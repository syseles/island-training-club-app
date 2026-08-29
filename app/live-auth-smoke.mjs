// Focused regression for the Supabase OAuth -> synchronous view handoff.
// Run directly with: node app/live-auth-smoke.mjs

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirnameSmoke = dirname(fileURLToPath(import.meta.url));

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};

const authUser = {
  id: "live-user-1",
  email: "runner@example.com",
  user_metadata: {
    full_name: "Riley Runner",
    avatar_url: "https://example.com/avatar.jpg",
  },
};
const profile = {
  id: authUser.id,
  email: authUser.email,
  full_name: "Riley Runner",
  avatar_url: authUser.user_metadata.avatar_url,
  role: "super_admin",
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
};
const applicationRows = new Map([
  [
    authUser.id,
    {
      profile_id: authUser.id,
      mobile: "+852 6123 4567",
      date_of_birth: null,
      is_minor: false,
      guardian_name: null,
      guardian_phone: null,
      emergency_name: "Taylor Coach",
      emergency_relationship: "Coach",
      emergency_phone: "+852 6777 8888",
      heard_source: "instagram",
      heard_detail: "Coach post",
      preferred_name: "Riley",
      photo_consent: true,
      waiver_accepted_at: "2026-08-05T01:00:00.000Z",
      waiver_signature_text: "Riley Runner",
      waiver_signed_at: "2026-08-05",
      waiver_form_version: "v1",
      privacy_accepted_at: "2026-08-05T01:05:00.000Z",
      guidelines_accepted_at: "2026-08-05T01:10:00.000Z",
      submitted_at: "2026-08-05T01:15:00.000Z",
      whatsapp_reminders: false,
      email_receipts: true,
      community_news: true,
    },
  ],
]);
const notificationRows = [
  {
    id: 'notification-admin-application',
    kind: 'admin_application_submitted',
    title: 'Application <submitted>',
    body: 'Review Riley & approve.',
    created_at: '2026-08-05T06:35:00.000Z',
    read_at: null,
  },
  {
    id: 'notification-admin-role',
    kind: 'admin_role_changed',
    title: 'Role changed',
    body: 'A member role changed.',
    created_at: '2026-08-05T04:40:00.000Z',
    read_at: '2026-08-05T05:00:00.000Z',
  },
  {
    id: 'notification-welcome',
    kind: 'welcome',
    title: 'Welcome to ITC',
    body: 'Your membership is ready.',
    created_at: '2026-08-05T06:32:00.000Z',
    read_at: null,
  },
  {
    id: 'notification-malformed',
    kind: null,
    title: 'Imported notification',
    body: 'This row has incomplete metadata.',
    created_at: 'not-a-date',
    read_at: '2026-08-05T06:39:00.000Z',
  },
];
const approvedProfiles = [
  {
    id: "approved-admin",
    email: "tina.admin@example.com",
    full_name: "Tina Admin",
    role: "admin",
    created_at: "2026-08-05T01:00:00.000Z",
  },
  {
    id: "approved-member",
    email: "micah.member@example.com",
    full_name: "Micah Member",
    role: "member",
    created_at: "2026-08-05T02:00:00.000Z",
  },
];
const pendingProfiles = [
  {
    id: "pending-submitted",
    email: "submitted@example.com",
    full_name: "Submitted Runner",
    role: "pending",
    created_at: "2026-08-05T03:00:00.000Z",
  },
  {
    id: "pending-incomplete",
    email: "incomplete@example.com",
    full_name: "Incomplete Runner",
    role: "pending",
    created_at: "2026-08-05T04:00:00.000Z",
  },
];
const declinedProfiles = [
  {
    id: "declined-member",
    email: "declined@example.com",
    full_name: "Declined Runner",
    role: "declined",
    created_at: "2026-08-05T05:00:00.000Z",
  },
];
applicationRows.set("pending-submitted", {
  ...structuredClone(applicationRows.get(authUser.id)),
  profile_id: "pending-submitted",
  profiles: pendingProfiles[0],
});
const applicationUpdates = [];
const profileUpdates = [];
let applicationReadError = null;
let applicationReadGate = null;
const applicationReadGates = [];
let notificationReadError = null;
let notificationReadGate = null;
let notificationQueryCount = 0;
const notificationUpdates = [];
let notificationUpdateError = null;
let notificationUpdateResult = "row";
let notificationUpdateGate = null;
let profileListError = null;
let profileListErrorAfterUpdate = null;
let applicationListError = null;
let profileUpdateError = null;
let profileUpdateResult = "row";
let profileUpdateGate = null;
let activeGivingCampaignRow = null;
let activeGivingCampaignError = null;
let givingCampaignListError = null;
let givingCampaignRows = [];
let operationalRpcHandler = null;
let operationalAuthSubOverride = null;
let operationalVenueOverrideReadError = null;
const operationalRpcCalls = [];
const operationalSubscriptions = [];
const operationalTableRows = {
  operational_sessions: [],
  operational_activity_templates: [
    { activity_id: "hyrox", name: "ITC HYROX", venue: "BFT Causeway Bay", weekday: 6, start_time: "11:15:00", duration_minutes: 60, capacity: 20, price_hkd: 180, default_open: true, active: true, category: "HYROX", maps_query: null, requires_rsvp: false },
    { activity_id: "hyrox-midtown", name: "ITC HYROX", venue: "Midtown 28", weekday: 6, start_time: "11:00:00", duration_minutes: 60, capacity: 12, price_hkd: 180, default_open: false, active: true, category: "HYROX", maps_query: null, requires_rsvp: false },
    { activity_id: "lunch", name: "Post-Training Lunch", venue: "TBC", weekday: 6, start_time: "12:45:00", duration_minutes: 75, capacity: null, price_hkd: 0, default_open: true, active: true, category: "Socials", maps_query: null, requires_rsvp: true },
  ],
  operational_bookings: [],
  operational_queue_entries: [],
  operational_receipts: [],
  collector_assignments: [],
  collector_payout_profiles: [],
  operational_session_venue_overrides: [{
    session_id: "wnt-2026-08-26",
    activity_id: "wnt",
    location: "Tamar Park",
    maps_query: "Tamar Park",
    meeting_lat: 22.2825,
    meeting_lng: 114.1659,
    set_by: "live-admin",
    set_at: "2026-08-05T02:00:00.000Z",
    member_notified_at: "2026-08-05T02:00:00.000Z",
  }],
};
let authStateChangeHandler = null;
let authCallbackLocked = false;
let oauthCalls = 0;
let oauthOptions = null;
let releaseOAuth = null;
let signOutCalls = 0;
let releaseSignOut = null;
const deferredAuthTasks = [];
const LIVE_TABLES_COUNT = 7;
const fixedIso = "2026-08-05T02:00:00.000Z";
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [fixedIso]));
  }
  static now() {
    return new RealDate(fixedIso).getTime();
  }
  static parse(value) {
    return RealDate.parse(value);
  }
  static UTC(...args) {
    return RealDate.UTC(...args);
  }
};

