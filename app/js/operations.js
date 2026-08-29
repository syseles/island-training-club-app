// ==========================================================================
// ITC prototype — live operational cache + RPC adapters.
//
// In live mode, every operational state read passes through the in-memory
// cache populated by `hydrateOperationalState()`. Mutations are routed to
// Supabase SECURITY DEFINER RPCs through `runOperationalRpc()`. The cache
// is reconciled both on RPC success and via Realtime events.
//
// No live fallback: when a Supabase call fails, the cache is left untouched
// and the surface stays read-only. Callers must surface the error and stop
// any local mutation that would otherwise mask the failure.
// ==========================================================================

import { SEED_ACTIVITIES } from "./data.js";
import { isLive, supabase } from "./config.js";
import { normalizeMeetingPoint } from "./venue.js";

const LIVE_TABLES = [
  "operational_sessions",
  "operational_bookings",
  "operational_queue_entries",
  "operational_receipts",
  "collector_assignments",
  "collector_payout_profiles",
  "operational_session_venue_overrides",
];

const cutoverMarker = "itc.live.operations.backend.v1";

const PAID_ACTIVITY_METADATA = new Map(
  SEED_ACTIVITIES
    .filter((activity) => activity.kind === "paid")
    .map((activity) => [activity.id, activity])
);

const liveCache = {
  sessions: new Map(),
  templates: [],
  bookings: [],
  queues: [],
  receipts: [],
  assignments: new Map(),
  payout: new Map(),
  venueOverrides: new Map(),
  loaded: false,
  loading: null,
  error: null,
  updatedAt: 0,
};

const listeners = new Set();
let subscription = null;

function notifyListeners() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.warn("operations listener failed", err); }
  }
}

function buildTemplateRow(row) {
  return {
    activity_id: row.activity_id,
    name: row.name,
    venue: row.venue,
    weekday: row.weekday,
    start_time: String(row.start_time || "").slice(0, 5),
    duration_minutes: row.duration_minutes,
    capacity: row.capacity,
    price_hkd: row.price_hkd,
    default_open: row.default_open,
    active: row.active,
    category: row.category || null,
    maps_query: row.maps_query || null,
    requires_rsvp: !!row.requires_rsvp,
  };
}

function buildSessionRow(row, templatesById = null) {
  const dateISO = typeof row.session_date === "string"
    ? row.session_date.slice(0, 10)
    : new Date(row.session_date).toISOString().slice(0, 10);
  const date = new Date(`${dateISO}T00:00:00`);
  const metadata = PAID_ACTIVITY_METADATA.get(row.activity_id);
  const template = templatesById?.get(row.activity_id) ?? null;
  const oneOff = String(row.activity_id).startsWith("event-");
  const legacyMidtown = row.activity_id === "hyrox-midtown"
    && row.venue === "Midtown 28";
  const venue = legacyMidtown
    ? (metadata?.location || row.venue)
    : row.venue;
  const mapsQuery = legacyMidtown
    ? (metadata?.mapsQuery || row.venue)
    : (template?.maps_query || row.venue);
  return {
    id: row.id,
    activityId: row.activity_id,
    // One-off events take their display name/category from their template;
    // the recurring HYROX templates keep the historical labels.
    name: template?.name || "ITC HYROX",
    // Paid sessions take the reserve/pay pipeline; price-0 sessions are RSVP
    // (headcount needed, e.g. the post-training lunch) when the template says
    // so, otherwise plain free show-up events.
    kind: Number(row.price_hkd) > 0 ? "paid" : (template?.requires_rsvp ? "rsvp" : "free"),
    category: template?.category || (oneOff ? "Other" : "HYROX"),
    weekday: date.getDay(),
    oneOff,
    dateISO,
    date,
    time: String(row.start_time || "").slice(0, 5),
    durationMin: row.duration_minutes,
    location: venue,
    mapsQuery,
    venue,
    photo: metadata?.photo || "../assets/itc/hyrox.webp",
    capacity: row.capacity,
    price: row.price_hkd,
    isOpen: row.is_open,
    venueTBC: !!row.venue_tbc,
    notice: row.notice || null,
    cancelReason: row.cancel_reason || null,
    cancelled: !!row.cancelled_at,
    cancelledAt: row.cancelled_at || null,
    cancelledBy: row.cancelled_by || null,
    cancelledSource: row.cancelled_source || null,
    gymConfirmedAt: row.gym_confirmed_at || null,
    gymConfirmedBy: row.gym_confirmed_by || null,
    gymNote: row.gym_note || null,
    published: true,
  };
}

