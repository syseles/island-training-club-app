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
    full_name: "Operations Admin",
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
let authStateChangeHandler = null;
let authCallbackLocked = false;
let oauthCalls = 0;
let releaseOAuth = null;
let signOutCalls = 0;
let releaseSignOut = null;
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
    signInWithOAuth() {
      oauthCalls++;
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
assert.match(approvalsHtml, /Ready for review \(1\)/);
assert.match(approvalsHtml, /Awaiting application \(1\)/);
assert.ok(approvalsHtml.indexOf("Submitted Runner") < approvalsHtml.indexOf("Incomplete Runner"),
  "Submitted applications must render first");
if (!approvalsHtml.includes("Application not submitted")) {
  throw new Error("Approvals must explain incomplete pending profiles");
}
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
assert.match(filteredMembersHtml, /Operations Admin/);
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
  "Filtered empty states must render without card chrome");
const emptyMemberNotificationsHtml = await views.viewNotifications(notificationNow, []);
assert.doesNotMatch(emptyMemberNotificationsHtml, /New notifications will appear here\./);
assert.match(emptyMemberNotificationsHtml, /No Club updates notifications\./);
assert.doesNotMatch(emptyMemberNotificationsHtml, /<section class="card notification-section"/);
renderedUser.role = "super_admin";
views.notificationFilters.kind = "all";
const emptyAdminNotificationsHtml = await views.viewNotifications(notificationNow, []);
assert.doesNotMatch(emptyAdminNotificationsHtml, /New notifications will appear here\./);
assert.match(emptyAdminNotificationsHtml, /No any notifications\./);
assert.doesNotMatch(emptyAdminNotificationsHtml, /<section class="card notification-section"/,
  "All-filter empty states must render without card chrome");
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
const makeElement = () => {
  const classes = new Set();
  return {
  children: [],
  className: "",
  innerHTML: "",
  textContent: "",
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
globalThis.location = { hash: "#/account" };
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
demoteSelect.dataset = { change: "set-role", user: "approved-admin", memberName: "Operations Admin", currentRole: "admin" };
demoteSelect.value = "member";
demoteSelect.closest = () => demoteSelect;
await change({ target: demoteSelect });
assert.equal(confirmMessage, "Change Operations Admin’s role to Member?");
assert.equal(profileUpdates.length, updatesBeforeRoleCancel, "Cancelled demotion must not call the store");

const revokeControl = makeElement();
revokeControl.textContent = "Revoke access";
revokeControl.dataset = { action: "revoke-member", user: "approved-admin", memberName: "Operations Admin" };
revokeControl.closest = () => revokeControl;
await click({ target: revokeControl });
assert.equal(confirmMessage, "Revoke Operations Admin’s access and move them to Pending?");
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
successfulDemotion.dataset = { change: "set-role", user: "approved-admin", memberName: "Operations Admin", currentRole: "admin" };
successfulDemotion.value = "member";
successfulDemotion.closest = () => successfulDemotion;
await change({ target: successfulDemotion });
assert.ok(profileUpdates.some((update) => update.id === "approved-admin" && update.role === "member"));
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Operations Admin is now Member."]);

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
refreshFailedRole.dataset = { change: "set-role", user: "approved-admin", memberName: "Operations Admin", currentRole: "member" };
refreshFailedRole.value = "admin";
refreshFailedRole.closest = () => refreshFailedRole;
profileListError = new Error("Members refresh failed");
await change({ target: refreshFailedRole });
profileListError = null;
assert.equal(approvedProfiles.find((item) => item.id === "approved-admin").role, "admin");
assert.equal(refreshFailedRole.disabled, true, "refresh failure must lock the stale role control");
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Operations Admin is now Admin.",
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
const firstSignOut = click({ target: signOutControl });
assert.equal(signOutControl.disabled, true);
assert.equal(signOutControl.textContent, "Signing out…");
assert.equal(signOutControl.getAttribute("aria-busy"), "true");
const duplicateSignOut = click({ target: signOutControl });
assert.equal(signOutCalls, 1, "pending sign-out must prevent a duplicate store action");
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

// A signed-out visitor keeps the original four-item navigation and no bell.
const visitorSignOut = makeElement();
visitorSignOut.textContent = "Sign out";
visitorSignOut.dataset = { action: "signout" };
visitorSignOut.closest = () => visitorSignOut;
const successfulSignOut = click({ target: visitorSignOut });
releaseSignOut({ error: null });
await successfulSignOut;
assert.equal(notificationBell.hidden, true, "visitor notification bell must stay hidden");
assert.equal(notificationBell.innerHTML, "", "visitor bell content must be cleared");
assert.equal(notificationBell.hasAttribute("aria-label"), false);
assert.equal((elements.get("bottom-nav").innerHTML.match(/<a /g) || []).length, 4,
  "visitor bottom navigation must remain unchanged");

console.log("ok  live SIGNED_IN callback returns synchronously and defers hydration until after the auth lock");
console.log("ok  live application read failures are caught and shown once across async render flows");
console.log("ok  live OAuth session renders signed and visitor notification chrome safely");
console.log("ok  live profile renders valid account metadata");
console.log("ok  live indemnity renders from the application waiver state");
console.log("ok  live approved/admin missing-application Profile sections render unavailable cards");
