// ==========================================================================
// ITC prototype — state store.
// localStorage-backed stand-in for the future backend. Every domain action
// (signup, approval, booking, payment, cancellation, admin edits) goes
// through this module so swapping in a real API later touches one file.
// ==========================================================================

import {
  SEED_ACTIVITIES,
  SEED_USERS,
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
const STATE_VERSION = 11;

// Live-mode (Supabase) session cache. Avoids hammering the DB on every
// page load. The TTL is short so role flips and welcome notifications
// surface promptly after the admin takes an action.
let liveProfile = null;
let liveUser = null;
let liveProfileFetchedAt = 0;
let liveGivingCampaign = null;
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
    bookings: [],
    receipts: [],
    receiptCounter: 49,
    campaigns: [],
    donations: [],
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
    // (activity location + any booking snapshots carrying the old string);
    // giving + shop state introduced. Only exact old-string matches are
    // rewritten so admin edits
    // made since are preserved.
    const hyrox = state.activities.find((a) => a.id === "hyrox");
    if (hyrox && hyrox.location === "Causeway Bay BFT") {
      hyrox.location = "BFT Causeway Bay";
    }
    for (const b of state.bookings) {
      if (b.snapshot?.location === "Causeway Bay BFT") {
        b.snapshot.location = "BFT Causeway Bay";
      }
    }
    if (!Array.isArray(state.donations)) state.donations = [];
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
  if (v < 10) {
    // v10: HYROX demo attendance cleanup — the club no longer simulates
    // demand. Strip the seeded baseBooked counters and remove the old
    // seed-owned bookings/receipts so "Who's coming" and spots left reflect
    // real sign-ups only. User-created records are untouched.
    for (const a of state.activities) {
      if (a.id === "hyrox" || a.id === "hyrox-midtown") delete a.baseBooked;
    }
    const seedBookingIds = new Set(["b-seed-past", "b-seed-next"]);
    const seedReceiptIds = new Set(["r-seed-past", "r-seed-next"]);
    state.bookings = state.bookings.filter((b) => !seedBookingIds.has(b.id));
    state.receipts = state.receipts.filter((r) => !seedReceiptIds.has(r.id));
  }
  if (v < 11) {
    // v11: remove the old Giving demo campaign and its two known donations.
    // Any member-created gifts remain intact, including gifts associated with
    // the old campaign ID.
    if (!Array.isArray(state.campaigns)) state.campaigns = [];
    const seedDonationIds = new Set(["d-seed-1", "d-seed-2"]);
    if (!Array.isArray(state.donations)) state.donations = [];
    state.donations = state.donations.filter((d) => !seedDonationIds.has(d.id));
  }
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
  liveGivingCampaign = null;
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
    options: { redirectTo: `${window.location.origin}/app/` },
  });
  if (error) throw error;
}

export async function signOutLive() {
  if (!isLive() || !supabase) return signOut();
  liveProfile = null;
  liveUser = null;
  liveProfileFetchedAt = 0;
  liveGivingCampaign = null;
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
    donor_id: user.donorId || null,
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
  if (!user) throw new Error("Member not found.");
  if (user.status !== "approved") throw new Error("Only approved members can change roles.");

  const nextRole = role === "super_admin" ? "superadmin" : role;
  if (!["member", "admin", "superadmin", "pending"].includes(nextRole)) {
    throw new Error("Invalid role transition.");
  }
  if (user.role === nextRole) throw new Error("Member already has that role.");

  user.role = nextRole;
  // Revocation returns an approved local demo account to the same pending
  // access state used by live profiles. Re-approval still goes through the
  // existing application decision flow.
  if (nextRole === "pending") user.status = "pending";
  save();
  return user;
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
  // Real bookings only — no simulated strangers. The list must reflect who
  // actually signed up.
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

export async function getActiveGivingCampaign() {
  const user = isLive() ? await getCurrentUser() : currentUser();
  if (!user || user.status !== "approved") return null;
  if (!isLive() || !supabase) return normalizeGivingCampaign(activeGivingCampaign());
  const { data, error } = await supabase
    .from("giving_campaigns")
    .select(campaignColumns)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  liveGivingCampaign = normalizeGivingCampaign(data);
  return liveGivingCampaign;
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

export function recordDonation({ userId, name, amount, note, ref, campaignId }) {
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
    userId: userId ?? null,
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