function buildBookingRow(row) {
  const dateISO = row.snapshot?.session_date
    ? String(row.snapshot.session_date).slice(0, 10)
    : null;
  return {
    id: row.id,
    userId: row.profile_id,
    sessionId: row.session_id,
    status: row.status,
    createdAt: Date.parse(row.created_at) || Date.now(),
    reservedAt: row.reserved_at ? Date.parse(row.reserved_at) : null,
    payDeadlineAt: row.pay_deadline_at ? Date.parse(row.pay_deadline_at) : null,
    paymentMarkedAt: row.payment_marked_at ? Date.parse(row.payment_marked_at) : null,
    paidMethod: row.payment_method ? String(row.payment_method).toUpperCase() : null,
    paymentRef: row.payment_reference || null,
    paidAt: row.paid_at ? Date.parse(row.paid_at) : null,
    confirmedBy: row.confirmed_by || null,
    deferredFrom: row.deferred_from_booking_id || null,
    deferredTo: row.deferred_to_booking_id || null,
    snapshot: {
      ...row.snapshot,
      price: row.snapshot?.price_hkd ?? row.snapshot?.price ?? null,
      location: row.snapshot?.venue ?? row.snapshot?.location ?? null,
      name: row.snapshot?.name || (row.snapshot?.activity_id === "hyrox-midtown" ? "ITC HYROX" : "ITC HYROX"),
      // DB snapshots store start_time ("HH:MM:SS"); the UI expects time
      // ("HH:MM"). Map it or fmtTime crashes on undefined.
      time: row.snapshot?.start_time
        ? String(row.snapshot.start_time).slice(0, 5)
        : row.snapshot?.time ?? null,
      durationMin: row.snapshot?.duration_min ?? row.snapshot?.durationMin ?? null,
      kind: row.snapshot?.kind ?? "paid",
      dateISO,
    },
    dateISO,
  };
}

function buildQueueRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.profile_id,
    kind: row.kind,
    status: row.status,
    joinedAt: Date.parse(row.joined_at) || Date.now(),
    resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : null,
  };
}

function buildReceiptRow(row) {
  return {
    id: row.id,
    number: row.receipt_number,
    bookingId: row.booking_id,
    userId: row.profile_id,
    sessionId: row.session_id,
    amount: row.amount_hkd,
    currency: row.currency,
    method: String(row.payment_method || "").toUpperCase(),
    status: row.status,
    issuedAt: Date.parse(row.issued_at) || Date.now(),
    line: `ITC HYROX — ${row.session_id}`,
  };
}

function buildAssignmentRow(row) {
  const saturdayISO = typeof row.week_start === "string"
    ? row.week_start.slice(0, 10)
    : new Date(row.week_start).toISOString().slice(0, 10);
  return {
    saturdayISO,
    userId: row.collector_profile_id,
    setAt: Date.parse(row.assigned_at) || Date.now(),
  };
}

function buildPayoutRow(row) {
  return {
    profileId: row.profile_id,
    paymeLink: row.payme_link || null,
    fpsPhone: row.fps_phone || null,
  };
}

function buildVenueOverrideRow(row) {
  const point = normalizeMeetingPoint(row.meeting_lat, row.meeting_lng);
  return {
    sessionId: row.session_id,
    activityId: row.activity_id,
    location: row.location || null,
    mapsQuery: row.maps_query || null,
    meetingLat: point?.lat ?? null,
    meetingLng: point?.lng ?? null,
    setBy: row.set_by || null,
    setAt: row.set_at ? Date.parse(row.set_at) : null,
    memberNotifiedAt: row.member_notified_at ? Date.parse(row.member_notified_at) : null,
  };
}