const fakeSupabase = {
  auth: {
    getSession: () => {
      if (authCallbackLocked) {
        throw new Error("getSession must not run while the auth callback lock is held");
      }
      return Promise.resolve({
        data: {
          session: {
            access_token: "test-access-token",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: 9999999999,
            refresh_token: "test-refresh-token",
            user: authUser,
          },
        },
        error: null,
      });
    },
    onAuthStateChange(callback) {
      authStateChangeHandler = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signInWithOAuth(options) {
      oauthCalls++;
      oauthOptions = options;
      return new Promise((resolve) => { releaseOAuth = resolve; });
    },
    signOut() {
      signOutCalls++;
      return new Promise((resolve) => { releaseSignOut = resolve; });
    },
  },
  from(table) {
    if (table === "profiles") {
      return {
        select() {
          return {
            eq(column, value) {
              if (column !== "id" || value !== authUser.id) {
                throw new Error("Profile query did not target the signed-in user");
              }
              return {
                maybeSingle: async () => ({ data: profile, error: null }),
              };
            },
            order(column, options) {
              if (column !== "created_at" || options?.ascending !== true) {
                throw new Error("Profile list query should order by created_at ascending");
              }
              return Promise.resolve({
                data: [
                  structuredClone(profile),
                  ...structuredClone(approvedProfiles),
                  ...structuredClone(pendingProfiles),
                  ...structuredClone(declinedProfiles),
                ],
                error: profileListError,
              });
            },
          };
        },
        update(patch) {
          let targetId = null;
          let expectedRole = null;
          const result = {
            eq(column, value) {
              if (column === "id") targetId = value;
              else if (column === "role") expectedRole = value;
              else throw new Error(`Unexpected profile update filter: ${column}`);
              return result;
            },
            select(columns) {
              if (columns !== "id, role") throw new Error("Profile update must return id and role");
              return {
                single: async () => {
                  if (profileUpdateGate) await profileUpdateGate;
                  const target = targetId === profile.id
                    ? profile
                    : [...approvedProfiles, ...pendingProfiles].find((item) => item.id === targetId);
                  profileUpdates.push({ id: targetId, expectedRole, ...structuredClone(patch) });
                  if (profileUpdateError) return { data: null, error: profileUpdateError };
                  if (profileUpdateResult === "zero" || !target || (expectedRole && target.role !== expectedRole)) {
                    return { data: null, error: null };
                  }
                  Object.assign(target, patch);
                  if (profileListErrorAfterUpdate) profileListError = profileListErrorAfterUpdate;
                  return { data: { id: targetId, role: target.role }, error: null };
                },
              };
            },
          };
          return result;
        },
      };
    }
    if (table === "notifications") {
      return {
        select(columns) {
          if (columns !== "*") throw new Error("Notification query should select all row fields");
          return {
            async order(column, options) {
              if (column !== "created_at" || options?.ascending !== false) {
                throw new Error("Notifications should be newest first");
              }
              notificationQueryCount++;
              const rows = structuredClone(notificationRows);
              const error = notificationReadError;
              const gate = notificationReadGate;
              notificationReadError = null;
              notificationReadGate = null;
              if (gate) await gate;
              return { data: rows, error };
            },
          };
        },
        update(patch) {
          let targetId = null;
          const result = {
            eq(column, value) {
              if (column !== "id") throw new Error("Notification update should target its id");
              targetId = value;
              return result;
            },
            is(column, value) {
              if (column !== "read_at" || value !== null) {
                throw new Error("Notification update should require an unread row");
              }
              return result;
            },
            select(columns) {
              if (columns !== "id, read_at") {
                throw new Error("Notification update must return id and read_at");
              }
              return {
                single: async () => {
                  notificationUpdates.push({ id: targetId, ...structuredClone(patch) });
                  if (notificationUpdateGate) await notificationUpdateGate;
                  if (notificationUpdateError) return { data: null, error: notificationUpdateError };
                  const row = notificationRows.find((item) => item.id === targetId);
                  if (notificationUpdateResult === "zero" || !row || row.read_at) {
                    return { data: null, error: null };
                  }
                  Object.assign(row, structuredClone(patch));
                  return { data: { id: row.id, read_at: row.read_at }, error: null };
                },
              };
            },
          };
          return result;
        },
      };
    }
    if (table === "giving_campaigns") {
      return {
        select() {
          return {
            order(column, options) {
              if (column !== "created_at" || options?.ascending !== false) {
                throw new Error("Giving campaign list must be newest first");
              }
              return Promise.resolve({
                data: givingCampaignListError ? null : givingCampaignRows,
                error: givingCampaignListError,
              });
            },
            eq(column, value) {
              if (column !== "status" || value !== "published") {
                throw new Error("Active Giving query must target published campaigns");
              }
              return {
                maybeSingle: async () => ({
                  data: structuredClone(activeGivingCampaignRow),
                  error: activeGivingCampaignError,
                }),
              };
            },
          };
        },
      };
    }
    if (table === "applications") {
      return {
        select() {
          return {
            eq(column, value) {
              if (column !== "profile_id" || value !== authUser.id) {
                throw new Error("Application query did not target the signed-in user");
              }
              return {
                maybeSingle: async () => {
                  const readGate = applicationReadGates.shift() || applicationReadGate;
                  if (readGate) await readGate;
                  return {
                    data: structuredClone(applicationRows.get(value) || null),
                    error: applicationReadError,
                  };
                },
              };
            },
            then(resolve, reject) {
              return Promise.resolve({
                data: Array.from(applicationRows.values()).map((row) => structuredClone(row)),
                error: applicationListError,
              }).then(resolve, reject);
            },
          };
        },
        upsert(row) {
          applicationRows.set(row.profile_id, structuredClone(row));
          return Promise.resolve({ data: structuredClone(row), error: null });
        },
        update(patch) {
          return {
            eq(column, value) {
              if (column !== "profile_id" || value !== authUser.id) {
                throw new Error("Application update did not target the signed-in user");
              }
              applicationUpdates.push(structuredClone(patch));
              const next = {
                ...(applicationRows.get(value) || { profile_id: value }),
                ...patch,
              };
              applicationRows.set(value, next);
              return {
                select() {
                  return {
                    single: async () => ({ data: structuredClone(next), error: null }),
                  };
                },
              };
            },
          };
        },
      };
    }
    if (table in operationalTableRows) {
      const rows = operationalTableRows[table];
      const result = () => {
        const error = table === "operational_session_venue_overrides"
          ? operationalVenueOverrideReadError
          : null;
        if (table === "operational_session_venue_overrides") {
          operationalVenueOverrideReadError = null;
        }
        return { data: error ? null : rows.slice(), error };
      };
      const thenable = () => Promise.resolve(result());
      const chain = {
        order: thenable,
        gte: () => chain,
        or: () => chain,
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        is: () => chain,
        match: () => chain,
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return { select: () => chain };
    }
    throw new Error(`Unexpected table: ${table}`);
  },
  rpc(name, args) {
    if (operationalRpcHandler) return operationalRpcHandler(name, args);
    return Promise.resolve({ data: null, error: null });
  },
  channel(name) {
    const channel = {
      name,
      handlers: [],
      on(_event, _filter, handler) { channel.handlers.push(handler); return channel; },
      subscribe() { operationalSubscriptions.push(channel); return channel; },
    };
    return channel;
  },
  removeChannel(ch) {
    const idx = operationalSubscriptions.indexOf(ch);
    if (idx >= 0) operationalSubscriptions.splice(idx, 1);
    return Promise.resolve();
  },
};

globalThis.window = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  supabase: { createClient: () => fakeSupabase },
};

// Seed operational fake tables with at least one upcoming paid session so
// scheduled live-mode views can render.
const today = new Date();
const aug15Iso = "2026-08-15";
const seededCancelled = new Set(["hyrox-2026-08-15", "hyrox-midtown-2026-08-15"]);
const normalWeeklyFixtureDates = [];
const firstNormalSaturday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
const daysUntilNextSaturday = ((6 - firstNormalSaturday.getDay() + 7) % 7) || 7;
firstNormalSaturday.setDate(firstNormalSaturday.getDate() + daysUntilNextSaturday);
for (let week = 0; normalWeeklyFixtureDates.length < 4; week += 1) {
  const d = new Date(firstNormalSaturday);
  d.setDate(firstNormalSaturday.getDate() + week * 7);
  const iso = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
  if (iso === aug15Iso) continue;
  normalWeeklyFixtureDates.push(iso);
  operationalTableRows.operational_sessions.push({
    id: `hyrox-${iso}`,
    activity_id: "hyrox",
    session_date: iso,
    start_time: "11:15:00",
    duration_minutes: 60,
    venue: "BFT Causeway Bay",
    capacity: 20,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
  operationalTableRows.operational_sessions.push({
    id: `lunch-${iso}`,
    activity_id: "lunch",
    session_date: iso,
    start_time: "12:45:00",
    duration_minutes: 75,
    venue: "TBC",
    capacity: null,
    price_hkd: 0,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
  operationalTableRows.operational_sessions.push({
    id: `hyrox-midtown-${iso}`,
    activity_id: "hyrox-midtown",
    session_date: iso,
    start_time: "11:00:00",
    duration_minutes: 60,
    venue: "Midtown 28",
    capacity: 12,
    price_hkd: 180,
    is_open: false,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
}

// Seed the 15 August 2026 cancelled sessions with system provenance.
operationalTableRows.operational_sessions.push({
  id: "hyrox-2026-08-15",
  activity_id: "hyrox",
  session_date: aug15Iso,
  start_time: "11:15:00",
  duration_minutes: 60,
  venue: "BFT Causeway Bay",
  capacity: 20,
  price_hkd: 180,
  is_open: true,
  venue_tbc: false,
  notice: null,
  cancelled_at: today.toISOString(),
  cancelled_by: null,
  cancelled_source: "system",
  cancel_reason: "HYROX race weekend",
  gym_confirmed_at: null,
  gym_confirmed_by: null,
  gym_note: null,
  created_at: today.toISOString(),
  updated_at: today.toISOString(),
});
operationalTableRows.operational_sessions.push({
  id: "hyrox-midtown-2026-08-15",
  activity_id: "hyrox-midtown",
  session_date: aug15Iso,
  start_time: "11:00:00",
  duration_minutes: 60,
  venue: "Midtown 28",
  capacity: 12,
  price_hkd: 180,
  is_open: false,
  venue_tbc: false,
  notice: null,
  cancelled_at: today.toISOString(),
  cancelled_by: null,
  cancelled_source: "system",
  cancel_reason: "HYROX race weekend",
  gym_confirmed_at: null,
  gym_confirmed_by: null,
  gym_note: null,
  created_at: today.toISOString(),
  updated_at: today.toISOString(),
});

assert.equal(normalWeeklyFixtureDates.length, 4, "live smoke needs four normal weekly fixtures");
assert.ok(!normalWeeklyFixtureDates.includes(aug15Iso), "normal weekly fixtures must skip the cancelled race weekend");
assert.ok(
  normalWeeklyFixtureDates.every((iso) => new RealDate(`${iso}T00:00:00Z`).getUTCDay() === 6),
  "normal weekly fixture dates must all be Saturdays",
);
const operationalSessionIds = operationalTableRows.operational_sessions.map((row) => row.id);
assert.equal(
  new Set(operationalSessionIds).size,
  operationalSessionIds.length,
  "live operational fixture IDs must be unique",
);

operationalRpcHandler = (name, args) => {
  operationalRpcCalls.push({ name, args: structuredClone(args) });
  const override = operationalAuthSubOverride;
  operationalAuthSubOverride = null;
  const now = new Date().toISOString();
  const actingProfile = override || authUser.id;
  if (name === "create_operational_event") {
    const activityId = `event-${operationalTableRows.operational_activity_templates.length + 1}`;
    operationalTableRows.operational_activity_templates.push({
      activity_id: activityId,
      name: args.p_name,
      venue: args.p_venue,
      weekday: new Date(`${args.p_session_date}T00:00:00`).getDay(),
      start_time: args.p_start_time,
      duration_minutes: args.p_duration_minutes,
      capacity: args.p_capacity,
      price_hkd: args.p_price_hkd,
      default_open: true,
      active: false,
      category: args.p_category || "Other",
      maps_query: args.p_maps_query || null,
    });
    const session = {
      id: `${activityId}-${args.p_session_date}`,
      activity_id: activityId,
      session_date: args.p_session_date,
      start_time: args.p_start_time,
      duration_minutes: args.p_duration_minutes,
      venue: args.p_venue,
      capacity: args.p_capacity,
      price_hkd: args.p_price_hkd,
      is_open: true,
      venue_tbc: false,
      notice: null,
      cancelled_at: null,
      cancelled_by: null,
      cancelled_source: null,
      cancel_reason: null,
      gym_confirmed_at: null,
      gym_confirmed_by: null,
      gym_note: null,
      created_at: now,
      updated_at: now,
    };
    operationalTableRows.operational_sessions.push(session);
    return Promise.resolve({ data: session, error: null });
  }
  if (name === "delete_operational_event") {
    const idx = operationalTableRows.operational_sessions.findIndex((s) => s.id === args.p_session_id);
    const row = operationalTableRows.operational_sessions[idx];
    if (!row) return Promise.resolve({ data: null, error: { message: "Session not found." } });
    if (!row.activity_id.startsWith("event-")) {
      return Promise.resolve({ data: null, error: { message: "Only one-off events can be deleted; cancel recurring sessions instead." } });
    }
    const hasBookings = operationalTableRows.operational_bookings.some(
      (b) => b.session_id === args.p_session_id && ["reserved", "confirmed"].includes(b.status)
    );
    if (hasBookings) {
      return Promise.resolve({ data: null, error: { message: "Event has active bookings — cancel the session instead." } });
    }
    operationalTableRows.operational_sessions.splice(idx, 1);
    const tIdx = operationalTableRows.operational_activity_templates.findIndex((t) => t.activity_id === row.activity_id);
    if (tIdx >= 0) operationalTableRows.operational_activity_templates.splice(tIdx, 1);
    return Promise.resolve({ data: null, error: null });
  }
  if (name === "reserve_operational_session") {
    const sessionRow = operationalTableRows.operational_sessions.find((s) => s.id === args.p_session_id);
    const templateRow = operationalTableRows.operational_activity_templates.find((t) => t.activity_id === sessionRow?.activity_id);
    const isRsvp = sessionRow && Number(sessionRow.price_hkd) === 0;
    const id = "b-" + (operationalTableRows.operational_bookings.length + 1);
    const booking = {
      id,
      profile_id: actingProfile,
      session_id: args.p_session_id,
      status: isRsvp ? "confirmed" : "reserved",
      reserved_at: now,
      pay_deadline_at: now,
      payment_marked_at: null,
      payment_method: null,
      payment_reference: null,
      paid_at: isRsvp ? now : null,
      confirmed_by: null,
      snapshot: isRsvp && sessionRow
        ? {
          name: templateRow?.name || sessionRow.activity_id,
          session_date: sessionRow.session_date,
          start_time: sessionRow.start_time,
          venue: sessionRow.venue,
          price_hkd: 0,
        }
        : {
          name: "ITC HYROX",
          session_date: "2026-08-22",
          start_time: "11:15:00",
          venue: "BFT Causeway Bay",
          price_hkd: 180,
        },
    };
    operationalTableRows.operational_bookings.push(booking);
    return Promise.resolve({ data: booking, error: null });
  }
  if (name === "withdraw_operational_rsvp") {
    const row = operationalTableRows.operational_bookings.find((b) => b.id === args.p_booking_id);
    const sRow = operationalTableRows.operational_sessions.find((s) => s.id === row?.session_id);
    if (!row || row.profile_id !== actingProfile || !sRow || Number(sRow.price_hkd) > 0 || row.status !== "confirmed") {
      return Promise.resolve({ data: null, error: { message: "Only your own confirmed RSVP can be withdrawn." } });
    }
    row.status = "cancelled";
    return Promise.resolve({ data: row, error: null });
  }
  if (name === "mark_operational_payment") {
    const row = operationalTableRows.operational_bookings.find((b) => b.id === args.p_booking_id);
    if (row) {
      row.payment_marked_at = now;
      row.payment_method = args.p_method;
      row.payment_reference = args.p_reference || null;
    }
    return Promise.resolve({ data: row || null, error: null });
  }
  if (name === "set_collector_assignment") {
    const idx = operationalTableRows.collector_assignments.findIndex((row) => row.week_start === args.p_week_start);
    const row = {
      week_start: args.p_week_start,
      collector_profile_id: args.p_profile_id,
      assigned_by: actingProfile,
      assigned_at: now,
    };
    if (idx >= 0) operationalTableRows.collector_assignments[idx] = row;
    else operationalTableRows.collector_assignments.push(row);
    return Promise.resolve({ data: row, error: null });
  }
  if (name === "update_collector_payout_profile") {
    const idx = operationalTableRows.collector_payout_profiles.findIndex((row) => row.profile_id === args.p_profile_id);
    const row = {
      profile_id: args.p_profile_id,
      payme_link: args.p_payme_link || null,
      fps_phone: args.p_fps_phone || null,
    };
    if (idx >= 0) operationalTableRows.collector_payout_profiles[idx] = row;
    else operationalTableRows.collector_payout_profiles.push(row);
    return Promise.resolve({ data: row, error: null });
  }
  if (name === "defer_operational_booking") {
    const source = operationalTableRows.operational_bookings.find((b) => b.id === args.p_booking_id);
    if (!source) return Promise.resolve({ data: null, error: { message: "Booking not found." } });
    const target = operationalTableRows.operational_sessions.find((s) => s.id === args.p_target_session_id);
    if (!target) return Promise.resolve({ data: null, error: { message: "Target session not found." } });
    const newBooking = {
      id: "b-def-" + (operationalTableRows.operational_bookings.length + 1),
      profile_id: source.profile_id,
      session_id: target.id,
      status: "confirmed",
      reserved_at: now,
      pay_deadline_at: now,
      payment_marked_at: source.payment_marked_at,
      payment_method: source.payment_method,
      payment_reference: source.payment_reference,
      paid_at: source.paid_at,
      confirmed_by: source.confirmed_by,
      deferred_from_booking_id: source.id,
      snapshot: { ...target, session_date: target.session_date, price_hkd: target.price_hkd, venue: target.venue },
    };
    operationalTableRows.operational_bookings.push(newBooking);
    source.status = "deferred";
    source.deferred_to_booking_id = newBooking.id;
    return Promise.resolve({ data: newBooking, error: null });
  }
  if (name === "finalize_operational_gym") {
    const session = operationalTableRows.operational_sessions.find((s) => s.id === args.p_session_id);
    if (!session) return Promise.resolve({ data: null, error: { message: "Session not found." } });
    session.gym_confirmed_at = now;
    session.gym_confirmed_by = actingProfile;
    session.gym_note = args.p_note || null;
    return Promise.resolve({ data: session, error: null });
  }
  if (name === "set_session_venue") {
    const sessionId = args.p_session_id;
    const activityId = String(sessionId || "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
    if (!["wnt", "run", "water", "lunch"].includes(activityId)) {
      return Promise.resolve({ data: null, error: { message: "Activity venue is fixed." } });
    }
    const existing = operationalTableRows.operational_session_venue_overrides
      .find((row) => row.session_id === sessionId);
    const location = String(args.p_location || "").trim() || null;
    const normalizedLocation = String(location || "").trim().toLowerCase().replace(/\s+/g, " ");
    const acceptsPoint = activityId === "wnt"
      && ["tamar park", "tamar park, admiralty"].includes(normalizedLocation);
    const next = {
      session_id: sessionId,
      activity_id: activityId,
      location,
      maps_query: String(args.p_maps_query || "").trim() || null,
      meeting_lat: acceptsPoint ? args.p_meeting_lat ?? null : null,
      meeting_lng: acceptsPoint ? args.p_meeting_lng ?? null : null,
      set_by: actingProfile,
      set_at: now,
      member_notified_at: existing?.member_notified_at || null,
    };
    if (args.p_was_tbc && !existing?.member_notified_at && next.location && next.maps_query) {
      next.member_notified_at = now;
    }
    if (existing) Object.assign(existing, next);
    else operationalTableRows.operational_session_venue_overrides.push(next);
    return Promise.resolve({ data: next, error: null });
  }
  return Promise.resolve({ data: null, error: null });
};

const store = await import("./js/store.js");
const views = await import("./js/views.js");
const data = await import("./js/data.js");
const operations = await import("./js/operations.js");
const todayISO = data.isoDate(data.todayLocal());
store.load();
await store.hydrateLiveOperations();

const hydratedWntPoint = store.getSession("wnt-2026-08-26");
assert.equal(hydratedWntPoint.meetingLat, 22.2825);
assert.equal(hydratedWntPoint.meetingLng, 114.1659);
const hydratedBft = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox");
const hydratedMidtown = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox-midtown");
assert.equal(hydratedBft.photo, "../assets/itc/hyrox.webp");
assert.equal(hydratedMidtown.photo, "../assets/itc/hyrox.webp");
assert.equal(hydratedMidtown.location, "Midtown28 Fitness");
assert.equal(hydratedMidtown.venue, "Midtown28 Fitness");
assert.equal(hydratedMidtown.mapsQuery, "Midtown28 Fitness, Hong Kong");
for (const html of [
  views.viewActivity(hydratedBft.id),
  views.viewActivity(hydratedMidtown.id),
]) {
  assert.match(html, /class="detail-photo" src="\.\.\/assets\/itc\/hyrox\.webp"/);
}

const customMidtownFixture = operationalTableRows.operational_sessions
  .find((row) => row.id === hydratedMidtown.id);
assert.ok(customMidtownFixture, "live smoke needs a Midtown fixture to mutate");
customMidtownFixture.venue = "Custom Midtown Venue";
try {
  await operations.refreshOperationalState();
  const customMidtown = store.upcomingSessions(21)
    .find((session) => session.id === hydratedMidtown.id);
  assert.equal(customMidtown.location, "Custom Midtown Venue");
  assert.equal(customMidtown.venue, "Custom Midtown Venue");
  assert.equal(customMidtown.mapsQuery, "Custom Midtown Venue");
  assert.equal(customMidtown.photo, "../assets/itc/hyrox.webp");
} finally {
  customMidtownFixture.venue = "Midtown 28";
  await operations.refreshOperationalState();
}

const appSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
assert.match(appSource, /form\.dataset\.form === "apply"/);
assert.match(appSource, /payload\.waiver = !!fd\.get\("waiver"\)/);
assert.match(appSource, /await store\.saveMyApplication\(payload\)/);
assert.match(appSource, /form\.dataset\.form === "membership-details"/);
assert.match(appSource, /await store\.updateMyMembershipDetails\(/);
assert.match(appSource, /await store\.acceptMyIndemnity\(\{/);
assert.match(appSource, /const acceptButton = form\.querySelector\("\[data-doc-submit\]"\)/);
assert.match(appSource, /acceptButton\.disabled/);
assert.match(appSource, /signature:\s*fd\.get\("signature"\)/);
assert.match(appSource, /signedAt:\s*fd\.get\("signedAt"\)/);
assert.match(appSource, /emergencyRelationship:\s*fd\.get\("emergencyRelationship"\)/);
assert.match(appSource, /t\.name !== "age_over_18"/);
assert.match(appSource, /const APPLY_DRAFT_DEBOUNCE_MS = 500/);
assert.match(appSource, /case "save-draft"/);
assert.match(appSource, /case "discard-draft"/);
assert.match(appSource, /store\.saveApplyDraft/);
assert.match(appSource, /store\.clearApplyDraft/);

await store.setWeekVenue("wnt-2026-08-05", {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
  wasTBC: true,
});
await operations.refreshOperationalState();
const lastVenueCall = operationalRpcCalls
  .filter((call) => call.name === "set_session_venue")
  .at(-1);
assert.equal(lastVenueCall.args.p_session_id, "wnt-2026-08-05");
assert.equal(lastVenueCall.args.p_location, "Central Harbourfront — 7pm sharp");
assert.equal(lastVenueCall.args.p_maps_query, "Central Harbourfront, Hong Kong");
assert.equal(lastVenueCall.args.p_was_tbc, true);
assert.equal(lastVenueCall.args.p_meeting_lat, null);
assert.equal(lastVenueCall.args.p_meeting_lng, null);
assert.equal(lastVenueCall.name, "set_session_venue");
assert.deepEqual(operations.getLiveVenueOverride("wnt-2026-08-05"), {
  sessionId: "wnt-2026-08-05",
  activityId: "wnt",
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
  meetingLat: null,
  meetingLng: null,
  setBy: authUser.id,
  setAt: Date.parse(fixedIso),
  memberNotifiedAt: Date.parse(fixedIso),
});
const venueChannel = operationalSubscriptions
  .flatMap((channel) => channel.handlers)
  .filter((handler) => handler);
assert.ok(
  operationalSubscriptions.some((channel) =>
    channel.handlers.length >= LIVE_TABLES_COUNT),
  "Realtime channel should subscribe to every operational table including venue overrides"
);
assert.equal(operations.operationalStateStatus().loaded, true);

// The mutation result is authoritative even when the best-effort full refresh
// immediately after it fails. A rerender must see the just-saved override.
const cacheFirstSessionId = "water-2026-08-11";
operationalVenueOverrideReadError = { message: "simulated venue override refresh failure" };
const refreshWarnings = [];
const consoleWarnBeforeCacheTest = console.warn;
console.warn = (...args) => refreshWarnings.push(args);
await store.setWeekVenue(cacheFirstSessionId, {
  location: "Victoria Park Swimming Pool",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
});
console.warn = consoleWarnBeforeCacheTest;
assert.ok(
  refreshWarnings.some(([message]) => message === "operations refresh after rpc failed"),
  "the live regression must exercise the failed best-effort refresh path"
);
assert.deepEqual(operations.getLiveVenueOverride(cacheFirstSessionId), {
  sessionId: cacheFirstSessionId,
  activityId: "water",
  location: "Victoria Park Swimming Pool",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
  meetingLat: null,
  meetingLng: null,
  setBy: authUser.id,
  setAt: Date.parse(fixedIso),
  memberNotifiedAt: Date.parse(fixedIso),
});
const cacheFirstDecoratedSession = store.getSession(cacheFirstSessionId);
assert.equal(cacheFirstDecoratedSession.location, "Victoria Park Swimming Pool");
assert.equal(cacheFirstDecoratedSession.mapsQuery, "Victoria Park Swimming Pool, Hong Kong");
await operations.refreshOperationalState();
assert.equal(
  operations.operationalStateStatus().error,
  null,
  "a one-shot refresh failure must not poison later operational refreshes"
);
console.log("ok  successful venue RPC updates live cache before a failed refresh");

const partialLiveSessionId = "water-2026-08-18";
await store.setWeekVenue(partialLiveSessionId, {
  location: "",
  mapsQuery: "Sun Yat Sen Pool, Hong Kong",
});
const partialLiveOverride = operations.getLiveVenueOverride(partialLiveSessionId);
const partialLiveSession = store.getSession(partialLiveSessionId);
assert.equal(partialLiveOverride.memberNotifiedAt, null);
assert.equal(partialLiveSession.location, "TBC");
assert.notEqual(partialLiveSession.venueTBC, false);
await store.setWeekVenue(partialLiveSessionId, {
  location: "Sun Yat Sen Memorial Park Swimming Pool",
  mapsQuery: "Sun Yat Sen Pool, Hong Kong",
});
assert.equal(
  operations.getLiveVenueOverride(partialLiveSessionId).memberNotifiedAt,
  Date.parse(fixedIso),
  "completing a live partial override must consume member dedupe only then"
);
console.log("ok  live partial venue remains TBC until both values confirm it");

const signedOutHome = views.viewHome();
assert.match(signedOutHome, /data-action="sign-in-google"[^>]*>Continue with Google</);
assert.doesNotMatch(signedOutHome, /href="#\/account"[^>]*>Sign in or join</);
store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
const signedOutAccount = await views.viewAccount();
assert.match(signedOutAccount, /Continue your application/);
assert.match(signedOutAccount, /data-action="discard-draft"/);
assert.match(signedOutAccount, /data-action="sign-in-google"/);
store.clearApplyDraft();

await store.getCurrentUser();
const originalProfileForApply = structuredClone(profile);
const originalApplicationForApply = structuredClone(applicationRows.get(authUser.id));
Object.assign(profile, { role: "pending" });
applicationRows.delete(authUser.id);
await store.getCurrentUser();
const liveApplyHtml = await views.viewApply();
assert.match(liveApplyHtml, /data-form="apply"/);
assert.match(liveApplyHtml, /name="mobile"/);
assert.match(liveApplyHtml, /name="age_over_18"/);
for (const name of ["emergency_relationship", "waiver_signature_text", "waiver_signed_at"]) {
  assert.match(liveApplyHtml, new RegExp(`name="${name}"`));
}
assert.match(liveApplyHtml, /name="waiver"/);
assert.match(liveApplyHtml, /data-doc-accept="indemnity"/);
assert.match(liveApplyHtml, /name="waiver"[^>]*disabled[^>]*data-doc-checkbox/);
assert.match(liveApplyHtml, new RegExp(`name="waiver_signed_at"[^>]*value="${todayISO}"`));
assert.match(liveApplyHtml, new RegExp(`name="waiver_signed_at"[^>]*max="${todayISO}"`));
assert.doesNotMatch(liveApplyHtml, /name="email"/);

store.saveApplyDraft({ fields: {
  mobile: "+852 6123 4567",
  age_over_18: "yes",
  emergency_name: "Taylor Coach",
  emergency_relationship: "Coach",
  emergency_phone: "+852 6777 8888",
  heard_source: "friend",
  preferred_name: "Riley",
  photo_consent: true,
  waiver: true,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
  privacy: true,
  guidelines: true,
} });
const draftApplyHtml = await views.viewApply();
assert.match(draftApplyHtml, /data-draft-resume/);
assert.match(draftApplyHtml, /value="\+852 6123 4567"/);
assert.match(draftApplyHtml, /name="age_over_18" value="yes" checked/);
assert.match(draftApplyHtml, /name="emergency_relationship" value="Coach"/);
assert.match(draftApplyHtml, /name="waiver_signature_text" value="Riley Runner"/);
assert.match(draftApplyHtml, /name="waiver_signed_at" value="2026-08-05"/);
assert.match(draftApplyHtml, /data-action="save-draft"/);
assert.match(draftApplyHtml, /data-action="discard-draft"/);

const liveApplyPayload = {
  mobile: "+852 6123 4567",
  age_over_18: "yes",
  guardian_name: "",
  guardian_phone: "",
  emergency_name: "Taylor Coach",
  emergency_relationship: "Coach",
  emergency_phone: "+852 6777 8888",
  heard_source: "friend",
  heard_detail: "",
  preferred_name: "Riley",
  photo_consent: false,
  waiver: true,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
};
for (const [label, overrides] of [
  ["missing emergency name", { emergency_name: "" }],
  ["missing emergency phone", { emergency_phone: "" }],
]) {
  await assert.rejects(
    () => store.saveMyApplication({ ...liveApplyPayload, ...overrides }),
    /Enter emergency contact name, relationship and phone/,
    `${label} should be rejected during live application submit`
  );
}
await store.saveMyApplication(liveApplyPayload);
assert.equal(store.getApplyDraft(), null, "successful live submit must clear its draft");

Object.assign(profile, originalProfileForApply);
if (originalApplicationForApply) applicationRows.set(authUser.id, originalApplicationForApply);
await store.getCurrentUser();
const queue = await store.listApprovalCandidates();
const submitted = queue.find((item) => item.id === "pending-submitted");
const incomplete = queue.find((item) => item.id === "pending-incomplete");
if (!submitted?.applicationSubmitted || incomplete?.applicationSubmitted !== false) {
  throw new Error("Approval queue must include both pending groups");
}
if (queue.some((item) => item.id === authUser.id)) {
  throw new Error("Approved/admin profiles must not enter the approval queue");
}
const approvalsHtml = await views.viewAdmin("approvals");
assert.match(approvalsHtml, /Ready for review \(1\)/);
assert.match(approvalsHtml, /Awaiting application \(1\)/);
assert.ok(approvalsHtml.indexOf("Submitted Runner") < approvalsHtml.indexOf("Incomplete Runner"),
  "Submitted applications must render first");
if (!approvalsHtml.includes("Application not submitted")) {
  throw new Error("Approvals must explain incomplete pending profiles");
}
assert.match(approvalsHtml, /<dt>Indemnity<\/dt><dd>Accepted<\/dd>/);
const submittedApplication = structuredClone(applicationRows.get("pending-submitted"));
applicationRows.set("pending-submitted", {
  ...submittedApplication,
  emergency_phone: "",
});
const reviewRequiredHtml = await views.viewAdmin("approvals");
assert.match(reviewRequiredHtml, /<dt>Indemnity<\/dt><dd>Review required<\/dd>/);
applicationRows.set("pending-submitted", submittedApplication);
const submittedProfile = pendingProfiles.find((item) => item.id === "pending-submitted");
const incompleteProfile = pendingProfiles.find((item) => item.id === "pending-incomplete");
submittedProfile.role = "member";
const readyEmptyHtml = await views.viewAdmin("approvals");
assert.match(readyEmptyHtml, /Ready for review \(0\)[\s\S]*No applications ready for review\./);
assert.match(readyEmptyHtml, /Awaiting application \(1\)/);
submittedProfile.role = "pending";
incompleteProfile.role = "member";
const awaitingEmptyHtml = await views.viewAdmin("approvals");
assert.match(awaitingEmptyHtml, /Ready for review \(1\)/);
assert.match(awaitingEmptyHtml, /Awaiting application \(0\)[\s\S]*No members awaiting an application\./);
submittedProfile.role = "member";
const allEmptyHtml = await views.viewAdmin("approvals");
assert.match(allEmptyHtml, /No pending members/);
submittedProfile.role = "pending";
incompleteProfile.role = "pending";
const decisionButton = (profileId, action) => approvalsHtml.match(
  new RegExp(`<button[^>]*data-action="${action}"[^>]*data-user="${profileId}"[^>]*>`)
)?.[0] || "";
for (const action of ["approve", "decline"]) {
  assert.match(decisionButton("pending-incomplete", action), /\sdisabled(?:\s|>)/,
    `Incomplete ${action} must be disabled`);
  assert.doesNotMatch(decisionButton("pending-submitted", action), /\sdisabled(?:\s|>)/,
    `Submitted ${action} must be enabled`);
}
const membersHtml = await views.viewAdmin("members");
assert.doesNotMatch(membersHtml, /member-summary|Member status counts|data-change="member-(?:status|role)-filter"/);
for (const [key, options] of Object.entries({
  status: [["all", "All"], ["approved", "Approved"], ["pending", "Pending"], ["declined", "Declined"]],
  role: [["all", "All roles"], ["member", "Member"], ["admin", "Admin"], ["superadmin", "Super Admin"]],
})) {
  for (const [value, label] of options) {
    assert.match(membersHtml, new RegExp(`<button[^>]*data-action="admin-member-filter"[^>]*data-filter-key="${key}"[^>]*data-filter-value="${value}"[^>]*aria-pressed="${value === "all"}"[^>]*>${label}</button>`));
  }
}
assert.doesNotMatch(membersHtml, /Clear filters/);
if (!/Declined Runner[\s\S]*badge danger">Declined</.test(membersHtml)) {
  throw new Error("Members must badge declined profiles as Declined");
}
assert.match(membersHtml, />Super Admin</);
assert.match(membersHtml, />Admin</);
assert.match(membersHtml, />Member</);
assert.doesNotMatch(membersHtml, />super_?admin</i, "Raw role spellings must not appear as labels");
assert.match(membersHtml, /Search members/);
assert.match(membersHtml, /Status/);
assert.match(membersHtml, /Role/);
views.adminMemberFilters.query = "tina";
views.adminMemberFilters.status = "approved";
views.adminMemberFilters.role = "admin";
const filteredMembersHtml = await views.viewAdmin("members");
assert.match(filteredMembersHtml, /data-action="admin-member-filters-clear"[^>]*>Clear filters</);
assert.match(filteredMembersHtml, /Tina Admin/);
for (const excluded of ["Riley Runner", "Micah Member", "Submitted Runner", "Declined Runner"]) {
  assert.doesNotMatch(filteredMembersHtml, new RegExp(excluded));
}
views.adminMemberFilters.query = "nobody";
const noMembersHtml = await views.viewAdmin("members");
assert.match(noMembersHtml, /No members match/i);
assert.match(noMembersHtml, /nobody/i);
assert.match(noMembersHtml, /Approved/);
assert.match(noMembersHtml, /Admin/);
views.adminMemberFilters.query = "";
views.adminMemberFilters.status = "all";
views.adminMemberFilters.role = "all";

// Admin Giving falls back to a clear "setup required" panel when the deployed
// Supabase project is missing the giving_campaigns table. Other errors must
// still surface to the caller.
givingCampaignListError = {
  code: "PGRST205",
  message: "Could not find the table 'public.giving_campaigns' in the schema cache",
};
const setupHtml = await views.viewAdmin("giving");
assert.match(setupHtml, /Giving setup required/);
assert.match(setupHtml, /20260805000011_giving_campaigns\.sql/);
assert.match(setupHtml, /20260806000001_donor_id\.sql/);
for (const forbidden of ["+ Create campaign", "form-campaign", "campaign-row", "Publish campaign", "Close campaign"]) {
  assert.doesNotMatch(setupHtml, new RegExp(forbidden.replace(/[+]/g, "\\+")));
}
const setupDetailHtml = await views.viewAdminCampaign("new");
assert.match(setupDetailHtml, /Giving setup required/);
assert.match(setupDetailHtml, /20260805000011_giving_campaigns\.sql/);
assert.match(setupDetailHtml, /20260806000001_donor_id\.sql/);
for (const forbidden of ["+ Create campaign", "form-campaign", "campaign-row", "Publish campaign", "Close campaign"]) {
  assert.doesNotMatch(setupDetailHtml, new RegExp(forbidden.replace(/[+]/g, "\\+")));
}

givingCampaignListError = { code: "42501", message: "permission denied" };
await assert.rejects(() => views.viewAdmin("giving"), (error) => error?.message === "permission denied");
await assert.rejects(() => views.viewAdminCampaign("new"), (error) => error?.message === "permission denied");
givingCampaignListError = null;

// Live Admin list/render: present a closed campaign row so the fake proves
// Supabase query normalization + closed-history rendering end-to-end, then
// restore the rows so downstream tests do not observe the fixture.
const originalGivingCampaignRows = givingCampaignRows;
givingCampaignRows = [{
  id: "live-closed-1",
  title: "Live Closed Campaign",
  description: "A previously closed live Giving campaign.",
  goal_hkd: 12345,
  fps_id: "9876543",
  fps_payee: "Island Evangelical Community Church",
  status: "closed",
  creator_profile_id: "live-admin",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
  published_at: "2026-07-02T00:00:00.000Z",
  closed_at: "2026-07-15T00:00:00.000Z",
}];
try {
  const liveGivingHtml = await views.viewAdmin("giving");
  assert.match(liveGivingHtml, /Live Closed Campaign/);
  assert.match(liveGivingHtml, /<span class="badge neutral">closed<\/span>/);
  assert.match(liveGivingHtml, /\+ Create campaign/);
} finally {
  givingCampaignRows = originalGivingCampaignRows;
}

await store.decideApplication(submitted.id, "declined");
if (!profileUpdates.some((update) =>
  update.id === submitted.id && update.role === "declined" && update.expectedRole === "pending"
)) {
  throw new Error("Decline must change exactly the targeted pending profile role");
}
await assert.rejects(
  () => store.decideApplication(incomplete.id, "member"),
  /Application not submitted/
);
profile.role = "declined";
await store.getCurrentUser();
if (store.currentUser().status !== "declined") {
  throw new Error("Live declined profiles must hydrate with declined status");
}
profile.role = "super_admin";
await store.getCurrentUser();
let renderedUser = store.currentUser();
if (!renderedUser || renderedUser.id !== authUser.id) {
  throw new Error("A fetched Supabase session was not available to synchronous views");
}
const notificationNow = new RealDate("2026-08-05T06:40:00.000Z");
profile.role = "admin";
await store.getCurrentUser();
const ordinaryAdminNotificationsHtml = await views.viewNotifications(notificationNow);
assert.match(ordinaryAdminNotificationsHtml, /Application &lt;submitted&gt;/,
  "Ordinary admins must receive operational notifications");
profile.role = "super_admin";
await store.getCurrentUser();
renderedUser = store.currentUser();
const categoryRows = [
  ...notificationRows,
  {
    id: "notification-decision",
    kind: "admin_application_approved",
    title: "Application approved",
    body: "A membership was approved.",
    created_at: "2026-08-05T06:34:00.000Z",
    read_at: null,
  },
  {
    id: "notification-club",
    kind: "giving_campaign_published",
    title: "Giving campaign published",
    body: "A campaign is ready.",
    created_at: "2026-08-05T06:33:00.000Z",
    read_at: null,
  },
];
views.notificationFilters.kind = "all";
const categoryNotificationsHtml = await views.viewNotifications(notificationNow, categoryRows);
for (const badge of ["Application", "Decision", "Role change", "Club update", "My account"]) {
  assert.match(categoryNotificationsHtml, new RegExp(`class="notification-kind-badge">${badge}<`));
}
assert.match(categoryNotificationsHtml, /Giving campaign published[\s\S]*?data-destination="#\/giving"|data-destination="#\/giving"[\s\S]*?Giving campaign published/);
const categoryFilterCases = [
  ["application", "Application &lt;submitted&gt;"],
  ["decision", "Application approved"],
  ["role", "Role changed"],
  ["club", "Giving campaign published"],
];
for (const [kind, expectedTitle] of categoryFilterCases) {
  views.notificationFilters.kind = kind;
  const filteredHtml = await views.viewNotifications(notificationNow, categoryRows);
  assert.match(filteredHtml, new RegExp(expectedTitle), `${kind} notifications must display in their filter`);
  for (const [, otherTitle] of categoryFilterCases) {
    if (otherTitle !== expectedTitle) {
      assert.doesNotMatch(filteredHtml, new RegExp(otherTitle), `${kind} filter must exclude other notification categories`);
    }
  }
}
views.notificationFilters.kind = "all";
const adminNotificationsHtml = await views.viewNotifications(notificationNow);
assert.match(adminNotificationsHtml, /<h1[^>]*>Notifications<\/h1>/);
for (const label of ["All", "Applications", "Decisions", "Role changes", "Club updates", "My account"]) {
  assert.match(adminNotificationsHtml, new RegExp(`data-notification-filter="[^"]+"[^>]*>${label}<\\/button>`));
}
assert.match(adminNotificationsHtml, /data-notification-filter="all"[^>]*aria-pressed="true"/);
assert.doesNotMatch(adminNotificationsHtml, /<h2[^>]*>Club operations<\/h2>|<h2[^>]*>My notifications<\/h2>/);
assert.equal((adminNotificationsHtml.match(/class="notification-list"/g) || []).length, 1,
  "Notifications must render one chronological list");
assert.ok(adminNotificationsHtml.indexOf("Application &lt;submitted&gt;") < adminNotificationsHtml.indexOf("Welcome to ITC"));
assert.ok(adminNotificationsHtml.indexOf("Welcome to ITC") < adminNotificationsHtml.indexOf("Role changed"));
assert.doesNotMatch(adminNotificationsHtml, /Application <submitted>|Riley & approve/,
  "Notification content must be HTML escaped");
const notificationButtons = adminNotificationsHtml.match(/<button class="notification-row[\s\S]*?<\/button>/g) || [];
assert.equal(notificationButtons.length, 4, "Every valid or malformed notification row must remain visible");
for (const button of notificationButtons) {
  assert.match(button, /<span class="notification-unread"/,
    "Read and unread rows must have the same grid indicator structure");
  assert.match(button, /class="notification-kind-badge"/,
    "Every notification row must show its category badge");
}
assert.match(adminNotificationsHtml, /class="notification-row unread"[^>]*type="button"/);
assert.match(adminNotificationsHtml, /class="notification-row"[^>]*[\s\S]*?class="notification-unread" aria-hidden="true"/,
  "Read rows must retain a hidden indicator placeholder");
assert.match(adminNotificationsHtml, /class="notification-unread" aria-label="Unread"/);
assert.match(adminNotificationsHtml, /5 minutes ago/);
assert.match(adminNotificationsHtml, /5 Aug 2026, 2:32 PM HKT/);
assert.match(adminNotificationsHtml, /Imported notification[\s\S]*?Time unavailable/,
  "Malformed metadata must fall back without dropping the row");
assert.doesNotMatch(adminNotificationsHtml, /Invalid Date|NaN/);
assert.match(adminNotificationsHtml, /data-destination="#\/admin\/approvals"/);
assert.match(adminNotificationsHtml, /data-destination="#\/account"/);
renderedUser.role = "member";
views.notificationFilters.kind = "all";
const memberNotificationsHtml = await views.viewNotifications(notificationNow);
for (const label of ["All", "Club updates", "My account"]) assert.match(memberNotificationsHtml, new RegExp(`>${label}<\\/button>`));
assert.doesNotMatch(memberNotificationsHtml, />Applications<\/button>|>Decisions<\/button>|>Role changes<\/button>/);
assert.doesNotMatch(memberNotificationsHtml, /Application &lt;submitted&gt;|Role changed/);
assert.match(memberNotificationsHtml, /Welcome to ITC/);
views.notificationFilters.kind = "club";
const memberClubNotificationsHtml = await views.viewNotifications(notificationNow, categoryRows);
assert.match(memberClubNotificationsHtml, /Giving campaign published/);
assert.doesNotMatch(memberClubNotificationsHtml, /Application &lt;submitted&gt;|Application approved|Role changed|Welcome to ITC/);
const emptyClubNotificationsHtml = await views.viewNotifications(notificationNow);
assert.match(emptyClubNotificationsHtml, /No Club updates notifications\./,
  "The active filter empty state must name its filter");
assert.doesNotMatch(emptyClubNotificationsHtml, /<section class="card notification-section"/,
  "Filter empty states must not wrap in a card/box container");
const emptyMemberNotificationsHtml = await views.viewNotifications(notificationNow, []);
assert.doesNotMatch(emptyMemberNotificationsHtml, /New notifications will appear here\./,
  "Empty inbox must not render the explanatory 'New notifications will appear here.' sentence");
assert.match(emptyMemberNotificationsHtml, /No Club updates notifications\./);
assert.doesNotMatch(emptyMemberNotificationsHtml, /<section class="card notification-section"/);
renderedUser.role = "super_admin";
views.notificationFilters.kind = "all";
const emptyAdminNotificationsHtml = await views.viewNotifications(notificationNow, []);
assert.doesNotMatch(emptyAdminNotificationsHtml, /New notifications will appear here\./);
assert.match(emptyAdminNotificationsHtml, /No any notifications\./,
  "The All filter empty state must use the simplified copy");
assert.doesNotMatch(emptyAdminNotificationsHtml, /<section class="card notification-section"/);
const liveApplication = await store.getMyApplication();
if (!liveApplication || liveApplication.waiver_accepted_at !== "2026-08-05T01:00:00.000Z") {
  throw new Error("waiver missing");
}
const confirmedDay = "5 Aug 2026";
const account = await views.viewAccount();
if (!account.includes("Super admin")) {
  throw new Error("Account did not display the live super-admin role");
}
if (!account.includes("Member since Aug 2026")) {
  throw new Error("Account did not map the live profile creation date");
}
if (!account.includes(`Indemnity confirmed on ${confirmedDay}`) || account.includes("To be accepted")) {
  throw new Error("Account should reflect the live application waiver acceptance date");
}
if (account.includes("undefined") || account.includes("Invalid Date")) {
  throw new Error("Account displayed an undefined role or invalid membership date");
}
const indemnity = await views.viewAccount("indemnity");
if (!indemnity.includes(`Indemnity confirmed on ${confirmedDay}`) || indemnity.includes("To be accepted")) {
  throw new Error("Indemnity page should reflect the live application waiver acceptance date");
}
for (const marker of [
  "Signed by",
  "Riley Runner",
  "Date of signing",
  "Emergency contact relationship",
  "Coach",
  "Document version",
  "v1",
]) {
  if (!indemnity.includes(marker)) {
    throw new Error(`Current live indemnity page missing ${marker}`);
  }
}
store.currentUser().role = "pending";
store.currentUser().status = "pending";
const pendingAccount = await views.viewAccount();
if (!pendingAccount.includes("+852 6123 4567")) {
  throw new Error("Pending Profile should render the fetched application phone");
}
if (!pendingAccount.includes("Taylor Coach · Coach · +852 6777 8888")) {
  throw new Error("Pending Profile should render the fetched application emergency contact and relationship");
}
if (!pendingAccount.includes("Accepted")) {
  throw new Error("Pending Profile should render the fetched application waiver state");
}
if (!pendingAccount.includes("Yes")) {
  throw new Error("Pending Profile should render the fetched application photo consent");
}
const gatedPaidSession = store.upcomingSessions(14).find((session) => session.kind === "paid" && !store.isMidtown(session));
if (!gatedPaidSession) throw new Error("Live access checks need an upcoming paid session");
store.currentUser().role = "super_admin";
store.currentUser().status = "approved";
const uuidBooking = await store.reserveSession(authUser.id, gatedPaidSession, Date.now());
if (uuidBooking.userId !== authUser.id) {
  throw new Error("Payment records must use the authenticated Supabase profile UUID");
}
for (const status of ["pending", "declined"]) {
  store.currentUser().role = status;
  store.currentUser().status = status;
  const gatedSurfaces = [
    views.viewActivity(gatedPaidSession.id),
    views.viewCheckout(gatedPaidSession.id),
    await views.viewGiving(),
  ];
  const renderedControls = gatedSurfaces
    .filter((surface) => typeof surface === "string")
    .join("\n");
  for (const forbidden of [
    'id="form-reserve"',
    'data-action="join-waitlist"',
    'data-action="join-interest"',
    'id="form-giving"',
    'data-action="giving-amount"',
    'data-action="giving-confirm"',
  ]) {
    if (renderedControls.includes(forbidden)) {
      throw new Error(`${status} live profiles must not render gated control: ${forbidden}`);
    }
  }
  const directPayHtml = views.viewPay(uuidBooking.id);
  if (typeof directPayHtml !== "string" || !directPayHtml.includes("Booking not found.")) {
    throw new Error(`${status} live profiles must not render the direct-pay route`);
  }
}
console.log("ok  pending and declined live profiles cannot render Payment or Giving controls");
store.currentUser().role = "super_admin";
store.currentUser().status = "approved";

// Live booking snapshots come from the DB with start_time/session_date/
// venue/price_hkd keys; Profile > History must render them (a missing
// time mapping previously crashed fmtTime with undefined).
const liveHistoryHtml = await views.viewAccount("history");
if (typeof liveHistoryHtml !== "string") {
  throw new Error("live booking history must render for the signed-in member");
}
if (!liveHistoryHtml.includes("11:15 AM") || liveHistoryHtml.includes("undefined")) {
  throw new Error("live booking history must render the snapshot start_time, not undefined");
}
console.log("ok  live booking history renders snapshot start_time without crashing");

// --- One-off events (live) ---
const freeEventRow = await store.createOneOffEvent({
  name: "Charity Gala Workout", dateISO: "2026-09-12", time: "09:00",
  durationMin: 45, location: "Sun Yat Sen Memorial Park", mapsQuery: "",
  category: "Other", price: 0, capacity: 30,
});
const freeEventSession = store.getSession(freeEventRow.id);
if (!freeEventSession || !freeEventSession.oneOff
    || freeEventSession.name !== "Charity Gala Workout"
    || freeEventSession.kind !== "free" || freeEventSession.weekday !== 6) {
  throw new Error("live one-off free event must hydrate with template name and free kind");
}
if (!store.upcomingSessions(30).some((s) => s.id === freeEventRow.id)) {
  throw new Error("live one-off event must appear in upcoming sessions");
}
const paidEventRow = await store.createOneOffEvent({
  name: "Pop-up HYROX", dateISO: "2026-09-19", time: "08:30",
  durationMin: 60, location: "BFT Central", mapsQuery: "BFT Central",
  category: "HYROX", price: 200, capacity: 10,
});
const paidEventSession = store.getSession(paidEventRow.id);
if (!paidEventSession || paidEventSession.kind !== "paid" || paidEventSession.price !== 200
    || paidEventSession.category !== "HYROX" || paidEventSession.mapsQuery !== "BFT Central") {
  throw new Error("live paid one-off event must hydrate with price, category and maps query");
}
await store.deleteOneOffEvent(paidEventRow.id);
if (store.getSession(paidEventRow.id)) {
  throw new Error("deleted one-off event must leave the live cache");
}
const keptEventRow = await store.createOneOffEvent({
  name: "Sunset Social Run", dateISO: "2026-09-20", time: "18:00",
  durationMin: 60, location: "Harbourfront", category: "Run", price: 150, capacity: 12,
});
await store.reserveSession(authUser.id, keptEventRow.id, Date.now());
try {
  await store.deleteOneOffEvent(keptEventRow.id);
  throw new Error("delete must refuse one-off events with active bookings");
} catch (err) {
  if (!/cancel the session instead/i.test(err.message)) throw err;
}
console.log("ok  live one-off events create, hydrate, delete, and guard booked deletion");

// --- RSVP events (live): price-0 sessions confirm instantly, no payment ---
const lunchSession = store.upcomingSessions(21).find((s) => s.kind === "rsvp");
if (!lunchSession || lunchSession.category !== "Socials" || lunchSession.name !== "Post-Training Lunch") {
  throw new Error("live RSVP lunch session must hydrate with rsvp kind and Socials category");
}
if (lunchSession.capacity !== null || store.spotsLeft(lunchSession) !== null) {
  throw new Error("the lunch is uncapped — capacity and spots must be null");
}
const otherLunchSession = store.upcomingSessions(28).find(
  (session) => session.activityId === "lunch"
    && session.id !== lunchSession.id
    && session.dateISO !== lunchSession.dateISO
);
if (!otherLunchSession || otherLunchSession.location !== "TBC") {
  throw new Error("live smoke needs another dated lunch at TBC to verify venue isolation");
}
const lunchHtml = views.viewActivity(lunchSession.id);
if (!lunchHtml.includes('data-action="rsvp-join"') || lunchHtml.includes("Book & pay")) {
  throw new Error("live RSVP activity should offer Count me in, not checkout");
}
const countBeforeRsvp = store.attendeeCountFor(lunchSession);
const rsvpBooking = await store.rsvpSession(authUser.id, lunchSession.id);
if (rsvpBooking.status !== "confirmed") {
  throw new Error("live RSVP should confirm instantly without payment");
}
assert.equal(store.attendeeCountFor(lunchSession), countBeforeRsvp + 1,
  "Count me in must increase the RSVP count by exactly one");
assert.deepEqual(JSON.parse(mem.get("itc.prototype.v1")).users, [],
  "live RSVP join must not copy identity rows into prototype state");
const goingHtml = views.viewActivity(lunchSession.id);
assert.ok(goingHtml.includes(`${countBeforeRsvp + 1} going`),
  "RSVP Activity Details must render the confirmed booking count");
if (!goingHtml.includes("rsvp-withdraw")) {
  throw new Error("RSVP'd member should see a withdraw action");
}
await store.withdrawRsvp(rsvpBooking.id);
assert.equal(store.attendeeCountFor(lunchSession), countBeforeRsvp,
  "withdrawal must decrease the RSVP count by exactly one");
assert.deepEqual(JSON.parse(mem.get("itc.prototype.v1")).users, [],
  "live RSVP withdrawal must leave prototype identity rows empty");
if (store.getBooking(rsvpBooking.id).status !== "cancelled") {
  throw new Error("withdraw should cancel the RSVP");
}
console.log("ok  live RSVP events change count by exactly one without copying identities");

// Same-day live sessions order by start time, and weekly venue overrides
// apply to live RSVP sessions (not just locally-seeded free events).
const saturdaySessions = store.upcomingSessions(14).filter((s) => s.dateISO === lunchSession.dateISO);
const saturdayTimes = saturdaySessions.map((s) => s.time);
const sortedTimes = [...saturdayTimes].sort();
if (saturdayTimes.join(",") !== sortedTimes.join(",")) {
  throw new Error(`same-day sessions must order by start time; got ${saturdayTimes.join(",")}`);
}
if (saturdaySessions.findIndex((s) => s.kind === "rsvp")
    < saturdaySessions.findIndex((s) => s.activityId === "hyrox")) {
  throw new Error("the post-training lunch must follow the morning HYROX sessions");
}
await store.setWeekVenue(lunchSession.id, { location: "Cafe Deco, Central", mapsQuery: "Cafe Deco, Central" });
const overriddenLunch = store.getSession(lunchSession.id);
if (overriddenLunch.location !== "Cafe Deco, Central" || overriddenLunch.mapsQuery !== "Cafe Deco, Central") {
  throw new Error("weekly venue override must apply to live RSVP sessions");
}
if (store.getSession(otherLunchSession.id)?.location !== "TBC") {
  throw new Error("saving a live lunch venue must not change another dated lunch");
}
const priorScheduleWeekOffset = views.scheduleState.weekOffset;
const priorScheduleSelected = views.scheduleState.selected;
views.scheduleState.weekOffset = Math.round(
  (data.mondayOf(data.parseISO(lunchSession.dateISO)) - data.mondayOf(data.todayLocal())) / (7 * 86400000)
);
views.scheduleState.selected = lunchSession.dateISO;
const lunchScheduleHtml = views.viewSchedule();
const lunchDetailHtml = views.viewActivity(lunchSession.id);
if (!lunchScheduleHtml.includes("Cafe Deco, Central")
    || !lunchDetailHtml.includes("Cafe Deco, Central")) {
  throw new Error("live lunch venue override must appear on Schedule and Activity Details");
}
views.scheduleState.weekOffset = priorScheduleWeekOffset;
views.scheduleState.selected = priorScheduleSelected;
await store.setWeekVenue(lunchSession.id, {
  location: null,
  mapsQuery: null,
  meetingLat: null,
  meetingLng: null,
});
const resetLunch = store.getSession(lunchSession.id);
if (resetLunch.location !== "TBC") {
  throw new Error("resetting a live lunch venue should restore its TBC recurring default");
}
if (store.getSession(otherLunchSession.id)?.location !== "TBC") {
  throw new Error("resetting a live lunch venue must not change another dated lunch");
}
console.log("ok  live sessions order by start time and lunch accepts isolated weekly venue overrides");

// A live Admin must compose the Supabase UUID directory with device-local
// Payment operations without copying editable identity records into storage.
await views.viewAdmin("payments");
operationalAuthSubOverride = "approved-member";
const memberUuidBooking = await store.reserveSession("approved-member", gatedPaidSession, Date.now());
operationalAuthSubOverride = null;
if (!await store.markBookingPaid(memberUuidBooking.id, "FPS", "LIVE-MEMBER-REF", Date.now())) {
  throw new Error("Live member UUID booking must enter pending Payment Ops");
}
store.setDuty(authUser.id, gatedPaidSession.dateISO);
await store.updateCollectorPayouts(authUser.id, {
  paymeLink: "https://payme.example/live-admin",
  fpsPhone: "+852 6999 0000",
});
let liveOpsHtml = await views.viewAdmin("payments");
for (const marker of ["Micah Member", "LIVE-MEMBER-REF", "Riley Runner", "https://payme.example/live-admin", "+852 6999 0000"]) {
  if (!liveOpsHtml.includes(marker)) {
    throw new Error(`Live Payment Ops composition missing ${marker}`);
  }
}
const persistedLiveOps = JSON.parse(mem.get("itc.prototype.v1"));
if (persistedLiveOps.users.length !== 0
    || persistedLiveOps.paymentPayouts?.[authUser.id]?.fpsPhone !== "+852 6999 0000") {
  throw new Error("Live Payment Ops must persist UUID-keyed details without a local identity directory");
}
store.load();
liveOpsHtml = await views.viewAdmin("payments");
if (!liveOpsHtml.includes("https://payme.example/live-admin")
    || !liveOpsHtml.includes("LIVE-MEMBER-REF")) {
  throw new Error("Live Payment Ops details must survive a local state reload");
}

// Exercise the member-facing route after the real auth transition clears the
// in-memory Admin directory. UUID-keyed duty and payout operations must remain
// usable without persisting or reloading an editable identity directory.
const memberPaySession = store.upcomingSessions(28).find((session) =>
  session.kind === "paid" && !store.isMidtown(session)
  && session.id !== gatedPaidSession.id
);
if (!memberPaySession) throw new Error("Live payout transition needs another paid session");
// Reassign the fake auth context so the live RPC captures the member UUID
// (the test asserts the member-facing payout route after sign-out).
Object.assign(authUser, {
  id: "approved-member",
  email: "micah.member@example.com",
  user_metadata: { full_name: "Micah Member", avatar_url: "" },
});
Object.assign(profile, {
  id: "approved-member", email: "micah.member@example.com",
  full_name: "Micah Member", avatar_url: "", role: "member",
});
operationalAuthSubOverride = "approved-member";
const memberPayBooking = await store.reserveSession("approved-member", memberPaySession, Date.now());
operationalAuthSubOverride = null;
await store.setDuty("live-user-1", memberPaySession.dateISO);
const signOutForMember = store.signOutLive();
releaseSignOut({ error: null });
await signOutForMember;
await store.getCurrentUser();
store.load();
const memberPayHtml = views.viewPay(memberPayBooking.id);
for (const marker of ["On-duty collector", "https://payme.example/live-admin", "+852 6999 0000", 'data-action="copy-fps"']) {
  if (typeof memberPayHtml !== "string" || !memberPayHtml.includes(marker)) {
    throw new Error(`Member payout route after auth transition missing ${marker}`);
  }
}
if (JSON.parse(mem.get("itc.prototype.v1")).users.length !== 0) {
  throw new Error("Member payout resolution must not persist a duplicate identity directory");
}
Object.assign(authUser, {
  id: "live-user-1", email: "runner@example.com",
  user_metadata: { full_name: "Riley Runner", avatar_url: "https://example.com/avatar.jpg" },
});
Object.assign(profile, {
  id: "live-user-1", email: "runner@example.com", full_name: "Riley Runner",
  avatar_url: "https://example.com/avatar.jpg", role: "super_admin",
});
await store.getCurrentUser();
await store.listPaymentUsers();
console.log("ok  live member payout survives Admin sign-out, member sign-in, and local reload");
console.log("ok  live Admin composes Supabase members with UUID-keyed local Payment Ops");

const detailsSummary = await views.viewAccount("details");
for (const label of [
  "Full name",
  "Preferred name",
  "Email",
  "Member since",
  "Mobile / WhatsApp number",
  "Age status",
  "Emergency contact name",
  "Emergency contact relationship",
  "Emergency contact phone",
  "How you heard about ITC",
]) {
  if (!detailsSummary.includes(label)) throw new Error(`Live details summary missing ${label}`);
}
if (!detailsSummary.includes("18 or over")) {
  throw new Error("Live details summary should show adult age status");
}
if (!detailsSummary.includes('href="#/account/details/edit"')) {
  throw new Error("Live details summary should link to the edit route");
}
if (detailsSummary.includes('data-form="membership-details"') || detailsSummary.includes("Date of birth")) {
  throw new Error("Live details summary should be a card, not the edit form or DOB UI");
}
const detailsEdit = await views.viewAccount("details", "edit");
if (!detailsEdit.includes('data-form="membership-details"')) {
  throw new Error("Live details edit route should render the membership-details form");
}
if (!detailsEdit.includes("Save changes")) {
  throw new Error("Live details edit route should render the save action");
}
if (!detailsEdit.includes("Riley Runner") || !detailsEdit.includes("runner@example.com")) {
  throw new Error("Live details edit route should show read-only identity rows");
}
if (!detailsEdit.includes('value="+852 6123 4567"')) {
  throw new Error("Live details edit route should prefill the mobile number");
}
if (!/name="age_over_18" value="yes"[^>]*checked/.test(detailsEdit)) {
  throw new Error("Live details edit route should prefill the adult age radio");
}
if (!detailsEdit.includes("data-minor-only") || !detailsEdit.includes("hidden")) {
  throw new Error("Live details edit route should keep the guardian block conditional");
}
if (!detailsEdit.includes('value="Taylor Coach"') || !detailsEdit.includes('value="Coach"') || !detailsEdit.includes('value="+852 6777 8888"')) {
  throw new Error("Live details edit route should prefill emergency contact fields");
}
if (!detailsEdit.includes('name="emergency_relationship"')) {
  throw new Error("Live details edit route should include emergency_relationship");
}
if (detailsEdit.includes('name="photo_consent"')) {
  throw new Error("Live details edit route should exclude photo consent controls");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  preferred_name: null,
});
const nullPreferredSummary = await views.viewAccount("details");
if (!nullPreferredSummary.includes("Preferred name</span><strong>Not provided</strong>")) {
  throw new Error("Null preferred_name should render as Not provided");
}
const nullPreferredEdit = await views.viewAccount("details", "edit");
if (!nullPreferredEdit.includes('name="preferred_name" value=""')) {
  throw new Error("Null preferred_name should stay blank in the edit form");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  preferred_name: "Riley",
});
const privacySummary = await views.viewAccount("privacy");
for (const label of [
  "Photo/video consent",
  "Privacy policy accepted",
  "WhatsApp session reminders",
  "Email receipts",
  "Community news",
]) {
  if (!privacySummary.includes(label)) throw new Error(`Live privacy summary missing ${label}`);
}
if (!privacySummary.includes("Allowed")) {
  throw new Error("Live privacy summary should show Allowed when photo consent is true");
}
if (!privacySummary.includes(confirmedDay)) {
  throw new Error("Live privacy summary should show the accepted privacy date");
}
if (!privacySummary.includes('>Off<') || (privacySummary.match(/>On</g) || []).length < 2) {
  throw new Error("Live privacy summary should show the expected On/Off values");
}
if (!privacySummary.includes('href="#/account/privacy/edit"')) {
  throw new Error("Live privacy summary should link to the edit route");
}
if (privacySummary.includes('data-form="privacy-preferences"')) {
  throw new Error("Live privacy summary should be a card, not the edit form");
}
const privacyEdit = await views.viewAccount("privacy", "edit");
if (!privacyEdit.includes('data-form="privacy-preferences"')) {
  throw new Error("Live privacy edit route should render the privacy-preferences form");
}
if (!privacyEdit.includes('href="#/account/privacy"')) {
  throw new Error("Live privacy edit route should link back to #/account/privacy");
}
if (!privacyEdit.includes("Privacy policy accepted") || !privacyEdit.includes(confirmedDay)) {
  throw new Error("Live privacy edit route should show privacy acceptance read-only");
}
for (const name of ["photo_consent", "whatsapp_reminders", "email_receipts", "community_news"]) {
  if (!privacyEdit.includes(`name="${name}"`)) {
    throw new Error(`Live privacy edit route missing ${name}`);
  }
}
if (!/name="photo_consent"[^>]*checked/.test(privacyEdit)) {
  throw new Error("Live privacy edit route should prefill checked photo consent");
}
if (/name="whatsapp_reminders"[^>]*checked/.test(privacyEdit)) {
  throw new Error("Live privacy edit route should leave unchecked WhatsApp reminders off");
}
if (!/name="email_receipts"[^>]*checked/.test(privacyEdit)) {
  throw new Error("Live privacy edit route should prefill checked email receipts");
}
if (!/name="community_news"[^>]*checked/.test(privacyEdit)) {
  throw new Error("Live privacy edit route should prefill checked community news");
}
if (!privacyEdit.includes("Save changes")) {
  throw new Error("Live privacy edit route should render the save action");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  whatsapp_reminders: undefined,
  email_receipts: undefined,
  community_news: undefined,
});
const missingPreferenceSummary = await views.viewAccount("privacy");
if ((missingPreferenceSummary.match(/>Off</g) || []).length < 3) {
  throw new Error("Live privacy summary should default omitted preference properties to Off");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  whatsapp_reminders: false,
  email_receipts: true,
  community_news: true,
});
await store.updateMyMembershipDetails({
  mobile: "+852 9000 0000",
  age_over_18: "yes",
  emergency_name: "Alex Runner",
  emergency_relationship: "Coach",
  emergency_phone: "+852 9111 1111",
  heard_source: "friend",
  heard_detail: "Run club",
  preferred_name: "Riley",
});
const membershipPatch = applicationUpdates.at(-1);
if (!membershipPatch) throw new Error("membership update missing");
const membershipKeys = Object.keys(membershipPatch).sort().join(",");
if (
  membershipKeys !==
  [
    "date_of_birth",
    "emergency_name",
    "emergency_phone",
    "emergency_relationship",
    "guardian_name",
    "guardian_phone",
    "heard_detail",
    "heard_source",
    "is_minor",
    "mobile",
    "preferred_name",
  ].join(",")
) {
  throw new Error(`membership patch leaked fields: ${membershipKeys}`);
}
for (const banned of [
  "photo_consent",
  "whatsapp_reminders",
  "email_receipts",
  "community_news",
  "waiver_accepted_at",
  "privacy_accepted_at",
  "guidelines_accepted_at",
  "submitted_at",
]) {
  if (banned in membershipPatch) throw new Error(`membership patch should exclude ${banned}`);
}
await store.updateMyPrivacyPreferences({
  photo_consent: false,
  whatsapp_reminders: true,
  email_receipts: false,
  community_news: false,
});
const privacyPatch = applicationUpdates.at(-1);
if (!privacyPatch) throw new Error("privacy update missing");
const privacyKeys = Object.keys(privacyPatch).sort().join(",");
if (
  privacyKeys !==
  ["community_news", "email_receipts", "photo_consent", "whatsapp_reminders"].join(",")
) {
  throw new Error(`privacy patch leaked fields: ${privacyKeys}`);
}
for (const banned of [
  "mobile",
  "is_minor",
  "guardian_name",
  "guardian_phone",
  "emergency_name",
  "emergency_phone",
  "emergency_relationship",
  "heard_source",
  "heard_detail",
  "preferred_name",
  "waiver_accepted_at",
  "privacy_accepted_at",
  "guidelines_accepted_at",
  "submitted_at",
]) {
  if (banned in privacyPatch) throw new Error(`privacy patch should exclude ${banned}`);
}
applicationUpdates.length = 0;
const preservedWaiver = await store.acceptMyIndemnity({
  signature: "Riley Runner",
  signedAt: "2026-08-05",
  emergencyRelationship: "Coach",
});
assert.equal(preservedWaiver, "2026-08-05T01:00:00.000Z");
assert.equal(applicationUpdates.length, 0, "current v1 acceptance should remain idempotent");
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  emergency_phone: "",
});
await assert.rejects(
  () => store.acceptMyIndemnity({
    signature: "Riley Runner",
    signedAt: "2026-08-05",
    emergencyRelationship: "Coach",
  }),
  /Enter emergency contact name, relationship and phone/
);
assert.equal(applicationUpdates.length, 0, "missing canonical emergency contact must not write a live waiver update");
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  emergency_phone: "+852 6777 8888",
});
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  waiver_signature_text: null,
  waiver_signed_at: null,
  waiver_form_version: null,
  emergency_relationship: null,
});
const legacyAccount = await views.viewAccount();
if (!legacyAccount.includes(`Legacy acceptance recorded on ${confirmedDay}`) || legacyAccount.includes("Indemnity confirmed on")) {
  throw new Error("Legacy live rows must stay stale/re-signable on the Profile summary");
}
const legacyWaiver = await views.viewAccount("indemnity");
for (const marker of [
  "A new version of the Indemnity is available",
  'data-doc-accept="indemnity"',
  'name="signature"',
  'name="signedAt"',
  'name="emergencyRelationship"',
  "Accept &amp; Confirm",
  "Edit in Membership Details",
]) {
  if (!legacyWaiver.includes(marker)) {
    throw new Error(`Legacy live re-sign flow missing ${marker}`);
  }
}
const createdWaiver = await store.acceptMyIndemnity({
  signature: "Riley Runner",
  signedAt: "2026-08-05",
  emergencyRelationship: "Coach",
});
assert.equal(createdWaiver, fixedIso);
assert.deepEqual(applicationUpdates.at(-1), {
  waiver_accepted_at: fixedIso,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
  waiver_form_version: "v1",
  emergency_relationship: "Coach",
});

const home = views.viewHome();
if (!home.includes("Good to see you, Riley.")) {
  throw new Error("Home did not greet the signed-in Google user");
}
if (home.includes("Continue with Google")) {
  throw new Error("Home still asked the signed-in Google user to sign in");
}

const refreshedAccount = await views.viewAccount();
if (!refreshedAccount.includes(`Indemnity confirmed on ${confirmedDay}`) || refreshedAccount.includes("To be accepted")) {
  throw new Error("Account should rerender from the accepted live waiver timestamp");
}
const refreshedIndemnity = await views.viewAccount("indemnity");
if (!refreshedIndemnity.includes(`Indemnity confirmed on ${confirmedDay}`) || refreshedIndemnity.includes("To be accepted")) {
  throw new Error("Indemnity page should rerender from the accepted live waiver timestamp");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  waiver_accepted_at: null,
  waiver_signature_text: null,
  waiver_signed_at: null,
  waiver_form_version: null,
  emergency_relationship: null,
});
const waiverMissing = await views.viewAccount("indemnity");
if (!waiverMissing.includes("To be accepted")) {
  throw new Error("Indemnity page should prompt when the live waiver is missing");
}
applicationRows.delete(authUser.id);
const missingAccount = await views.viewAccount();
if (missingAccount?.redirect) {
  throw new Error("Approved/admin users missing an application must not redirect from Profile");
}
if (!missingAccount.includes("Application details unavailable")) {
  throw new Error("Profile should clearly say application details are unavailable");
}
if (missingAccount.includes("To be accepted")) {
  throw new Error("Profile must not claim indemnity is merely to-be-accepted without an application");
}
const missingDetails = await views.viewAccount("details");
if (missingDetails?.redirect || !missingDetails.includes("Application details unavailable")) {
  throw new Error("Live account details should show an unavailable card when no application exists");
}
if (missingDetails.includes('data-form="apply"') || missingDetails.includes("Save changes")) {
  throw new Error("Missing application details must not render an edit/application form");
}
const missingIndemnity = await views.viewAccount("indemnity");
if (missingIndemnity?.redirect || !missingIndemnity.includes("Application details unavailable")) {
  throw new Error("Live indemnity should show an unavailable card when no application exists");
}
if (missingIndemnity.includes("To be accepted") || missingIndemnity.includes("Accept &amp; Confirm")) {
  throw new Error("Missing application indemnity must not render an accept form or to-be-accepted claim");
}
const missingPrivacy = await views.viewAccount("privacy");
if (missingPrivacy?.redirect || !missingPrivacy.includes("Application details unavailable")) {
  throw new Error("Live privacy should show an unavailable card when no application exists");
}

const domListeners = new Map();
const windowListeners = new Map();
let activeElement = null;
const makeElement = () => {
  const classes = new Set();
  return {
  children: [],
  className: "",
  innerHTML: "",
  textContent: "",
  dataset: {},
  hidden: false,
  attributes: new Map(),
  classList: {
    toggle(name, force) {
      const enabled = force === undefined ? !classes.has(name) : force;
      if (enabled) classes.add(name);
      else classes.delete(name);
      return enabled;
    },
    contains: (name) => classes.has(name),
  },
  appendChild(child) { this.children.push(child); },
  setAttribute(name, value) { this.attributes.set(name, String(value)); },
  getAttribute(name) { return this.attributes.get(name) ?? null; },
  hasAttribute(name) { return this.attributes.has(name); },
  removeAttribute(name) { this.attributes.delete(name); },
  focus(options) {
    activeElement = this;
    this.focusOptions = options;
  },
  remove() {},
  querySelector() { return null; },
  };
};
const routeLoader = makeElement();
routeLoader.hidden = true;
const elements = new Map([
  ["view", makeElement()],
  ["bottom-nav", makeElement()],
  ["top-notifications", makeElement()],
  ["top-avatar", makeElement()],
  ["toast-stack", makeElement()],
  ["route-loader", routeLoader],
]);
globalThis.document = {
  get activeElement() { return activeElement; },
  getElementById: (id) => elements.get(id),
  createElement: () => makeElement(),
  addEventListener: (event, callback) => domListeners.set(event, callback),
};
globalThis.HTMLInputElement = class {};
globalThis.HTMLFormElement = class {};
globalThis.FormData = class {
  constructor(form) { this.form = form; }
  get(name) { return this.form.fields?.[name] ?? null; }
};
globalThis.location = {
  hash: "#/account",
  origin: "https://payment-preview.example",
  pathname: "/feature/payment-system/app/",
};
window.location = globalThis.location;
window.addEventListener = (event, callback) => windowListeners.set(event, callback);
window.scrollTo = () => {};
let nextTimerId = 1;
const delayedTimers = new Map();
globalThis.setTimeout = (callback, delay) => {
  if (delay === 0) deferredAuthTasks.push(callback);
  else delayedTimers.set(nextTimerId, { callback, delay });
  return nextTimerId++;
};
globalThis.clearTimeout = (id) => delayedTimers.delete(id);
const advanceTimersBy = (delay) => {
  for (const [id, timer] of [...delayedTimers]) {
    if (timer.delay !== delay) continue;
    delayedTimers.delete(id);
    timer.callback();
  }
};

async function dispatchAuthStateChange(event) {
  authCallbackLocked = true;
  try {
    const callbackResult = authStateChangeHandler(event);
    if (callbackResult !== undefined) {
      throw new Error("onAuthStateChange callback must return undefined synchronously");
    }
  } finally {
    authCallbackLocked = false;
  }
  while (deferredAuthTasks.length) {
    await deferredAuthTasks.shift()();
  }
}

const escapedRejections = [];
const captureRejection = (reason) => escapedRejections.push(reason);
process.on("unhandledRejection", captureRejection);
const originalConsoleError = console.error;
let expectedApplicationErrorLogs = [];
const captureExpectedApplicationErrors = (...args) => expectedApplicationErrorLogs.push(args);
applicationReadError = new Error("Application read failed");
console.error = captureExpectedApplicationErrors;
const app = await import("./js/app.js?application-read-errors");
await app.bootPromise;
await new Promise(setImmediate);
const toastStack = elements.get("toast-stack");
if (escapedRejections.length || toastStack.children.length !== 1 || toastStack.children[0].textContent !== "Application read failed") {
  throw new Error("Boot should catch one failed application read and show one error toast");
}

escapedRejections.length = 0;
toastStack.children.length = 0;
let hashRejected = false;
try {
  await windowListeners.get("hashchange")();
} catch {
  hashRejected = true;
}
await new Promise(setImmediate);
if (hashRejected || escapedRejections.length || toastStack.children.length !== 1 || toastStack.children[0].textContent !== "Application read failed") {
  throw new Error("Hash changes should catch failed application reads and show one error toast");
}
console.error = originalConsoleError;
assert.deepEqual(
  expectedApplicationErrorLogs.map(([message, error]) => [message, error?.message]),
  [
    ["Failed to load live application for account", "Application read failed"],
    ["Failed to hydrate live user", "Application read failed"],
    ["Failed to load live application for account", "Application read failed"],
    ["Failed to hydrate live user", "Application read failed"],
  ],
  "expected boot/hash application failures must be explicitly observed without noisy stderr"
);

// Route feedback announces work immediately, only exposes visible copy after
// the delay, and always clears once the awaited view is complete.
applicationReadError = null;
let releaseApplicationRead;
applicationReadGate = new Promise((resolve) => { releaseApplicationRead = resolve; });
const slowRender = windowListeners.get("hashchange")();
const viewEl = elements.get("view");
assert.equal(viewEl.getAttribute("aria-busy"), "true", "async route must announce busy immediately");
assert.equal(routeLoader.hidden, true, "fast routes must not flash loading feedback");
advanceTimersBy(300);
assert.equal(routeLoader.hidden, false, "slow route must expose delayed loading feedback");
releaseApplicationRead();
await slowRender;
applicationReadGate = null;
assert.equal(viewEl.hasAttribute("aria-busy"), false, "route busy state must clear");
assert.equal(routeLoader.hidden, true, "route loading feedback must clear");

// Three overlapping routes prove that stale completion cannot clear current
// feedback and out-of-order completion cannot replace the newest route.
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const oldestGate = deferred();
const middleGate = deferred();
const currentGate = deferred();
applicationReadGates.push(oldestGate.promise, middleGate.promise, currentGate.promise);
location.hash = "#/account/privacy";
const oldestRender = windowListeners.get("hashchange")();
location.hash = "#/account/indemnity";
const middleRender = windowListeners.get("hashchange")();
location.hash = "#/account/details";
const currentRender = windowListeners.get("hashchange")();
advanceTimersBy(300);
assert.equal(viewEl.getAttribute("aria-busy"), "true");
assert.equal(routeLoader.hidden, false);
middleGate.resolve();
await middleRender;
assert.equal(viewEl.getAttribute("aria-busy"), "true", "stale completion must not clear current busy state");
assert.equal(routeLoader.hidden, false, "stale completion must not hide the current loader");
currentGate.resolve();
await currentRender;
const currentRouteHtml = viewEl.innerHTML;
assert.match(currentRouteHtml, /Membership Details/);
assert.equal(viewEl.hasAttribute("aria-busy"), false);
assert.equal(routeLoader.hidden, true);
oldestGate.resolve();
await oldestRender;
assert.equal(viewEl.innerHTML, currentRouteHtml, "an older route must not commit after the current route");
assert.equal(viewEl.hasAttribute("aria-busy"), false);
assert.equal(routeLoader.hidden, true);

// Signed-in notification chrome appears before its best-effort count query,
// fails silently, and ignores stale generations.
const notificationBell = elements.get("top-notifications");
const countGate = deferred();
notificationReadGate = countGate.promise;
location.hash = "#/home";
const immediateBellRender = windowListeners.get("hashchange")();
await immediateBellRender;
assert.equal(notificationBell.hidden, false, "signed-in bell must be visible without waiting for its count");
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications");
assert.doesNotMatch(notificationBell.innerHTML, /notification-badge/);
countGate.resolve();
await new Promise(setImmediate);
assert.match(notificationBell.innerHTML, /notification-badge[^>]*[\s\S]*>2<\/span>/);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 2 unread");

const cappedRows = Array.from({ length: 118 }, (_, index) => ({
  id: `notification-cap-${index}`,
  kind: "welcome",
  title: "Unread update",
  body: "Unread count cap fixture.",
  created_at: "2026-08-05T06:39:00.000Z",
  read_at: null,
}));
notificationRows.push(...cappedRows);
await windowListeners.get("hashchange")();
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 120 unread",
  "the accessible label must retain the full unread count");
