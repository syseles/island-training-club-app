// ==========================================================================
// ITC prototype — state store.
// localStorage-backed stand-in for the future backend. Every domain action
// (signup, approval, booking, payment, cancellation, admin edits) goes
// through this module so swapping in a real API later touches one file.
// ==========================================================================

import {
  SEED_ACTIVITIES,
  sessionsInRange,
  sessionStarted,
  parseISO,
  findSession,
  todayLocal,
  isoDate,
  saturdayOnOrAfter,
  fmtDate,
  fmtTime,
  nextPayDeadline,
  uid,
  normalizeDonorId,
  donorIdProblem,
} from "./data.js";
import { supabase, isLive } from "./config.js";

const STORAGE_KEY = "itc.prototype.v1";
const STATE_VERSION = 10;

// Live-mode (Supabase) session cache. Avoids hammering the DB on every
// page load. The TTL is short so role flips and welcome notifications
// surface promptly after the admin takes an action.
let liveProfile = null;
let liveUser = null;
let liveProfileFetchedAt = 0;
const LIVE_PROFILE_TTL_MS = 30_000;

let state = null;

function freshState() {
  return {
    version: STATE_VERSION,
    sessionUserId: null,
    activities: structuredClone(SEED_ACTIVITIES),
    users: [],
    bookings: [],
    receipts: [],
    receiptCounter: 49,
    prayers: [],
    sessionOverrides: {},
    queues: {},
    notifications: [],
    duty: {},
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : freshState();
  } catch {
    state = freshState();
  }
  migrate();
  sweepCheckpoints();
  save();
  return state;
}