function replaceState(payload) {
  liveCache.sessions = new Map(payload.sessions.map((row) => [row.id, row]));
  liveCache.templates = payload.templates || [];
  liveCache.bookings = payload.bookings;
  liveCache.queues = payload.queues;
  liveCache.receipts = payload.receipts;
  liveCache.assignments = new Map(
    payload.assignments.map((row) => [row.saturdayISO, row])
  );
  liveCache.payout = new Map(
    payload.payouts.map((row) => [row.profileId, row])
  );
  liveCache.venueOverrides = new Map(
    (payload.venueOverrides || []).map((row) => [row.sessionId, row])
  );
  liveCache.loaded = true;
  liveCache.error = null;
  liveCache.updatedAt = Date.now();
}

function operationalProblem(error) {
  if (!error) return new Error("Unable to save — try again.");
  const message = String(error.message || error);
  if (message.includes("Session is cancelled")) return new Error("Session is cancelled.");
  if (message.includes("Session is full")) return new Error("Session is full.");
  if (message.includes("Session is not open")) return new Error("Session is not open.");
  if (message.includes("Already booked")) return new Error("Already booked.");
  if (message.includes("Approved membership required")) return new Error("Approved membership required.");
  if (message.includes("Not authorized for this booking")) return new Error("Not authorized for this booking.");
  if (message.includes("Not authorized for this queue entry")) return new Error("Not authorized for this queue entry.");
  if (message.includes("Not authorized for this payout profile")) return new Error("Not authorized for this payout profile.");
  if (message.includes("Administrator access required")) return new Error("Admin access required.");
  if (message.includes("Cancellation reason is required")) return new Error("Cancellation reason is required.");
  if (message.includes("Payment has not been marked")) return new Error("Payment has not been marked.");
  if (message.includes("Payment has already been marked")) return new Error("Payment has already been marked.");
  if (message.includes("Payment has already been processed")) return new Error("Payment has already been processed.");
  if (message.includes("Booking is not awaiting approval")) return new Error("Booking is not awaiting approval.");
  if (message.includes("Only confirmed bookings can be deferred")) return new Error("Only confirmed bookings can be deferred.");
  if (message.includes("Target must be a session of the same activity")) return new Error("Target must be a session of the same activity.");
  if (message.includes("Target must be later than the current session")) return new Error("Target must be later than the current session.");
  if (message.includes("Target session is full")) return new Error("Target session is full.");
  if (message.includes("Session has already started")) return new Error("Session has already started.");
  if (message.includes("Session is already cancelled")) return new Error("Session is already cancelled.");
  if (message.includes("Gym confirmation has already been recorded")) return new Error("Gym confirmation has already been recorded.");
  if (message.includes("Session not found")) return new Error("Session not found.");
  if (message.includes("Booking not found")) return new Error("Booking not found.");
  if (message.includes("Queue entry not found")) return new Error("Queue entry not found.");
  if (message.includes("Authentication required")) return new Error("Authentication required.");
  if (message.includes("Midtown toggle is only valid")) return new Error("Midtown toggle is only valid for Midtown sessions.");
  if (message.includes("Interest list is only for closed Midtown")) return new Error("Interest list is only for closed Midtown sessions.");
  if (message.includes("Waitlist is only for open sessions")) return new Error("Waitlist is only for open sessions.");
  if (message.includes("Waitlist is only for full sessions")) return new Error("Waitlist is only for full sessions.");
  if (message.includes("Session is not full")) return new Error("Session is not full.");
  if (message.includes("Interest list is only")) return new Error("Interest list is only for closed Midtown sessions.");
  if (message.includes("Activity venue is fixed.")) return new Error("Activity venue is fixed.");
  return new Error(message || "Unable to save — try again.");
}

let hydrationPromise = null;