assert.match(notificationBell.innerHTML, />99\+<\/span>/, "only the visual badge should cap at 99+");
notificationRows.splice(-cappedRows.length);

const toastsBeforeCountFailure = toastStack.children.length;
notificationReadError = new Error("Notification count unavailable");
await windowListeners.get("hashchange")();
await new Promise(setImmediate);
assert.equal(notificationBell.hidden, false);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications");
assert.doesNotMatch(notificationBell.innerHTML, /notification-badge/);
assert.equal(toastStack.children.length, toastsBeforeCountFailure, "count failures must not toast");

const staleCountGate = deferred();
notificationReadGate = staleCountGate.promise;
const staleCountRender = windowListeners.get("hashchange")();
await staleCountRender;
notificationRows.push({
  id: "notification-new-unread",
  kind: "welcome",
  title: "New update",
  body: "A newer generation sees this unread row.",
  created_at: "2026-08-05T06:39:00.000Z",
  read_at: null,
});
await windowListeners.get("hashchange")();
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 3 unread");
staleCountGate.resolve();
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 3 unread",
  "a stale unread query must not overwrite newer chrome");
notificationRows.pop();

const directRouteGate = deferred();
notificationReadGate = directRouteGate.promise;
const queriesBeforeDirectRoute = notificationQueryCount;
location.hash = "#/notifications";
const directRouteRender = windowListeners.get("hashchange")();
assert.equal(notificationBell.hidden, false,
  "a direct Notifications route must commit signed-in chrome before its query resolves");
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications");
assert.equal(notificationBell.getAttribute("aria-current"), "page");
assert.equal(notificationQueryCount, queriesBeforeDirectRoute + 1,
  "the Notifications page and unread badge must share one query");
