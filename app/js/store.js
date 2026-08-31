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
  hktEventStartMs,
  parseISO,
  findSession,
  todayHktISO,
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
import { INDEMNITY_VERSION } from "./documents.js";
import { normalizeMeetingPoint, normalizeVenueLocation } from "./venue.js";
import * as liveOps from "./operations.js";

const STORAGE_KEY = "itc.prototype.v1";
const APPLY_DEVICE_KEY = "itc.device.id";
const APPLY_DRAFT_KEY = "itc.apply.draft.v1";
const APPLY_DRAFT_VERSION = 1;
const STATE_VERSION = 16;

// Live-mode (Supabase) session cache. Avoids hammering the DB on every
// page load. The TTL is short so role flips and welcome notifications
// surface promptly after the admin takes an action.
let liveProfile = null;
let liveUser = null;
let liveProfileFetchedAt = 0;
let liveGivingCampaign = null;
// Supabase remains the identity directory. Payment Ops caches live profiles
// in memory only; device-local persistence stores UUID-keyed operations.
let livePaymentDirectory = new Map();
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
    paymentPayouts: {},
    campaigns: [],
    donations: [],
    prayers: [],
    oneOffEvents: [],
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

export async function hydrateLiveOperations({ ensureWindow = false, force = false } = {}) {
  if (!isLive()) return null;
  if (ensureWindow) {
    try {
      await liveOps.ensureLiveSessionWindow();
    } catch (err) {
      console.warn("ensureLiveSessionWindow failed", err);
    }
  }
  await liveOps.hydrateOperationalState({ force });
  await liveOps.startOperationalRealtime();
  return liveOps.operationalStateStatus();
}