async function fetchOperationalState() {
  if (!isLive() || !supabase) return null;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [
    sessions,
    bookings,
    queues,
    receipts,
    assignments,
    payouts,
    assignedPayouts,
    templates,
    venueOverrides,
  ] = await Promise.all([
    supabase.from("operational_sessions").select("*").gte("session_date", since).order("session_date"),
    supabase.from("operational_bookings").select("*"),
    supabase.from("operational_queue_entries").select("*")
      .or("status.eq.active,status.eq.promoted,status.eq.dissolved")
      .order("joined_at"),
    supabase.from("operational_receipts").select("*").order("issued_at", { ascending: false }),
    supabase.from("collector_assignments").select("*"),
    supabase.from("collector_payout_profiles").select("*"),
    supabase.rpc("get_assigned_collector_payout_profiles"),
    supabase.from("operational_activity_templates").select("*").order("activity_id"),
    supabase.from("operational_session_venue_overrides").select("*"),
  ]);
  for (const result of [
    sessions,
    bookings,
    queues,
    receipts,
    assignments,
    payouts,
    assignedPayouts,
    templates,
    venueOverrides,
  ]) {
    if (result.error) throw operationalProblem(result.error);
  }
  // Templates hydrate before sessions so one-off event rows (inactive
  // templates) can lend their name, category and maps query to the session.
  const templateRows = (templates.data || []).map(buildTemplateRow);
  const templatesById = new Map(templateRows.map((t) => [t.activity_id, t]));
  const payoutRowsByProfile = new Map();
  for (const row of assignedPayouts.data || []) payoutRowsByProfile.set(row.profile_id, row);
  // Normal-RLS rows win on duplicates while assigned rows fill the cold-member gap.
  for (const row of payouts.data || []) payoutRowsByProfile.set(row.profile_id, row);
  return {
    sessions: (sessions.data || []).map((row) => buildSessionRow(row, templatesById)),
    templates: templateRows,
    bookings: (bookings.data || []).map(buildBookingRow),
    queues: (queues.data || []).map(buildQueueRow),
    receipts: (receipts.data || []).map(buildReceiptRow),
    assignments: (assignments.data || []).map(buildAssignmentRow),
    payouts: [...payoutRowsByProfile.values()].map(buildPayoutRow),
    venueOverrides: (venueOverrides.data || []).map(buildVenueOverrideRow),
  };
}

export async function ensureLiveSessionWindow() {
  if (!isLive() || !supabase) return null;
  const iso = new Date().toISOString().slice(0, 10);
  try {
    const { error } = await supabase.rpc("ensure_operational_sessions", {
      p_start_date: iso,
      p_weeks: 16,
    });
    if (error) throw operationalProblem(error);
  } catch (err) {
    console.warn("ensureLiveSessionWindow failed", err);
  }
  return null;
}

export async function hydrateOperationalState({ force = false } = {}) {
  if (!isLive() || !supabase) return null;
  if (liveCache.loaded && !force) return liveCache;
  if (hydrationPromise) return hydrationPromise;
  liveCache.loading = Promise.resolve().then(async () => {
    try {
      const payload = await fetchOperationalState();
      replaceState(payload);
      try { localStorage.setItem(cutoverMarker, "supabase"); } catch {}
      notifyListeners();
      return liveCache;
    } catch (err) {
      liveCache.error = operationalProblem(err);
      notifyListeners();
      throw liveCache.error;
    } finally {
      liveCache.loading = null;
    }
  });
  hydrationPromise = liveCache.loading;
  try {
    return await hydrationPromise;
  } finally {
    hydrationPromise = null;
  }
}

export async function refreshOperationalState() {
  if (!isLive() || !supabase) return null;
  return hydrateOperationalState({ force: true });
}

export function subscribeOperationalState(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function operationalStateStatus() {
  return {
    loading: !!liveCache.loading,
    loaded: liveCache.loaded,
    error: liveCache.error ? String(liveCache.error.message || liveCache.error) : null,
    updatedAt: liveCache.updatedAt,
  };
}

export async function startOperationalRealtime() {
  if (!isLive() || !supabase || subscription) return subscription;
  if (typeof supabase.channel !== "function") return null;
  const channel = supabase.channel("itc-operations")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_sessions" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_bookings" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_queue_entries" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_receipts" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "collector_assignments" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "collector_payout_profiles" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_session_venue_overrides" },
      () => scheduleRealtimeRefresh())
    .subscribe();
  subscription = channel;
  return channel;
}

export async function stopOperationalRealtime() {
  if (!subscription || !supabase) return;
  try { await supabase.removeChannel(subscription); } catch {}
  subscription = null;
}

let realtimeRefreshTimer = null;
function scheduleRealtimeRefresh() {
  if (realtimeRefreshTimer) return;
  realtimeRefreshTimer = setTimeout(async () => {
    realtimeRefreshTimer = null;
    try { await refreshOperationalState(); } catch (err) { console.warn("operations refresh failed", err); }
  }, 50);
}

