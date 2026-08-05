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
const detailsSummary = await views.viewAccount("details");
for (const label of [
  "Full name",
  "Preferred name",
  "Email",
  "Member since",
  "Mobile / WhatsApp number",
  "Age status",
  "Emergency contact name",
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
if (!detailsEdit.includes('value="Taylor Coach"') || !detailsEdit.includes('value="+852 6777 8888"')) {
  throw new Error("Live details edit route should prefill emergency contact fields");
}
if (detailsEdit.includes('name="photo_consent"')) {
  throw new Error("Live details edit route should exclude photo consent controls");
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
const waiverMissing = await views.viewAccount("indemnity");
if (!waiverMissing.includes("To be accepted")) {
  throw new Error("Indemnity page should prompt when the live waiver is missing");
}
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

const refreshedAccount = await views.viewAccount();
if (!refreshedAccount.includes(`Indemnity confirmed on ${confirmedDay}`) || refreshedAccount.includes("To be accepted")) {
  throw new Error("Account should rerender from the accepted live waiver timestamp");
}
const refreshedIndemnity = await views.viewAccount("indemnity");
if (!refreshedIndemnity.includes(`Indemnity confirmed on ${confirmedDay}`) || refreshedIndemnity.includes("To be accepted")) {
  throw new Error("Indemnity page should rerender from the accepted live waiver timestamp");
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

console.log("ok  live OAuth session renders the signed-in home page");
console.log("ok  live profile renders valid account metadata");
console.log("ok  live indemnity renders from the application waiver state");
console.log("ok  live approved/admin missing-application Profile sections render unavailable cards");