directRouteGate.resolve();
await directRouteRender;
await new Promise(setImmediate);
assert.equal(notificationQueryCount, queriesBeforeDirectRoute + 1,
  "resolving the direct route must not start a second unread query");
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 2 unread");
assert.doesNotMatch(elements.get("bottom-nav").innerHTML, /aria-current="page"/,
  "Notifications must not activate a bottom navigation item");

// Out-of-order overlapping Notifications renders must leave the route cache
// paired with the newest committed HTML. Filtering that page remains local.
const olderNotificationsGate = deferred();
notificationReadGate = olderNotificationsGate.promise;
const queriesBeforeOverlap = notificationQueryCount;
const olderNotificationsRender = windowListeners.get("hashchange")();
notificationRows.unshift({
  id: "notification-latest-application",
  kind: "admin_application_submitted",
  title: "Latest application",
  body: "This row belongs only to the newest route request.",
  created_at: "2026-08-05T06:39:30.000Z",
  read_at: null,
});
const currentNotificationsGate = deferred();
notificationReadGate = currentNotificationsGate.promise;
const currentNotificationsRender = windowListeners.get("hashchange")();
assert.equal(notificationQueryCount, queriesBeforeOverlap + 2,
  "each overlapping Notifications route should issue exactly one shared query");
currentNotificationsGate.resolve();
await currentNotificationsRender;
olderNotificationsGate.resolve();
await olderNotificationsRender;
notificationRows.shift();
const overlapFilterControl = makeElement();
overlapFilterControl.tagName = "BUTTON";
overlapFilterControl.dataset = { action: "notification-filter", notificationFilter: "application" };
overlapFilterControl.closest = () => overlapFilterControl;
const queriesBeforeOverlapFilter = notificationQueryCount;
await domListeners.get("click")({ target: overlapFilterControl });
assert.equal(notificationQueryCount, queriesBeforeOverlapFilter,
  "filtering after overlapping routes must not fetch again");