export async function runOperationalRpc(name, args, options = {}) {
  if (!isLive() || !supabase) {
    throw new Error("Live operations are unavailable in this deployment.");
  }
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw operationalProblem(error);
  options.applyResult?.(data);
  try { await refreshOperationalState(); } catch (err) { console.warn("operations refresh after rpc failed", err); }
  return data;
}

// Weekly venue overrides apply to live sessions too (e.g. the RSVP lunch),
// not just locally-seeded free events. Read paths merge the override in so
// every surface sees the current venue.
function applyLiveVenueOverride(session) {
  if (!session) return session;
  const o = liveCache.venueOverrides.get(session.id);
  if (!o) return session;
  const out = { ...session };
  if (o.location) out.location = o.location;
  if (o.mapsQuery) out.mapsQuery = o.mapsQuery;
  if (o.meetingLat != null && o.meetingLng != null) {
    out.meetingLat = o.meetingLat;
    out.meetingLng = o.meetingLng;
  }
  const display = String(out.location || "").trim();
  const query = String(out.mapsQuery || "").trim();
  if (display && display.toUpperCase() !== "TBC" && query && query.toUpperCase() !== "TBC") {
    out.venueTBC = false;
  }
  return out;
}

export function getLiveSession(id) {
  return applyLiveVenueOverride(liveCache.sessions.get(id)) || null;
}

export function listLiveSessions() {
  return [...liveCache.sessions.values()].map(applyLiveVenueOverride);
}

export function liveActivityTemplates() {
  return liveCache.templates.slice();
}

export function listLiveBookings(filter = () => true) {
  return liveCache.bookings.filter(filter);
}

export function liveBookingsForUser(userId) {
  return liveCache.bookings.filter((b) => b.userId === userId);
}

export function liveBookingsForSession(sessionId) {
  return liveCache.bookings.filter((b) => b.sessionId === sessionId);
}

export function livePendingBookings() {
  return liveCache.bookings
    .filter((b) => b.status === "reserved" && b.paymentMarkedAt)
    .sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
}

export function liveHeldBookingsForSession(sessionId) {
  return liveCache.bookings.filter(
    (b) => b.sessionId === sessionId && (b.status === "reserved" || b.status === "confirmed")
  );
}

export function liveConfirmedBookingsForSession(sessionId) {
  return liveCache.bookings.filter(
    (b) => b.sessionId === sessionId && b.status === "confirmed"
  );
}

export function liveQueueForSession(sessionId) {
  const waitlist = liveCache.queues
    .filter((q) => q.sessionId === sessionId && q.status === "active" && q.kind === "waitlist")
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const interest = liveCache.queues
    .filter((q) => q.sessionId === sessionId && q.status === "active" && q.kind === "interest")
    .sort((a, b) => a.joinedAt - b.joinedAt);
  return { waitlist, interest };
}

export function liveAssigneeForWeek(saturdayISO) {
  return liveCache.assignments.get(saturdayISO) || null;
}

export function livePayoutFor(profileId) {
  return liveCache.payout.get(profileId) || null;
}

export function getLiveVenueOverride(sessionId) {
  return liveCache.venueOverrides.get(sessionId) || null;
}

export function listLiveVenueOverrides() {
  return [...liveCache.venueOverrides.values()];
}

export function liveReceiptsForUser(userId) {
  return liveCache.receipts.filter((r) => r.userId === userId);
}

export function liveReceiptForBooking(bookingId) {
  return liveCache.receipts.find((r) => r.bookingId === bookingId) || null;
}

export function liveBookingById(id) {
  return liveCache.bookings.find((b) => b.id === id) || null;
}

export function liveReceiptById(id) {
  return liveCache.receipts.find((r) => r.id === id) || null;
}

export async function liveReserveSession(sessionId) {
  const row = await runOperationalRpc("reserve_operational_session", { p_session_id: sessionId });
  return buildBookingRow(row);
}

export async function liveCancelSession(sessionId, reason) {
  return runOperationalRpc("cancel_operational_session", {
    p_session_id: sessionId,
    p_reason: reason,
  });
}

// One-off events: an inactive template + a single session row, created and
// removed atomically server-side. Deletion is only allowed while the event
// has no active bookings; afterwards admins cancel instead.
export async function liveCreateEvent(payload) {
  const row = await runOperationalRpc("create_operational_event", {
    p_name: payload.name,
    p_session_date: payload.dateISO,
    p_start_time: payload.time,
    p_duration_minutes: payload.durationMin,
    p_venue: payload.location,
    p_maps_query: payload.mapsQuery || null,
    p_category: payload.category || "Other",
    p_price_hkd: payload.price ?? 0,
    p_capacity: payload.capacity ?? 20,
  });
  return row;
}

