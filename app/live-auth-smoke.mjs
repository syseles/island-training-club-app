// Focused regression for the Supabase OAuth -> synchronous view handoff.
// Run directly with: node app/live-auth-smoke.mjs

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
      emergency_phone: "+852 6777 8888",
      heard_source: "instagram",
      heard_detail: "Coach post",
      preferred_name: "Riley",
      photo_consent: true,
      waiver_accepted_at: "2026-08-05T01:00:00.000Z",
      privacy_accepted_at: "2026-08-05T01:05:00.000Z",
      guidelines_accepted_at: "2026-08-05T01:10:00.000Z",
      submitted_at: "2026-08-05T01:15:00.000Z",
      whatsapp_reminders: false,
      email_receipts: true,
      community_news: true,
    },
  ],
]);
const applicationUpdates = [];
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
    getSession: async () => ({
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
    }),
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
                maybeSingle: async () => ({
                  data: structuredClone(applicationRows.get(value) || null),
                  error: null,
                }),
              };
            },
          };
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
    throw new Error(`Unexpected table: ${table}`);
  },
};

globalThis.window = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  supabase: { createClient: () => fakeSupabase },
};

const store = await import("./js/store.js");
const views = await import("./js/views.js");
store.load();

await store.getCurrentUser();
const renderedUser = store.currentUser();
if (!renderedUser || renderedUser.id !== authUser.id) {
  throw new Error("A fetched Supabase session was not available to synchronous views");
}
const liveApplication = await store.getMyApplication();
if (!liveApplication || liveApplication.waiver_accepted_at !== "2026-08-05T01:00:00.000Z") {
  throw new Error("waiver missing");
}
await store.updateMyMembershipDetails({
  mobile: "+852 9000 0000",
  age_over_18: "yes",
  emergency_name: "Alex Runner",
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
const preservedWaiver = await store.acceptMyIndemnity();
if (preservedWaiver !== "2026-08-05T01:00:00.000Z") {
  throw new Error("acceptMyIndemnity should preserve an existing timestamp");
}
if (applicationUpdates.length !== 0) {
  throw new Error("acceptMyIndemnity should not write when already accepted");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  waiver_accepted_at: null,
});
const createdWaiver = await store.acceptMyIndemnity();
if (createdWaiver !== fixedIso) {
  throw new Error(`acceptMyIndemnity should write ${fixedIso}, got ${createdWaiver}`);
}
const indemnityPatch = applicationUpdates.at(-1);
if (!indemnityPatch || Object.keys(indemnityPatch).join(",") !== "waiver_accepted_at") {
  throw new Error("acceptMyIndemnity should only write waiver_accepted_at");
}

const home = views.viewHome();
if (!home.includes("Good to see you, Riley.")) {
  throw new Error("Home did not greet the signed-in Google user");
}
if (home.includes("Continue with Google")) {
  throw new Error("Home still asked the signed-in Google user to sign in");
}

const account = views.viewAccount();
if (!account.includes("Super admin")) {
  throw new Error("Account did not display the live super-admin role");
}
if (!account.includes("Member since Aug 2026")) {
  throw new Error("Account did not map the live profile creation date");
}
if (account.includes("undefined") || account.includes("Invalid Date")) {
  throw new Error("Account displayed an undefined role or invalid membership date");
}

console.log("ok  live OAuth session renders the signed-in home page");
console.log("ok  live profile renders valid account metadata");