function normalizeReceiptCounter() {
  if (Number.isInteger(state.receiptCounter) && state.receiptCounter >= 0) return;
  const highestIssued = state.receipts.reduce((highest, receipt) => {
    const match = String(receipt?.number || "").match(/-(\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, -1);
  state.receiptCounter = Math.max(49, highestIssued + 1);
}

// One-time, versioned migrations for persisted state that predates a
// seed-data revision. Each step runs once per version so admin edits made
// afterwards are not reverted on the next load.
function migrate() {
  // Persisted prototypes may predate individual collections or contain null
  // values. Normalize every collection before a legacy step or early return.
  for (const key of ["users", "activities", "bookings", "receipts", "campaigns", "donations", "prayers", "notifications", "oneOffEvents"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.queues || typeof state.queues !== "object" || Array.isArray(state.queues)) {
    state.queues = {};
  }
  if (!state.sessionOverrides || typeof state.sessionOverrides !== "object"
    || Array.isArray(state.sessionOverrides)) {
    state.sessionOverrides = {};
  }
  if (!state.duty || typeof state.duty !== "object" || Array.isArray(state.duty)) state.duty = {};
  if (!state.paymentPayouts || typeof state.paymentPayouts !== "object"
      || Array.isArray(state.paymentPayouts)) state.paymentPayouts = {};
  // v14 carries forward the additive UUID-keyed operations map for every
  // accepted v9-v13 snapshot.
  for (const user of state.users) {
    if (!user?.id || state.paymentPayouts[user.id] || (!user.paymeLink && !user.fpsPhone)) continue;
    state.paymentPayouts[user.id] = {
      paymeLink: String(user.paymeLink ?? "").trim(),
      fpsPhone: String(user.fpsPhone ?? "").trim(),
    };
  }
  normalizeReceiptCounter();

  const v = state.version || 0;
  if (v >= STATE_VERSION) return;
  if (v < 16) {
    // v16: the recurring post-training lunch (RSVP kind, Meals category)
    // joins the seed activities. Existing states get it appended without
    // touching admin edits.
    if (Array.isArray(state.activities) && !state.activities.some((a) => a.id === "lunch")) {
      const lunch = SEED_ACTIVITIES.find((a) => a.id === "lunch");
      if (lunch) state.activities.push(structuredClone(lunch));
    }
  }
  if (v < 15) {
    // v15: admin-created one-off events live in state.oneOffEvents
    // (activity-shaped entries with oneOff + dateISO). The collection
    // normalization above guarantees the array; this step only documents
    // the version boundary.
    if (!Array.isArray(state.oneOffEvents)) state.oneOffEvents = [];
  }
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
  if (v < 13) {
    // v13 reconciles genuine v9-v12 state with Payment's historical demo
    // cleanup. Exact-sentinel match only —
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
      (Array.isArray(entries) ? entries : []).filter((entry) => {
        const userId = entry && typeof entry === "object" ? entry.userId : entry;
        return !removedUserIds.has(userId);
      });
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

    // Giving's only known seeded transactions are removed by exact ID.
    // Campaigns and every unmatched donation remain untouched.
    const seedDonationIds = new Set(["d-seed-1", "d-seed-2"]);
    state.donations = state.donations.filter((donation) => !seedDonationIds.has(donation.id));
  }
  if (v < 9) {
    // v9: remove only the exact identities shipped by the historical local
    // demo. Matching by normalized email also catches records whose IDs were
    // changed locally. Everything not owned by those identities is retained.
    const demoIds = new Set(["u-super", "u-admin", "u-member", "u-pend-1", "u-pend-2"]);
    const demoEmails = new Set([
      "owner@itc.hk",
      "admin@itc.hk",
      "member@itc.hk",
      "marco.santos@example.com",
      "jenny.wu@example.com",
    ]);
    const users = Array.isArray(state.users) ? state.users : [];
    const removedUserIds = new Set(demoIds);
    state.users = users.filter((user) => {
      const matches = demoIds.has(user.id)
        || demoEmails.has(String(user.email ?? "").trim().toLowerCase());
      if (matches) removedUserIds.add(user.id);
      return !matches;
    });
    if (removedUserIds.has(state.sessionUserId)) state.sessionUserId = null;

    const bookings = Array.isArray(state.bookings) ? state.bookings : [];
    const removedBookingIds = new Set();
    state.bookings = bookings.filter((booking) => {
      const remove = removedUserIds.has(booking.userId);
      if (remove) removedBookingIds.add(booking.id);
      return !remove;
    });
    const receipts = Array.isArray(state.receipts) ? state.receipts : [];
    state.receipts = receipts.filter(
      (receipt) => !removedUserIds.has(receipt.userId)
        && !removedBookingIds.has(receipt.bookingId)
    );
    const activities = Array.isArray(state.activities) ? state.activities : [];
    for (const activity of activities) delete activity.baseBooked;
    state.activities = activities;
  }
  if (v < 14) {
    for (const user of state.users) {
      for (const field of [
        "indemnitySignature",
        "indemnitySignedAt",
        "indemnityFormVersion",
        "emergencyRelationship",
      ]) {
        if (!Object.prototype.hasOwnProperty.call(user, field)) user[field] = null;
      }
    }
    const water = state.activities.find((activity) => activity.id === "water");
    if (water) {
      if (["Victoria Park", "Victoria Park Swimming Pool"].includes(water.location)) {
        water.location = "TBC";
      }
      if (["Victoria Park, Hong Kong", "Victoria Park Swimming Pool, Hong Kong", "TBC"].includes(water.mapsQuery)) {
        water.mapsQuery = "";
      }
      if (water.photo === "../assets/itc/main.webp") {
        water.photo = "../assets/itc/water.webp";
      }
    }

    const midtown = state.activities.find((activity) => activity.id === "hyrox-midtown");
    if (midtown?.location === "Midtown 28") midtown.location = "Midtown28 Fitness";
    if (midtown?.mapsQuery === "Midtown 28, Hong Kong") {
      midtown.mapsQuery = "Midtown28 Fitness, Hong Kong";
    }
    for (const booking of state.bookings) {
      if (booking.snapshot?.location === "Midtown 28") {
        booking.snapshot.location = "Midtown28 Fitness";
      }
    }
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

// Payment records may be changed by their approved owner or by an approved
// Admin/Super Admin performing an operational flow. In live mode currentUser()
// is the cached Supabase profile; affected members are not copied into local
// identity state, so an approved Admin may operate on their UUID-owned record.
const PAYMENT_ADMIN_ROLES = new Set(["admin", "superadmin", "super_admin"]);
const normalizePaymentUser = (profile) => {
  if (!profile) return null;
  const role = profile.role === "super_admin" ? "superadmin" : profile.role;
  const fullName = profile.fullName || profile.full_name || profile.email || "ITC Member";
  return {
    id: profile.id,
    email: profile.email,
    fullName,
    preferredName: profile.preferredName || null,
    role,
    status: profile.status || (role === "pending" || role === "declined" ? role : "approved"),
  };
};

function paymentUserById(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  if (!isLive()) return state.users.find((user) => user.id === id) ?? null;
  const actor = currentUser();
  return livePaymentDirectory.get(id) ?? (actor?.id === id ? normalizePaymentUser(actor) : null);
}

function requireApprovedPaymentOwner(userId) {
  const owner = paymentUserById(userId);
  if (!owner || owner.status !== "approved") {
    throw new Error("Approved member access required");
  }
  return owner;
}

function requirePaymentAdminActor() {
  const actor = currentUser();
  if (!actor || actor.status !== "approved" || !PAYMENT_ADMIN_ROLES.has(actor.role)) {
    throw new Error("Approved Admin access required");
  }
  return actor;
}

function requireAuthorizedPaymentOwner(userId) {
  const id = String(userId || "").trim();
  const actor = currentUser();
  if (!actor || actor.status !== "approved") {
    throw new Error("Approved actor access required");
  }
  if (actor.id !== id && !PAYMENT_ADMIN_ROLES.has(actor.role)) {
    throw new Error("Payment mutation not authorized");
  }
  return requireApprovedPaymentOwner(id);
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

// --- Membership application drafts --------------------------------------------

export function getApplyDeviceId() {
  try {
    let id = localStorage.getItem(APPLY_DEVICE_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || uid("device");
      localStorage.setItem(APPLY_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function getApplyDraft() {
  try {
    const raw = localStorage.getItem(APPLY_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const deviceId = getApplyDeviceId();
    const valid = draft?.version === APPLY_DRAFT_VERSION
      && draft?.deviceId === deviceId
      && Number.isFinite(draft?.savedAt)
      && draft?.fields
      && typeof draft.fields === "object"
      && !Array.isArray(draft.fields);
    if (!valid) {
      localStorage.removeItem(APPLY_DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch {}
    return null;
  }
}

export function saveApplyDraft({ fields = {} } = {}) {
  try {
    const deviceId = getApplyDeviceId();
    if (!deviceId) return null;
    const existing = getApplyDraft();
    const draft = {
      version: APPLY_DRAFT_VERSION,
      deviceId,
      savedAt: Date.now(),
      fields: { ...(existing?.fields || {}), ...fields },
    };
    localStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function clearApplyDraft() {
  try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch {}
}

// --- Signup / approval ---------------------------------------------------------

function normalizeEmergencyContact({
  emergencyName,
  emergencyRelationship,
  emergencyPhone,
} = {}) {
  const name = String(emergencyName || "").trim();
  const relationship = String(emergencyRelationship || "").trim();
  const phone = String(emergencyPhone || "").trim();
  if (!name || !relationship || !phone) {
    throw new Error("Enter emergency contact name, relationship and phone");
  }
  return { name, relationship, phone };
}

function normalizeIndemnityAcceptance({
  signature,
  signedAt,
  emergencyName,
  emergencyRelationship,
  emergencyPhone,
  formVersion = INDEMNITY_VERSION,
} = {}) {
  const normalizedSignature = String(signature || "").trim();
  const normalizedSignedAt = String(signedAt || "").trim();
  const emergency = normalizeEmergencyContact({
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
  });
  if (normalizedSignature.length < 2) {
    throw new Error("Type your full name as your signature");
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedSignedAt)
    && isoDate(parseISO(normalizedSignedAt)) === normalizedSignedAt;
  if (!validDate) throw new Error("Enter a valid signing date");
  if (normalizedSignedAt > todayHktISO()) {
    throw new Error("Signing date cannot be in the future");
  }
  if (formVersion !== INDEMNITY_VERSION) {
    throw new Error("The Indemnity has changed. Reload and review the current document");
  }
  return {
    signature: normalizedSignature,
    signedAt: normalizedSignedAt,
    emergencyName: emergency.name,
    emergencyRelationship: emergency.relationship,
    emergencyPhone: emergency.phone,
    formVersion: INDEMNITY_VERSION,
  };
}

export function isIndemnityCurrent(user) {
  if (!user?.indemnityAcceptedAt || user.indemnityFormVersion !== INDEMNITY_VERSION) return false;
  if (String(user.indemnitySignature || "").trim().length < 2) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(user.indemnitySignedAt || ""))) return false;
  return !!String(user.emergencyName || "").trim()
    && !!String(user.emergencyRelationship || "").trim()
    && !!String(user.emergencyPhone || "").trim();
}

export function applyForMembership(form) {
  const email = String(form.email).trim().toLowerCase();
  if (state.users.some((u) => u.email.toLowerCase() === email)) {
    return { ok: false, reason: "duplicate" };
  }
  if (!form.indemnity) throw new Error("Read and accept the Indemnity");
  const acceptance = normalizeIndemnityAcceptance({
    signature: form.indemnitySignature,
    signedAt: form.indemnitySignedAt,
    emergencyName: form.emergencyName,
    emergencyRelationship: form.emergencyRelationship,
    emergencyPhone: form.emergencyPhone,
  });
  const acceptedAt = Date.now();
  const user = {
    id: uid("u"),
    role: "pending",
    status: "pending",
    fullName: form.fullName.trim(),
    preferredName: form.preferredName.trim(),
    email,
    phone: form.phone.trim(),
    ageConfirmed: !!form.ageConfirmed,
    emergencyName: acceptance.emergencyName,
    emergencyRelationship: acceptance.emergencyRelationship,
    emergencyPhone: acceptance.emergencyPhone,
    heard: form.heard.trim(),
    mediaConsent: !!form.mediaConsent,
    donorId: normalizeDonorId(form.donorId),
    indemnityAcceptedAt: acceptedAt,
    indemnitySignature: acceptance.signature,
    indemnitySignedAt: acceptance.signedAt,
    indemnityFormVersion: acceptance.formVersion,
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

export async function updateMyDonorId(raw) {
  const donorId = normalizeDonorId(raw);
  if (!donorId || donorIdProblem(donorId)) throw new Error("Enter a valid Donor ID");
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    user.donorId = donorId;
    save();
    return donorId;
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("applications")
    .update({ donor_id: donorId })
    .eq("profile_id", cu.id)
    .select("donor_id")
    .single();
  if (error) throw error;
  return data.donor_id;
}

export function acceptIndemnity(userId, payload) {
  const user = state.users.find((candidate) => candidate.id === userId);
  if (!user) return null;
  const acceptance = normalizeIndemnityAcceptance({
    ...payload,
    emergencyName: user.emergencyName,
    emergencyPhone: user.emergencyPhone,
  });
  user.indemnityAcceptedAt = Date.now();
  user.indemnitySignature = acceptance.signature;
  user.indemnitySignedAt = acceptance.signedAt;
  user.indemnityFormVersion = acceptance.formVersion;
  user.emergencyRelationship = acceptance.emergencyRelationship;
  save();
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
  requirePaymentAdminActor();
  const existing = state.activities.find((a) => a.id === draft.id);
  const record = {
    ...draft,
    photo: existing?.photo || draft.photo || "../assets/itc/main.webp",
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

export async function listPaymentUsers() {
  requirePaymentAdminActor();
  if (!isLive() || !supabase) return state.users;
  const profiles = await listProfiles();
  livePaymentDirectory = new Map(
    profiles.map(normalizePaymentUser).filter(Boolean).map((user) => [user.id, user])
  );
  const actor = currentUser();
  if (actor && !livePaymentDirectory.has(actor.id)) {
    livePaymentDirectory.set(actor.id, normalizePaymentUser(actor));
  }
  return [...livePaymentDirectory.values()];
}

export function pendingPaymentBookings() {
  if (isLive()) {
    const list = liveOps.livePendingBookings();
    return list.slice().sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
  }
  requirePaymentAdminActor();
  return state.bookings
    .filter((booking) => booking.status === "reserved" && booking.paymentMarkedAt)
    .sort((a, b) => a.snapshot.dateISO.localeCompare(b.snapshot.dateISO));
}

export function activeBookingsForSession(sessionId) {
  if (isLive()) {
    return liveOps.liveConfirmedBookingsForSession(sessionId);
  }
  return state.bookings.filter(
    (b) => b.sessionId === sessionId && b.status === "confirmed"
  );
}

export function spotsLeft(session) {
  if (!session) return null;
  if (session.kind === "free") return null;
  if (session.capacity == null) return null; // uncapped (e.g. the RSVP lunch)
  if (isLive()) {
    return Math.max(0, session.capacity - liveOps.liveHeldBookingsForSession(session.id).length);
  }
  return Math.max(0, session.capacity - heldBookingsForSession(session.id).length);
}

export function attendeeCountFor(session) {
  if (!session?.id) return 0;
  if (isLive()) {
    const exactCount = liveOps.liveRsvpCountFor(session.id);
    if (exactCount !== null) return exactCount;
  }
  return activeBookingsForSession(session.id).length;
}

export function attendeesFor(session) {
  const names = [];
  for (const b of activeBookingsForSession(session.id)) {
    const u = state.users.find((x) => x.id === b.userId);
    if (u) names.push(`${u.preferredName || u.fullName} ${u.fullName.split(" ").pop()[0]}.`);
  }
  return names;
}

// --- Booking & payment ------------------------------------------------------------
// Exported mutation policy at this backend seam:
// - Member self-service (or Admin on the owner's behalf): reserve, mark paid,
//   release, defer, and queue join/leave.
// - Admin operations: confirm/cancel payments, activity and weekly-session
//   administration, duty assignment, payout editing, and gym confirmation.
// - Automatic maintenance only: checkpoint expiry, queue promotion/cascade,
//   and operational notifications stay private so callers cannot bypass the
//   actor-authorized exports above.

export function userBookingFor(userId, sessionId) {
  if (isLive()) {
    return liveOps.liveBookingsForUser(userId).find(
      (b) => b.sessionId === sessionId && b.status === "confirmed"
    ) || null;
  }
  return state.bookings.find(
    (b) => b.userId === userId && b.sessionId === sessionId && b.status === "confirmed"
  );
}

export function bookingsForUser(userId) {
  if (isLive()) {
    return liveOps.liveBookingsForUser(userId).slice().sort(
      (a, b) => (b.dateISO || "").localeCompare(a.dateISO || "")
    );
  }
  return state.bookings
    .filter((b) => b.userId === userId)
    .sort((a, b) => b.snapshot.dateISO.localeCompare(a.snapshot.dateISO));
}

export function receiptsForUser(userId) {
  if (isLive()) {
    return liveOps.liveReceiptsForUser(userId);
  }
  return state.receipts
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.issuedAt - a.issuedAt);
}

export function getBooking(id) {
  if (isLive()) return liveOps.liveBookingById(id);
  return state.bookings.find((b) => b.id === id) ?? null;
}

export function getReceipt(id) {
  if (isLive()) return liveOps.liveReceiptById(id);
  return state.receipts.find((r) => r.id === id) ?? null;
}

export function receiptForBooking(bookingId) {
  if (isLive()) return liveOps.liveReceiptForBooking(bookingId);
  return state.receipts.find((r) => r.bookingId === bookingId) ?? null;
}

function notify(userId, kind, body, link) {
  state.notifications.push({ id: uid("n"), userId, kind, body, link, read: false, createdAt: Date.now() });
}

export function notificationsFor(userId) {
  return state.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function heldBookingsForSession(sessionId) {
  if (isLive()) return liveOps.liveHeldBookingsForSession(sessionId);
  return state.bookings.filter(
    (b) => b.sessionId === sessionId && (b.status === "reserved" || b.status === "confirmed")
  );
}

export function userReservationFor(userId, sessionId) {
  if (isLive()) {
    return liveOps.liveBookingsForUser(userId).find(
      (b) => b.sessionId === sessionId && b.status === "reserved"
    ) || null;
  }
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
  if (isLive()) {
    const live = liveOps.getLiveSession(id);
    if (live) return !!live.isOpen;
  }
  return !!state.sessionOverrides[id]?.midtownOpen;
}

// Midtown opens manually (collector decision). The interest list — members
// who said "wait for Midtown" — converts to reserved spots in join order;
// anyone past capacity becomes the Midtown waitlist, order preserved.
export function setMidtownOpen(sessionId, open, now = Date.now()) {
  if (isLive()) {
    return liveOps.liveSetMidtownOpen(sessionId, open);
  }
  requirePaymentAdminActor();
  const o = (state.sessionOverrides[sessionId] ||= {});
  o.midtownOpen = open;
  if (open) {
    const session = getSession(sessionId);
    const q = paymentQueueFor(sessionId);
    while (session && spotsLeft(session) > 0 && q.interest.length) {
      const { userId } = q.interest.shift();
      try {
        const booking = reserveApprovedSession(userId, session, now);
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
  normalizeReceiptCounter();
  const counter = state.receiptCounter;
  state.receiptCounter += 1;
  return `ITC-${new Date().getFullYear()}-${String(counter).padStart(4, "0")}`;
}

function snapshotFor(session) {
  return {
    name: session.name, kind: session.kind, dateISO: session.dateISO,
    time: session.time, durationMin: session.durationMin,
    location: session.location, price: session.price ?? null,
    capacity: session.capacity ?? null,
  };
}

// Reserve a spot without paying. The spot is held until the next payment
// checkpoint (Thu 6 PM, then Fri 2 PM, then a 2-hour last-minute window).
export function reserveSession(userId, sessionOrId, now = Date.now()) {
  if (isLive()) {
    const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
    return liveOps.liveReserveSession(sessionId);
  }
  requireAuthorizedPaymentOwner(userId);
  return reserveApprovedSession(userId, sessionOrId, now);
}

// Private consequence path for checkpoint and Admin queue promotion. Both
// paths accept only a canonical ID (or an object's ID for caller compatibility)
// and resolve every operational field from authoritative weekly state.
function reserveApprovedSession(userId, sessionOrId, now = Date.now()) {
  requireApprovedPaymentOwner(userId);
  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
  const session = typeof sessionId === "string" ? getSession(sessionId) : null;
  if (!session) throw new Error("Unknown session");
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
  if (isLive()) {
    const normalized = method === "FPS" ? "fps" : "payme";
    return liveOps.liveMarkBookingPaid(bookingId, normalized, ref);
  }
  const b = getBooking(bookingId);
  if (!b || b.status !== "reserved" || b.paymentMarkedAt) return null;
  requireAuthorizedPaymentOwner(b.userId);
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
export function confirmBookingPayment(bookingId, now = Date.now()) {
  if (isLive()) {
    return liveOps.liveApproveBookingPayment(bookingId);
  }
  const b = getBooking(bookingId);
  if (!b || b.status !== "reserved" || !b.paymentMarkedAt) return null;
  const actor = requirePaymentAdminActor();
  requireApprovedPaymentOwner(b.userId);
  b.status = "confirmed";
  b.paidAt = now;
  b.confirmedBy = actor.id;
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
  const q = paymentQueueFor(otherVenueId);
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

// Releasing an unpaid reservation is member self-service; confirmed booking
// cancellation/refund remains an Admin operation while policy is unresolved.
export function releaseReservation(bookingId, now = Date.now()) {
  if (isLive()) {
    return liveOps.liveReleaseReservation(bookingId);
  }
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== "reserved" || booking.paymentMarkedAt) return null;
  requireAuthorizedPaymentOwner(booking.userId);
  booking.status = "cancelled";
  cascadeSession(booking.sessionId, now);
  save();
  return booking;
}

export function cancelBooking(bookingId) {
  requirePaymentAdminActor();
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== "confirmed") return null;
  booking.status = "cancelled";
  const receipt = receiptForBooking(bookingId);
  if (receipt) receipt.status = "refunded";
  save();
  return booking;
}

// --- Checkpoint sweep & cascade --------------------------------------------
// Deterministic: called internally on load with now = Date.now(). No timers.

function paymentQueueFor(sessionId) {
  if (isLive()) {
    const queue = liveOps.liveQueueForSession(sessionId);
    return {
      waitlist: queue.waitlist.map((q) => ({ userId: q.userId, joinedAt: q.joinedAt })),
      interest: queue.interest.map((q) => ({ userId: q.userId, joinedAt: q.joinedAt })),
    };
  }
  if (!state.queues[sessionId]) {
    state.queues[sessionId] = { waitlist: [], interest: [] };
  }
  return state.queues[sessionId];
}

export function queueFor(sessionId) {
  const queue = paymentQueueFor(sessionId);
  return {
    waitlist: queue.waitlist.map((entry) => typeof entry === "string" ? entry : { ...entry }),
    interest: queue.interest.map((entry) => typeof entry === "string" ? entry : { ...entry }),
  };
}

function sweepCheckpoints(now = Date.now()) {
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

function cascadeSession(sessionId, now = Date.now()) {
  const session = getSession(sessionId);
  if (!session || session.cancelled) return;
  if (isMidtown(session) && !midtownOpenFor(session)) return;
  const q = paymentQueueFor(sessionId);
  while (spotsLeft(session) > 0 && q.waitlist.length) {
    const { userId } = q.waitlist.shift();
    try {
      const booking = reserveApprovedSession(userId, session, now);
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
  requireAuthorizedPaymentOwner(userId);
  if (userBookingFor(userId, sessionId) || userReservationFor(userId, sessionId))
    throw new Error("Already booked");
  const q = paymentQueueFor(sessionId);
  for (const list of [q.waitlist, q.interest]) {
    if (list.some((e) => e.userId === userId)) throw new Error("Already in a queue for this session");
  }
  q[kind].push({ userId, joinedAt: Date.now() });
  save();
  return q[kind].length;
}

function leaveQueue(userId, sessionId, kind) {
  requireAuthorizedPaymentOwner(userId);
  const q = paymentQueueFor(sessionId);
  q[kind] = q[kind].filter((e) => e.userId !== userId);
  save();
}

function queuePosition(userId, sessionId, kind) {
  const idx = paymentQueueFor(sessionId)[kind].findIndex((e) => e.userId === userId);
  return idx === -1 ? null : idx + 1;
}

export function joinWaitlist(userId, sessionId) {
  if (isLive()) {
    return liveOps.liveJoinQueue(sessionId, "waitlist");
  }
  return joinQueue(userId, sessionId, "waitlist");
}
export function leaveWaitlist(userId, sessionId) {
  if (isLive()) {
    const session = liveOps.getLiveSession(sessionId);
    const entry = (session && liveOps.liveQueueForSession(sessionId).waitlist.find((q) => q.userId === userId))
      || null;
    if (entry) return liveOps.liveLeaveQueue(entry.id);
    return null;
  }
  return leaveQueue(userId, sessionId, "waitlist");
}
export function waitlistPosition(userId, sessionId) {
  if (isLive()) {
    const queue = liveOps.liveQueueForSession(sessionId).waitlist;
    const idx = queue.findIndex((q) => q.userId === userId);
    return idx === -1 ? null : idx + 1;
  }
  return queuePosition(userId, sessionId, "waitlist");
}
export function joinInterest(userId, sessionId) {
  if (isLive()) {
    return liveOps.liveJoinQueue(sessionId, "interest");
  }
  return joinQueue(userId, sessionId, "interest");
}
export function leaveInterest(userId, sessionId) {
  if (isLive()) {
    const entry = liveOps.liveQueueForSession(sessionId).interest.find((q) => q.userId === userId);
    if (entry) return liveOps.liveLeaveQueue(entry.id);
    return null;
  }
  return leaveQueue(userId, sessionId, "interest");
}
export function interestPosition(userId, sessionId) {
  if (isLive()) {
    const queue = liveOps.liveQueueForSession(sessionId).interest;
    const idx = queue.findIndex((q) => q.userId === userId);
    return idx === -1 ? null : idx + 1;
  }
  return queuePosition(userId, sessionId, "interest");
}

// Session template + per-week override (cancelled, time, venueTBC, notice...).
export function getSession(sessionId) {
  if (isLive()) {
    const live = liveOps.getLiveSession(sessionId);
    if (live) return live;
    // Free events live only in local state; the live cache has no row.
    const local = findSession(state.activities, sessionId);
    if (local) return decorateFreeSession(local);
    return null;
  }
  const s = findSession(state.activities, sessionId);
  if (!s) {
    const event = state.oneOffEvents.find((e) => `${e.id}-${e.dateISO}` === sessionId);
    if (!event) return null;
    return decorateSession(oneOffSessionFor(event));
  }
  return decorateSession(s);
}

function hasConfirmedVenue(location, mapsQuery) {
  const display = String(location || "").trim();
  const query = String(mapsQuery || "").trim();
  return Boolean(display && display.toUpperCase() !== "TBC"
    && query && query.toUpperCase() !== "TBC");
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
  if (o.gymConfirmedAt) out.gymConfirmedAt = o.gymConfirmedAt;
  if (o.gymNote) out.gymNote = o.gymNote;
  if (o.location) out.location = o.location;
  if (o.mapsQuery) out.mapsQuery = o.mapsQuery;
  const point = normalizeMeetingPoint(o.meetingLat, o.meetingLng);
  if (point) Object.assign(out, { meetingLat: point.lat, meetingLng: point.lng });
  if (hasConfirmedVenue(out.location, out.mapsQuery)) out.venueTBC = false;
  return out;
}

function decorateFreeSession(s) {
  const o = liveOps.getLiveVenueOverride(s.id);
  if (!o) return s;
  const out = { ...s };
  if (o.location) out.location = o.location;
  if (o.mapsQuery) out.mapsQuery = o.mapsQuery;
  const point = normalizeMeetingPoint(o.meetingLat, o.meetingLng);
  if (point) Object.assign(out, { meetingLat: point.lat, meetingLng: point.lng });
  if (hasConfirmedVenue(out.location, out.mapsQuery)) out.venueTBC = false;
  return out;
}

export function weekVenueOverride(sessionId) {
  const value = isLive()
    ? liveOps.getLiveVenueOverride(sessionId)
    : state.sessionOverrides[sessionId];
  if (!value) return { location: "", mapsQuery: "", meetingLat: "", meetingLng: "" };
  const notifiedAt = isLive()
    ? value.memberNotifiedAt
    : value.venueMemberNotifiedAt;
  const point = normalizeMeetingPoint(value.meetingLat, value.meetingLng);
  return {
    location: value.location || "",
    mapsQuery: value.mapsQuery || "",
    meetingLat: point?.lat ?? "",
    meetingLng: point?.lng ?? "",
    ...(notifiedAt ? { venueMemberNotifiedAt: notifiedAt } : {}),
  };
}

// --- Next relevant activity (home) ---------------------------------------------------

export function upcomingSessions(days = 14) {
  const todayISO = todayHktISO();
  const today = parseISO(todayISO);
  if (isLive()) {
    const end = new Date(today);
    end.setDate(end.getDate() + days - 1);
    const endISO = isoDate(end);
    const livePaid = liveOps.listLiveSessions()
      .filter((s) => s.dateISO >= todayISO && s.dateISO <= endISO)
      .sort((a, b) =>
        a.dateISO.localeCompare(b.dateISO) || String(a.time).localeCompare(String(b.time))
      )
      .map((s) => ({
        ...s,
        spots: spotsLeft(s),
        past: false,
      }));
    const freeSessions = sessionsInRange(
      state.activities.filter((a) => a.kind === "free"),
      today,
      days
    ).map((s) => {
      const decorated = decorateFreeSession(s);
      return {
        ...decorated,
        spots: spotsLeft(decorated),
        past: false,
      };
    });
    // Free (local) and paid/RSVP (live) sessions interleave by start time so
    // each day reads chronologically.
    return [...freeSessions, ...livePaid].sort((a, b) =>
      a.dateISO.localeCompare(b.dateISO) || String(a.time).localeCompare(String(b.time))
    );
  }
  const todayStart = today.getTime();
  const horizon = todayStart + days * 24 * 60 * 60 * 1000;
  const oneOffs = state.oneOffEvents
    .map(oneOffSessionFor)
    .filter((s) => s.date.getTime() >= todayStart && s.date.getTime() < horizon)
    .map((s) => {
      const decorated = decorateSession(s);
      return { ...decorated, spots: spotsLeft(decorated), past: false };
    });
  return [...sessionsInRange(state.activities, today, days).map((s) => {
    const decorated = decorateSession(s);
    return {
      ...decorated,
      spots: spotsLeft(decorated),
      past: false,
    };
  }), ...oneOffs].sort((a, b) =>
    a.dateISO.localeCompare(b.dateISO) || String(a.time).localeCompare(String(b.time))
  );
}

export function nextSession() {
  return upcomingSessions(14)[0] ?? null;
}

export function nextSocialSession() {
  const now = Date.now();
  const latest = now + 7 * 24 * 60 * 60 * 1000;
  return upcomingSessions(8).find((session) => {
    if (session.category !== "Socials") return false;
    const startMs = hktEventStartMs(session.dateISO, session.time);
    return startMs >= now && startMs <= latest;
  }) ?? null;
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
  // Resolve identity from Supabase's in-memory directory in live mode and
  // compose only UUID-keyed payout operations from local persistence.
  const withPayouts = (user) => user
    ? { ...user, ...payoutDetailsForRead(state.paymentPayouts[user.id]) }
    : null;
  if (isLive()) {
    const dateISO = sessionDateOf(sessionId);
    if (dateISO) {
      const slot = liveOps.liveAssigneeForWeek(dateISO);
      if (slot) {
        const payouts = liveOps.livePayoutFor(slot.userId);
        const directory = livePaymentDirectory.get(slot.userId);
        const assigned = directory || (payouts ? { id: slot.userId, fullName: "On-duty collector", preferredName: null } : null);
        if (assigned) return payouts ? { ...assigned, ...payoutDetailsForRead(payouts) } : assigned;
      }
    }
    const candidates = [...livePaymentDirectory.values()];
    return withPayouts(candidates.find((user) =>
      user.status === "approved" && PAYMENT_ADMIN_ROLES.has(user.role)
    ) ?? null);
  }
  const session = findSession(state.activities, sessionId);
  if (session) {
    const slot = state.duty?.[isoDate(session.date)];
    if (slot?.userId) {
      const assigned = paymentUserById(slot.userId);
      if (assigned && assigned.status === "approved" && PAYMENT_ADMIN_ROLES.has(assigned.role)) {
        return withPayouts(assigned);
      }
      const payouts = state.paymentPayouts[slot.userId];
      if (payouts) {
        return {
          id: slot.userId,
          fullName: "On-duty collector",
          preferredName: null,
          ...payoutDetailsForRead(payouts),
        };
      }
    }
  }
  const candidates = state.users;
  return withPayouts(candidates.find((user) =>
    user.status === "approved" && PAYMENT_ADMIN_ROLES.has(user.role)
  ) ?? null);
}

export function dutyFor(sessionId) {
  if (isLive()) {
    const dateISO = sessionDateOf(sessionId);
    if (!dateISO) return null;
    return liveOps.liveAssigneeForWeek(dateISO);
  }
  return state.duty[sessionDateOf(sessionId)] ?? null;
}

export function setDuty(userId, saturdayISO) {
  if (isLive()) {
    return liveOps.liveSetCollector(saturdayISO, userId);
  }
  requirePaymentAdminActor();
  const target = paymentUserById(userId);
  if (!target || target.status !== "approved" || !PAYMENT_ADMIN_ROLES.has(target.role)) return null;
  state.duty[saturdayISO] = { userId: target.id, setAt: Date.now() };
  save();
  return state.duty[saturdayISO];
}

export function normalizePayMeLink(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return "";
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter your personal PayMe link.");
  }
  const authority = value.slice(value.indexOf("//") + 2).split(/[\/?#]/, 1)[0];
  const hasExplicitPort = authority.split("@").pop().includes(":");
  const pathname = url.pathname.replace(/\/+$/, "");
  const personalPath = pathname.split("/");
  let routePrefix = "";
  let collectorToken = "";
  try {
    routePrefix = decodeURIComponent(personalPath[1] || "");
    collectorToken = decodeURIComponent(personalPath[2] || "");
  } catch {
    throw new Error("Enter your personal PayMe link from PayMe.");
  }
  if (url.protocol !== "https:"
      || url.hostname.toLowerCase() !== "payme.hsbc.com.hk"
      || url.username
      || url.password
      || url.port
      || hasExplicitPort
      || personalPath.length !== 3
      || personalPath[0] !== ""
      || !/^\d+$/.test(routePrefix)
      || routePrefix.trim() !== routePrefix
      || /[\\/]/.test(routePrefix)
      || !collectorToken
      || collectorToken.trim() !== collectorToken
      || /[\\/]/.test(collectorToken)) {
    throw new Error("Enter your personal PayMe link from PayMe.");
  }
  url.pathname = pathname;
  return url.toString();
}

function payoutDetailsForRead(payouts) {
  const details = payouts || {};
  let paymeLink = "";
  try {
    paymeLink = normalizePayMeLink(details.paymeLink);
  } catch {
    // Persisted or live legacy values must not break payout views.
  }
  return { ...details, paymeLink };
}

export function collectorPayoutsFor(userId) {
  const profile = paymentUserById(userId);
  const profilePhone = String(profile?.phone || "").trim();
  if (isLive()) {
    const live = liveOps.livePayoutFor(userId);
    if (live) {
      const normalized = payoutDetailsForRead(live);
      return { paymeLink: normalized.paymeLink, fpsPhone: live.fpsPhone || profilePhone };
    }
    return { paymeLink: "", fpsPhone: profilePhone };
  }
  const saved = payoutDetailsForRead(state.paymentPayouts[userId]);
  return {
    paymeLink: "",
    fpsPhone: profilePhone || saved.fpsPhone || "",
    ...saved,
    // Membership Details is the source of truth whenever the local profile
    // has a phone number.
    ...(profilePhone ? { fpsPhone: profilePhone } : {}),
  };
}

export function updateCollectorPayouts(userId, { paymeLink, fpsPhone }) {
  const profile = paymentUserById(userId);
  const profilePhone = String(profile?.phone || "").trim();
  const resolvedFpsPhone = profilePhone || String(fpsPhone ?? "").trim();
  if (isLive()) {
    const normalizedPayMeLink = normalizePayMeLink(paymeLink);
    return liveOps.liveUpdatePayout(userId, normalizedPayMeLink, resolvedFpsPhone)
      .then((result) => {
        state.paymentPayouts[userId] = {
          paymeLink: normalizedPayMeLink,
          fpsPhone: resolvedFpsPhone,
        };
        save();
        return result;
      });
  }
  requirePaymentAdminActor();
  const target = paymentUserById(userId);
  if (!target || target.status !== "approved" || !PAYMENT_ADMIN_ROLES.has(target.role)) return null;
  state.paymentPayouts[target.id] = {
    paymeLink: normalizePayMeLink(paymeLink),
    fpsPhone: profilePhone || String(fpsPhone ?? "").trim(),
  };
  save();
  return collectorPayoutsFor(target.id);
}

// --- Deferral (defer-only policy; no member refunds) ------------------------

export function deferTargetsFor(booking) {
  const from = parseISO(booking.snapshot.dateISO);
  if (isLive()) {
    const sources = liveOps.listLiveSessions();
    return sources
      .filter((s) => s.dateISO > booking.snapshot.dateISO && !s.cancelled)
      .filter((s) => !sessionStarted(s))
      .filter((s) => !(isMidtown(s) && !midtownOpenFor(s)))
      .filter((s) => spotsLeft(s) > 0);
  }
  const sourceSessions = state.activities;
  return sessionsInRange(sourceSessions, from, 28)
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
  if (isLive()) {
    return liveOps.liveDeferBooking(bookingId, targetSessionId);
  }
  const b = getBooking(bookingId);
  if (!b || (b.status !== "reserved" && b.status !== "confirmed"))
    throw new Error("Booking cannot be deferred");
  requireAuthorizedPaymentOwner(b.userId);
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

// --- One-off events -----------------------------------------------------------
// Admin-created single-date events. Live mode stores them in Supabase (an
// inactive template + one session row via RPC); local mode keeps them in
// state.oneOffEvents as activity-shaped entries with a fixed dateISO.

function oneOffSessionFor(event) {
  const date = parseISO(event.dateISO);
  return {
    ...event,
    id: `${event.id}-${event.dateISO}`,
    activityId: event.id,
    date,
  };
}

// --- RSVP events ------------------------------------------------------------
// Price-0 sessions that still need a headcount (e.g. the post-training
// lunch): joining confirms instantly — no reserve/pay/confirm pipeline.

export async function rsvpSession(userId, sessionOrId, now = Date.now()) {
  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
  if (isLive()) {
    // The reserve RPC branches on price_hkd = 0 and confirms immediately.
    return liveOps.liveReserveSession(sessionId);
  }
  requireAuthorizedPaymentOwner(userId);
  const session = getSession(sessionId);
  if (!session) throw new Error("Unknown session");
  if (session.kind !== "rsvp") throw new Error("Session is not an RSVP event");
  if (session.cancelled) throw new Error("Session is cancelled");
  if (sessionStarted(session)) throw new Error("Session has already started");
  const spots = spotsLeft(session);
  if (spots !== null && spots <= 0) throw new Error("Session is full");
  if (userBookingFor(userId, session.id)) throw new Error("Already booked");
  const booking = {
    id: uid("b"),
    userId,
    sessionId: session.id,
    status: "confirmed",
    createdAt: now,
    reservedAt: now,
    payDeadlineAt: now,
    paymentMarkedAt: null,
    paidAt: now,
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

// Withdrawing an RSVP is member self-service: no money ever moved, so no
// admin involvement is needed (unlike paid confirmed bookings).
export async function withdrawRsvp(bookingId) {
  if (isLive()) {
    return liveOps.liveWithdrawRsvp(bookingId);
  }
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== "confirmed") return null;
  if (Number(booking.snapshot?.price) > 0) return null;
  requireAuthorizedPaymentOwner(booking.userId);
  booking.status = "cancelled";
  save();
  return booking;
}

export async function createOneOffEvent(fields) {
  const name = String(fields.name ?? "").trim();
  const dateISO = String(fields.dateISO ?? "").trim();
  const time = String(fields.time ?? "").trim();
  const durationMin = Number(fields.durationMin);
  const location = String(fields.location ?? "").trim();
  const mapsQuery = String(fields.mapsQuery ?? "").trim();
  const category = String(fields.category ?? "").trim() || "Other";
  const price = Math.max(0, Number(fields.price) || 0);
  const capacity = Math.max(1, Number(fields.capacity) || 20);
  if (!name) throw new Error("Enter the event name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new Error("Pick the event date.");
  if (!time) throw new Error("Pick the start time.");
  if (!Number.isFinite(durationMin) || durationMin <= 0) throw new Error("Enter a positive duration.");
  if (!location) throw new Error("Enter the venue.");
  const payload = { name, dateISO, time, durationMin, location, mapsQuery, category, price, capacity };
  if (isLive()) {
    return liveOps.liveCreateEvent(payload);
  }
  requirePaymentAdminActor();
  const event = {
    id: uid("event"),
    oneOff: true,
    dateISO,
    name,
    kind: price > 0 ? "paid" : "free",
    category,
    weekday: parseISO(dateISO).getDay(),
    time,
    durationMin,
    location,
    mapsQuery: mapsQuery || location,
    photo: "../assets/itc/main.webp",
    price,
    capacity,
    blurb: "",
    memberNote: "",
    published: true,
  };
  state.oneOffEvents.push(event);
  save();
  return oneOffSessionFor(event);
}

export async function deleteOneOffEvent(sessionId) {
  if (isLive()) {
    return liveOps.liveDeleteEvent(sessionId);
  }
  requirePaymentAdminActor();
  const event = state.oneOffEvents.find((e) => `${e.id}-${e.dateISO}` === sessionId);
  if (!event) throw new Error("Event not found.");
  const active = state.bookings.filter(
    (b) => b.sessionId === sessionId && (b.status === "reserved" || b.status === "confirmed")
  );
  if (active.length) {
    throw new Error("Event has active bookings — cancel the session instead.");
  }
  state.oneOffEvents = state.oneOffEvents.filter((e) => e.id !== event.id);
  save();
}

export function cancelSessionWeek(sessionId, reason, now = Date.now()) {
  if (isLive()) {
    return liveOps.liveCancelSession(sessionId, reason);
  }
  requirePaymentAdminActor();
  const o = (state.sessionOverrides[sessionId] ||= {});
  o.cancelled = String(reason || "").trim() || "No session this week";
  const session = getSession(sessionId);
  const cancellationCopy = `Session cancelled by ITC — ${o.cancelled}`;
  const cancellationLink = `#/activity/${sessionId}`;
  const venueActivityId = sessionId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  for (const b of state.bookings.filter((x) => x.sessionId === sessionId)) {
    if (b.status === "confirmed") {
      const target = deferTargetsFor(b).find((s) => s.activityId === venueActivityId);
      if (target) {
        deferBooking(b.id, target.id, now);
      } else {
        b.status = "cancelled";
        notify(b.userId, "session-cancelled",
          `${cancellationCopy}. ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} had no future slot available — a leader will sort your credit.`,
          cancellationLink);
      }
    } else if (b.status === "reserved") {
      b.status = "cancelled";
      notify(b.userId, "session-cancelled",
        `${cancellationCopy}. ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} — your unpaid reservation was released.`,
        cancellationLink);
    }
  }
  const q = paymentQueueFor(sessionId);
  for (const entry of [...q.waitlist, ...q.interest]) {
    notify(entry.userId, "session-cancelled",
      `${cancellationCopy}. ITC HYROX · ${fmtDate(sessionDateOf(sessionId))} — the waitlist was dissolved.`,
      cancellationLink);
  }
  q.waitlist = [];
  q.interest = [];
  save();
}

export function setSessionTime(sessionId, time) {
  if (isLive()) {
    return liveOps.liveSetSessionTime(sessionId, time);
  }
  requirePaymentAdminActor();
  (state.sessionOverrides[sessionId] ||= {}).time = time;
  save();
}

export function setVenueTBC(sessionId, on) {
  if (isLive()) {
    return liveOps.liveSetVenueTBC(sessionId, !!on);
  }
  requirePaymentAdminActor();
  (state.sessionOverrides[sessionId] ||= {}).venueTBC = !!on;
  save();
}

export function setSessionNotice(sessionId, text) {
  if (isLive()) {
    return liveOps.liveSetSessionNotice(sessionId, text);
  }
  requirePaymentAdminActor();
  (state.sessionOverrides[sessionId] ||= {}).notice = String(text || "").trim() || undefined;
  save();
}

export function confirmGymBooking(sessionId, note, now = Date.now()) {
  if (isLive()) {
    return liveOps.liveFinalizeGym(sessionId, note);
  }
  requirePaymentAdminActor();
  const override = (state.sessionOverrides[sessionId] ||= {});
  override.gymConfirmedAt = now;
  override.gymNote = String(note || "").trim() || undefined;
  save();
  return override;
}

// Per-week free-event venue overrides. Admin only. Local mode fans out
// notifications and dedupes per member; live mode delegates both to the
// trusted `set_session_venue` RPC.
export function setWeekVenue(sessionId, {
  location, mapsQuery, meetingLat = null, meetingLng = null,
} = {}) {
  const before = getSession(sessionId);
  const fallbackActivityId = String(sessionId).replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const overrideActivityId = before?.activityId || fallbackActivityId;
  if (!new Set(["wnt", "run", "water", "lunch"]).has(overrideActivityId)) {
    throw new Error("Activity venue is fixed.");
  }
  const cleanLocation = String(location || "").trim();
  const cleanMapsQuery = String(mapsQuery || "").trim();
  const rawPointProvided = ![meetingLat, meetingLng].every(
    (value) => value === null || value === undefined || value === ""
  );
  const normalizedPoint = normalizeMeetingPoint(meetingLat, meetingLng);
  const acceptsPoint = overrideActivityId === "wnt"
    && normalizeVenueLocation(cleanLocation) === "tamar park";
  if (acceptsPoint && rawPointProvided && !normalizedPoint) {
    throw new Error("Choose a valid meeting point.");
  }
  const meetingPoint = acceptsPoint ? normalizedPoint : null;
  if (isLive()) {
    const wasTBC = before?.location === "TBC"
      || !hasConfirmedVenue(before?.location, before?.mapsQuery);
    return liveOps.liveSetWeekVenue(sessionId, {
      location: cleanLocation,
      mapsQuery: cleanMapsQuery,
      meetingLat: meetingPoint?.lat ?? null,
      meetingLng: meetingPoint?.lng ?? null,
      wasTBC,
    });
  }
  if (!before || (before.kind !== "free" && before.kind !== "rsvp")) throw new Error("Session not found.");
  const wasTBC = before.location === "TBC"
    || !hasConfirmedVenue(before.location, before.mapsQuery);
  requirePaymentAdminActor();
  const actor = currentUser();
  const existingOverride = state.sessionOverrides[sessionId];
  const cleared = cleanLocation === "" && cleanMapsQuery === "";
  if (!existingOverride && cleared) {
    return { sessionId, activityId: overrideActivityId, unchanged: true };
  }
  const override = existingOverride || (state.sessionOverrides[sessionId] = {});
  const previousLocation = override.location || "";
  const previousMapsQuery = override.mapsQuery || "";
  const previousPoint = normalizeMeetingPoint(override.meetingLat, override.meetingLng);
  const previousNotified = override.venueMemberNotifiedAt || null;
  const recurring = getActivity(overrideActivityId);
  const effectiveLocation = cleanLocation || recurring?.location || "";
  const effectiveMapsQuery = cleanMapsQuery || recurring?.mapsQuery || "";
  const confirmed = hasConfirmedVenue(effectiveLocation, effectiveMapsQuery);
  const nextVenueTBC = cleared || confirmed ? false : Boolean(override.venueTBC);
  const pointChanged = (previousPoint?.lat ?? null) !== (meetingPoint?.lat ?? null)
    || (previousPoint?.lng ?? null) !== (meetingPoint?.lng ?? null);
  const changed = previousLocation !== cleanLocation
    || previousMapsQuery !== cleanMapsQuery
    || Boolean(override.venueTBC) !== nextVenueTBC
    || pointChanged;
  if (!changed) {
    return { sessionId, activityId: overrideActivityId, ...override, unchanged: true };
  }
  override.location = cleanLocation || undefined;
  override.mapsQuery = cleanMapsQuery || undefined;
  if (meetingPoint) {
    override.meetingLat = meetingPoint.lat;
    override.meetingLng = meetingPoint.lng;
  } else {
    delete override.meetingLat;
    delete override.meetingLng;
  }
  override.venueTBC = nextVenueTBC;
  override.setAt = Date.now();
  override.setBy = actor?.id || null;
  override.venueMemberNotifiedAt = previousNotified;
  const destination = `#/activity/${sessionId}`;
  const sessionLabel = `${before.name || recurring?.name || overrideActivityId} on ${before.dateISO}`;
  if (wasTBC && !cleared && confirmed && !override.venueMemberNotifiedAt) {
    override.venueMemberNotifiedAt = Date.now();
    for (const user of state.users) {
      if (user?.status !== "approved" || user.role !== "member") continue;
      state.notifications.push({
        id: uid("n"),
        userId: user.id,
        kind: "operational_session_venue_updated",
        title: "Venue confirmed",
        body: `${sessionLabel} is at ${effectiveLocation}. Check the activity page for details.`,
        link: destination,
        read: false,
        createdAt: Date.now(),
      });
    }
  }
  const actorLabel = actor?.fullName || actor?.preferredName || actor?.email || "Admin";
  for (const user of state.users) {
    if (user?.status !== "approved") continue;
    if (user.role !== "admin" && user.role !== "superadmin" && user.role !== "super_admin") continue;
    if (actor && user.id === actor.id) continue;
    const body = cleared
      ? `${actorLabel} reset the venue for ${sessionId} to the activity default.`
      : `${actorLabel} set the venue for ${sessionId} to ${effectiveLocation}.`;
    state.notifications.push({
      id: uid("n"),
      userId: user.id,
      kind: "operational_session_venue_updated",
      title: "Session venue updated",
      body,
      link: destination,
      read: false,
      createdAt: Date.now(),
    });
  }
  save();
  return { sessionId, activityId: overrideActivityId, ...override };
}

// --- Giving (FPS donations) -----------------------------------------------------
// FPS is a push payment from the member's banking app, so the prototype
// records every gift as "pending" until a leader reconciles it against the
// club account — there is no instant confirmation path like card checkout.

export function campaigns() {
  return state.campaigns;
}

export function activeGivingCampaign() {
  return state.campaigns.find((campaign) => campaign.status === "published") ?? null;
}

const ADMIN_CAMPAIGN_ROLES = new Set(["admin", "superadmin", "super_admin"]);
const campaignColumns = "id, title, description, goal_hkd, fps_id, fps_payee, status, creator_profile_id, created_at, updated_at, published_at, closed_at";

function normalizeGivingCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    goalHKD: Number(row.goal_hkd ?? row.goalHKD),
    fpsId: row.fps_id ?? row.fpsId,
    fpsPayee: row.fps_payee ?? row.fpsPayee,
    status: String(row.status || "").toLowerCase(),
    creatorProfileId: row.creator_profile_id ?? row.creatorProfileId ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    publishedAt: row.published_at ?? row.publishedAt ?? null,
    closedAt: row.closed_at ?? row.closedAt ?? null,
  };
}

function validatedCampaignFields(draft) {
  const title = String(draft?.title || "").trim();
  const description = String(draft?.description || "").trim();
  const rawGoal = draft?.goalHKD ?? draft?.goal_hkd;
  const goalHKD = Number(rawGoal);
  const fpsId = String(draft?.fpsId ?? draft?.fps_id ?? "").trim();
  const fpsPayee = String(draft?.fpsPayee ?? draft?.fps_payee ?? "").trim();
  if (!title) throw new Error("Enter a campaign title.");
  if (!description) throw new Error("Enter a campaign description.");
  if (!Number.isInteger(goalHKD) || goalHKD <= 0) {
    throw new Error("Enter a positive whole-HKD goal.");
  }
  if (!fpsId) throw new Error("Enter the FPS ID.");
  if (!fpsPayee) throw new Error("Enter the FPS payee.");
  return { title, description, goalHKD, fpsId, fpsPayee };
}

async function requireCampaignAdmin() {
  const user = isLive() ? await getCurrentUser() : currentUser();
  if (!user || user.status !== "approved" || !ADMIN_CAMPAIGN_ROLES.has(user.role)) {
    throw new Error("Admin access required.");
  }
  return user;
}

function localCampaignById(id) {
  return state.campaigns.find((campaign) => campaign.id === id) ?? null;
}

export async function listGivingCampaigns() {
  await requireCampaignAdmin();
  if (!isLive() || !supabase) {
    return state.campaigns.map(normalizeGivingCampaign).sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
  }
  const { data, error } = await supabase
    .from("giving_campaigns")
    .select(campaignColumns)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeGivingCampaign);
}

export async function getActiveGivingCampaign({ ownsGeneration = () => true } = {}) {
  const user = isLive() ? await getCurrentUser() : currentUser();
  if (!user || user.status !== "approved") return null;
  if (!isLive() || !supabase) return normalizeGivingCampaign(activeGivingCampaign());
  const { data, error } = await supabase
    .from("giving_campaigns")
    .select(campaignColumns)
    .eq("status", "published")
    .maybeSingle();
  if (error?.code === "PGRST205") {
    if (ownsGeneration()) liveGivingCampaign = null;
    return null;
  }
  if (error) throw error;
  const campaign = normalizeGivingCampaign(data);
  if (ownsGeneration()) liveGivingCampaign = campaign;
  return campaign;
}

export async function saveGivingCampaign(draft) {
  const user = await requireCampaignAdmin();
  const fields = validatedCampaignFields(draft);
  const id = String(draft?.id || "").trim();
  if (!isLive() || !supabase) {
    const existing = id ? localCampaignById(id) : null;
    if (id && !existing) throw new Error("Giving campaign not found.");
    if (existing?.status === "closed") throw new Error("Closed Giving campaigns are immutable.");
    if (!existing && state.campaigns.some((campaign) => campaign.status !== "closed")) {
      throw new Error("Close the current campaign before creating another.");
    }
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, fields, { updatedAt: now });
      save();
      return normalizeGivingCampaign(existing);
    }
    const campaign = {
      id: uid("campaign"),
      ...fields,
      status: "draft",
      creatorProfileId: user.id,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      closedAt: null,
    };
    state.campaigns.push(campaign);
    save();
    return normalizeGivingCampaign(campaign);
  }
  const row = {
    title: fields.title,
    description: fields.description,
    goal_hkd: fields.goalHKD,
    fps_id: fields.fpsId,
    fps_payee: fields.fpsPayee,
  };
  let result;
  if (id) {
    result = await supabase
      .from("giving_campaigns")
      .update(row)
      .eq("id", id)
      .neq("status", "closed")
      .select(campaignColumns)
      .single();
  } else {
    result = await supabase
      .from("giving_campaigns")
      .insert({ ...row, status: "draft", creator_profile_id: user.id })
      .select(campaignColumns)
      .single();
  }
  if (result.error) throw result.error;
  const campaign = normalizeGivingCampaign(result.data);
  if (!campaign?.id || (id && campaign.id !== id) || campaign.status === "closed") {
    throw new Error("Giving campaign save conflict.");
  }
  if (campaign.status === "published") liveGivingCampaign = campaign;
  return campaign;
}

async function transitionGivingCampaign(id, fromStatus, toStatus) {
  await requireCampaignAdmin();
  const campaignId = String(id || "").trim();
  if (!campaignId) throw new Error("Giving campaign not found.");
  if (!isLive() || !supabase) {
    const campaign = localCampaignById(campaignId);
    if (!campaign) throw new Error("Giving campaign not found.");
    if (campaign.status !== fromStatus) throw new Error(`Campaign must be ${fromStatus} before it can be ${toStatus}.`);
    if (toStatus === "published") validatedCampaignFields(campaign);
    const now = new Date().toISOString();
    campaign.status = toStatus;
    campaign.updatedAt = now;
    if (toStatus === "published") campaign.publishedAt = campaign.publishedAt || now;
    if (toStatus === "closed") campaign.closedAt = now;
    save();
    return normalizeGivingCampaign(campaign);
  }
  const { data, error } = await supabase
    .from("giving_campaigns")
    .update({ status: toStatus })
    .eq("id", campaignId)
    .eq("status", fromStatus)
    .select(campaignColumns)
    .single();
  if (error) throw error;
  const campaign = normalizeGivingCampaign(data);
  if (!campaign?.id || campaign.id !== campaignId || campaign.status !== toStatus) {
    throw new Error("Giving campaign transition conflict.");
  }
  liveGivingCampaign = toStatus === "published" ? campaign : null;
  return campaign;
}

export async function publishGivingCampaign(id) {
  const campaign = (await listGivingCampaigns()).find((item) => item.id === id);
  if (!campaign) throw new Error("Giving campaign not found.");
  validatedCampaignFields(campaign);
  if (campaign.status !== "draft") throw new Error("Campaign must be draft before it can be published.");
  return transitionGivingCampaign(id, "draft", "published");
}

export function closeGivingCampaign(id) {
  return transitionGivingCampaign(id, "published", "closed");
}

export function campaignRaised(campaign = activeGivingCampaign()) {
  const campaignId = typeof campaign === "string" ? campaign : campaign?.id;
  if (!campaignId) return 0;
  return state.donations
    .filter((donation) => donation.campaignId === campaignId)
    .reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
}

export function donationsForUser(userId) {
  return state.donations
    .filter((d) => d.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function recordDonation(input = {}) {
  const user = currentUser();
  if (!user || !user.id || user.status !== "approved") {
    throw new Error("Approved member access required");
  }
  if (Object.hasOwn(input, "userId") && input.userId !== user.id) {
    throw new Error("Donation owner must match the approved member");
  }
  const { name, amount, note, ref, campaignId } = input;
  const campaign = campaignId
    ? state.campaigns.find((item) => item.id === campaignId && item.status === "published") ||
      (isLive() && liveGivingCampaign?.id === campaignId ? liveGivingCampaign : null)
    : activeGivingCampaign() || (isLive() ? liveGivingCampaign : null);
  if (!campaign) throw new Error("No active Giving campaign");
  const transferRef = String(ref || "").trim();
  const existing = transferRef
    ? state.donations.find((item) => item.campaignId === campaign.id && item.ref === transferRef)
    : null;
  if (existing) return existing;
  const donation = {
    id: uid("d"),
    userId: user.id,
    name: String(name).trim(),
    amount: Math.round(Number(amount)),
    currency: "HKD",
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    method: "FPS",
    ref: transferRef,
    note: String(note ?? "").trim(),
    status: "pending", // reconciled manually by a leader
    createdAt: Date.now(),
  };
  state.donations.push(donation);
  save();
  return donation;
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
  livePaymentDirectory.set(liveUser.id, normalizePaymentUser(liveUser));
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
  livePaymentDirectory = new Map();
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
    emergency_relationship: user.emergencyRelationship || null,
    emergency_phone: user.emergencyPhone || "",
    heard_source: user.heard || "other",
    heard_detail: user.heardDetail || null,
    preferred_name: user.preferredName || null,
    photo_consent: !!user.mediaConsent,
    waiver_accepted_at: user.indemnityAcceptedAt || null,
    waiver_signature_text: user.indemnitySignature || null,
    waiver_signed_at: user.indemnitySignedAt || null,
    waiver_form_version: user.indemnityFormVersion || null,
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
  const emergency = normalizeEmergencyContact({
    emergencyName: form.emergency_name,
    emergencyRelationship: form.emergency_relationship,
    emergencyPhone: form.emergency_phone,
  });
  const patch = {
    mobile: String(form.mobile || "").trim(),
    is_minor: isMinor,
    date_of_birth: null,
    guardian_name: guardian.name,
    guardian_phone: guardian.phone,
    emergency_name: emergency.name,
    emergency_relationship: emergency.relationship,
    emergency_phone: emergency.phone,
    heard_source: String(form.heard_source || "").trim(),
    heard_detail: String(form.heard_detail || "").trim() || null,
    preferred_name: String(form.preferred_name || "").trim() || null,
  };
  if (!patch.mobile) throw new Error("Enter mobile number");
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
  if (!form.waiver) throw new Error("Read and accept the Indemnity");
  const acceptance = normalizeIndemnityAcceptance({
    signature: form.waiver_signature_text,
    signedAt: form.waiver_signed_at,
    emergencyName: form.emergency_name,
    emergencyRelationship: form.emergency_relationship,
    emergencyPhone: form.emergency_phone,
  });
  const acceptedAt = new Date().toISOString();
  const row = {
    profile_id: cu.id,
    mobile: form.mobile,
    date_of_birth: null,
    is_minor: isMinor,
    guardian_name: guardian.name,
    guardian_phone: guardian.phone,
    emergency_name: acceptance.emergencyName,
    emergency_relationship: acceptance.emergencyRelationship,
    emergency_phone: acceptance.emergencyPhone,
    heard_source: form.heard_source,
    heard_detail: form.heard_detail || null,
    preferred_name: form.preferred_name || null,
    photo_consent: !!form.photo_consent,
    waiver_accepted_at: acceptedAt,
    waiver_signature_text: acceptance.signature,
    waiver_signed_at: acceptance.signedAt,
    waiver_form_version: acceptance.formVersion,
    privacy_accepted_at: acceptedAt,
    guidelines_accepted_at: acceptedAt,
  };
  const { error } = await supabase.from("applications").upsert(row);
  if (error) throw error;
  clearApplyDraft();
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
    user.emergencyRelationship = patch.emergency_relationship;
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

export async function acceptMyIndemnity(payload) {
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    return acceptIndemnity(user.id, payload);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const app = await getMyApplication();
  if (!app) throw new Error("Application not found");
  const mapped = {
    indemnityAcceptedAt: app.waiver_accepted_at,
    indemnitySignature: app.waiver_signature_text,
    indemnitySignedAt: app.waiver_signed_at,
    indemnityFormVersion: app.waiver_form_version,
    emergencyName: app.emergency_name,
    emergencyRelationship: app.emergency_relationship,
    emergencyPhone: app.emergency_phone,
  };
  if (isIndemnityCurrent(mapped)) return app.waiver_accepted_at;
  const acceptance = normalizeIndemnityAcceptance({
    ...payload,
    emergencyName: app.emergency_name,
    emergencyPhone: app.emergency_phone,
  });
  const waiver_accepted_at = new Date().toISOString();
  const patch = {
    waiver_accepted_at,
    waiver_signature_text: acceptance.signature,
    waiver_signed_at: acceptance.signedAt,
    waiver_form_version: acceptance.formVersion,
    emergency_relationship: acceptance.emergencyRelationship,
  };
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
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
      emergencyRelationship: a.emergency_relationship,
      emergencyPhone: a.emergency_phone,
      heard: a.heard_source,
      appliedAt: a.submitted_at,
      isMinor: !!a.is_minor,
      indemnityAcceptedAt: a.waiver_accepted_at,
      indemnitySignature: a.waiver_signature_text,
      indemnitySignedAt: a.waiver_signed_at,
      indemnityFormVersion: a.waiver_form_version,
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



function normalizeLocalNotification(notification) {
  const created = new Date(notification?.createdAt);
  const createdAt = Number.isNaN(created.getTime()) ? null : created.toISOString();
  return {
    ...notification,
    body: notification?.body ?? notification?.message ?? "",
    read_at: notification?.read ? (createdAt || new Date(0).toISOString()) : null,
    destination: notification?.link ?? notification?.destination ?? null,
    created_at: createdAt,
  };
}

export async function listMyNotifications() {
  if (!isLive() || !supabase) {
    const user = currentUser();
    return user ? notificationsFor(user.id).map(normalizeLocalNotification) : [];
  }
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id) {
  if (!isLive() || !supabase) {
    const user = currentUser();
    const notification = state.notifications.find(
      (row) => row.id === id && row.userId === user?.id && !row.read
    );
    if (!notification) throw new Error("Notification update conflict.");
    notification.read = true;
    save();
    const normalized = normalizeLocalNotification(notification);
    return { id: normalized.id, read_at: normalized.read_at };
  }
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