// One-time, versioned migrations for persisted state that predates a
// seed-data revision. Each step runs once per version so admin edits made
// afterwards are not reverted on the next load.
function migrate() {
  // Persisted prototypes may predate individual collections or contain null
  // values. Normalize every collection before a legacy step or early return.
  for (const key of ["users", "activities", "bookings", "receipts", "prayers", "notifications"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.queues || typeof state.queues !== "object" || Array.isArray(state.queues)) {
    state.queues = {};
  }
  if (!state.sessionOverrides || typeof state.sessionOverrides !== "object"
    || Array.isArray(state.sessionOverrides)) {
    state.sessionOverrides = {};
  }
  if (!state.duty || typeof state.duty !== "object") state.duty = {};

  const v = state.version || 0;
  if (v >= STATE_VERSION) return;
  if (v < 2) {
    // v2: Sunday Trail Run removed; HYROX moved to Sat 11:15 at Causeway Bay
    // BFT (HK$180) and a second Saturday session added at Midtown 28 (11:00).
    state.activities = state.activities.filter(
      (a) => a.id !== "trail" && a.id !== "hyrox" && a.id !== "hyrox-midtown"
    );
    state.activities.push(
      ...SEED_ACTIVITIES.filter((a) => a.category === "HYROX").map((a) =>
        structuredClone(a)
      )
    );
  }
  if (v < 3) {
    // v3: Run Club moved to Mon 7:30 PM with venue TBC; Water Sports Evening
    // renamed ITC Swimming at 7:30 PM. Activities are replaced in place
    // from the current activity configuration.
    const seedAct = new Map(SEED_ACTIVITIES.map((a) => [a.id, a]));
    state.activities = state.activities.map((a) =>
      a.id === "run" || a.id === "water"
        ? structuredClone(seedAct.get(a.id))
        : a
    );
  }
  if (v < 4) {
    // v4: HYROX venue renamed "Causeway Bay BFT" -> "BFT Causeway Bay"
    // (activity location + any booking snapshots carrying the old string).
    // Only exact old-string matches are rewritten so admin edits made
    // since are preserved.
    const hyrox = state.activities.find((a) => a.id === "hyrox");
    if (hyrox && hyrox.location === "Causeway Bay BFT") {
      hyrox.location = "BFT Causeway Bay";
    }
    for (const b of state.bookings) {
      if (b.snapshot?.location === "Causeway Bay BFT") {
        b.snapshot.location = "BFT Causeway Bay";
      }
    }
  }
  if (v < 5) {
    // v5: Wednesday Night Training venue changed to TBC (location, maps
    // query, member note). Only exact old-seed matches are rewritten so
    // admin edits made since are preserved; booking snapshots get the
    // same treatment.
    const wnt = state.activities.find((a) => a.id === "wnt");
    if (wnt && wnt.location === "Tamar Park, Admiralty") {
      wnt.location = "TBC";
      wnt.mapsQuery = "";
      wnt.memberNote =
        "Meeting point to be confirmed — check back before Wednesday. Bring water.";
    }
    for (const b of state.bookings) {
      if (b.snapshot?.location === "Tamar Park, Admiralty") {
        b.snapshot.location = "TBC";
      }
    }
  }
  if (v < 6) {
    // v6: indemnity acceptance is now tracked per member; approved seed
    // members predate the requirement and are backfilled, everyone else
    // accepts from Profile > Indemnity. Exact-sentinel match only.
    for (const id of ["u-super", "u-admin", "u-member"]) {
      const u = state.users.find((x) => x.id === id);
      if (u && u.indemnityAcceptedAt === undefined) {
        u.indemnityAcceptedAt = u.appliedAt;
      }
    }
  }
  if (v < 7) {
    // v7: donor IDs saved before the LASTNAME-NNNN(N) format rule existed
    // may be missing the hyphen (CHUI08879) or use another separator, and
    // would display that way in Profile > Donor Profile. Repair what is
    // recognizable to the canonical form; clear the rest so the member
    // re-enters it through the validated form.
    for (const u of state.users) {
      if (!u.donorId) continue;
      const repaired = normalizeDonorId(
        String(u.donorId).trim().replace(/^([A-Za-z]+)(\d{4,5})$/, "$1-$2")
      );
      u.donorId = repaired && !donorIdProblem(repaired) ? repaired : null;
    }
  }
  if (v < 8) {
    // v8: prayer requests (Community > Prayers) are stored locally.
    // (No-op: collection normalization above initializes the array.)
  }
  if (v < 9) {
    // v9: HYROX capacities corrected to the real gym bookings (BFT 20,
    // Midtown 12). Payment-system state introduced: per-week session
    // overrides, waitlist/interest queues, duty roster, notifications.
    // (Collection normalization above initializes the structures.)
    for (const a of state.activities) {
      if (a.id === "hyrox" && a.capacity === 18) a.capacity = 20;
      if (a.id === "hyrox-midtown" && a.capacity === 18) a.capacity = 12;
    }
  }
  if (v < 10) {
    // v10: strip the historical local demo. Exact-sentinel match only —
    // every genuine user, application, booking, receipt, queue entry,
    // duty assignment, and notification is preserved. Demo demand on
    // activities is removed so capacity reflects real confirmed bookings
    // only. Collector payout details seeded for demo accounts are also
    // stripped; Admin can add real payout details when they set up duty.
    const demoIds = new Set(["u-super", "u-admin", "u-member", "u-pend-1", "u-pend-2"]);
    const demoEmails = new Set([
      "owner@itc.hk",
      "admin@itc.hk",
      "member@itc.hk",
      "marco.santos@example.com",
      "jenny.wu@example.com",
    ]);
    const removedUserIds = new Set(demoIds);
    state.users = state.users.filter((user) => {
      const matches = demoIds.has(user.id)
        || demoEmails.has(String(user.email ?? "").trim().toLowerCase());
      if (matches) removedUserIds.add(user.id);
      return !matches;
    });
    if (removedUserIds.has(state.sessionUserId)) state.sessionUserId = null;

    const removedBookingIds = new Set();
    state.bookings = state.bookings.filter((booking) => {
      const remove = removedUserIds.has(booking.userId);
      if (remove) removedBookingIds.add(booking.id);
      return !remove;
    });
    state.receipts = state.receipts.filter(
      (receipt) => !removedUserIds.has(receipt.userId)
        && !removedBookingIds.has(receipt.bookingId)
    );

    // Queue and notification entries referencing removed demo users are
    // stripped; unmatched ones survive.
    const filterByUserId = (entries) =>
      (Array.isArray(entries) ? entries : []).filter((id) => !removedUserIds.has(id));
    for (const [sessionId, q] of Object.entries(state.queues || {})) {
      state.queues[sessionId] = {
        waitlist: filterByUserId(q?.waitlist),
        interest: filterByUserId(q?.interest),
      };
    }
    for (const n of state.notifications || []) {
      if (removedUserIds.has(n.userId) || removedUserIds.has(n.actorId)) {
        n.removedByCleanup = true;
      }
    }
    state.notifications = state.notifications.filter((n) => !n.removedByCleanup);

    // Duty roster entries pointing at removed demo collectors are cleared;
    // genuine assignments survive.
    if (state.duty && typeof state.duty === "object") {
      for (const [date, slot] of Object.entries(state.duty)) {
        if (slot && removedUserIds.has(slot.userId)) {
          delete state.duty[date];
        }
      }
    }

    for (const activity of state.activities) delete activity.baseBooked;
  }
  state.version = STATE_VERSION;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetLocalData() {
  localStorage.removeItem(STORAGE_KEY);
  return load();
}

// --- Session / auth ----------------------------------------------------------

export function currentUser() {
  if (isLive()) return liveUser;
  if (!state.sessionUserId) return null;
  return state.users.find((u) => u.id === state.sessionUserId) ?? null;
}

export function signIn(email) {
  const user = state.users.find(
    (u) => u.email.toLowerCase() === String(email).trim().toLowerCase()
  );
  if (!user) return { ok: false, reason: "not-found" };
  if (user.status === "declined") {
    state.sessionUserId = user.id;
    save();
    return { ok: true, user, declined: true };
  }
  state.sessionUserId = user.id;
  save();
  return { ok: true, user };
}

export function signOut() {
  state.sessionUserId = null;
  save();
}

// --- Signup / approval ---------------------------------------------------------

export function applyForMembership(form) {
  const email = String(form.email).trim().toLowerCase();
  if (state.users.some((u) => u.email.toLowerCase() === email)) {
    return { ok: false, reason: "duplicate" };
  }
  const user = {
    id: uid("u"),
    role: "pending",
    status: "pending",
    fullName: form.fullName.trim(),
    preferredName: form.preferredName.trim(),
    email,
    phone: form.phone.trim(),
    ageConfirmed: !!form.ageConfirmed,
    emergencyName: form.emergencyName.trim(),
    emergencyPhone: form.emergencyPhone.trim(),
    heard: form.heard.trim(),
    mediaConsent: !!form.mediaConsent,
    donorId: normalizeDonorId(form.donorId),
    // Joining requires accepting the health & liability indemnity; the
    // timestamp is the member's acceptance record (Profile > Indemnity).
    indemnityAcceptedAt: form.indemnity ? Date.now() : null,
    appliedAt: Date.now(),
  };
  state.users.push(user);
  state.sessionUserId = user.id; // applicant keeps public-level access while pending
  save();
  return { ok: true, user };
}

export function pendingApplicants() {
  return state.users
    .filter((u) => u.status === "pending")
    .sort((a, b) => a.appliedAt - b.appliedAt);
}

export function approveApplicant(userId) {
  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== "pending") return;
  user.status = "approved";
  user.role = "member";
  save();
}

export function declineApplicant(userId) {
  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== "pending") return;
  user.status = "declined";
  user.role = "pending";
  save();
}