assert.match(viewEl.innerHTML, /Latest application/,
  "a stale Notifications completion must not replace the newest route rows");
views.notificationFilters.kind = "all";

// Kind filters are view-local: activating one reuses route rows, rerenders the
// Notifications HTML, and restores keyboard focus to the equivalent new chip.
const filterControl = makeElement();
filterControl.tagName = "BUTTON";
filterControl.dataset = { action: "notification-filter", notificationFilter: "application" };
filterControl.closest = () => filterControl;
const replacementFilterControl = makeElement();
const filterSelector = '[data-action="notification-filter"][data-notification-filter="application"]';
viewEl.querySelector = (selector) => selector === filterSelector ? replacementFilterControl : null;
const queriesBeforeFilter = notificationQueryCount;
await domListeners.get("click")({ target: filterControl });
assert.equal(views.notificationFilters.kind, "application");
assert.equal(notificationQueryCount, queriesBeforeFilter,
  "a local kind filter must not refetch notifications");
assert.match(viewEl.innerHTML, /data-notification-filter="application"[^>]*aria-pressed="true"/);
assert.match(viewEl.innerHTML, /Application &lt;submitted&gt;/);
assert.doesNotMatch(viewEl.innerHTML, /Welcome to ITC|Role changed/);
assert.equal(activeElement, replacementFilterControl,
  "filter rerender must restore focus to the activated chip");
