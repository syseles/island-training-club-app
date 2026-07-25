// ==========================================================================
// ITC prototype — state store.
// localStorage-backed stand-in for the future backend. Every domain action
// (signup, approval, booking, payment, cancellation, admin edits) goes
// through this module so swapping in a real API later touches one file.
// ==========================================================================

import {
  SEED_ACTIVITIES,
  SEED_USERS,
  seedBookings,
  seedReceipts,
  sessionsInRange,
  todayLocal,
  isoDate,
  fmtDate,
  fmtTime,
  uid,
} from "./data.js";

const STORAGE_KEY = "itc.prototype.v1";

let state = null;

function freshState() {
  return {
    sessionUserId: null,
    activities: structuredClone(SEED_ACTIVITIES),
    users: structuredClone(SEED_USERS),
    bookings: seedBookings(),
    receipts: seedReceipts(),
    receiptCounter: 49,
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : freshState();
  } catch {
    state = freshState();
  }
  save();
  return state;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetDemo() {
  localStorage.removeItem(STORAGE_KEY);
  return load();
}

// --- Session / auth ----------------------------------------------------------

export function currentUser() {
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

export function demoSignIn(role) {
  const user = state.users.find((u) => u.role === role && u.status === "approved");
  if (!user) return { ok: false, reason: "not-found" };
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
    baseBooked: draft.kind === "paid" ? Number(draft.baseBooked) || 0 : undefined,
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
  const taken = (session.baseBooked || 0) + activeBookingsForSession(session.id).length;
  return Math.max(0, session.capacity - taken);
}

export function attendeesFor(session) {
  // Simulated member list: seed bookings plus any local bookings.
  const pool = [
    "Ava C.", "Daniel L.", "Marco S.", "Jenny W.", "Kelvin T.",
    "Chris P.", "Wing L.", "Sam H.", "Rachel N.", "Tom Y.",
    "Grace F.", "Ben K.", "Michelle O.", "Alex Z.",
  ];
  const names = pool.slice(0, Math.min(session.baseBooked || 0, pool.length));
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

// Simulated in-app payment. Returns { booking, receipt }.
export function payForSession(userId, session, cardLast4) {
  if (session.kind !== "paid") throw new Error("Session is not paid");
  if (spotsLeft(session) <= 0) throw new Error("Session is full");
  if (userBookingFor(userId, session.id)) throw new Error("Already booked");

  const booking = {
    id: uid("b"),
    userId,
    sessionId: session.id,
    status: "confirmed",
    createdAt: Date.now(),
    snapshot: {
      name: session.name,
      kind: session.kind,
      dateISO: session.dateISO,
      time: session.time,
      durationMin: session.durationMin,
      location: session.location,
      price: session.price,
    },
  };
  const receipt = {
    id: uid("r"),
    number: `ITC-${new Date().getFullYear()}-${String(state.receiptCounter++).padStart(4, "0")}`,
    bookingId: booking.id,
    userId,
    amount: session.price,
    currency: "HKD",
    cardLast4: cardLast4 || "4242",
    status: "paid",
    issuedAt: Date.now(),
    line: `${session.name} — ${fmtDate(session.date)} ${fmtTime(session.time)}`,
  };
  state.bookings.push(booking);
  state.receipts.push(receipt);
  save();
  return { booking, receipt };
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

export { isoDate, todayLocal };