export function setRole(userId, role) {
  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== "approved") return;
  user.role = role;
  save();
}

// Donor ID is optional at sign-up; members who skipped it (or answered
// "not applicable", which normalizes to null) can add it later from Profile.
export function updateDonorId(userId, raw) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  user.donorId = normalizeDonorId(raw);
  save();
  return user.donorId;
}

// Records the member's acceptance of the health & liability indemnity.
// Idempotent — the first acceptance timestamp is the record that matters.
export function acceptIndemnity(userId) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  if (!user.indemnityAcceptedAt) {
    user.indemnityAcceptedAt = Date.now();
    save();
  }
  return user.indemnityAcceptedAt;
}

// --- Activities & sessions -------------------------------------------------------

export function activities() {
  return state.activities;
}

export function getActivity(id) {
  return state.activities.find((a) => a.id === id) ?? null;
}

export function saveActivity(draft) {
  const existing = state.activities.find((a) => a.id === draft.id);
  const record = {
    ...draft,
    price: draft.kind === "paid" ? Number(draft.price) || 0 : undefined,
    capacity: draft.kind === "paid" ? Number(draft.capacity) || 0 : undefined,
    durationMin: Number(draft.durationMin) || 60,
    weekday: Number(draft.weekday),
  };
  if (existing) {
    Object.assign(existing, record);
    save();
    return { id: existing.id, created: false };
  }
  const id = draft.id || uid("act");
  state.activities.push({ ...record, id });
  save();
  return { id, created: true };
}

export function allUsers() {
  return state.users;
}

export function activeBookingsForSession(sessionId) {
  return state.bookings.filter(
    (b) => b.sessionId === sessionId && b.status === "confirmed"
  );
}

export function spotsLeft(session) {
  if (session.kind !== "paid") return null;
  return Math.max(0, session.capacity - heldBookingsForSession(session.id).length);
}

export function attendeesFor(session) {
  const names = [];
  for (const b of activeBookingsForSession(session.id)) {
    const u = state.users.find((x) => x.id === b.userId);
    if (u) names.unshift(`${u.preferredName || u.fullName} ${u.fullName.split(" ").pop()[0]}.`);
  }
  return names;
}

// --- Booking & payment ------------------------------------------------------------

export function userBookingFor(userId, sessionId) {
  return state.bookings.find(
    (b) => b.userId === userId && b.sessionId === sessionId && b.status === "confirmed"
  );
}

export function bookingsForUser(userId) {
  return state.bookings
    .filter((b) => b.userId === userId)
    .sort((a, b) => b.snapshot.dateISO.localeCompare(a.snapshot.dateISO));
}

export function receiptsForUser(userId) {
  return state.receipts
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.issuedAt - a.issuedAt);
}

export function getBooking(id) {
  return state.bookings.find((b) => b.id === id) ?? null;
}

export function getReceipt(id) {
  return state.receipts.find((r) => r.id === id) ?? null;
}

export function receiptForBooking(bookingId) {
  return state.receipts.find((r) => r.bookingId === bookingId) ?? null;
}

export function notify(userId, kind, body, link) {
  state.notifications.push({ id: uid("n"), userId, kind, body, link, read: false, createdAt: Date.now() });
}