export async function liveDeleteEvent(sessionId) {
  return runOperationalRpc("delete_operational_event", {
    p_session_id: sessionId,
  });
}

// RSVP withdraw is member self-service on price-0 sessions only.
export async function liveWithdrawRsvp(bookingId) {
  return runOperationalRpc("withdraw_operational_rsvp", {
    p_booking_id: bookingId,
  });
}

export async function liveMarkBookingPaid(bookingId, method, reference) {
  return runOperationalRpc("mark_operational_payment", {
    p_booking_id: bookingId,
    p_method: method,
    p_reference: reference || "",
  });
}

export async function liveApproveBookingPayment(bookingId) {
  return runOperationalRpc("approve_operational_payment", { p_booking_id: bookingId });
}

export async function liveDeferBooking(bookingId, targetSessionId) {
  return runOperationalRpc("defer_operational_booking", {
    p_booking_id: bookingId,
    p_target_session_id: targetSessionId,
  });
}

export async function liveJoinQueue(sessionId, kind) {
  return runOperationalRpc("join_operational_queue", {
    p_session_id: sessionId,
    p_kind: kind,
  });
}

export async function liveLeaveQueue(entryId) {
  return runOperationalRpc("leave_operational_queue", { p_entry_id: entryId });
}

export async function liveFinalizeGym(sessionId, note) {
  return runOperationalRpc("finalize_operational_gym", {
    p_session_id: sessionId,
    p_note: note || "",
  });
}

export async function liveSetSessionTime(sessionId, time) {
  return runOperationalRpc("set_operational_session_time", {
    p_session_id: sessionId,
    p_time: time,
  });
}

export async function liveSetVenueTBC(sessionId, enabled) {
  return runOperationalRpc("set_operational_venue_tbc", {
    p_session_id: sessionId,
    p_enabled: !!enabled,
  });
}

export async function liveSetSessionNotice(sessionId, notice) {
  return runOperationalRpc("set_operational_notice", {
    p_session_id: sessionId,
    p_notice: notice || "",
  });
}

export async function liveSetMidtownOpen(sessionId, enabled) {
  return runOperationalRpc("set_operational_midtown_open", {
    p_session_id: sessionId,
    p_enabled: !!enabled,
  });
}

export async function liveSetCollector(weekStart, profileId) {
  return runOperationalRpc("set_collector_assignment", {
    p_week_start: weekStart,
    p_profile_id: profileId,
  });
}

export async function liveUpdatePayout(profileId, paymeLink, fpsPhone) {
  return runOperationalRpc("update_collector_payout_profile", {
    p_profile_id: profileId,
    p_payme_link: paymeLink || "",
    p_fps_phone: fpsPhone || "",
  });
}

export async function liveSetWeekVenue(sessionId, {
  location, mapsQuery, wasTBC, meetingLat = null, meetingLng = null,
}) {
  const point = normalizeMeetingPoint(meetingLat, meetingLng);
  return runOperationalRpc("set_session_venue", {
    p_session_id: sessionId,
    p_location: String(location || "").trim() || null,
    p_maps_query: String(mapsQuery || "").trim() || null,
    p_was_tbc: !!wasTBC,
    p_meeting_lat: point?.lat ?? null,
    p_meeting_lng: point?.lng ?? null,
  }, {
    applyResult(result) {
      const row = Array.isArray(result) ? result[0] : result;
      if (!row?.session_id) return;
      const override = buildVenueOverrideRow(row);
      liveCache.venueOverrides.set(override.sessionId, override);
    },
  });
}

export function sessionCancellationCopy(session) {
  if (!session) return "";
  if (session.cancelledSource === "system" && session.cancelled && session.cancelReason) {
    return `Session cancelled by ITC — ${session.cancelReason}`;
  }
  if (session.cancelled && session.cancelReason) {
    return `Session cancelled by ITC — ${session.cancelReason}`;
  }
  if (session.cancelled) {
    return "Session cancelled by ITC";
  }
  return "";
}

export { LIVE_TABLES };