viewEl.querySelector = () => null;
views.notificationFilters.kind = "all";
await domListeners.get("click")({
  target: {
    dataset: { action: "notification-filter", notificationFilter: "all" },
    closest() { return this; },
  },
});

// Unread row activation is checked, duplicate-safe, and row-safe. It does not
// navigate until one unread row is confirmed updated, then advances the render
// generation so an older same-route count cannot overwrite the new badge.
const sameRouteStaleGate = deferred();
notificationReadGate = sameRouteStaleGate.promise;
const sameRouteStaleRender = windowListeners.get("hashchange")();
const updateGate = deferred();
notificationUpdateGate = updateGate.promise;
const notificationControl = makeElement();
notificationControl.tagName = "BUTTON";
notificationControl.textContent = "Application submitted Review Riley";
notificationControl.dataset = {
  action: "notification-open",
  notificationId: "notification-admin-application",
  notificationRead: "false",
  destination: "#/admin/approvals",
};
notificationControl.closest = () => notificationControl;
const updatesBeforeOpen = notificationUpdates.length;
const notificationHtmlBeforeOpen = viewEl.innerHTML;
const markReadRender = domListeners.get("click")({ target: notificationControl });
const duplicateOpen = domListeners.get("click")({ target: notificationControl });
assert.equal(notificationUpdates.length, updatesBeforeOpen + 1, "double activation must send one update");
assert.equal(location.hash, "#/notifications", "an unread row must wait for update success before navigating");
assert.equal(notificationControl.disabled, true);
assert.equal(notificationControl.getAttribute("aria-busy"), "true");
assert.equal(notificationControl.getAttribute("aria-label"), "Opening…");
assert.equal(notificationControl.classList.contains("is-busy"), true);
assert.equal(notificationControl.textContent, "Application submitted Review Riley",
  "structured notification content must not be replaced by a busy label");
await duplicateOpen;
updateGate.resolve();
await markReadRender;
notificationUpdateGate = null;
assert.equal(location.hash, "#/admin/approvals");
assert.equal(viewEl.innerHTML, notificationHtmlBeforeOpen,
  "notification activation must not explicitly render in addition to hashchange");
await windowListeners.get("hashchange")();
assert.match(viewEl.innerHTML, /Ready for review/);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 1 unread");
assert.equal(notificationControl.disabled, false);
assert.equal(notificationControl.hasAttribute("aria-busy"), false);
assert.equal(notificationControl.hasAttribute("aria-label"), false);
assert.equal(notificationControl.classList.contains("is-busy"), false);
sameRouteStaleGate.resolve();
await sameRouteStaleRender;
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 1 unread",
  "a stale same-route count must not overwrite the post-mark-read generation");

// Already-read rows skip the write and route immediately to their semantic destination.
location.hash = "#/notifications";
await windowListeners.get("hashchange")();
const alreadyReadControl = makeElement();
alreadyReadControl.tagName = "BUTTON";
alreadyReadControl.textContent = "Role changed";
alreadyReadControl.dataset = {
  action: "notification-open",
  notificationId: "notification-admin-role",
  notificationRead: "true",
  destination: "#/admin/members",
};
alreadyReadControl.closest = () => alreadyReadControl;
const updatesBeforeReadOpen = notificationUpdates.length;
const readOpen = domListeners.get("click")({ target: alreadyReadControl });
assert.equal(location.hash, "#/admin/members", "read rows should navigate without waiting for a write");
await readOpen;
assert.equal(notificationUpdates.length, updatesBeforeReadOpen, "read rows must not update again");
await windowListeners.get("hashchange")();
assert.match(viewEl.innerHTML, /href="#\/admin\/members" class="active"/);

// Destination failures use shared route feedback after mutation handling has
// finished. They must never be misreported as mark-read failures, whether the
// activated row started unread or read.
for (const initiallyRead of [false, true]) {
  location.hash = "#/notifications";
  await windowListeners.get("hashchange")();
  const retainedDestinationHtml = viewEl.innerHTML;
  toastStack.children.length = 0;
  const destinationFailure = new Error(initiallyRead
    ? "Read notification destination unavailable"
    : "Unread notification destination unavailable");
  profileListError = destinationFailure;
  const destinationControl = makeElement();
  destinationControl.tagName = "BUTTON";
  destinationControl.textContent = "Open operational notification";
  destinationControl.dataset = {
    action: "notification-open",
    notificationId: initiallyRead ? "notification-admin-role" : "notification-destination-unread",
    notificationRead: initiallyRead ? "true" : "false",
    destination: "#/admin/members",
  };
  destinationControl.closest = () => destinationControl;
  if (!initiallyRead) {
    notificationRows.push({
      id: "notification-destination-unread",
      kind: "admin_role_promoted",
      title: "Destination test",
      body: "Destination failure fixture.",
      created_at: "2026-08-05T06:39:30.000Z",
      read_at: null,
    });
  }
  const updatesBeforeDestinationFailure = notificationUpdates.length;
  await domListeners.get("click")({ target: destinationControl });
  assert.equal(location.hash, "#/admin/members");
  assert.equal(notificationUpdates.length, updatesBeforeDestinationFailure + (initiallyRead ? 0 : 1));
  await windowListeners.get("hashchange")();
  assert.equal(viewEl.innerHTML, retainedDestinationHtml,
    "A failed destination render must retain the last successful Notifications page");
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [destinationFailure.message]);
  assert.equal(toastStack.children.some((item) => item.textContent === "Failed to mark notification read"), false);
  if (!initiallyRead) {
    assert.ok(notificationRows.find((row) => row.id === "notification-destination-unread")?.read_at,
      "Unread destination failure must not roll back or misreport a successful mark-read");
    notificationRows.splice(notificationRows.findIndex((row) => row.id === "notification-destination-unread"), 1);
  }
  profileListError = null;
}

// Update errors and zero-row conflicts retain the Notifications page, hash,
// and unread count, recover the row, and expose one accessible generic error.
for (const failureMode of ["error", "zero"]) {
  location.hash = "#/notifications";
  await windowListeners.get("hashchange")();
  const retainedNotificationHtml = viewEl.innerHTML;
  const retainedNotificationLabel = notificationBell.getAttribute("aria-label");
  const queriesBeforeFailure = notificationQueryCount;
  toastStack.children.length = 0;
  notificationUpdateError = failureMode === "error" ? new Error("Notification update unavailable") : null;
  notificationUpdateResult = failureMode === "zero" ? "zero" : "row";
  const failedControl = makeElement();
  failedControl.tagName = "BUTTON";
  failedControl.textContent = "Welcome to ITC";
  failedControl.setAttribute("aria-label", "Open welcome notification");
  failedControl.dataset = {
    action: "notification-open",
    notificationId: "notification-welcome",
    notificationRead: "false",
    destination: "#/account",
  };
  failedControl.closest = () => failedControl;
  await domListeners.get("click")({ target: failedControl });
  assert.equal(location.hash, "#/notifications", `${failureMode} must retain the current hash`);
  assert.equal(viewEl.innerHTML, retainedNotificationHtml, `${failureMode} must retain the current page`);
  assert.equal(notificationBell.getAttribute("aria-label"), retainedNotificationLabel,
    `${failureMode} must retain the unread count`);
  assert.equal(notificationQueryCount, queriesBeforeFailure, `${failureMode} must not render a destination`);
  assert.equal(failedControl.disabled, false);
  assert.equal(failedControl.hasAttribute("aria-busy"), false);
  assert.equal(failedControl.getAttribute("aria-label"), "Open welcome notification");
  assert.equal(failedControl.classList.contains("is-busy"), false);
  assert.deepEqual(toastStack.children.map((item) => [item.textContent, item.getAttribute("role")]),
    [["Failed to mark notification read", "alert"]]);
  assert.match(toastStack.children[0].className, /err/);
}
notificationUpdateError = null;
notificationUpdateResult = "row";

// Approval queue failures must be truthful and preserve the last good queue.
applicationReadError = null;
profile.role = "super_admin";
pendingProfiles.find((item) => item.id === "pending-submitted").role = "pending";
location.hash = "#/admin";
toastStack.children.length = 0;
await windowListeners.get("hashchange")();
const retainedQueueHtml = elements.get("view").innerHTML;
assert.equal(document.activeElement, elements.get("view"), "Successful route renders must focus #view");
assert.deepEqual(elements.get("view").focusOptions, { preventScroll: true });
assert.match(retainedQueueHtml, /Submitted Runner/);
assert.match(retainedQueueHtml, /Incomplete Runner/);

for (const [errorType, setError] of [
  ["Profile queue read failed", (error) => { profileListError = error; }],
  ["Application queue read failed", (error) => { applicationListError = error; }],
]) {
  const error = new Error(errorType);
  setError(error);
  toastStack.children.length = 0;
  await assert.rejects(() => store.listApprovalCandidates(), new RegExp(errorType));
  await windowListeners.get("hashchange")();
  assert.equal(elements.get("view").innerHTML, retainedQueueHtml, `${errorType} must retain prior queue UI`);
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [errorType]);
  assert.equal(toastStack.children.some((item) => /Approved\.|Declined\./.test(item.textContent)), false);
  setError(null);
}

const click = domListeners.get("click");
const change = domListeners.get("change");

// Rendered Payment controls must reach their store seams through delegated
// handling, mutate state, and route to the moved booking.
const routingSessions = store.upcomingSessions(28).filter((session) =>
  session.kind === "paid" && !store.isMidtown(session) && !session.cancelled
  && !store.userReservationFor(authUser.id, session.id)
  && !store.userBookingFor(authUser.id, session.id)
);
if (routingSessions.length < 2) throw new Error("Payment routing regression needs two sessions");
const routedReleaseBooking = await store.reserveSession(authUser.id, routingSessions[0], Date.now());
const routedDeferBooking = await store.reserveSession(authUser.id, routingSessions[1], Date.now());
const routedDeferMarked = await store.markBookingPaid(routedDeferBooking.id, "FPS", "ROUTING", Date.now());
if (!routedDeferMarked) throw new Error("Live deferral routing must mark payment");
await store.confirmBookingPayment(routedDeferBooking.id, Date.now());
const routedDeferTarget = store.deferTargetsFor(routedDeferBooking)[0];
if (!routedDeferTarget) throw new Error("Payment routing regression needs a defer target");
window.confirm = () => true;
globalThis.confirm = window.confirm;
const releaseControl = makeElement();
releaseControl.dataset = { action: "release-reservation", booking: routedReleaseBooking.id };
releaseControl.closest = () => releaseControl;
await click({ target: releaseControl, preventDefault() {} });
assert.equal(store.getBooking(routedReleaseBooking.id).status, "cancelled");
const deferControl = makeElement();
deferControl.dataset = { action: "defer-to", booking: routedDeferBooking.id, session: routedDeferTarget.id };
deferControl.closest = () => deferControl;
await click({ target: deferControl, preventDefault() {} });
const routedMovedBooking = store.bookingsForUser(authUser.id).find((booking) =>
  booking.deferredFrom === routedDeferBooking.id
);
if (!routedMovedBooking) throw new Error("defer-to must create the moved booking");
assert.equal(location.hash, `#/booking/${routedMovedBooking.id}`);
let copiedFps = null;
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (value) => { copiedFps = value; } },
});
const fpsControl = makeElement();
fpsControl.dataset = { action: "copy-fps", phone: "+852 6999 0000" };
fpsControl.closest = () => fpsControl;
await click({ target: fpsControl, preventDefault() {} });
assert.equal(copiedFps, "+852 6999 0000");
console.log("ok  delegated release, deferral, and FPS copy controls execute prototype behavior");

