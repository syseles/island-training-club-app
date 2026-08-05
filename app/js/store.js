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
  sessionStarted,
  todayLocal,
  isoDate,
  fmtDate,
  fmtTime,
  uid,
  normalizeDonorId,
  donorIdProblem,
} from "./data.js";
import { supabase, isLive } from "./config.js";

const STORAGE_KEY = "itc.prototype.v1";
const STATE_VERSION = 9;

// Live-mode (Supabase) session cache. Avoids hammering the DB on every
// page load. The TTL is short so role flips and welcome notifications
// surface promptly after the admin takes an action.
let liveProfile = null;
let liveUser = null;
let liveProfileFetchedAt = 0;
const LIVE_PROFILE_TTL_MS = 30_000;

let state = null;

function backfillProfilePreferences(user) {
  if (user.isMinor === undefined) user.isMinor = false;
  if (user.privacyAcceptedAt === undefined) user.privacyAcceptedAt = user.appliedAt || null;
  if (user.whatsappReminders === undefined) user.whatsappReminders = false;
  if (user.emailReceipts === undefined) user.emailReceipts = false;
  if (user.communityNews === undefined) user.communityNews = false;
  return user;
}

function freshState() {
  return {
    version: STATE_VERSION,
    sessionUserId: null,
    activities: structuredClone(SEED_ACTIVITIES),
    users: structuredClone(SEED_USERS).map(backfillProfilePreferences),
    bookings: seedBookings(),
    receipts: seedReceipts(),
    receiptCounter: 49,
    prayers: [],
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
  save();
  return state;
}

// One-time, versioned migrations for persisted state that predates a
// seed-data revision. Each step runs once per version so admin edits made
// afterwards are not reverted on the next load.
function migrate() {
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
    // Seed-owned bookings/receipts are replaced outright: their snapshots
    // describe the old session. User-created records are left untouched.
    for (const [key, seeded] of [
      ["bookings", seedBookings()],
      ["receipts", seedReceipts()],
    ]) {
      const ids = new Set(seeded.map((r) => r.id));
      state[key] = [...state[key].filter((r) => !ids.has(r.id)), ...seeded];
    }
  }
  if (v < 3) {
    // v3: Run Club moved to Mon 7:30 PM with venue TBC; Water Sports Evening
    // renamed ITC Swimming at 7:30 PM; leaders renamed (Arnold Wong, Tina,
    // CM Chui). Activities are replaced in place from the seed; seed users
    // get the new names only, keeping any role/status changes.
    const seedAct = new Map(SEED_ACTIVITIES.map((a) => [a.id, a]));
    state.activities = state.activities.map((a) =>
      a.id === "run" || a.id === "water"
        ? structuredClone(seedAct.get(a.id))
        : a
    );
    const seedUser = new Map(SEED_USERS.map((u) => [u.id, u]));
    state.users = state.users.map((u) =>
      seedUser.has(u.id)
        ? {
            ...u,
            fullName: seedUser.get(u.id).fullName,
            preferredName: seedUser.get(u.id).preferredName,
          }
        : u
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
    // v6: donor IDs follow IECC's LASTNAME-NNNN(N) format, so the seeded
    // demo member's ID moves from the old placeholder to CHUI-08879 (only
    // an exact old-seed match is rewritten). Indemnity acceptance is now
    // tracked per member; approved seed members predate the requirement
    // and are backfilled, everyone else accepts from Profile > Indemnity.
    const member = state.users.find((u) => u.id === "u-member");
    if (member && member.donorId === "IECC-10028") member.donorId = "CHUI-08879";
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
    if (!Array.isArray(state.prayers)) state.prayers = [];
  }
  if (v < 9) state.users.forEach(backfillProfilePreferences);
  state.version = STATE_VERSION;
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

export function demoSignIn(role) {
  const user = state.users.find((u) => u.role === role && u.status === "approved");
  if (!user) return { ok: false, reason: "not-found" };
  state.sessionUserId = user.id;
  save();
  return { ok: true, user };
}

export function signOut() {
  liveProfile = null;
  liveUser = null;
  liveProfileFetchedAt = 0;
  state.sessionUserId = null;
  save();
}

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
    status: liveProfile.role === "pending" ? "pending" : "approved",
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
    options: { redirectTo: `${window.location.origin}/app/` },
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

export async function updateProfileRole(profileId, newRole, reason) {
  if (!isLive() || !supabase) {
    setRole(profileId, newRole);
    return;
  }
  const { error } = await supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", profileId);
  if (error) throw error;
  // The DB trigger writes role_changes + welcome notification automatically.
  // Persisting `reason` to role_changes.reason requires a small Postgres
  // RPC that sets a session-local config; deferred. ⏳
  if (reason) console.info("role update reason:", reason);
}

// --- Applicant: application form (B; Supabase) ------------------------------

export async function getMyApplication() {
  if (!isLive() || !supabase) return null;
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
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// --- Signup / approval ---------------------------------------------------------

export function applyForMembership(form) {
  const email = String(form.email).trim().toLowerCase();
  if (state.users.some((u) => u.email.toLowerCase() === email)) {
    return { ok: false, reason: "duplicate" };
  }
  const isMinor = parseAgeOver18(form.ageOver18);
  const guardian = guardianFields(isMinor, form.guardianName, form.guardianPhone);
  const user = {
    id: uid("u"),
    role: "pending",
    status: "pending",
    fullName: form.fullName.trim(),
    preferredName: form.preferredName.trim(),
    email,
    phone: form.phone.trim(),
    emergencyName: form.emergencyName.trim(),
    emergencyPhone: form.emergencyPhone.trim(),
    heard: form.heard.trim(),
    mediaConsent: !!form.mediaConsent,
    donorId: normalizeDonorId(form.donorId),
    // Joining requires accepting the health & liability indemnity; the
    // timestamp is the member's acceptance record (Profile > Indemnity).
    indemnityAcceptedAt: form.indemnity ? Date.now() : null,
    isMinor,
    guardianName: guardian.name,
    guardianPhone: guardian.phone,
    privacyAcceptedAt: Date.now(),
    whatsappReminders: false,
    emailReceipts: false,
    communityNews: false,
    appliedAt: Date.now(),
  };
  state.users.push(user);
  state.sessionUserId = user.id; // applicant keeps public-level access while pending
  save();
  return { ok: true, user };
}

// Live: pending applications joined with their profiles, mapped to the
// shape the admin approvals cards render. Local: the seed applicants.
export async function listPendingApplications() {
  if (!isLive() || !supabase) return pendingApplicants();
  const { data, error } = await supabase
    .from("applications")
    .select("*, profiles!inner(id, email, full_name, role)")
    .eq("profiles.role", "pending");
  if (error) throw error;
  return (data || []).map((a) => ({
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
    "Jason M.", "Natalie C.", "Marco S.", "Jenny W.", "Kelvin T.",
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
  if (sessionStarted(session)) throw new Error("Session has already started");
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

export { isoDate, todayLocal };