export function notificationsFor(userId) {
  return state.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function heldBookingsForSession(sessionId) {
  return state.bookings.filter(
    (b) => b.sessionId === sessionId && (b.status === "reserved" || b.status === "confirmed")
  );
}

export function userReservationFor(userId, sessionId) {
  return state.bookings.find(
    (b) => b.userId === userId && b.sessionId === sessionId && b.status === "reserved"
  ) ?? null;
}

export function sessionDateOf(sessionId) {
  const m = sessionId.match(/-(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

export function isMidtown(sessionOrId) {
  const id = typeof sessionOrId === "string" ? sessionOrId : sessionOrId.id;
  return id.startsWith("hyrox-midtown");
}

export function midtownOpenFor(sessionOrId) {
  const id = typeof sessionOrId === "string" ? sessionOrId : sessionOrId.id;
  return !!state.sessionOverrides[id]?.midtownOpen;
}

// Midtown opens manually (collector decision). The interest list — members
// who said "wait for Midtown" — converts to reserved spots in join order;
// anyone past capacity becomes the Midtown waitlist, order preserved.
export function setMidtownOpen(sessionId, open, now = Date.now()) {
  const o = (state.sessionOverrides[sessionId] ||= {});
  o.midtownOpen = open;
  if (open) {
    const session = getSession(sessionId);
    const q = queueFor(sessionId);
    while (session && spotsLeft(session) > 0 && q.interest.length) {
      const { userId } = q.interest.shift();
      try {
        const booking = reserveSession(userId, session, now);
        notify(userId, "midtown-open",
          `Midtown is open and you're in for ${session.name} · ${fmtDate(session.date)}! Pay by the checkpoint to keep your spot.`,
          `#/pay/${booking.id}`);
      } catch {
        // already booked — skip
      }
    }
    q.waitlist = [...q.waitlist, ...q.interest.splice(0)];
  }
  save();
}

function receiptNumber() {
  return `ITC-${new Date().getFullYear()}-${String(state.receiptCounter++).padStart(4, "0")}`;
}

function snapshotFor(session) {
  return {
    name: session.name, kind: session.kind, dateISO: session.dateISO,
    time: session.time, durationMin: session.durationMin,
    location: session.location, price: session.price ?? null,
  };
}

// Reserve a spot without paying. The spot is held until the next payment
// checkpoint (Thu 6 PM, then Fri 2 PM, then a 2-hour last-minute window).
export function reserveSession(userId, session, now = Date.now()) {
  if (session.kind !== "paid") throw new Error("Session is not paid");
  if (session.cancelled) throw new Error("Session is cancelled");
  if (sessionStarted(session)) throw new Error("Session has already started");
  if (isMidtown(session) && !midtownOpenFor(session)) throw new Error("Session is not open");
  if (spotsLeft(session) <= 0) throw new Error("Session is full");
  if (
    userBookingFor(userId, session.id) || userReservationFor(userId, session.id)
  ) throw new Error("Already booked");

  const booking = {
    id: uid("b"),
    userId,
    sessionId: session.id,
    status: "reserved",
    createdAt: now,
    reservedAt: now,
    payDeadlineAt: nextPayDeadline(session.dateISO, now),
    paymentMarkedAt: null,
    paidAt: null,
    paidMethod: null,
    paymentRef: null,
    confirmedBy: null,
    deferredTo: null,
    deferredFrom: null,
    reminderSentAt: null,
    snapshot: snapshotFor(session),
  };
  state.bookings.push(booking);
  save();
  return booking;
}

// Member taps "I've paid" after sending PayMe/FPS. Lands in the on-duty
// collector's pending list; the spot stays held until they confirm.
export function markBookingPaid(bookingId, method, ref, now = Date.now()) {
  const b = getBooking(bookingId);
  if (!b || b.status !== "reserved" || b.paymentMarkedAt) return null;
  b.paymentMarkedAt = now;
  b.paidMethod = method === "FPS" ? "FPS" : "PayMe";
  b.paymentRef = String(ref ?? "").trim() || null;
  const collector = collectorFor(b.sessionId);
  if (collector) {
    const who = state.users.find((u) => u.id === b.userId);
    notify(
      collector.id,
      "payment-marked",
      `${who?.preferredName || who?.fullName || "A member"} marked a ${b.paidMethod} payment for ${b.snapshot.name} — ${fmtDate(b.snapshot.dateISO)}. Confirm when it lands.`,
      "#/admin/ops"
    );
  }
  save();
  return b;
}

// Collector confirms the money arrived. Payment = commitment: any other
// venue hold the member had for the same Saturday is released.
export function confirmBookingPayment(bookingId, collectorId, now = Date.now()) {
  const b = getBooking(bookingId);
  if (!b || b.status !== "reserved" || !b.paymentMarkedAt) return null;
  b.status = "confirmed";
  b.paidAt = now;
  b.confirmedBy = collectorId;
  const receipt = {
    id: uid("r"),
    number: receiptNumber(),
    bookingId: b.id,
    userId: b.userId,
    amount: b.snapshot.price,
    currency: "HKD",
    method: b.paidMethod || "PayMe",
    status: "paid",
    issuedAt: now,
    line: `${b.snapshot.name} — ${fmtDate(b.snapshot.dateISO)} ${fmtTime(b.snapshot.time)}`,
  };
  state.receipts.push(receipt);
  // Payment = commitment. Release the member's holds and queue spots at the
  // OTHER venue for the same Saturday; freed spots cascade immediately.
  const otherVenueId = isMidtown(b.sessionId)
    ? `hyrox-${b.snapshot.dateISO}`
    : `hyrox-midtown-${b.snapshot.dateISO}`;
  const other = state.bookings.find(
    (x) => x.userId === b.userId && x.sessionId === otherVenueId && x.status === "reserved"
  );
  if (other) {
    other.status = "cancelled";
    notify(b.userId, "hold-released",
      `You're booked for ${b.snapshot.location} — your unpaid ${other.snapshot.location} spot was released to the waitlist.`,
      `#/booking/${b.id}`);
    cascadeSession(other.sessionId, now);
  }
  const q = queueFor(otherVenueId);
  const wasQueued =
    q.waitlist.some((e) => e.userId === b.userId) || q.interest.some((e) => e.userId === b.userId);
  q.waitlist = q.waitlist.filter((e) => e.userId !== b.userId);
  q.interest = q.interest.filter((e) => e.userId !== b.userId);
  if (wasQueued && !other) {
    notify(b.userId, "hold-released",
      `You're booked for ${b.snapshot.location} — your spot in the other venue queue was released.`,
      `#/booking/${b.id}`);
  }
  notify(b.userId, "payment-confirmed",
    `Payment confirmed — you're booked for ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)}.`,
    `#/booking/${b.id}`);
  save();
  return { booking: b, receipt };
}

// Cancellation/refund policy is unresolved in the brief; the prototype issues
// an automatic refund and frees the place.
export function cancelBooking(bookingId) {
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== "confirmed") return null;
  booking.status = "cancelled";
  const receipt = receiptForBooking(bookingId);
  if (receipt) receipt.status = "refunded";
  save();
  return booking;
}

// --- Checkpoint sweep & cascade --------------------------------------------
// Deterministic: called on load and every render with now = Date.now();
// tests call it with manipulated deadlines. No timers anywhere.

export function queueFor(sessionId) {
  if (!state.queues[sessionId]) {
    state.queues[sessionId] = { waitlist: [], interest: [] };
  }
  return state.queues[sessionId];
}

export function sweepCheckpoints(now = Date.now()) {
  let dirty = false;
  for (const b of state.bookings) {
    if (b.status !== "reserved") continue;
    // A member who already marked "I've paid" is waiting on the collector,
    // not the clock — the collector confirms or releases at the checkpoint.
    if (!b.paymentMarkedAt && b.payDeadlineAt && now > b.payDeadlineAt) {
      b.status = "expired";
      notify(b.userId, "reservation-expired",
        `Your unpaid spot for ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} expired at the payment deadline — it went to the waitlist.`,
        `#/activity/${b.sessionId}`);
      cascadeSession(b.sessionId, now);
      dirty = true;
    } else if (
      !b.paymentMarkedAt && !b.reminderSentAt && b.payDeadlineAt &&
      now > b.payDeadlineAt - 24 * 3600 * 1000 && now < b.payDeadlineAt
    ) {
      b.reminderSentAt = now;
      notify(b.userId, "payment-reminder",
        `Reminder: pay for ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} by the checkpoint or your spot goes to the waitlist.`,
        `#/pay/${b.id}`);
      dirty = true;
    }
  }
  if (dirty) save();
}

export function cascadeSession(sessionId, now = Date.now()) {
  const session = getSession(sessionId);
  if (!session || session.cancelled) return;
  if (isMidtown(session) && !midtownOpenFor(session)) return;
  const q = queueFor(sessionId);
  while (spotsLeft(session) > 0 && q.waitlist.length) {
    const { userId } = q.waitlist.shift();
    try {
      const booking = reserveSession(userId, session, now);
      notify(userId, "waitlist-promoted",
        `A spot opened for ${session.name} · ${fmtDate(session.date)} — you're in! Pay by the checkpoint to keep it.`,
        `#/pay/${booking.id}`);
    } catch {
      // member already holds this session somehow — skip to next in line
    }
  }
  save();
}

// --- Queues: waitlist (open sessions) & interest (closed Midtown) ----------

function joinQueue(userId, sessionId, kind) {
  if (userBookingFor(userId, sessionId) || userReservationFor(userId, sessionId))
    throw new Error("Already booked");
  const q = queueFor(sessionId);
  for (const list of [q.waitlist, q.interest]) {
    if (list.some((e) => e.userId === userId)) throw new Error("Already in a queue for this session");
  }
  q[kind].push({ userId, joinedAt: Date.now() });
  save();
  return q[kind].length;
}

function leaveQueue(userId, sessionId, kind) {
  const q = queueFor(sessionId);
  q[kind] = q[kind].filter((e) => e.userId !== userId);
  save();
}

function queuePosition(userId, sessionId, kind) {
  const idx = queueFor(sessionId)[kind].findIndex((e) => e.userId === userId);
  return idx === -1 ? null : idx + 1;
}

export function joinWaitlist(userId, sessionId) { return joinQueue(userId, sessionId, "waitlist"); }
export function leaveWaitlist(userId, sessionId) { leaveQueue(userId, sessionId, "waitlist"); }
export function waitlistPosition(userId, sessionId) { return queuePosition(userId, sessionId, "waitlist"); }
export function joinInterest(userId, sessionId) { return joinQueue(userId, sessionId, "interest"); }
export function leaveInterest(userId, sessionId) { leaveQueue(userId, sessionId, "interest"); }
export function interestPosition(userId, sessionId) { return queuePosition(userId, sessionId, "interest"); }

// Session template + per-week override (cancelled, time, venueTBC, notice...).
export function getSession(sessionId) {
  const s = findSession(state.activities, sessionId);
  if (!s) return null;
  return decorateSession(s);
}

function decorateSession(s) {
  const o = state.sessionOverrides[s.id];
  if (!o) return s;
  const out = { ...s };
  if (o.time) out.time = o.time;
  if (o.cancelled) { out.cancelled = true; out.cancelReason = o.cancelled; }
  if (o.venueTBC) { out.venueTBC = true; out.location = "TBC"; }
  if (o.notice) out.notice = o.notice;
  if (o.midtownOpen) out.midtownOpen = true;
  return out;
}

// --- Next relevant activity (home) ---------------------------------------------------

export function upcomingSessions(days = 14) {
  const today = todayLocal();
  return sessionsInRange(state.activities, today, days).map((s) => ({
    ...s,
    spots: spotsLeft(s),
    past: false,
  }));
}

export function nextSession() {
  return upcomingSessions(14)[0] ?? null;
}

// --- Community: prayer requests ------------------------------------------------
// Requests go privately to ITC leaders (no public list in the app), so the
// store only records them — there is intentionally no reader exposed here.

export function recordPrayer({ userId, name, request }) {
  const prayer = {
    id: uid("p"),
    userId: userId ?? null,
    name: String(name ?? "").trim(),
    request: String(request ?? "").trim(),
    createdAt: Date.now(),
  };
  state.prayers.push(prayer);
  save();
  return prayer;
}

// --- Duty roster --------------------------------------------------------------
// One collector per week (Saturday date) covering both venues. The member's
// payment screen shows this collector's PayMe/FPS details; mid-week switches
// change the target for new payments.

export function collectorFor(sessionId) {
  // Resolve the active collector for the session's Saturday. Prefer a
  // explicitly-assigned duty entry for that date; fall back to any
  // approved Admin/Super Admin. Returns null when no collector is
  // available so callers can skip notifications.
  const session = findSession(state.activities, sessionId);
  if (session) {
    const slot = state.duty?.[isoDate(session.date)];
    if (slot?.userId) {
      const assigned = state.users.find((u) => u.id === slot.userId);
      if (assigned && assigned.status === "approved" &&
          (assigned.role === "admin" || assigned.role === "superadmin")) {
        return assigned;
      }
    }
  }
  return state.users.find((u) => u.status === "approved" &&
    (u.role === "admin" || u.role === "superadmin")) ?? null;
}

export function dutyFor(sessionId) {
  return state.duty[sessionDateOf(sessionId)] ?? null;
}

export function setDuty(userId, saturdayISO) {
  const u = state.users.find((x) => x.id === userId);
  if (!u || !["admin", "superadmin"].includes(u.role) || u.status !== "approved") return;
  state.duty[saturdayISO] = { userId, setAt: Date.now() };
  save();
}

export function updateCollectorPayouts(userId, { paymeLink, fpsPhone }) {
  const u = state.users.find((x) => x.id === userId);
  if (!u) return;
  u.paymeLink = String(paymeLink ?? "").trim();
  u.fpsPhone = String(fpsPhone ?? "").trim();
  save();
}

// --- Deferral (defer-only policy; no member refunds) ------------------------

export function deferTargetsFor(booking) {
  const from = parseISO(booking.snapshot.dateISO);
  return sessionsInRange(state.activities, from, 28)
    .map((s) => getSession(s.id))
    .filter(
      (s) =>
        s && s.kind === "paid" && s.id !== booking.sessionId &&
        !s.cancelled && !sessionStarted(s) &&
        (!isMidtown(s) || midtownOpenFor(s)) &&
        spotsLeft(s) > 0
    );
}

export function deferBooking(bookingId, targetSessionId, now = Date.now()) {
  const b = getBooking(bookingId);
  if (!b || (b.status !== "reserved" && b.status !== "confirmed"))
    throw new Error("Booking cannot be deferred");
  const src = getSession(b.sessionId);
  if (src && sessionStarted(src)) throw new Error("Session has already started");
  const target = getSession(targetSessionId);
  if (!target || target.kind !== "paid" || target.cancelled || sessionStarted(target))
    throw new Error("That session is not available");
  if (isMidtown(target) && !midtownOpenFor(target)) throw new Error("Session is not open");
  if (spotsLeft(target) <= 0) throw new Error("Session is full");

  const wasPaid = b.status === "confirmed";
  const moved = {
    ...b,
    id: uid("b"),
    sessionId: target.id,
    status: wasPaid ? "confirmed" : "reserved",
    createdAt: now,
    reservedAt: wasPaid ? null : now,
    payDeadlineAt: wasPaid ? null : nextPayDeadline(target.dateISO, now),
    paymentMarkedAt: wasPaid ? b.paymentMarkedAt : null,
    deferredFrom: b.id,
    deferredTo: null,
    snapshot: snapshotFor(target),
  };
  b.status = "deferred";
  b.deferredTo = target.id;
  state.bookings.push(moved);
  const receipt = receiptForBooking(b.id);
  if (receipt) {
    receipt.bookingId = moved.id;
    receipt.line = `${moved.snapshot.name} — ${fmtDate(moved.snapshot.dateISO)} ${fmtTime(moved.snapshot.time)}`;
  }
  const who = state.users.find((u) => u.id === b.userId);
  const collector = collectorFor(target.id);
  if (collector) {
    notify(collector.id, "defer",
      `${who?.preferredName || who?.fullName || "A member"} deferred ${wasPaid ? "a paid booking" : "a reservation"} to ${target.name} · ${fmtDate(target.date)} — headcount updated.`,
      "#/admin/ops");
  }
  notify(b.userId, "deferred",
    `Moved to ${target.name} · ${fmtDate(target.date)}${wasPaid ? " — your payment carried over." : ". Pay by the new checkpoint."}`,
    `#/booking/${moved.id}`);
  cascadeSession(b.sessionId, now); // freed spot goes to the waitlist
  save();
  return moved;
}

// --- Per-week session admin --------------------------------------------------

export function cancelSessionWeek(sessionId, reason, now = Date.now()) {
  const o = (state.sessionOverrides[sessionId] ||= {});
  o.cancelled = String(reason || "").trim() || "No session this week";
  const venueActivityId = sessionId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  for (const b of state.bookings.filter((x) => x.sessionId === sessionId)) {
    if (b.status === "confirmed") {
      const target = deferTargetsFor(b).find((s) => s.activityId === venueActivityId);
      if (target) {
        deferBooking(b.id, target.id, now);
      } else {
        b.status = "cancelled";
        notify(b.userId, "session-cancelled",
          `${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} was cancelled (${o.cancelled}) and no future slot was free — a leader will sort your credit.`,
          "#/schedule");
      }
    } else if (b.status === "reserved") {
      b.status = "cancelled";
      notify(b.userId, "session-cancelled",
        `${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} was cancelled (${o.cancelled}) — your unpaid reservation was released.`,
        "#/schedule");
    }
  }
  const q = queueFor(sessionId);
  for (const entry of [...q.waitlist, ...q.interest]) {
    notify(entry.userId, "session-cancelled",
      `ITC HYROX · ${fmtDate(sessionDateOf(sessionId))} was cancelled (${o.cancelled}) — the waitlist was dissolved.`,
      "#/schedule");
  }
  q.waitlist = [];
  q.interest = [];
  save();
}

export function setSessionTime(sessionId, time) {
  (state.sessionOverrides[sessionId] ||= {}).time = time;
  save();
}

export function setVenueTBC(sessionId, on) {
  (state.sessionOverrides[sessionId] ||= {}).venueTBC = !!on;
  save();
}

export function setSessionNotice(sessionId, text) {
  (state.sessionOverrides[sessionId] ||= {}).notice = String(text || "").trim() || undefined;
  save();
}

export { isoDate, todayLocal };
// --- Live (Supabase) auth helpers (from canonical Auth baseline) ----
// --- Live (Supabase) auth helpers --------------------------------------------

export async function getCurrentUser() {
  if (!isLive() || !supabase) return currentUser();
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessData.session) {
    liveUser = null;
    return null;
  }
  const authUser = sessData.session.user;
  if (!liveProfile || Date.now() - liveProfileFetchedAt > LIVE_PROFILE_TTL_MS) {
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profErr) {
      // Never fail silently — a broken profile read renders a signed-in
      // user as a visitor with no clue why (cf. the 42P17 RLS recursion).
      console.error("profiles fetch failed", profErr);
      return null;
    }
    liveProfile = prof || {
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.user_metadata?.full_name || null,
      avatar_url: authUser.user_metadata?.avatar_url || null,
      role: "pending",
    };
    liveProfileFetchedAt = Date.now();
  }
  const fullName = liveProfile.full_name || liveProfile.email || "ITC Member";
  liveUser = {
    id: liveProfile.id,
    email: liveProfile.email,
    fullName,
    preferredName: fullName.split(" ")[0],
    avatarUrl: liveProfile.avatar_url,
    appliedAt: liveProfile.created_at,
    role: liveProfile.role,
    status:
      liveProfile.role === "pending"
        ? "pending"
        : liveProfile.role === "declined"
          ? "declined"
          : "approved",
    profile: liveProfile,
  };
  return liveUser;
}

export async function signInWithGoogle() {
  if (!isLive || !supabase) {
    throw new Error("signInWithGoogle requires SUPABASE_URL and SUPABASE_ANON_KEY");
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  if (error) throw error;
}

export async function signOutLive() {
  if (!isLive() || !supabase) return signOut();
  liveProfile = null;
  liveUser = null;
  liveProfileFetchedAt = 0;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// --- Admin: user/role management (Supabase) --------------------------------

export async function listProfiles() {
  if (!isLive() || !supabase) return allUsers();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listRoleChanges() {
  if (!isLive() || !supabase) return [];
  const { data, error } = await supabase
    .from("role_changes")
    .select("*, changed_by_profile:changed_by(email, full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateProfileRole(profileId, newRole, reason, expectedRole = null) {
  if (!isLive() || !supabase) return setRole(profileId, newRole);
  let query = supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", profileId);
  if (expectedRole) query = query.eq("role", expectedRole);
  const { data, error } = await query.select("id, role").single();
  if (error) throw error;
  if (!data || data.id !== profileId || data.role !== newRole) {
    throw new Error("Application decision conflict.");
  }
  // The DB trigger writes role_changes + welcome notification automatically.
  // Persisting `reason` to role_changes.reason requires a small Postgres
  // RPC that sets a session-local config; deferred. ⏳
  if (reason) console.info("role update reason:", reason);
}

// --- Applicant: application form (B; Supabase) ------------------------------

function localApplication(user) {
  return {
    profile_id: user.id,
    mobile: user.phone || "",
    is_minor: !!user.isMinor,
    guardian_name: user.guardianName || null,
    guardian_phone: user.guardianPhone || null,
    emergency_name: user.emergencyName || "",
    emergency_phone: user.emergencyPhone || "",
    heard_source: user.heard || "other",
    heard_detail: user.heardDetail || null,
    preferred_name: user.preferredName || null,
    photo_consent: !!user.mediaConsent,
    waiver_accepted_at: user.indemnityAcceptedAt || null,
    privacy_accepted_at: user.privacyAcceptedAt || null,
    guidelines_accepted_at: user.guidelinesAcceptedAt || user.appliedAt || null,
    submitted_at: user.appliedAt || null,
    whatsapp_reminders: !!user.whatsappReminders,
    email_receipts: !!user.emailReceipts,
    community_news: !!user.communityNews,
  };
}

function membershipPatch(form) {
  const isMinor = parseAgeOver18(form.age_over_18);
  const guardian = guardianFields(isMinor, form.guardian_name, form.guardian_phone);
  const patch = {
    mobile: String(form.mobile || "").trim(),
    is_minor: isMinor,
    date_of_birth: null,
    guardian_name: guardian.name,
    guardian_phone: guardian.phone,
    emergency_name: String(form.emergency_name || "").trim(),
    emergency_phone: String(form.emergency_phone || "").trim(),
    heard_source: String(form.heard_source || "").trim(),
    heard_detail: String(form.heard_detail || "").trim() || null,
    preferred_name: String(form.preferred_name || "").trim() || null,
  };
  if (!patch.mobile) throw new Error("Enter mobile number");
  if (!patch.emergency_name || !patch.emergency_phone) {
    throw new Error("Enter emergency contact name and phone");
  }
  if (!patch.heard_source) throw new Error("Choose how you heard about ITC");
  return patch;
}

function privacyPatch(form) {
  return {
    photo_consent: !!form.photo_consent,
    whatsapp_reminders: !!form.whatsapp_reminders,
    email_receipts: !!form.email_receipts,
    community_news: !!form.community_news,
  };
}

export async function fetchApplicationForUser(user) {
  if (!isLive() || !supabase || !user || !user.id) return null;
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyApplication() {
  if (!isLive() || !supabase) {
    const user = currentUser();
    return user ? localApplication(user) : null;
  }
  const cu = await getCurrentUser();
  if (!cu) return null;
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("profile_id", cu.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveMyApplication(form) {
  if (!isLive() || !supabase) {
    throw new Error("saveMyApplication requires live mode");
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const isMinor = parseAgeOver18(form.age_over_18);
  const guardian = guardianFields(isMinor, form.guardian_name, form.guardian_phone);
  const row = {
    profile_id: cu.id,
    mobile: form.mobile,
    date_of_birth: null,
    is_minor: isMinor,
    guardian_name: guardian.name,
    guardian_phone: guardian.phone,
    emergency_name: form.emergency_name,
    emergency_phone: form.emergency_phone,
    heard_source: form.heard_source,
    heard_detail: form.heard_detail || null,
    preferred_name: form.preferred_name || null,
    photo_consent: !!form.photo_consent,
    waiver_accepted_at: new Date().toISOString(),
    privacy_accepted_at: new Date().toISOString(),
    guidelines_accepted_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("applications").upsert(row);
  if (error) throw error;
}

export async function updateMyMembershipDetails(form) {
  const patch = membershipPatch(form);
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    user.phone = patch.mobile;
    user.isMinor = patch.is_minor;
    user.guardianName = patch.guardian_name;
    user.guardianPhone = patch.guardian_phone;
    user.emergencyName = patch.emergency_name;
    user.emergencyPhone = patch.emergency_phone;
    user.heard = patch.heard_source;
    user.heardDetail = patch.heard_detail;
    user.preferredName = patch.preferred_name;
    save();
    return localApplication(user);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyPrivacyPreferences(form) {
  const patch = privacyPatch(form);
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    user.mediaConsent = patch.photo_consent;
    user.whatsappReminders = patch.whatsapp_reminders;
    user.emailReceipts = patch.email_receipts;
    user.communityNews = patch.community_news;
    save();
    return localApplication(user);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptMyIndemnity() {
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    if (!user.indemnityAcceptedAt) {
      user.indemnityAcceptedAt = Date.now();
      save();
    }
    return user.indemnityAcceptedAt;
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const app = await getMyApplication();
  if (!app) throw new Error("Application not found");
  if (app.waiver_accepted_at) return app.waiver_accepted_at;
  const waiver_accepted_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("applications")
    .update({ waiver_accepted_at })
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data.waiver_accepted_at;
}

function parseAgeOver18(value) {
  if (value === "yes") return false;
  if (value === "no") return true;
  throw new Error("Choose whether you are 18 or over");
}

function guardianFields(isMinor, name, phone) {
  if (!isMinor) return { name: null, phone: null };
  const guardianName = String(name || "").trim();
  const guardianPhone = String(phone || "").trim();
  if (!guardianName || !guardianPhone) {
    throw new Error("Enter guardian name and phone");
  }
  return { name: guardianName, phone: guardianPhone };
}

// --- Notifications (B; Supabase) -----------------------------------------------
// Live: pending applications joined with their profiles, mapped to the
// shape the admin approvals cards render. Local: the seed applicants.
export async function listPendingApplications() {
  if (!isLive() || !supabase) return pendingApplicants();
  const { data, error } = await supabase
    .from("applications")
    .select("*, profiles(id, email, full_name, role)");
  if (error) throw error;
  return (data || [])
    .filter((a) => a.profiles?.role === "pending")
    .map((a) => ({
      id: a.profiles.id,
      fullName: a.profiles.full_name || a.profiles.email,
      email: a.profiles.email,
      phone: a.mobile,
      emergencyName: a.emergency_name,
      emergencyPhone: a.emergency_phone,
      heard: a.heard_source,
      appliedAt: a.submitted_at,
      isMinor: !!a.is_minor,
      indemnityAcceptedAt: a.waiver_accepted_at,
      mediaConsent: a.photo_consent,
    }));
}

export async function listApprovalCandidates() {
  if (!isLive() || !supabase) {
    return pendingApplicants().map((user) => ({
      ...user,
      applicationSubmitted: true,
    }));
  }
  const [profiles, applications] = await Promise.all([
    listProfiles(),
    listPendingApplications(),
  ]);
  const applicationByProfile = new Map(applications.map((item) => [item.id, item]));
  return profiles
    .filter((profile) => profile.role === "pending")
    .map((profile) => {
      const application = applicationByProfile.get(profile.id);
      return application
        ? { ...application, applicationSubmitted: true }
        : {
            id: profile.id,
            fullName: profile.full_name || profile.email,
            email: profile.email,
            appliedAt: profile.created_at,
            applicationSubmitted: false,
          };
    })
    .sort((a, b) => new Date(a.appliedAt) - new Date(b.appliedAt));
}

export async function decideApplication(profileId, decision) {
  if (!new Set(["member", "declined"]).has(decision)) {
    throw new Error("Invalid application decision.");
  }
  if (!isLive() || !supabase) {
    const candidate = pendingApplicants().find((user) => user.id === profileId);
    if (!candidate) throw new Error("Pending application not found.");
    if (decision === "member") approveApplicant(profileId);
    else declineApplicant(profileId);
    return;
  }
  const candidate = (await listApprovalCandidates()).find((item) => item.id === profileId);
  if (!candidate) throw new Error("Pending application not found.");
  if (!candidate.applicationSubmitted) throw new Error("Application not submitted.");
  await updateProfileRole(profileId, decision, undefined, "pending");
}



export async function listMyNotifications() {
  if (!isLive() || !supabase) return [];
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id) {
  if (!isLive() || !supabase) return;
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null)
    .select("id, read_at")
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error("Notification update conflict.");
  return data;
}

// --- Approval workflow (Supabase) — canonical Auth baseline exports ---