// Gym finalization must travel through the delegated submit seam, persist the
// authorized Admin mutation, and rerender the confirmed state.
const gymSession = routingSessions[0];
location.hash = "#/admin/ops";
await windowListeners.get("hashchange")();
assert.match(viewEl.innerHTML, new RegExp(`form-gym-note[^>]*data-session="${gymSession.id}"|data-session="${gymSession.id}"[^>]*form-gym-note`));
const gymForm = new HTMLFormElement();
gymForm.id = "form-gym-note";
gymForm.dataset = { session: gymSession.id };
gymForm.fields = { note: "Confirmed 18 with BFT" };
gymForm.reportValidity = () => true;
await domListeners.get("submit")({ target: gymForm, preventDefault() {} });
await new Promise(setImmediate);
const confirmedGymSession = store.getSession(gymSession.id);
assert.ok(confirmedGymSession.gymConfirmedAt, "delegated gym submit must persist confirmation");
assert.equal(confirmedGymSession.gymNote, "Confirmed 18 with BFT");
assert.match(viewEl.innerHTML, /Confirmed with gym/);
assert.match(viewEl.innerHTML, /Confirmed 18 with BFT/);
console.log("ok  delegated gym confirmation persists and rerenders confirmed state");

const swimmingSession = store.upcomingSessions(21)
  .find((session) => session.activityId === "water" && !data.sessionStarted(session));
assert.ok(swimmingSession, "live smoke needs an upcoming Swimming session");

const weeklyVenueForm = new HTMLFormElement();
weeklyVenueForm.id = "";
weeklyVenueForm.dataset = {
  action: "form-week-venue",
  session: swimmingSession.id,
};
weeklyVenueForm.fields = {
  location: "  Victoria Park Swimming Pool  ",
  mapsQuery: "",
};
const weeklySubmit = makeElement();
weeklySubmit.type = "submit";
weeklySubmit.closest = () => weeklyVenueForm;
weeklyVenueForm.querySelector = (selector) => selector === '[type="submit"]' ? weeklySubmit : null;
weeklyVenueForm.querySelectorAll = () => [weeklySubmit];

// A click on the nested submit control must be left to the browser so it can
// emit the form's submit event. The form's own data-action must not make the
// generic click delegate cancel that default behavior first.
let weeklyClickPrevented = false;
await click({
  target: weeklySubmit,
  preventDefault() { weeklyClickPrevented = true; },
});
assert.equal(weeklyClickPrevented, false,
  "weekly venue submit click must not be cancelled by the click delegate");

await domListeners.get("submit")({ target: weeklyVenueForm, preventDefault() {} });
await new Promise(setImmediate);
const weeklyVenueCall = operationalRpcCalls
  .filter((call) => call.name === "set_session_venue")
  .at(-1);
assert.equal(weeklyVenueCall.args.p_session_id, swimmingSession.id);
assert.equal(weeklyVenueCall.args.p_location, "Victoria Park Swimming Pool");
assert.equal(weeklyVenueCall.args.p_maps_query, "Victoria Park Swimming Pool");
const savedSwimming = store.getSession(swimmingSession.id);
assert.equal(savedSwimming.location, "Victoria Park Swimming Pool");
assert.equal(savedSwimming.mapsQuery, "Victoria Park Swimming Pool");
console.log("ok  delegated weekly venue submit copies location into blank map queries");

const wntVenueForm = new HTMLFormElement();
wntVenueForm.id = "";
wntVenueForm.dataset = {
  action: "form-week-venue",
  session: "wnt-2026-08-26",
};
wntVenueForm.fields = {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: "22.2827",
  meetingLng: "114.1661",
};
const wntVenueSubmit = makeElement();
wntVenueSubmit.type = "submit";
wntVenueForm.querySelector = (selector) => selector === '[type="submit"]' ? wntVenueSubmit : null;
wntVenueForm.querySelectorAll = () => [wntVenueSubmit];
await domListeners.get("submit")({ target: wntVenueForm, preventDefault() {} });
await new Promise(setImmediate);
const wntVenueCall = operationalRpcCalls
  .filter((call) => call.name === "set_session_venue")
  .at(-1);
assert.deepEqual({
  p_session_id: wntVenueCall.args.p_session_id,
  p_location: wntVenueCall.args.p_location,
  p_maps_query: wntVenueCall.args.p_maps_query,
  p_meeting_lat: wntVenueCall.args.p_meeting_lat,
  p_meeting_lng: wntVenueCall.args.p_meeting_lng,
}, {
  p_session_id: "wnt-2026-08-26",
  p_location: "Tamar Park",
  p_maps_query: "Tamar Park",
  p_meeting_lat: 22.2827,
  p_meeting_lng: 114.1661,
});
const savedWntPoint = store.getSession("wnt-2026-08-26");
assert.equal(savedWntPoint.meetingLat, 22.2827);
assert.equal(savedWntPoint.meetingLng, 114.1661);
console.log("ok  delegated WNT venue submit persists exact meeting coordinates");

const weeklyVenueFailureForm = new HTMLFormElement();
weeklyVenueFailureForm.id = "";
weeklyVenueFailureForm.dataset = {
  action: "form-week-venue",
  session: "wnt-2026-08-26",
};
weeklyVenueFailureForm.fields = {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: "22.2829",
  meetingLng: "114.1663",
};
const weeklyVenueFailureSubmit = makeElement();
weeklyVenueFailureSubmit.type = "submit";
weeklyVenueFailureForm.querySelector = (selector) => selector === '[type="submit"]' ? weeklyVenueFailureSubmit : null;
weeklyVenueFailureForm.querySelectorAll = () => [weeklyVenueFailureSubmit];
const htmlBeforeVenueFailure = viewEl.innerHTML;
const baseOperationalRpcHandler = operationalRpcHandler;
let rejectNextVenueSave = true;
operationalRpcHandler = (name, args) => {
  if (rejectNextVenueSave && name === "set_session_venue") {
    rejectNextVenueSave = false;
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return Promise.resolve({ data: null, error: { message: "Venue override setup unavailable" } });
  }
  return baseOperationalRpcHandler(name, args);
};
await domListeners.get("submit")({ target: weeklyVenueFailureForm, preventDefault() {} });
await new Promise(setImmediate);
assert.equal(viewEl.innerHTML, htmlBeforeVenueFailure);
assert.equal(weeklyVenueFailureForm.fields.location, "Tamar Park");
assert.equal(weeklyVenueFailureForm.fields.meetingLat, "22.2829");
assert.equal(weeklyVenueFailureForm.fields.meetingLng, "114.1663");
assert.equal(weeklyVenueFailureSubmit.disabled, false);
assert.ok(toastStack.children.some((item) =>
  item.textContent === "Venue override setup unavailable"
));
console.log("ok  failed weekly venue submit preserves form state without rerendering");

// Legacy member-management URLs canonicalize instead of rendering the removed
// row/avatar implementation.
location.hash = "#/admin/users";
await windowListeners.get("hashchange")();
assert.equal(location.hash, "#/admin/members");
assert.doesNotMatch(elements.get("view").innerHTML, /class="(?:row|avatar)"/);

// Every role/access change names the member and target state before touching
// the store. Cancelling leaves the profile untouched.
const roleSelect = makeElement();
roleSelect.dataset = { change: "set-role", user: "approved-member", memberName: "Micah Member" };
roleSelect.value = "admin";
roleSelect.closest = () => roleSelect;
let confirmMessage = null;
window.confirm = (message) => { confirmMessage = message; return false; };
const updatesBeforeRoleCancel = profileUpdates.length;
await change({ target: roleSelect });
assert.equal(confirmMessage, "Change Micah Member’s role to Admin?");
assert.equal(profileUpdates.length, updatesBeforeRoleCancel, "Cancelled promotion must not call the store");

const demoteSelect = makeElement();
demoteSelect.dataset = { change: "set-role", user: "approved-admin", memberName: "Tina Admin", currentRole: "admin" };
demoteSelect.value = "member";
demoteSelect.closest = () => demoteSelect;
await change({ target: demoteSelect });
assert.equal(confirmMessage, "Change Tina Admin’s role to Member?");
assert.equal(profileUpdates.length, updatesBeforeRoleCancel, "Cancelled demotion must not call the store");

const revokeControl = makeElement();
revokeControl.textContent = "Revoke access";
revokeControl.dataset = { action: "revoke-member", user: "approved-admin", memberName: "Tina Admin" };
revokeControl.closest = () => revokeControl;
await click({ target: revokeControl });
assert.equal(confirmMessage, "Revoke Tina Admin’s access and move them to Pending?");
assert.equal(profileUpdates.length, updatesBeforeRoleCancel, "Cancelled revoke must not call the store");

window.confirm = () => true;
const successfulRoleSelect = makeElement();
successfulRoleSelect.tagName = "SELECT";
successfulRoleSelect.dataset = { change: "set-role", user: "approved-member", memberName: "Micah Member", currentRole: "member" };
successfulRoleSelect.value = "admin";
successfulRoleSelect.closest = () => successfulRoleSelect;
const roleGate = deferred();
profileUpdateGate = roleGate.promise;
const pendingRoleChange = change({ target: successfulRoleSelect });
assert.equal(successfulRoleSelect.disabled, true);
assert.equal(successfulRoleSelect.getAttribute("aria-busy"), "true");
roleGate.resolve();
await pendingRoleChange;
profileUpdateGate = null;
assert.equal(successfulRoleSelect.disabled, false);
assert.equal(successfulRoleSelect.hasAttribute("aria-busy"), false);
assert.ok(profileUpdates.some((update) => update.id === "approved-member" && update.role === "admin"));
assert.ok(toastStack.children.some((item) => item.textContent === "Micah Member is now Admin."));

// Successful delegated demotion and revocation both dispatch through the live
// role API and only announce success after the returned row confirms mutation.
toastStack.children.length = 0;
const successfulDemotion = makeElement();
successfulDemotion.tagName = "SELECT";
successfulDemotion.dataset = { change: "set-role", user: "approved-admin", memberName: "Tina Admin", currentRole: "admin" };
successfulDemotion.value = "member";
successfulDemotion.closest = () => successfulDemotion;
await change({ target: successfulDemotion });
assert.ok(profileUpdates.some((update) => update.id === "approved-admin" && update.role === "member"));
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Tina Admin is now Member."]);

toastStack.children.length = 0;
const successfulRevoke = makeElement();
successfulRevoke.textContent = "Revoke access";
successfulRevoke.dataset = { action: "revoke-member", user: "approved-member", memberName: "Micah Member" };
successfulRevoke.closest = () => successfulRevoke;
await click({ target: successfulRevoke });
assert.ok(profileUpdates.some((update) => update.id === "approved-member" && update.role === "pending"));
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Micah Member moved to Pending."]);

// A stale delegated target restores its select and never emits false success.
toastStack.children.length = 0;
profileUpdateResult = "zero";
const staleRoleSelect = makeElement();
staleRoleSelect.tagName = "SELECT";
staleRoleSelect.dataset = { change: "set-role", user: "removed-member", memberName: "Removed Member", currentRole: "member" };
staleRoleSelect.value = "admin";
staleRoleSelect.closest = () => staleRoleSelect;
await change({ target: staleRoleSelect });
profileUpdateResult = "row";
assert.equal(staleRoleSelect.value, "member");
assert.equal(staleRoleSelect.disabled, false);
assert.equal(staleRoleSelect.hasAttribute("aria-busy"), false);
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Application decision conflict."]);
assert.equal(toastStack.children.some((item) => /is now Admin/.test(item.textContent)), false);

// Once the authoritative role mutation succeeds, a failed Members refresh is
// a stale-view problem: success remains truthful and the old control is locked
// so the mutation cannot be retried against already-changed data.
toastStack.children.length = 0;
const refreshFailedRole = makeElement();
refreshFailedRole.tagName = "SELECT";
refreshFailedRole.dataset = { change: "set-role", user: "approved-admin", memberName: "Tina Admin", currentRole: "member" };
refreshFailedRole.value = "admin";
refreshFailedRole.closest = () => refreshFailedRole;
profileListError = new Error("Members refresh failed");
await change({ target: refreshFailedRole });
profileListError = null;
assert.equal(approvedProfiles.find((item) => item.id === "approved-admin").role, "admin");
assert.equal(refreshFailedRole.disabled, true, "refresh failure must lock the stale role control");
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Tina Admin is now Admin.",
  "Change saved, but this Admin view could not refresh. Members refresh failed",
]);
assert.equal(toastStack.children.some((item) => /Unable to change role/.test(item.textContent)), false);

// Restore fixture roles so later approval-queue regressions retain their
// original baseline independently of these member-action tests.
approvedProfiles.find((item) => item.id === "approved-admin").role = "admin";
approvedProfiles.find((item) => item.id === "approved-member").role = "member";
location.hash = "#/admin";
await windowListeners.get("hashchange")();

// Delegated async controls expose exact progress copy, suppress a duplicate
// action, and recover without a success toast when the store rejects.
const googleControl = makeElement();
googleControl.textContent = "Continue with Google";
googleControl.dataset = { action: "sign-in-google" };
googleControl.closest = () => googleControl;
toastStack.children.length = 0;
const firstGoogleClick = click({ target: googleControl });
assert.equal(googleControl.disabled, true);
assert.equal(googleControl.textContent, "Connecting…");
assert.equal(googleControl.getAttribute("aria-busy"), "true");
const duplicateGoogleClick = click({ target: googleControl });
assert.equal(oauthCalls, 1, "pending control must prevent a duplicate store action");
assert.equal(
  oauthOptions?.options?.redirectTo,
  `${location.origin}${location.pathname}`,
  "Google OAuth must return to the exact deployed Payment /app/ pathname"
);
releaseOAuth({ error: new Error("OAuth unavailable") });
await Promise.all([firstGoogleClick, duplicateGoogleClick]);
assert.equal(googleControl.disabled, false);
assert.equal(googleControl.textContent, "Continue with Google");
assert.equal(googleControl.hasAttribute("aria-busy"), false);
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["OAuth unavailable"]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");

// Exercise a second delegated path: sign-out must also suppress duplicate
// clicks, recover its control on rejection, and withhold the success toast.
const signOutControl = makeElement();
signOutControl.textContent = "Sign out";
signOutControl.dataset = { action: "signout" };
signOutControl.closest = () => signOutControl;
toastStack.children.length = 0;
const signOutCallsBeforeDelegatedTest = signOutCalls;
const firstSignOut = click({ target: signOutControl });
assert.equal(signOutControl.disabled, true);
assert.equal(signOutControl.textContent, "Signing out…");
assert.equal(signOutControl.getAttribute("aria-busy"), "true");
const duplicateSignOut = click({ target: signOutControl });
assert.equal(signOutCalls, signOutCallsBeforeDelegatedTest + 1, "pending sign-out must prevent a duplicate store action");
releaseSignOut({ error: new Error("Sign-out unavailable") });
await Promise.all([firstSignOut, duplicateSignOut]);
assert.equal(signOutControl.disabled, false);
assert.equal(signOutControl.textContent, "Sign out");
assert.equal(signOutControl.hasAttribute("aria-busy"), false);
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Sign-out unavailable"]);
assert.equal(toastStack.children.some((item) => item.textContent === "Signed out"), false);
await store.getCurrentUser();

const makeDecisionCard = (action) => {
  const approve = makeElement();
  approve.textContent = "Approve";
  approve.dataset = { action: "approve", user: "pending-submitted", applicantName: "Submitted Runner" };
  const decline = makeElement();
  decline.textContent = "Decline";
  decline.dataset = { action: "decline", user: "pending-submitted", applicantName: "Submitted Runner" };
  const error = makeElement();
  error.hidden = true;
  const card = makeElement();
  card.querySelectorAll = () => [approve, decline];
  card.querySelector = (selector) => selector === ".decision-error" ? error : null;
  for (const control of [approve, decline]) {
    control.closest = (selector) => selector === "[data-action]" ? control : card;
  }
  return { card, approve, decline, error, target: action === "approve" ? approve : decline };
};
confirmMessage = null;
window.confirm = (message) => { confirmMessage = message; return false; };
const cancelledDecline = makeDecisionCard("decline");
const updatesBeforeCancel = profileUpdates.length;
await click({ target: cancelledDecline.target });
assert.equal(confirmMessage, "Decline Submitted Runner’s membership application?");
assert.equal(profileUpdates.length, updatesBeforeCancel, "Cancelled decline must not update the profile");

window.confirm = (message) => { confirmMessage = message; return true; };
const declineAttempt = makeDecisionCard("decline");
const decisionGate = deferred();
profileUpdateGate = decisionGate.promise;
profileUpdateError = new Error("Profile update failed");
toastStack.children.length = 0;
const pendingDecline = click({ target: declineAttempt.target });
assert.equal(confirmMessage, "Decline Submitted Runner’s membership application?");
assert.equal(declineAttempt.approve.disabled, true);
assert.equal(declineAttempt.decline.disabled, true);
assert.equal(declineAttempt.decline.textContent, "Declining…");
decisionGate.resolve();
await pendingDecline;
profileUpdateGate = null;
assert.equal(elements.get("view").innerHTML, retainedQueueHtml, "Failed decline must retain prior queue UI");
assert.equal(declineAttempt.approve.disabled, false);
assert.equal(declineAttempt.decline.disabled, false);
assert.equal(declineAttempt.decline.textContent, "Decline");
assert.equal(declineAttempt.error.hidden, false);
assert.equal(declineAttempt.error.textContent, "Profile update failed");
assert.equal(declineAttempt.error.getAttribute("role"), "alert");
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Profile update failed"]);
assert.equal(toastStack.children.some((item) => /Approved\.|Declined\./.test(item.textContent)), false);
profileUpdateError = null;

