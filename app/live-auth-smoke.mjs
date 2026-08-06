// Focused regression for the Supabase OAuth -> synchronous view handoff.
// Run directly with: node app/live-auth-smoke.mjs

import assert from "node:assert/strict";

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
let profileListError = null;
let applicationListError = null;
let profileUpdateError = null;
let profileUpdateResult = "row";
let authStateChangeHandler = null;
let authCallbackLocked = false;
const deferredAuthTasks = [];
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
                  const target = targetId === profile.id
                    ? profile
                    : pendingProfiles.find((item) => item.id === targetId);
                  profileUpdates.push({ id: targetId, expectedRole, ...structuredClone(patch) });
                  if (profileUpdateError) return { data: null, error: profileUpdateError };
                  if (profileUpdateResult === "zero" || !target || (expectedRole && target.role !== expectedRole)) {
                    return { data: null, error: null };
                  }
                  Object.assign(target, patch);
                  return { data: { id: targetId, role: target.role }, error: null };
                },
              };
            },
          };
          return result;
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
                  error: applicationReadError,
                }),
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
if (!approvalsHtml.includes("Application not submitted")) {
  throw new Error("Approvals must explain incomplete pending profiles");
}
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
if (!/Declined Runner[\s\S]*badge danger">Declined</.test(membersHtml)) {
  throw new Error("Members must badge declined profiles as Declined");
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
store.currentUser().role = "pending";
store.currentUser().status = "pending";
const pendingAccount = await views.viewAccount();
if (!pendingAccount.includes("+852 6123 4567")) {
  throw new Error("Pending Profile should render the fetched application phone");
}
if (!pendingAccount.includes("Taylor Coach · +852 6777 8888")) {
  throw new Error("Pending Profile should render the fetched application emergency contact");
}
if (!pendingAccount.includes("Accepted")) {
  throw new Error("Pending Profile should render the fetched application waiver state");
}
if (!pendingAccount.includes("Yes")) {
  throw new Error("Pending Profile should render the fetched application photo consent");
}
store.currentUser().role = "super_admin";
store.currentUser().status = "approved";
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

const domListeners = new Map();
const windowListeners = new Map();
let activeElement = null;
const makeElement = () => ({
  children: [],
  className: "",
  innerHTML: "",
  textContent: "",
  classList: { toggle() {} },
  appendChild(child) { this.children.push(child); },
  focus(options) {
    activeElement = this;
    this.focusOptions = options;
  },
  remove() {},
  querySelector() { return null; },
});
const elements = new Map([
  ["view", makeElement()],
  ["bottom-nav", makeElement()],
  ["top-avatar", makeElement()],
  ["toast-stack", makeElement()],
]);
globalThis.document = {
  get activeElement() { return activeElement; },
  getElementById: (id) => elements.get(id),
  createElement: () => makeElement(),
  addEventListener: (event, callback) => domListeners.set(event, callback),
};
globalThis.HTMLInputElement = class {};
globalThis.location = { hash: "#/account" };
window.location = globalThis.location;
window.addEventListener = (event, callback) => windowListeners.set(event, callback);
window.scrollTo = () => {};
globalThis.setTimeout = (callback, delay) => {
  if (delay === 0) deferredAuthTasks.push(callback);
  return 0;
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
applicationReadError = new Error("Application read failed");
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
const approvalClick = {
  target: {
    closest: () => ({ dataset: { action: "approve", user: "pending-submitted" } }),
  },
};
for (const [expectedError, configure] of [
  ["Profile update failed", () => { profileUpdateError = new Error("Profile update failed"); }],
  ["Application decision conflict.", () => { profileUpdateResult = "zero"; }],
]) {
  toastStack.children.length = 0;
  configure();
  await click(approvalClick);
  assert.equal(elements.get("view").innerHTML, retainedQueueHtml, `${expectedError} must retain prior queue UI`);
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [expectedError]);
  assert.equal(toastStack.children.some((item) => item.textContent === "Approved."), false,
    `${expectedError} must not produce a success toast`);
  profileUpdateError = null;
  profileUpdateResult = "row";
}

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

console.log("ok  live SIGNED_IN callback returns synchronously and defers hydration until after the auth lock");
console.log("ok  live application read failures are caught and shown once across async render flows");
console.log("ok  live OAuth session renders the signed-in home page");
console.log("ok  live profile renders valid account metadata");
console.log("ok  live indemnity renders from the application waiver state");
console.log("ok  live approved/admin missing-application Profile sections render unavailable cards");