for (const [expectedError, configure] of [
  ["Profile update failed", () => { profileUpdateError = new Error("Profile update failed"); }],
  ["Application decision conflict.", () => { profileUpdateResult = "zero"; }],
]) {
  const approvalAttempt = makeDecisionCard("approve");
  toastStack.children.length = 0;
  configure();
  await click({ target: approvalAttempt.target });
  assert.equal(elements.get("view").innerHTML, retainedQueueHtml, `${expectedError} must retain prior queue UI`);
  assert.equal(approvalAttempt.error.textContent, expectedError);
  assert.equal(approvalAttempt.error.hidden, false);
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [expectedError]);
  assert.equal(toastStack.children.some((item) => item.textContent === "Approved."), false,
    `${expectedError} must not produce a success toast`);
  profileUpdateError = null;
  profileUpdateResult = "row";
}

// A confirmed decision must not become a false action failure when the
// post-decision queue read rejects. Keep the retained card non-actionable and
// announce the successful mutation separately from the stale Admin view.
const refreshFailedDecision = makeDecisionCard("approve");
toastStack.children.length = 0;
profileListErrorAfterUpdate = new Error("Queue refresh failed");
await click({ target: refreshFailedDecision.target });
profileListErrorAfterUpdate = null;
profileListError = null;
assert.equal(pendingProfiles.find((item) => item.id === "pending-submitted").role, "member");
assert.equal(refreshFailedDecision.approve.disabled, true);
assert.equal(refreshFailedDecision.decline.disabled, true);
assert.equal(refreshFailedDecision.error.hidden, false);
assert.equal(
  refreshFailedDecision.error.textContent,
  "Change saved, but this Admin view could not refresh. Queue refresh failed"
);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Approved.",
  "Change saved, but this Admin view could not refresh. Queue refresh failed",
]);
assert.equal(toastStack.children.some((item) => item.textContent === "Decision failed"), false);
pendingProfiles.find((item) => item.id === "pending-submitted").role = "pending";

escapedRejections.length = 0;
toastStack.children.length = 0;
profile.role = "pending";
applicationReadError = null;
location.hash = "#/account";
await dispatchAuthStateChange("SIGNED_IN");
if (location.hash !== "#/apply" || !elements.get("view").innerHTML.includes("Good to see you, Riley.")) {
  throw new Error("Deferred SIGNED_IN handling should render Home before redirecting a pending applicant to Apply");
}

applicationReadError = new Error("Application read failed");
location.hash = "#/home";
await dispatchAuthStateChange("SIGNED_IN");
await new Promise(setImmediate);
if (escapedRejections.length || toastStack.children.length !== 1 || toastStack.children[0].textContent !== "Application read failed") {
  throw new Error("SIGNED_IN should catch failed application reads and show one error toast");
}
process.off("unhandledRejection", captureRejection);
applicationReadError = null;
profile.role = "super_admin";
await store.getCurrentUser();
activeGivingCampaignRow = null;
activeGivingCampaignError = {
  code: "PGRST205",
  message: "Could not find the table 'public.giving_campaigns' in the schema cache",
};
const missingSchemaGiving = await views.viewGiving();
assert.match(missingSchemaGiving, /No active Giving campaign at the moment/);
assert.match(missingSchemaGiving, /Check back soon for the next opportunity to support the ITC community\./);

activeGivingCampaignError = null;
const emptyGiving = await views.viewGiving();
assert.match(emptyGiving, /No active Giving campaign at the moment/);

activeGivingCampaignError = { code: "42501", message: "permission denied" };
await assert.rejects(() => views.viewGiving(), { message: "permission denied" });
activeGivingCampaignError = null;

activeGivingCampaignRow = {
  id: "campaign-current", title: "Current campaign", description: "Current route data",
  goal_hkd: 1000, fps_id: "1111111", fps_payee: "ITC", status: "published",
};
await store.getActiveGivingCampaign();
activeGivingCampaignRow = {
  id: "campaign-stale", title: "Stale campaign", description: "Obsolete route data",
  goal_hkd: 2000, fps_id: "2222222", fps_payee: "ITC", status: "published",
};
const staleGivingHtml = await views.viewGiving({ ownsGeneration: () => false });
assert.match(staleGivingHtml, /Stale campaign/, "stale route may finish with its own result");
const retainedCampaignGift = store.recordDonation({
  name: "Riley Runner", amount: 50, ref: "STALE-CACHE-REGRESSION",
});
assert.equal(retainedCampaignGift.userId, authUser.id, "live Giving must derive the authenticated UUID");
assert.equal(retainedCampaignGift.campaignId, "campaign-current",
  "stale Giving completion must not replace the shared live campaign cache");
const liveGivingUser = store.currentUser();
const liveGivingUserId = liveGivingUser.id;
liveGivingUser.id = "";
assert.throws(
  () => store.recordDonation({ name: "Missing UUID", amount: 10, ref: "MISSING-UUID" }),
  /Approved member access required/,
  "Giving must reject an approved-looking identity with no UUID"
);
liveGivingUser.id = liveGivingUserId;
console.log("ok  stale Giving lookups cannot mutate the owned live campaign cache");

const finalSignOut = store.signOutLive();
releaseSignOut({ error: null });
await finalSignOut;
if (!store.getBooking(uuidBooking.id) || store.getBooking(uuidBooking.id).userId !== authUser.id) {
  throw new Error("Live sign-out must preserve device-local Payment records keyed by profile UUID");
}

console.log("ok  live SIGNED_IN callback returns synchronously and defers hydration until after the auth lock");
console.log("ok  live application read failures are caught and shown once across async render flows");
console.log("ok  live OAuth session renders the signed-in home page");
console.log("ok  live profile renders valid account metadata");
console.log("ok  live indemnity renders from the application waiver state");
console.log("ok  live approved/admin missing-application Profile sections render unavailable cards");

// Giving integration must retain live Supabase ownership for campaigns and donor IDs.
for (const relativePath of [
  "../supabase/migrations/20260805000011_giving_campaigns.sql",
  "../supabase/migrations/20260806000001_donor_id.sql",
  "../supabase/tests/giving_campaigns_integration.sql",
  "../supabase/tests/verify_giving_campaigns_safety.sh",
]) {
  if (!existsSync(resolve(__dirnameSmoke, relativePath))) {
    throw new Error(`live Giving database contract missing ${relativePath}`);
  }
}
if (typeof store.updateMyDonorId !== "function" || typeof store.getActiveGivingCampaign !== "function") {
  throw new Error("live Giving profile/campaign APIs are missing");
}
console.log("ok  live Giving database and profile APIs coexist with Payment/Auth and Notifications");

// Cancellation copy must read exactly 'Session cancelled by ITC — <reason>'
// across schedule, activity, and admin ops surfaces.
const seededCancellation = await store.getSession("hyrox-2026-08-15");
if (!seededCancellation || !seededCancellation.cancelled) {
  throw new Error("15 August 2026 session should be server-cancelled on hydration");
}
if (seededCancellation.cancelReason !== "HYROX race weekend") {
  throw new Error("15 August 2026 cancel reason must be 'HYROX race weekend'");
}
const copy = operations.sessionCancellationCopy(seededCancellation);
if (copy !== "Session cancelled by ITC — HYROX race weekend") {
  throw new Error(`Cancellation copy must be canonical: ${copy}`);
}
// Check the schedule by navigating to the week containing 15 August 2026 and
// selecting that day so the cancelled session renders through the schedule row.
let scheduleHtml = "";
for (let offset = 0; offset < 4; offset += 1) {
  views.scheduleState.weekOffset = offset;
  views.scheduleState.selected = null;
  scheduleHtml += views.viewSchedule();
}
views.scheduleState.weekOffset = 1;
views.scheduleState.selected = "2026-08-15";
scheduleHtml += views.viewSchedule();
if (!scheduleHtml.includes("Session cancelled by ITC — HYROX race weekend")) {
  throw new Error("Schedule must render the canonical cancellation copy");
}
const activityHtml = views.viewActivity("hyrox-2026-08-15");
if (!activityHtml.includes("Session cancelled by ITC — HYROX race weekend")) {
  throw new Error("Activity view must render the canonical cancellation copy");
}
console.log("ok  live cancellation copy renders 'Session cancelled by ITC — <reason>' everywhere");

// Location-map surface: a non-cancelled paid HYROX exposes Get directions
// without the inline map host.
const liveNonCancelledHyrox = store.upcomingSessions(21)
  .filter((s) => s.activityId === "hyrox" && !data.sessionStarted(s))
  .find((s) => s.id !== "hyrox-2026-08-15");
if (!liveNonCancelledHyrox) throw new Error("live smoke needs an upcoming non-cancelled hyrox session");
const liveHyroxDetail = views.viewActivity(liveNonCancelledHyrox.id);
if (!liveHyroxDetail.includes("Get directions") || liveHyroxDetail.includes('id="activity-map"')) {
  throw new Error("paid HYROX activity must surface Get directions without the inline map");
}
console.log("ok  live paid HYROX surfaces Get directions without the inline map");

// app.js owns the browser-relative lazy import. Exercise that real import from
// app/js/app.js so a duplicated "js/" path cannot pass through the smoke file's
// different base URL.
const browserRelativeMap = await app.loadActivityMapModule();
assert.equal(
  typeof browserRelativeMap.mountActivityMap,
  "function",
  "app.js must resolve the map module relative to its own app/js URL"
);

// Admin Tamar picker: map click and marker drag emit exact selected points.
const pickerLeafletBefore = globalThis.L;
let pickerMapClick;
let pickerMarkerDrag;
let pickerMarkerPoint = { lat: 22.2816182, lng: 114.1655613 };
let pickerRemoved = 0;
const pickerSetViews = [];
const pickerChanges = [];
const pickerMap = {
  setView(coords, zoom) { pickerSetViews.push([coords, zoom]); },
  on(type, callback) { if (type === "click") pickerMapClick = callback; },
  remove() { pickerRemoved += 1; },
};
const pickerMarker = {
  addTo() { return this; },
  setLatLng(coords) { pickerMarkerPoint = { lat: coords[0], lng: coords[1] }; },
  getLatLng() { return pickerMarkerPoint; },
  on(type, callback) { if (type === "dragend") pickerMarkerDrag = callback; },
};
globalThis.L = {
  map: () => pickerMap,
  tileLayer: () => ({ addTo() {} }),
  marker: () => pickerMarker,
};
const pickerHost = makeElement();
pickerHost.isConnected = true;
const pickerController = await browserRelativeMap.mountVenuePicker(pickerHost, {
  initialPoint: { lat: 22.2816182, lng: 114.1655613 },
  onChange: (point) => pickerChanges.push(point),
  loadLeaflet: async () => {},
});
assert.deepEqual(pickerSetViews, [[ [22.2816182, 114.1655613], 17 ]]);
pickerMapClick({ latlng: { lat: 22.2825, lng: 114.1659 } });
assert.deepEqual(pickerChanges.at(-1), { lat: 22.2825, lng: 114.1659 });
pickerMarkerPoint = { lat: 22.2827, lng: 114.1661 };
pickerMarkerDrag();
assert.deepEqual(pickerChanges.at(-1), { lat: 22.2827, lng: 114.1661 });
pickerController.destroy();
assert.equal(pickerRemoved, 1);
globalThis.L = pickerLeafletBefore;

// Form synchronization reveals Tamar, seeds defaults, retains marker changes,
// and clears/destroys the picker after changing to an indoor venue.
const pickerForm = new HTMLFormElement();
pickerForm.dataset = { session: "wnt-2026-08-26" };
const pickerLocation = { value: "Tamar Park" };
const pickerLat = { value: "" };
const pickerLng = { value: "" };
const pickerShell = makeElement();
pickerShell.classList.toggle("hidden", true);
const pickerFormHost = makeElement();
pickerFormHost.isConnected = true;
pickerForm.querySelector = (selector) => ({
  '[name="location"]': pickerLocation,
  '[name="meetingLat"]': pickerLat,
  '[name="meetingLng"]': pickerLng,
  "[data-venue-picker-shell]": pickerShell,
  "[data-venue-picker]": pickerFormHost,
})[selector] || null;
let pickerFormChange;
let pickerFormDestroyed = 0;
let pickerInitialPoint;
assert.equal(await app.syncWeekVenuePicker(pickerForm, {
  ownsGeneration: () => true,
  loadModule: async () => ({
    mountVenuePicker: async (_host, options) => {
      pickerInitialPoint = options.initialPoint;
      pickerFormChange = options.onChange;
      return { destroy() { pickerFormDestroyed += 1; } };
    },
  }),
}), true);
assert.equal(pickerShell.classList.contains("hidden"), false);
assert.deepEqual(pickerInitialPoint, { lat: 22.2816182, lng: 114.1655613 });
assert.equal(pickerLat.value, "22.2816182");
assert.equal(pickerLng.value, "114.1655613");
pickerFormChange({ lat: 22.2825, lng: 114.1659 });
assert.equal(pickerLat.value, "22.2825");
assert.equal(pickerLng.value, "114.1659");
pickerLocation.value = "Island ECC 9/F";
assert.equal(await app.syncWeekVenuePicker(pickerForm), false);
assert.equal(pickerShell.classList.contains("hidden"), true);
assert.equal(pickerLat.value, "");
assert.equal(pickerLng.value, "");
assert.equal(pickerFormDestroyed, 1);
console.log("ok  Admin Tamar picker click, drag, default, and clear behavior");

// A rejected lazy import must settle the host on the public fallback instead
// of escaping as an unhandled rejection or leaving "Loading map…" forever.
const rejectedImportHost = {
  id: "activity-map",
  isConnected: true,
  dataset: { mapsQuery: "Causeway Bay, Hong Kong", markerLabel: "Rejected import" },
  innerHTML: "<p>Loading map…</p>",
};
const rejectedImportResult = await app.mountCommittedActivityMap(rejectedImportHost, {
  loadModule: async () => { throw new Error("simulated map import rejection"); },
});
assert.equal(rejectedImportResult, false, "a rejected map import must resolve to false");
assert.match(rejectedImportHost.innerHTML, /Couldn.t find the venue on the map/);
assert.doesNotMatch(rejectedImportHost.innerHTML, /Loading map/);
console.log("ok  app-relative map import resolves and import rejection renders fallback");

// A failed ECC guide image must be replaced with the generic map host while
// route ownership is current; stale routes must leave their figure untouched.
let venueImageError;
let replacedVenueFigure = null;
let mountedFallbackHost = null;
const venueFigure = {
  replaceWith(node) { replacedVenueFigure = node; },
};
const venueImage = {
  dataset: { fallbackQuery: "Island ECC" },
  isConnected: true,
  closest: () => venueFigure,
  addEventListener(type, callback) {
    if (type === "error") venueImageError = callback;
  },
};
assert.equal(app.mountVenueImageFallback(venueImage, {
  mountMap: async (host) => { mountedFallbackHost = host; return true; },
}), true);
assert.equal(replacedVenueFigure, null);
await venueImageError();
assert.ok(replacedVenueFigure, "image error must replace the guide figure");
assert.equal(mountedFallbackHost?.dataset?.mapsQuery, "Island ECC");

let noQueryError;
let noQueryRemoved = false;
const noQueryImage = {
  dataset: { fallbackQuery: "" },
  isConnected: true,
  closest: () => ({ remove() { noQueryRemoved = true; } }),
  addEventListener(type, callback) { if (type === "error") noQueryError = callback; },
};
assert.equal(app.mountVenueImageFallback(noQueryImage), true);
noQueryError();
assert.equal(noQueryRemoved, true, "failed guide without a map query must be removed");

let detailPhotoError;
let detailPhotoSrc = "/assets/itc/missing-hyrox.webp";
let detailPhotoRemoved = false;
const detailPhoto = {
  dataset: { photoFallback: "/assets/itc/hyrox.webp" },
  isConnected: true,
  getAttribute(name) { return name === "src" ? detailPhotoSrc : null; },
  set src(value) { detailPhotoSrc = value; },
  remove() { detailPhotoRemoved = true; },
  addEventListener(type, callback) { if (type === "error") detailPhotoError = callback; },
};
assert.equal(app.mountDetailPhotoFallback(detailPhoto), true);
detailPhotoError();
assert.equal(detailPhotoSrc, "/assets/itc/hyrox.webp", "failed HYROX image must retry the root asset");
detailPhotoError();
assert.equal(detailPhotoRemoved, true, "a failed HYROX fallback must not remain broken");
console.log("ok  HYROX detail photo retries a root asset fallback");

let staleReplaced = false;
let staleImageError;
const staleImage = {
  dataset: { fallbackQuery: "Island ECC" },
  isConnected: true,
  closest: () => ({ replaceWith() { staleReplaced = true; } }),
  addEventListener(type, callback) { if (type === "error") staleImageError = callback; },
};
assert.equal(app.mountVenueImageFallback(staleImage, {
  ownsGeneration: () => false,
}), false);
assert.equal(staleImageError, undefined);
assert.equal(staleReplaced, false);
console.log("ok  ECC guide failure falls back to map only for the current route");

// Mount contract: stale activity hosts must not be remounted after navigation.
let lateMounted = false;
const lateMap = await import("./js/map.js");
globalThis.window.__lateMapLoader = () => {
  lateMounted = true;
  return Promise.resolve();
};
const lateHost = {
  id: "activity-map",
  isConnected: false,
  dataset: { mapsQuery: "Causeway Bay, Hong Kong", markerLabel: "Late" },
  innerHTML: "<p>Loading\u2026</p>",
};
const lateResult = await lateMap.mountActivityMap(lateHost, {
  ownsGeneration: () => false,
  fetchImpl: async () => ({ ok: true, json: async () => [] }),
  loadLeaflet: globalThis.window.__lateMapLoader,
});
if (lateResult !== false) {
  throw new Error("stale activity host must resolve to false");
}
if (lateMounted) {
  throw new Error("stale activity host must not load Leaflet");
}
console.log("ok  inline map mount respects stale generation ownership");
