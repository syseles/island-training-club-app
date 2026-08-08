// Headless smoke test: render every view for every user state.
// Run: node --input-type=module < smoke.mjs  (from the app/ directory)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const liveAuth = spawnSync(process.execPath, [fileURLToPath(new URL("./live-auth-smoke.mjs", import.meta.url))], {
  encoding: "utf8",
});
if (liveAuth.stdout) process.stdout.write(liveAuth.stdout);
if (liveAuth.status !== 0) {
  if (liveAuth.stderr) process.stderr.write(liveAuth.stderr);
  process.exit(liveAuth.status || 1);
}

const liveApply = spawnSync(process.execPath, [
  "--input-type=module",
  "-e",
  `
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
const authUser = {
  id: "live-pending-user",
  email: "pending@example.com",
  user_metadata: { full_name: "Pending Person" },
};
const profile = {
  id: authUser.id,
  email: authUser.email,
  full_name: "Pending Person",
  role: "pending",
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
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
              if (column !== "id" || value !== authUser.id) throw new Error("Profile query mismatch");
              return { maybeSingle: async () => ({ data: profile, error: null }) };
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
              if (column !== "profile_id" || value !== authUser.id) throw new Error("Application query mismatch");
              return { maybeSingle: async () => ({ data: null, error: null }) };
            },
          };
        },
      };
    }
    throw new Error("Unexpected table: " + table);
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
const applyHtml = await views.viewApply();
if (typeof applyHtml !== "string") throw new Error("Live apply did not render HTML");
if (!applyHtml.includes('name="age_over_18"') ||
    !applyHtml.includes('value="yes"') ||
    !applyHtml.includes('value="no"') ||
    applyHtml.includes('name="date_of_birth"')) {
  throw new Error("Live apply should require Yes/No age status and omit DOB");
}
if (!applyHtml.includes("data-minor-only")) {
  throw new Error("Live apply should mark guardian fields as minor-only");
}
console.log("ok  live apply uses age status instead of DOB");
  `,
], {
  encoding: "utf8",
  cwd: fileURLToPath(new URL(".", import.meta.url)),
});
if (liveApply.stdout) process.stdout.write(liveApply.stdout);
if (liveApply.status !== 0) {
  if (liveApply.stderr) process.stderr.write(liveApply.stderr);
  process.exit(liveApply.status || 1);
}

// --- Shared UI and accessibility foundations ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, "index.html"), "utf8");
const stylesCss = readFileSync(resolve(__dirname, "styles.css"), "utf8");
const viewsSource = readFileSync(resolve(__dirname, "js/views.js"), "utf8");
for (const path of [
  "../assets/fonts/archivo-latin-variable.woff2",
  "../assets/fonts/OFL-Archivo.txt",
]) {
  if (!existsSync(new URL(path, import.meta.url))) throw new Error(`missing self-hosted font asset: ${path}`);
}
const fontFiles = readdirSync(new URL("../assets/fonts/", import.meta.url));
if (fontFiles.some((name) => /barlow/i.test(name)) || /barlow/i.test(indexHtml) || /barlow/i.test(stylesCss)) {
  throw new Error("Barlow assets, declarations, and preloads must be removed");
}
const archivoFont = readFileSync(new URL("../assets/fonts/archivo-latin-variable.woff2", import.meta.url));
const archivoLicense = readFileSync(new URL("../assets/fonts/OFL-Archivo.txt", import.meta.url), "utf8");
if (archivoFont.subarray(0, 4).toString("ascii") !== "wOF2" || !archivoLicense.includes("SIL Open Font License, Version 1.1")) {
  throw new Error("Archivo must include a valid WOFF2 asset and OFL 1.1 license");
}
if (!indexHtml.includes('rel="preload" href="../assets/fonts/archivo-latin-variable.woff2" as="font" type="font/woff2" crossorigin')) {
  throw new Error("primary Archivo variable font must be preloaded");
}
const fontFaces = stylesCss.match(/@font-face\s*{[^}]*}/gs) || [];
if (fontFaces.length !== 1 || !/font-family:\s*"Archivo";[^}]*archivo-latin-variable\.woff2[^}]*font-style:\s*normal;[^}]*font-weight:\s*100 900;[^}]*font-stretch:\s*100%;[^}]*font-display:\s*swap;/s.test(fontFaces[0])) {
  throw new Error("Archivo must have one normal-width variable font face");
}
const archivoStack = '"Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
if (!stylesCss.includes(`--font: ${archivoStack};`) || !stylesCss.includes(`--font-display: ${archivoStack};`)) {
  throw new Error("normal and display font tokens must resolve to Archivo");
}
if (!stylesCss.includes("--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;") ||
    !stylesCss.includes(".mono { font-family: var(--font-mono); }")) {
  throw new Error("technical monospace typography must remain unchanged");
}
const ordinaryUiCss = stylesCss.replace(fontFaces[0], "");
if (/font-weight:\s*900\b/.test(ordinaryUiCss) ||
    !/body\s*{[^}]*font-weight:\s*400\b/s.test(ordinaryUiCss) ||
    !/button\s*{[^}]*font-weight:\s*600\b/s.test(ordinaryUiCss) ||
    !/input, select, textarea\s*{[^}]*font-weight:\s*600\b/s.test(ordinaryUiCss)) {
  throw new Error("ordinary Archivo body and control weights must follow the readable hierarchy");
}
for (const selector of [".display", ".section-head h2", ".card h3", ".ph-id h1", ".session-row h3"]) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`${escapedSelector}\\s*{[^}]*font-weight:\\s*800\\b`, "s").test(ordinaryUiCss)) {
    throw new Error(`ordinary Archivo heading must use weight 800: ${selector}`);
  }
}
for (const selector of [".kicker", ".badge", ".btn", ".chip", ".admin-tabs a", ".admin-filter-chips button", ".admin-filters-clear"]) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`${escapedSelector}\\s*{[^}]*font-weight:\\s*700\\b`, "s").test(ordinaryUiCss)) {
    throw new Error(`ordinary Archivo label/control must use weight 700: ${selector}`);
  }
}
for (const contract of ["@font-face", "font-display: swap", ":focus-visible", "prefers-reduced-motion", "max-width: 420px"]) {
  if (!stylesCss.includes(contract)) throw new Error(`missing accessibility CSS contract: ${contract}`);
}
if (!indexHtml.includes('class="skip-link"') || !indexHtml.includes('id="view"')) {
  throw new Error("app shell must provide a skip link and main target");
}
if (viewsSource.includes('{ key: "admin", label: "Admin"')) {
  throw new Error("Admin belongs in Profile, not bottom navigation");
}
if (viewsSource.includes('{ key: "notifications", label: "Notifications"')) {
  throw new Error("Notifications belong in the top bar, not bottom navigation");
}
const notificationHost = '<a id="top-notifications" class="top-icon-button" href="#/notifications" hidden></a>';
if (!indexHtml.includes(notificationHost) || indexHtml.indexOf(notificationHost) > indexHtml.indexOf('id="top-avatar"')) {
  throw new Error("app shell must provide a visitor-hidden semantic notification link before the avatar");
}
for (const contract of [".top-icon-button", "width: 44px", "height: 44px", ".notification-badge", "env(safe-area-inset-top)"]) {
  if (!stylesCss.includes(contract)) throw new Error(`missing notification bell CSS contract: ${contract}`);
}
console.log("ok  shared UI and accessibility foundation contracts");

// --- localStorage shim ---
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import("./js/store.js");
const views = await import("./js/views.js");
const data = await import("./js/data.js");

const bellThree = views.notificationBellHTML?.(3, false) || "";
const bellCapped = views.notificationBellHTML?.(120, true) || "";
if (!bellThree.includes("<svg") || !bellThree.includes('class="notification-badge"') || !bellThree.includes(">3</span>")) {
  throw new Error("notificationBellHTML must render the bell and unread badge");
}
if (!bellCapped.includes(">99+</span>") || /120/.test(bellCapped)) {
  throw new Error("notificationBellHTML must visually cap unread counts at 99+");
}
if (views.notificationBellHTML?.(0, false).includes("notification-badge")) {
  throw new Error("notificationBellHTML must omit the badge for zero unread notifications");
}
const visitorNav = views.navHTML("home", null);
const signedNav = views.navHTML("home", { role: "member" });
if (visitorNav.includes("#/notifications") || signedNav.includes("#/notifications") ||
    visitorNav.includes("#/giving") || !signedNav.includes("#/giving") ||
    (visitorNav.match(/<a /g) || []).length !== 4 || (signedNav.match(/<a /g) || []).length !== 5) {
  throw new Error("bottom navigation must hide Giving from visitors and keep five signed-in product items");
}

const notificationNow = new Date("2026-08-05T06:40:00.000Z");
const notificationHelperCases = [
  [data.notificationRelativeTime?.("2026-08-05T06:39:45.000Z", notificationNow), "Just now"],
  [data.notificationRelativeTime?.("2026-08-05T06:35:00.000Z", notificationNow), "5 minutes ago"],
  [data.notificationRelativeTime?.("2026-08-05T04:40:00.000Z", notificationNow), "2 hours ago"],
  [data.notificationRelativeTime?.("2026-08-04T06:40:00.000Z", notificationNow), "Yesterday"],
];
for (const [actual, expected] of notificationHelperCases) {
  if (actual !== expected) throw new Error(`notificationRelativeTime: expected ${expected}, got ${actual}`);
}
if (!/5 Aug 2026, 2:32 PM HKT/.test(data.notificationHktTime?.("2026-08-05T06:32:00.000Z") || "")) {
  throw new Error("notificationHktTime must format exact Asia/Hong_Kong time independently of host timezone");
}
for (const invalidTime of [undefined, "", "not-a-date"]) {
  if (data.notificationRelativeTime?.(invalidTime, notificationNow) !== "" ||
      data.notificationHktTime?.(invalidTime) !== "") {
    throw new Error("Malformed notification timestamps must use a stable empty helper fallback");
  }
}
const notificationCategoryCases = [
  ["admin_application_submitted", "application"],
  ["admin_application_approved", "decision"],
  ["admin_application_declined", "decision"],
  ["admin_role_promoted", "role"],
  ["admin_role_demoted", "role"],
  ["admin_membership_revoked", "role"],
  ["giving_campaign_published", "club"],
  ["welcome", "personal"],
  [null, "personal"],
  [{ malformed: true }, "personal"],
];
for (const [kind, expected] of notificationCategoryCases) {
  const actual = data.notificationCategory?.(kind);
  if (actual !== expected) throw new Error(`notificationCategory: expected ${expected}, got ${actual}`);
}
if (data.notificationDestination?.("admin_application_submitted") !== "#/admin/approvals" ||
    data.notificationDestination?.(" admin_role_changed ") !== "#/admin/members" ||
    data.notificationDestination?.("giving_campaign_published") !== "#/giving" ||
    data.notificationDestination?.("welcome") !== "#/account" ||
    data.notificationDestination?.(null) !== "#/account") {
  throw new Error("notificationDestination must normalize kinds and preserve route semantics");
}
console.log("ok  deterministic notification helper contracts");

let failures = 0;
async function check(label, fn) {
  try {
    const out = await fn();
    if (out && typeof out === "object" && out.redirect) {
      console.log(`ok(redirect) ${label} -> ${out.redirect}`);
      return out;
    }
    if (typeof out !== "string" || out.length < 50) {
      throw new Error(`suspicious output (len ${typeof out === "string" ? out.length : "obj"})`);
    }
    console.log(`ok  ${label}`);
    return out;
  } catch (err) {
    failures++;
    console.error(`FAIL ${label}: ${err.message}\n${err.stack.split("\n")[1] || ""}`);
    return "";
  }
}

store.load();

// --- v11 clean identity baseline ---
const freshBaseline = JSON.parse(mem.get("itc.prototype.v1"));
if (freshBaseline.users.length || freshBaseline.bookings.length || freshBaseline.receipts.length || freshBaseline.sessionUserId) {
  throw new Error("fresh local state must contain no identities, transactions, or session");
}
const cleanAccountHtml = await views.viewAccount();
for (const removed of ["demo-signin", "reset-demo", "one-tap demo", "seeded email"]) {
  if (cleanAccountHtml.toLowerCase().includes(removed)) throw new Error(`Account still contains removed demo content: ${removed}`);
}
const freshLocalNotifications = await store.listMyNotifications();
views.notificationFilters.kind = "all";
const cleanNotificationsHtml = await views.viewNotifications(new Date("2026-08-05T06:40:00.000Z"), freshLocalNotifications);
if (freshLocalNotifications.length || !cleanNotificationsHtml.includes("New notifications will appear here.")) {
  throw new Error("fresh local notification state must be empty");
}
if (views.viewCommunity("announcements").includes("Marathon fundraiser passes first milestone")) {
  throw new Error("fake fundraiser announcement must not ship");
}
console.log("ok  v11 fresh local account and notification state is empty and free of demo controls");

// Neutral fixtures exercise authenticated local paths without shipping to users.
const installLocalFixtures = () => {
  const clean = JSON.parse(mem.get("itc.prototype.v1"));
  clean.users = [
    {
      id: "fixture-admin", role: "admin", status: "approved", fullName: "Test Admin",
      preferredName: "Admin", email: "admin@example.test", phone: "+852 5000 0001",
      emergencyName: "Test Contact", emergencyPhone: "+852 5000 9001", heard: "Test fixture",
      isMinor: false, appliedAt: Date.now() - 86400000, indemnityAcceptedAt: Date.now() - 86400000,
      privacyAcceptedAt: Date.now() - 86400000, whatsappReminders: false, emailReceipts: false,
      communityNews: false,
    },
    {
      id: "fixture-member", role: "member", status: "approved", fullName: "Test Member",
      preferredName: "Tester", email: "member@example.test", phone: "+852 5000 0002",
      emergencyName: "Test Contact", emergencyPhone: "+852 5000 9002", heard: "Test fixture",
      mediaConsent: true, donorId: "TEST-1234", isMinor: false,
      appliedAt: Date.now() - 172800000, indemnityAcceptedAt: Date.now() - 172800000,
      privacyAcceptedAt: Date.now() - 172800000, whatsappReminders: false,
      emailReceipts: false, communityNews: false,
    },
  ];
  mem.set("itc.prototype.v1", JSON.stringify(clean));
  store.load();
};
installLocalFixtures();

// --- Visitor state ---
store.signOut();
await check("home (visitor)", () => views.viewHome());
const homeVisitor = views.viewHome();
if (homeVisitor.includes("My Week")) {
  failures++;
  console.error('FAIL visitor home must not show "My Week"');
} else console.log('ok  "My Week" is signed-in-only');
if (!homeVisitor.includes("This week — open to all")) {
  failures++;
  console.error("FAIL visitor home missing free open-to-all preview");
} else console.log("ok  visitor home shows the free open-to-all preview");
if (homeVisitor.includes('href="#/apply"')) {
  failures++;
  console.error("FAIL visitor home must not link to #/apply");
} else console.log("ok  visitor home has no #/apply link");
if (!homeVisitor.includes('href="#/account"')) {
  failures++;
  console.error("FAIL visitor home missing its #/account CTA");
} else console.log("ok  visitor home CTA points to #/account");
if (homeVisitor.includes("Encouragement of the week")) {
  failures++;
  console.error('FAIL visitor home must not show "Encouragement of the week"');
} else console.log('ok  visitor home hides "Encouragement of the week"');
if (homeVisitor.includes("Book & pay")) {
  failures++;
  console.error("FAIL visitor home preview must not contain paid booking language");
} else console.log("ok  visitor home preview has no paid booking language");
await check("schedule", () => views.viewSchedule());
const hyroxSid = store.nextSession().kind === "paid" ? store.nextSession().id : null;
const allUpcoming = store.upcomingSessions(14);
// booking tests need a session that hasn't started yet — today's sessions
// are unbookable once their start time passes
const paid = allUpcoming.find((s) => s.kind === "paid" && !data.sessionStarted(s));
const free = allUpcoming.find((s) => s.kind === "free");
if (!paid || !free) throw new Error("expected both paid and free sessions in window");
// --- HYROX demo attendance cleanup: no simulated strangers ---
// The club has one real member and no sign-ups yet, so HYROX sessions must
// show full capacity and an empty attendee list in fresh state.
let hyroxSeedsClear = true;
for (const a of data.SEED_ACTIVITIES.filter((x) => x.category === "HYROX")) {
  if ("baseBooked" in a) {
    failures++;
    hyroxSeedsClear = false;
    console.error(`FAIL seed activity ${a.id} still simulates demand (baseBooked)`);
  }
}
if (hyroxSeedsClear) console.log("ok  HYROX seeds carry no simulated bookings");
const hyroxUpcoming = allUpcoming.find((s) => s.category === "HYROX" && !data.sessionStarted(s));
if (!hyroxUpcoming) throw new Error("expected an upcoming HYROX session");
if (store.attendeesFor(hyroxUpcoming).length !== 0) {
  failures++;
  console.error("FAIL fresh state should have no HYROX attendees");
} else console.log("ok  fresh state has no HYROX attendees");
if (store.spotsLeft(hyroxUpcoming) !== hyroxUpcoming.capacity) {
  failures++;
  console.error("FAIL HYROX spots should equal capacity with no bookings");
} else console.log("ok  HYROX spots equal capacity with no bookings");
if (store.bookingsForUser("fixture-member").length !== 0) {
  failures++;
  console.error("FAIL fixture member should have no bookings");
} else console.log("ok  fixture member has no bookings");
await check("activity paid (visitor)", () => views.viewActivity(paid.id));
await check("activity free (visitor)", () => views.viewActivity(free.id));
await check("community", () => views.viewCommunity());
const commHtml = views.viewCommunity();
let commOk = true;
for (const link of [
  "#/community/prayers",
  "#/community/fellowship",
  "#/community/meals",
  "#/community/announcements",
  "#/community/about",
]) {
  if (!commHtml.includes(`href="${link}"`)) {
    failures++;
    commOk = false;
    console.error(`FAIL Community missing ${link} card`);
  }
}
if (commOk) console.log("ok  Community shows the five cards");
if (!commHtml.includes("Mission, coaches and leadership")) {
  failures++;
  console.error("FAIL Community About card missing its subtext");
} else console.log("ok  About card sits at the bottom of Community");
if (commHtml.includes("Arnold Wong") || commHtml.includes("Our foundation")) {
  failures++;
  console.error("FAIL leaders/culture should live behind the About card");
} else console.log("ok  leaders & culture live behind the About card");
await check("community > prayers", () => views.viewCommunity("prayers"));
await check("community > fellowship", () => views.viewCommunity("fellowship"));
await check("community > meals", () => views.viewCommunity("meals"));
await check("community > announcements", () => views.viewCommunity("announcements"));
await check("community > about", () => views.viewCommunity("about"));
const commAbout = views.viewCommunity("about");
if (!commAbout.includes("Arnold Wong") || !commAbout.includes("Our foundation")) {
  failures++;
  console.error("FAIL Community About page missing leaders or culture content");
} else console.log("ok  Community About page carries leaders & culture");
if (!views.viewCommunity("prayers").includes('id="form-prayer"')) {
  failures++;
  console.error("FAIL prayers page missing the request form");
} else console.log("ok  prayers page has the request form");
for (const [section, title] of [
  ["prayers", "Prayers."],
  ["fellowship", "Fellowship."],
  ["meals", "Ad-Hoc Meals."],
  ["announcements", "Announcements."],
  ["about", "More than a workout."],
]) {
  if (!views.viewCommunity(section).includes(title)) {
    failures++;
    console.error(`FAIL community > ${section} heading should read "${title}"`);
  }
}
console.log("ok  community sub-page headings title-cased");
if (!views.viewCommunity("nope").includes("Page not found")) {
  failures++;
  console.error("FAIL unknown Community section should 404");
} else console.log("ok  unknown Community section 404s");
await check("account (visitor)", () => views.viewAccount());
await check("apply", () => views.viewApply());
const localApplyHtml = views.viewApply();
if (!localApplyHtml.includes('name="donorId"')) {
  failures++;
  console.error("FAIL apply form missing optional Donor ID field");
} else console.log("ok  apply form collects optional Donor ID");
if (!localApplyHtml.includes('name="age_over_18"') ||
    !localApplyHtml.includes('value="yes"') ||
    !localApplyHtml.includes('value="no"') ||
    localApplyHtml.includes('name="date_of_birth"') ||
    localApplyHtml.includes('name="ageConfirmed"')) {
  failures++;
  console.error("FAIL application should require Yes/No age status and omit DOB");
} else console.log("ok  local apply uses age status instead of DOB");
if (!localApplyHtml.includes("data-minor-only")) {
  failures++;
  console.error("FAIL application guardian fields should be marked minor-only");
} else console.log("ok  application guardian fields are marked minor-only");
await check("checkout (visitor) -> redirect", () => views.viewCheckout(paid.id));
const adminVisitorOut = await views.viewAdmin("approvals");
await check("admin (visitor) -> redirect", () => adminVisitorOut);
await check("notfound", () => views.viewNotFound());

// free activity must never show booking/capacity language
const freeHtml = views.viewActivity(free.id);
for (const banned of ["spots left", "Book & pay", "capacity", "Confirm booking", "Add to bag"]) {
  if (freeHtml.toLowerCase().includes(banned.toLowerCase())) {
    failures++;
    console.error(`FAIL free activity contains banned phrase: "${banned}"`);
  }
}
console.log("ok  free activity has no booking/capacity language");

// paid activity must show price + free/paid badges everywhere
const paidHtml = views.viewActivity(paid.id);
if (!paidHtml.includes("HK$") || !paidHtml.includes("badge paid")) {
  failures++;
  console.error("FAIL paid activity missing price or paid badge");
} else console.log("ok  paid activity shows price + badge");

const paidVisitor = views.viewActivity(paid.id);
if (!paidVisitor.includes("Sign in to book") || !paidVisitor.includes('href="#/account"')) {
  failures++;
  console.error("FAIL paid activity (visitor) should offer a single sign-in CTA");
} else console.log("ok  paid activity (visitor) routes to sign-in");
if (paidVisitor.includes('href="#/apply"')) {
  failures++;
  console.error("FAIL paid activity (visitor) must not link to #/apply");
} else console.log("ok  paid activity (visitor) has no #/apply link");

// --- Application flow ---
const applyRes = store.applyForMembership({
  fullName: "Test Person",
  preferredName: "Test",
  email: "test@example.com",
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageOver18: "yes",
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
});
if (!applyRes.ok) throw new Error("apply failed");
store.signOut();
const pendingSignIn = store.signIn(" TEST@EXAMPLE.COM ");
if (!pendingSignIn.ok || pendingSignIn.user.id !== applyRes.user.id || pendingSignIn.user.status !== "pending") {
  failures++;
  console.error("FAIL a local applicant should be able to sign in again while pending");
} else console.log("ok  local application can sign in again while pending");
if (applyRes.user.isMinor !== false) {
  failures++;
  console.error("FAIL adult application should store isMinor as false");
} else console.log("ok  adult application stores isMinor false");
const applyMinorRes = store.applyForMembership({
  fullName: "Minor Person",
  preferredName: "Minor",
  email: "minor@example.com",
  phone: "+852 2222 3333",
  emergencyName: "Guardian Contact",
  emergencyPhone: "+852 3333 4444",
  heard: "Instagram",
  ageOver18: "no",
  guardianName: "Guardian Person",
  guardianPhone: "+852 5555 6666",
  mediaConsent: false,
  donorId: "",
  indemnity: true,
});
if (!applyMinorRes.ok) throw new Error("minor apply failed");
if (applyMinorRes.user.isMinor !== true) {
  failures++;
  console.error("FAIL minor application should store isMinor as true");
} else console.log("ok  minor application stores isMinor true");
if (applyRes.user.donorId !== null) {
  failures++;
  console.error('FAIL "Not applicable" donor ID should normalize to null');
} else console.log("ok  N/A donor ID at signup normalizes to null");
if (!applyRes.user.indemnityAcceptedAt) {
  failures++;
  console.error("FAIL indemnity acceptance not recorded at application");
} else console.log("ok  indemnity acceptance recorded at application");

// pending users see "My Week" but with free sessions only — paid booking
// is locked until approval, so paid rows would be dead ends
const pendingHome = views.viewHome();
if (!pendingHome.includes("My Week")) {
  failures++;
  console.error('FAIL pending home should show "My Week"');
} else console.log('ok  pending home shows "My Week"');
if (pendingHome.includes("badge paid")) {
  failures++;
  console.error("FAIL pending home must not list paid sessions");
} else console.log("ok  pending home lists no paid sessions");
if (!pendingHome.includes(free.name)) {
  failures++;
  console.error("FAIL pending home should list free sessions");
} else console.log("ok  pending home lists free sessions");
if (!pendingHome.includes("Encouragement of the week")) {
  failures++;
  console.error('FAIL pending home should show "Encouragement of the week"');
} else console.log('ok  pending home shows "Encouragement of the week"');

// donor ID format: last name, hyphen, then 4 or 5 digits (CHUI-08879 / CHUI-8879);
// dash variants and spaces as the separator normalize to a plain hyphen
for (const [input, expect] of [
  ["CHUI-08879", null],
  ["CHUI-8879", null],
  ["chui-8879", null],
  ["CHUI 08879", null],
  ["CHUI—08879", null], // em-dash (phone autocorrect)
  ["CHUI -08879", null],
  ["", null],
  ["Not applicable", null],
  ["CHUI08879", "format"], // no separator — rejected, user re-enters
  ["CHUI-887", "format"],
  ["CHUI-088797", "format"],
  ["CHUI-0887A", "format"],
]) {
  const got = data.donorIdProblem(input);
  if (got !== expect) {
    failures++;
    console.error(`FAIL donorIdProblem(${JSON.stringify(input)}) = ${got}, expected ${expect}`);
  }
}
console.log("ok  donor ID format validation");
await check("account (pending)", () => views.viewAccount());
const pendHtml = views.viewActivity(paid.id);
if (!pendHtml.includes("Booking locked")) {
  failures++;
  console.error("FAIL pending user should see booking locked");
} else console.log("ok  pending user blocked from paid booking");

// --- Admin approval flow ---
store.signIn("admin@example.test");
const adminApprovalsOut = await views.viewAdmin("approvals");
await check("admin approvals", () => adminApprovalsOut);
for (const approvalContract of [
  /Ready for review \(\d+\)/,
  /Awaiting application \(\d+\)/,
  /data-approval-card/,
  /data-applicant-name/,
  /class="decision-error" role="alert" hidden/,
]) {
  if (!approvalContract.test(adminApprovalsOut)) {
    failures++;
    console.error(`FAIL grouped Admin approvals missing ${approvalContract}`);
  }
}
if (!stylesCss.includes(".applicant-awaiting") || !stylesCss.includes("flex-wrap: wrap")) {
  failures++;
  console.error("FAIL Admin approval actions must wrap and Awaiting cards need reduced emphasis");
} else console.log("ok  grouped Admin approvals expose responsive decision UI");
const adminActivitiesOut = await views.viewAdmin("activities");
await check("admin activities", () => adminActivitiesOut);
if (!/href="#\/admin\/activities" class="active" aria-current="page"/.test(adminActivitiesOut) ||
    (adminActivitiesOut.match(/aria-current="page"/g) || []).length !== 1) {
  failures++;
  console.error("FAIL active Admin tab must expose one aria-current page");
} else console.log("ok  active Admin tab exposes aria-current page");
const adminMembersOut = await views.viewAdmin("members");
await check("admin members", () => adminMembersOut);
if (/member-summary|Member status counts|data-change="member-(?:status|role)-filter"/.test(adminMembersOut)) {
  failures++;
  console.error("FAIL Admin members must omit redundant counts and native filter selects");
}
if ((adminMembersOut.match(/class="admin-filter-chips"/g) || []).length !== 2 ||
    !/<fieldset class="admin-filter-group">[\s\S]*?<legend>Status<\/legend>/.test(adminMembersOut) ||
    !/<fieldset class="admin-filter-group">[\s\S]*?<legend>Role<\/legend>/.test(adminMembersOut)) {
  failures++;
  console.error("FAIL Admin member chips must render as labeled semantic groups");
}
const chipCss = stylesCss.match(/\.admin-filter-chips \{[\s\S]*?\n\}/)?.[0] || "";
const chipButtonCss = stylesCss.match(/\.admin-filter-chips button \{[\s\S]*?\n\}/)?.[0] || "";
if (!/overflow-x:\s*auto/.test(chipCss) || !/gap:\s*8px/.test(chipCss) ||
    !/min-height:\s*44px/.test(chipButtonCss) || !/white-space:\s*nowrap/.test(chipButtonCss) ||
    !/button\[aria-pressed="true"\]/.test(stylesCss)) {
  failures++;
  console.error("FAIL Admin member chips need accessible Night Circuit sizing, overflow, and active styles");
}
for (const [key, options] of Object.entries({
  status: [["all", "All"], ["approved", "Approved"], ["pending", "Pending"], ["declined", "Declined"]],
  role: [["all", "All roles"], ["member", "Member"], ["admin", "Admin"], ["superadmin", "Super Admin"]],
})) {
  for (const [value, label] of options) {
    const chip = new RegExp(`<button[^>]*data-action="admin-member-filter"[^>]*data-filter-key="${key}"[^>]*data-filter-value="${value}"[^>]*aria-pressed="${value === "all"}"[^>]*>${label}</button>`);
    if (!chip.test(adminMembersOut)) {
      failures++;
      console.error(`FAIL Admin members missing ${key} chip ${label}`);
    }
  }
}
if (!/Search members/.test(adminMembersOut) || !/(?:Role changes are Super Admin only|Only a Super Admin can change roles)/.test(adminMembersOut) || /Clear filters/.test(adminMembersOut)) {
  failures++;
  console.error("FAIL default Admin member filters must preserve guidance/search and hide Clear filters");
}
views.adminMemberFilters.query = "test admin";
views.adminMemberFilters.status = "approved";
views.adminMemberFilters.role = "admin";
const filteredAdminMembers = await views.viewAdmin("members");
if (!/data-action="admin-member-filters-clear"[^>]*>Clear filters</.test(filteredAdminMembers)) {
  failures++;
  console.error("FAIL active Admin member filters must show Clear filters");
}
if (!filteredAdminMembers.includes("Test Admin") || filteredAdminMembers.includes("Test Member") || filteredAdminMembers.includes("test@example.com")) {
  failures++;
  console.error("FAIL Admin member search/status/role filters must combine truthfully");
} else console.log("ok  Admin member filters combine truthfully");
views.adminMemberFilters.query = "nobody";
const emptyAdminMembers = await views.viewAdmin("members");
if (!/No members match[\s\S]*nobody[\s\S]*Approved[\s\S]*Admin/i.test(emptyAdminMembers)) {
  failures++;
  console.error("FAIL Admin member empty state must name active filters");
} else console.log("ok  Admin member empty state names active filters");
views.adminMemberFilters.query = "";
views.adminMemberFilters.status = "all";
views.adminMemberFilters.role = "all";

// --- Admin Giving (local mode) ---
// Empty local state still surfaces an actionable Create campaign link.
const localEmptyGivingHtml = await views.viewAdmin("giving");
if (!localEmptyGivingHtml.includes("No Giving campaigns yet.") ||
    !localEmptyGivingHtml.includes("+ Create campaign")) {
  failures++;
  console.error("FAIL local empty Admin Giving must show empty state and Create campaign link");
} else console.log("ok  local empty Admin Giving shows empty state and Create campaign link");

// Closed campaigns remain visible while the open-campaign guard lets a
// successor be drafted.
const closedCampaign = {
  id: "closed-fixture-1",
  title: "Closed Local Campaign",
  description: "A previously closed local Giving campaign.",
  goalHKD: 12000,
  fpsId: "1111111",
  fpsPayee: "Island Evangelical Community Church",
  status: "closed",
  creatorProfileId: "fixture-admin",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  publishedAt: "2026-07-02T00:00:00.000Z",
  closedAt: "2026-07-15T00:00:00.000Z",
};
store.campaigns().push(structuredClone(closedCampaign));
const localClosedGivingHtml = await views.viewAdmin("giving");
if (!localClosedGivingHtml.includes("Closed Local Campaign") ||
    !localClosedGivingHtml.includes("closed") ||
    !localClosedGivingHtml.includes("+ Create campaign")) {
  failures++;
  console.error("FAIL local closed Admin Giving must keep history visible and unlock Create campaign");
} else console.log("ok  local closed Admin Giving keeps history visible and unlocks Create campaign");
// Restore baseline so other tests do not observe this fixture campaign.
store.campaigns().pop();

const adminActivityEdit = views.viewAdminActivity("hyrox");
const adminActivityNew = views.viewAdminActivity("new");
await check("admin activity edit", () => adminActivityEdit);
await check("admin activity new", () => adminActivityNew);
if ([adminActivityEdit, adminActivityNew].some((html) => /baseBooked|Simulated existing bookings|simulated demand/i.test(html))) {
  failures++;
  console.error("FAIL Admin activity forms must not render simulated demand controls or copy");
} else console.log("ok  Admin activity forms cannot render simulated demand controls");
const activityDraft = { ...store.getActivity("hyrox"), baseBooked: 17 };
store.saveActivity(activityDraft);
if ("baseBooked" in store.getActivity("hyrox")) {
  failures++;
  console.error("FAIL saveActivity must discard simulated demand input");
} else console.log("ok  saveActivity discards simulated demand input");
const capacityProbe = { id: "runtime-demand-probe", kind: "paid", capacity: 12, baseBooked: 11 };
if (store.spotsLeft(capacityProbe) !== capacityProbe.capacity) {
  failures++;
  console.error("FAIL capacity must be calculated from real confirmed bookings only");
} else console.log("ok  capacity uses real confirmed bookings only");
const newApplicant = store.pendingApplicants().find((u) => u.email === "test@example.com");
store.approveApplicant(newApplicant.id);
console.log("ok  admin approved new applicant");

// --- Member booking + payment flow ---
const signIn = store.signIn("test@example.com");
if (!signIn.ok || signIn.user.status !== "approved") throw new Error("approval did not take effect");
await check("account (new member)", () => views.viewAccount());

// Profile sections are tappable rows that open sub-pages; row faces carry
// a one-line description, not live details
const newMemberAcct = await views.viewAccount();
let cardsOk = true;
for (const link of [
  "#/account/details",
  "#/account/indemnity",
  "#/account/donor",
  "#/account/payments",
  "#/account/privacy",
  "#/account/history",
]) {
  if (!newMemberAcct.includes(`href="${link}"`)) {
    failures++;
    cardsOk = false;
    console.error(`FAIL Profile missing ${link} row`);
  }
}
if (cardsOk) console.log("ok  Profile shows the six section rows");
if (newMemberAcct.includes("#/account/about")) {
  failures++;
  console.error("FAIL About card should have moved to the Community tab");
} else console.log("ok  About card moved off Profile");
for (const sub of [
  "Contact and emergency information",
  "Donor ID and e-receipt details",
  "Bookings, donations and orders",
  "Consent and communication choices",
  "Activity history",
]) {
  if (!newMemberAcct.includes(sub)) {
    failures++;
    console.error(`FAIL Profile row missing subtext "${sub}"`);
  }
}
console.log("ok  Profile rows show descriptive subtexts");
await check("profile > details", () => views.viewAccount("details"));
await check("profile > indemnity", () => views.viewAccount("indemnity"));
await check("profile > donor", () => views.viewAccount("donor"));
await check("profile > payments", () => views.viewAccount("payments"));
await check("profile > privacy", () => views.viewAccount("privacy"));
await check("profile > history", () => views.viewAccount("history"));

// sub-page headings are title-cased to match the row titles
for (const [section, title] of [
  ["details", "Membership Details."],
  ["indemnity", "Health &amp; Liability Indemnity."],
  ["donor", "Donor Profile."],
  ["payments", "Payments &amp; Receipts."],
  ["privacy", "Privacy &amp; Notifications."],
  ["history", "History."],
]) {
  if (!(await views.viewAccount(section)).includes(title)) {
    failures++;
    console.error(`FAIL profile > ${section} heading should read "${title}"`);
  }
}
console.log("ok  sub-page headings title-cased");
if (!(await views.viewAccount("nope")).includes("Page not found")) {
  failures++;
  console.error("FAIL unknown Profile section should 404");
} else console.log("ok  unknown Profile section 404s");

// indemnity: accepted at application -> confirmed on Profile as a single
// "Indemnity confirmed on [date]" line; a member who never accepted sees
// "To be accepted" and can confirm from the sub-page
if (!newMemberAcct.includes("Indemnity confirmed on") || newMemberAcct.includes("Accepted on")) {
  failures++;
  console.error("FAIL Profile should show a single indemnity-confirmed-on-date line");
} else console.log("ok  Profile shows single-line indemnity confirmation");
store.currentUser().indemnityAcceptedAt = null;
if (!(await views.viewAccount()).includes("To be accepted")) {
  failures++;
  console.error('FAIL unaccepted indemnity should read "To be accepted"');
} else console.log('ok  unaccepted indemnity reads "To be accepted"');
if (!(await views.viewAccount("indemnity")).includes("Accept &amp; Confirm")) {
  failures++;
  console.error("FAIL indemnity page missing Accept & Confirm");
} else console.log("ok  indemnity page offers Accept & Confirm");
store.acceptIndemnity(store.currentUser().id);
if (!(await views.viewAccount()).includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL acceptIndemnity did not confirm on Profile");
} else console.log("ok  acceptIndemnity confirms on Profile");
if (!views.viewHome().includes("Nothing booked this week")) {
  failures++;
  console.error('FAIL "My week" should prompt when the member has no bookings');
} else console.log('ok  "My week" empty state prompts to book');
await check("checkout (member)", () => views.viewCheckout(paid.id));
const before = store.spotsLeft(paid);
const { booking, receipt } = store.payForSession(signIn.user.id, paid, "4242");
const after = store.spotsLeft(paid);
if (after !== before - 1) throw new Error(`spots did not decrement (${before} -> ${after})`);
console.log(`ok  payment decremented spots ${before} -> ${after}`);
await check("booking confirmation", () => views.viewBooking(booking.id));
await check("receipt", () => views.viewReceipt(receipt.id));
await check("activity (member, booked)", () => views.viewActivity(paid.id));

// the booked class is badged on Home "My week" and on the Schedule row;
// "My week" shows booked sessions only, so unbooked ones stay out
const homeBooked = views.viewHome();
if (!homeBooked.includes("Booked") || !homeBooked.includes("Midtown 28")) {
  failures++;
  console.error('FAIL home "My week" does not show the booked session');
} else console.log('ok  home "My week" shows the booked session');
if (homeBooked.includes("BFT Causeway Bay") || homeBooked.includes("Just show up")) {
  failures++;
  console.error('FAIL home "My week" shows sessions the member has not booked');
} else console.log('ok  home "My week" hides unbooked sessions');
const WEEK_MS = 7 * 24 * 3600 * 1000;
views.scheduleState.weekOffset = Math.round(
  (data.mondayOf(data.parseISO(paid.dateISO)) - data.mondayOf(data.todayLocal())) / WEEK_MS
);
views.scheduleState.selected = paid.dateISO;
if (!views.viewSchedule().includes("Booked")) {
  failures++;
  console.error("FAIL schedule does not badge the booked session");
} else console.log("ok  schedule badges booked session");
if ((await views.viewAccount()).includes(">Upcoming<")) {
  failures++;
  console.error("FAIL Profile still repeats the upcoming bookings list");
} else console.log("ok  Profile drops redundant upcoming list");

// donor ID skipped at signup ("Not applicable" above) can be added later;
// it lives inside the Donor Profile sub-page, not on the card face
store.updateDonorId(signIn.user.id, "IECC-99999");
if (store.currentUser().donorId !== "IECC-99999") throw new Error("donor ID not saved");
if ((await views.viewAccount()).includes("IECC-99999")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  Profile card face carries no donor details");
if (!(await views.viewAccount("donor")).includes("IECC-99999")) {
  failures++;
  console.error("FAIL donor ID missing from Donor Profile sub-page");
} else console.log("ok  donor ID shows on Donor Profile sub-page");
store.updateDonorId(signIn.user.id, "wong 1234");
if (store.currentUser().donorId !== "WONG-1234") {
  failures++;
  console.error("FAIL donor ID should be stored uppercase with a hyphen");
} else console.log("ok  donor ID stored uppercase with hyphen");

// double booking must be rejected
try {
  store.payForSession(signIn.user.id, paid, "4242");
  failures++;
  console.error("FAIL double booking was allowed");
} catch {
  console.log("ok  double booking rejected");
}

// cancel frees the place and refunds
store.cancelBooking(booking.id);
if (store.spotsLeft(paid) !== before) throw new Error("cancel did not free the spot");
if (store.receiptForBooking(booking.id).status !== "refunded") throw new Error("cancel did not refund");
console.log("ok  cancellation refunds and frees the place");

// past bookings live behind the History card, not inline on the Profile
if ((await views.viewAccount()).includes("booking-card")) {
  failures++;
  console.error("FAIL Profile should not list history inline");
} else console.log("ok  Profile keeps history behind the card");
const histHtml = await views.viewAccount("history");
if (!histHtml.includes("booking-card") || !histHtml.includes("Cancelled")) {
  failures++;
  console.error("FAIL History sub-page missing past bookings");
} else console.log("ok  History sub-page lists past bookings");

// --- Existing local member view ---
store.signIn("member@example.test");
await check("account (existing member)", () => views.viewAccount());
const memberAcct = await views.viewAccount();
if (!(await views.viewAccount("donor")).includes("TEST-1234")) {
  failures++;
  console.error("FAIL existing member donor ID not shown in Donor Profile");
} else console.log("ok  existing member donor ID shown in Donor Profile");
if (memberAcct.includes("TEST-1234")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  existing member card faces carry no donor details");
if (!(await views.viewAccount("payments")).includes("No payments yet")) {
  failures++;
  console.error("FAIL existing member Payments sub-page should be empty");
} else console.log("ok  existing member has no receipts");
if (!memberAcct.includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL existing member should have indemnity confirmed");
} else console.log("ok  existing member indemnity confirmed");
if (!memberAcct.includes('class="kicker">Profile</div>') || memberAcct.includes("Member Profile") || memberAcct.includes("’s training")) {
  failures++;
  console.error('FAIL Profile header should read "Profile" with no name headline');
} else console.log('ok  Profile header reads "Profile"');
if (memberAcct.includes("member@example.test")) {
  failures++;
  console.error("FAIL email should not appear on the Profile face");
} else console.log("ok  Profile face carries no contact details");
const member = store.currentUser();
const memberDetailsSummary = await views.viewAccount("details");
if (!memberDetailsSummary.includes("member@example.test")) {
  failures++;
  console.error("FAIL email missing from Membership Details sub-page");
} else console.log("ok  email lives on Membership Details sub-page");
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
  if (!memberDetailsSummary.includes(label)) {
    failures++;
    console.error(`FAIL Membership Details summary missing ${label}`);
  }
}
if (!memberDetailsSummary.includes("18 or over")) {
  failures++;
  console.error("FAIL Membership Details summary should show adult age status");
} else console.log("ok  Membership Details summary shows adult age status");
if (!memberDetailsSummary.includes("Preferred name</span><strong>Tester</strong>")) {
  failures++;
  console.error("FAIL Membership Details summary should show the local preferred name");
} else console.log("ok  Membership Details summary shows the local preferred name");
if (!memberDetailsSummary.includes('href="#/account/details/edit"')) {
  failures++;
  console.error("FAIL Membership Details summary should link to the edit route");
} else console.log("ok  Membership Details summary links to the edit route");
if (memberDetailsSummary.includes('data-form="membership-details"') || memberDetailsSummary.includes("Date of birth")) {
  failures++;
  console.error("FAIL Membership Details summary should be a card, not the edit form or DOB UI");
} else console.log("ok  Membership Details summary is distinct from the edit form");
const memberDetailsEdit = await views.viewAccount("details", "edit");
if (!memberDetailsEdit.includes('data-form="membership-details"')) {
  failures++;
  console.error("FAIL Membership Details edit route should render the membership-details form");
} else console.log("ok  Membership Details edit route renders the membership-details form");
if (!memberDetailsEdit.includes("Save changes")) {
  failures++;
  console.error("FAIL Membership Details edit route missing Save changes");
}
if (!memberDetailsEdit.includes(member.fullName) || !memberDetailsEdit.includes(member.email)) {
  failures++;
  console.error("FAIL Membership Details edit route should show read-only identity rows");
}
if (!memberDetailsEdit.includes(`value="${member.phone}"`)) {
  failures++;
  console.error("FAIL Membership Details edit route should prefill the mobile number");
}
if (!/name="age_over_18" value="yes"[^>]*checked/.test(memberDetailsEdit)) {
  failures++;
  console.error("FAIL Membership Details edit route should prefill the adult age radio");
}
if (!memberDetailsEdit.includes("data-minor-only") || !memberDetailsEdit.includes("hidden")) {
  failures++;
  console.error("FAIL Membership Details edit route should keep the guardian block conditional");
}
if (!memberDetailsEdit.includes(`value="${member.emergencyName}"`) || !memberDetailsEdit.includes(`value="${member.emergencyPhone}"`)) {
  failures++;
  console.error("FAIL Membership Details edit route should prefill emergency contact fields");
}
if (memberDetailsEdit.includes('name="photo_consent"')) {
  failures++;
  console.error("FAIL Membership Details edit route should exclude photo consent controls");
} else console.log("ok  Membership Details edit route excludes photo consent controls");
if (!memberDetailsEdit.includes('name="preferred_name" value="Tester"')) {
  failures++;
  console.error("FAIL Membership Details edit route should prefill the local preferred name");
} else console.log("ok  Membership Details edit route prefills the local preferred name");
member.mediaConsent = true;
member.whatsappReminders = false;
member.emailReceipts = true;
member.communityNews = false;
member.privacyAcceptedAt = "2026-08-05T01:05:00.000Z";
const memberPrivacySummary = await views.viewAccount("privacy");
for (const label of [
  "Photo/video consent",
  "Privacy policy accepted",
  "WhatsApp session reminders",
  "Email receipts",
  "Community news",
]) {
  if (!memberPrivacySummary.includes(label)) {
    failures++;
    console.error(`FAIL Privacy summary missing ${label}`);
  }
}
if (!memberPrivacySummary.includes("Allowed")) {
  failures++;
  console.error("FAIL Privacy summary should show Allowed when photo consent is true");
}
if (!memberPrivacySummary.includes("5 Aug 2026")) {
  failures++;
  console.error("FAIL Privacy summary should show the accepted privacy date");
}
if (!memberPrivacySummary.includes('>Off<') || !memberPrivacySummary.includes('>On<')) {
  failures++;
  console.error("FAIL Privacy summary should show mixed On/Off preferences");
}
if (!memberPrivacySummary.includes('href="#/account/privacy/edit"')) {
  failures++;
  console.error("FAIL Privacy summary should link to the edit route");
}
if (memberPrivacySummary.includes('data-form="privacy-preferences"')) {
  failures++;
  console.error("FAIL Privacy summary should be a card, not the edit form");
} else console.log("ok  Privacy summary is distinct from the edit form");
const memberPrivacyEdit = await views.viewAccount("privacy", "edit");
if (!memberPrivacyEdit.includes('data-form="privacy-preferences"')) {
  failures++;
  console.error("FAIL Privacy edit route should render the privacy-preferences form");
} else console.log("ok  Privacy edit route renders the privacy-preferences form");
if (!memberPrivacyEdit.includes('href="#/account/privacy"')) {
  failures++;
  console.error("FAIL Privacy edit route should link back to #/account/privacy");
}
if (!memberPrivacyEdit.includes("Privacy policy accepted") || !memberPrivacyEdit.includes("5 Aug 2026")) {
  failures++;
  console.error("FAIL Privacy edit route should show privacy acceptance read-only");
}
for (const name of ["photo_consent", "whatsapp_reminders", "email_receipts", "community_news"]) {
  if (!memberPrivacyEdit.includes(`name="${name}"`)) {
    failures++;
    console.error(`FAIL Privacy edit route missing ${name}`);
  }
}
if (!/name="photo_consent"[^>]*checked/.test(memberPrivacyEdit)) {
  failures++;
  console.error("FAIL Privacy edit route should prefill checked photo consent");
}
if (/name="whatsapp_reminders"[^>]*checked/.test(memberPrivacyEdit)) {
  failures++;
  console.error("FAIL Privacy edit route should leave unchecked WhatsApp reminders off");
}
if (!/name="email_receipts"[^>]*checked/.test(memberPrivacyEdit)) {
  failures++;
  console.error("FAIL Privacy edit route should prefill checked email receipts");
}
if (/name="community_news"[^>]*checked/.test(memberPrivacyEdit)) {
  failures++;
  console.error("FAIL Privacy edit route should leave unchecked community news off");
}
if (!memberPrivacyEdit.includes("Save changes")) {
  failures++;
  console.error("FAIL Privacy edit route missing Save changes");
}
member.mediaConsent = false;
member.whatsappReminders = undefined;
member.emailReceipts = undefined;
member.communityNews = undefined;
const memberPrivacyFallback = await views.viewAccount("privacy");
if ((memberPrivacyFallback.match(/>Off</g) || []).length < 3) {
  failures++;
  console.error("FAIL Privacy summary should default omitted preference properties to Off");
} else {
  console.log("ok  Privacy summary defaults omitted preference properties to Off");
}
await check("home (member)", () => views.viewHome());
const memberHome = views.viewHome();
if (!memberHome.includes("Nothing booked this week")) {
  failures++;
  console.error('FAIL "My week" should be empty for the fixture member');
} else console.log('ok  "My week" is empty for the fixture member');
if (!memberHome.includes("Encouragement of the week")) {
  failures++;
  console.error('FAIL approved home should show "Encouragement of the week"');
} else console.log('ok  approved home shows "Encouragement of the week"');

const memberApplication = await store.getMyApplication();
if (
  !memberApplication ||
  memberApplication.profile_id !== member.id ||
  memberApplication.mobile !== member.phone ||
  memberApplication.is_minor !== !!member.isMinor ||
  memberApplication.waiver_accepted_at !== member.indemnityAcceptedAt ||
  memberApplication.privacy_accepted_at !== member.privacyAcceptedAt ||
  memberApplication.submitted_at !== member.appliedAt
) {
  failures++;
  console.error("FAIL getMyApplication should map the local member into the live application shape");
} else {
  console.log("ok  getMyApplication maps the local member into application shape");
}
const membershipBefore = await store.getMyApplication();
const updatedMembership = await store.updateMyMembershipDetails({
  mobile: "+852 9000 0000",
  age_over_18: "yes",
  emergency_name: "Alex Runner",
  emergency_phone: "+852 9111 1111",
  heard_source: "friend",
  heard_detail: "Run club",
  preferred_name: "Riley",
});
if (
  updatedMembership.mobile !== "+852 9000 0000" ||
  updatedMembership.is_minor !== false ||
  updatedMembership.guardian_name !== null ||
  updatedMembership.guardian_phone !== null ||
  updatedMembership.emergency_name !== "Alex Runner" ||
  updatedMembership.emergency_phone !== "+852 9111 1111" ||
  updatedMembership.heard_source !== "friend" ||
  updatedMembership.heard_detail !== "Run club" ||
  updatedMembership.preferred_name !== "Riley" ||
  updatedMembership.photo_consent !== membershipBefore.photo_consent ||
  store.currentUser().phone !== "+852 9000 0000"
) {
  failures++;
  console.error("FAIL updateMyMembershipDetails should update only membership fields locally");
} else {
  console.log("ok  updateMyMembershipDetails updates only membership fields locally");
}
const updatedPrivacy = await store.updateMyPrivacyPreferences({
  photo_consent: false,
  whatsapp_reminders: true,
  email_receipts: false,
  community_news: true,
});
if (
  updatedPrivacy.photo_consent !== false ||
  updatedPrivacy.whatsapp_reminders !== true ||
  updatedPrivacy.email_receipts !== false ||
  updatedPrivacy.community_news !== true ||
  updatedPrivacy.mobile !== "+852 9000 0000" ||
  store.currentUser().mediaConsent !== false ||
  store.currentUser().whatsappReminders !== true ||
  store.currentUser().emailReceipts !== false ||
  store.currentUser().communityNews !== true
) {
  failures++;
  console.error("FAIL updateMyPrivacyPreferences should update only privacy fields locally");
} else {
  console.log("ok  updateMyPrivacyPreferences updates only privacy fields locally");
}
const existingIndemnity = member.indemnityAcceptedAt;
const preservedIndemnity = await store.acceptMyIndemnity();
if (preservedIndemnity !== existingIndemnity) {
  failures++;
  console.error("FAIL acceptMyIndemnity should preserve an existing local timestamp");
} else {
  console.log("ok  acceptMyIndemnity preserves an existing local timestamp");
}
const realNow = Date.now;
Date.now = () => 1780000000000;
store.currentUser().indemnityAcceptedAt = null;
const writtenIndemnity = await store.acceptMyIndemnity();
Date.now = realNow;
if (writtenIndemnity !== 1780000000000 || store.currentUser().indemnityAcceptedAt !== 1780000000000) {
  failures++;
  console.error("FAIL acceptMyIndemnity should write one local timestamp when absent");
} else {
  console.log("ok  acceptMyIndemnity writes one local timestamp when absent");
}
// community: prayer request records locally (no public reader by design)
const prayer = store.recordPrayer({ userId: member.id, name: member.fullName, request: "Smoke test request" });
if (!prayer.id || prayer.request !== "Smoke test request") throw new Error("prayer not recorded");
console.log("ok  prayer request records locally");

// --- ICS generation ---
const ics = data.buildICS(free);
if (!ics.includes("BEGIN:VEVENT") || !ics.includes(free.name)) throw new Error("bad ICS");
console.log("ok  ICS generation");

// --- v7 migration: legacy hyphen-less donor IDs get repaired on load ---
store.resetLocalData();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 6;
  raw.users = [
    { id: "legacy-one", email: "legacy-one@example.test", donorId: "TEST1234" },
    { id: "legacy-two", email: "legacy-two@example.test", donorId: "not a real id" },
  ];
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const fixed = store.allUsers().find((u) => u.id === "legacy-one").donorId;
  if (fixed !== "TEST-1234") {
    failures++;
    console.error(`FAIL v7 migration should repair TEST1234 -> TEST-1234, got ${fixed}`);
  } else console.log("ok  v7 migration inserts the missing hyphen");
  const cleared = store.allUsers().find((u) => u.id === "legacy-two").donorId;
  if (cleared !== null) {
    failures++;
    console.error(`FAIL v7 migration should clear unrecognizable donor ID, got ${cleared}`);
  } else console.log("ok  v7 migration clears unrecognizable donor ID");
}

// --- v9 migration: age status + notification preferences ---
store.resetLocalData();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 8;
  raw.users = [{ id: "legacy-member", email: "legacy-member@example.test", appliedAt: 1234 }];
  const legacyUser = raw.users[0];
  delete legacyUser.isMinor;
  delete legacyUser.privacyAcceptedAt;
  delete legacyUser.whatsappReminders;
  delete legacyUser.emailReceipts;
  delete legacyUser.communityNews;
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const migrated = store.allUsers().find((u) => u.id === "legacy-member");
  if (
    migrated.isMinor !== false ||
    migrated.whatsappReminders !== false ||
    migrated.emailReceipts !== false ||
    migrated.communityNews !== false ||
    migrated.privacyAcceptedAt !== migrated.appliedAt
  ) {
    failures++;
    console.error("FAIL v9 migration should backfill age, privacy and notification defaults");
  } else {
    console.log("ok  v9 migration backfills age, privacy and notification defaults");
  }

  const migrationPath = fileURLToPath(
    new URL("../supabase/migrations/20260805000005_profile_preferences_age_status.sql", import.meta.url)
  );
  const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const dropDobNotNullAt = migrationSql.indexOf("alter column date_of_birth drop not null");
  const clearDobAt = migrationSql.indexOf("update public.applications\nset date_of_birth = null;");
  if (
    !migrationSql.includes("add column if not exists whatsapp_reminders boolean not null default false") ||
    !migrationSql.includes("add column if not exists email_receipts boolean not null default false") ||
    !migrationSql.includes("add column if not exists community_news boolean not null default false") ||
    !migrationSql.includes("set is_minor = case") ||
    !migrationSql.includes("when date_of_birth is null then is_minor") ||
    !migrationSql.includes("else date_of_birth > (current_date - interval '18 years')::date") ||
    clearDobAt < 0 ||
    dropDobNotNullAt < 0 ||
    dropDobNotNullAt > clearDobAt
  ) {
    failures++;
    console.error("FAIL v9 migration SQL should add defaults, backfill age and clear DOB");
  } else {
    console.log("ok  v9 migration SQL adds defaults, backfills age and clears DOB");
  }
}

// --- v11 migration: exact demo identities removed, genuine v10 data preserved ---
store.resetLocalData();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  const historicalIdentities = [
    ["u-super", "owner@itc.hk"],
    ["u-admin", "admin@itc.hk"],
    ["u-member", "member@itc.hk"],
    ["u-pend-1", "marco.santos@example.com"],
    ["u-pend-2", "jenny.wu@example.com"],
  ];
  const idMatchedUsers = historicalIdentities.map(([id], index) => ({
    id,
    email: `historical-id-${index}@example.test`,
  }));
  const emailMatchedUsers = historicalIdentities.map(([, email], index) => ({
    id: `historical-email-${index}`,
    email: ` ${email.toUpperCase()} `,
  }));
  const removedUsers = [...idMatchedUsers, ...emailMatchedUsers];
  const preservedUsers = [
    { id: "real-member", email: "real-member@example.test", donorId: "REAL-1234" },
    { id: "u-admin-extra", email: "admin@itc.hk.example.test" },
  ];
  raw.version = 10;
  raw.sessionUserId = "u-pend-2";
  raw.users = [...removedUsers, ...preservedUsers];
  raw.bookings = [
    ...removedUsers.map((user, index) => ({ id: `historical-booking-${index}`, userId: user.id })),
    ...preservedUsers.map((user, index) => ({ id: `preserved-booking-${index}`, userId: user.id })),
  ];
  raw.receipts = [
    ...removedUsers.map((user, index) => ({
      id: `historical-receipt-${index}`,
      bookingId: `historical-booking-${index}`,
      userId: user.id,
    })),
    ...preservedUsers.map((user, index) => ({
      id: `preserved-receipt-${index}`,
      bookingId: `preserved-booking-${index}`,
      userId: user.id,
    })),
  ];
  raw.prayers = [{ id: "real-prayer", userId: "real-member", request: "Preserve this" }];
  raw.activities[0].baseBooked = 7;
  raw.activities[0].location = "Genuine admin edit";
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  const preservedIds = new Set(preservedUsers.map((user) => user.id));
  const preserved = migrated.users.length === preservedUsers.length
    && migrated.users.every((user) => preservedIds.has(user.id))
    && migrated.bookings.length === preservedUsers.length
    && migrated.bookings.every((booking) => preservedIds.has(booking.userId))
    && migrated.receipts.length === preservedUsers.length
    && migrated.receipts.every((receipt) => preservedIds.has(receipt.userId))
    && migrated.prayers.length === 1 && migrated.prayers[0].id === "real-prayer"
    && migrated.activities[0].location === "Genuine admin edit";
  const cleaned = migrated.version === 12 && migrated.sessionUserId === null
    && migrated.activities.every((activity) => !("baseBooked" in activity));
  if (!preserved || !cleaned) {
    failures++;
    console.error("FAIL v11 migration should remove exact demo data and preserve genuine v10 records");
  } else console.log("ok  v11 migration removes exact demo data and preserves genuine v10 records");
}

// Every collection, including prayers, is normalized before migrations and
// before a current-version early return.
for (const version of [0, 10, 11]) {
  store.resetLocalData();
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = version;
  for (const key of ["users", "activities", "bookings", "receipts", "prayers"]) raw[key] = null;
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const normalized = JSON.parse(mem.get("itc.prototype.v1"));
  if (["users", "activities", "bookings", "receipts", "prayers"].some((key) => !Array.isArray(normalized[key]))) {
    failures++;
    console.error(`FAIL v${version} should normalize every state collection`);
  } else console.log(`ok  v${version} normalizes every state collection`);
}

// --- viewAccount live-mode branch ---
// The live-mode HTML is rendered when isLive() is true at viewAccount
// call time. We can't re-route views.js's captured config import to a
// bustered version (cache busting only affects the top-level URL), so we
// verify the live-mode HTML source exists in views.js and that the live
// config evaluates correctly when imported fresh. The live render path
// is verified manually against a deployed staging environment.
const _savedWindow = globalThis.window;
globalThis.window = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  supabase: { createClient: () => ({}) },
};
const cfgLive = await import("./js/config.js?v=live");
if (!cfgLive.isLive()) {
  failures++;
  console.error("FAIL config (live): isLive() should be true with stubbed window");
} else {
  console.log("ok  config (live): isLive() is true with stubbed window");
}
globalThis.window = _savedWindow || undefined;

const viewsSrc = readFileSync(resolve(__dirname, "js/views.js"), "utf8");
if (!viewsSrc.includes("Continue with Google")) {
  failures++;
  console.error("FAIL views.js: should contain 'Continue with Google' string");
} else {
  console.log("ok  views.js: contains Continue with Google (live-mode HTML source)");
}
if (!viewsSrc.includes("accountVisitorLive")) {
  failures++;
  console.error("FAIL views.js: should contain accountVisitorLive function");
} else {
  console.log("ok  views.js: contains accountVisitorLive function");
}
if (viewsSrc.includes("Please sign in first")) {
  failures++;
  console.error("FAIL views.js: the 'Please sign in first' wall should be gone");
} else {
  console.log("ok  views.js: no 'Please sign in first' wall");
}
if (!viewsSrc.includes('if (!cu) return { redirect: "#/account" };')) {
  failures++;
  console.error("FAIL views.js: viewApplyLive should redirect visitors to #/account");
} else {
  console.log("ok  views.js: viewApplyLive redirects visitors to #/account");
}
if (!viewsSrc.includes("Signed in as")) {
  failures++;
  console.error("FAIL views.js: apply form should show the signed-in Google identity");
} else {
  console.log("ok  views.js: apply form shows the signed-in identity");
}

const appSrc = readFileSync(resolve(__dirname, "js/app.js"), "utf8");
const activityStoreRuntimeSrc = readFileSync(resolve(__dirname, "js/store.js"), "utf8")
  .split("// --- Activities & sessions")[1] || "";
if (viewsSrc.includes("baseBooked") || appSrc.includes("baseBooked") || activityStoreRuntimeSrc.includes("baseBooked")) {
  failures++;
  console.error("FAIL runtime activity source must not support baseBooked");
} else console.log("ok  runtime activity source has no baseBooked support");
const indexSrc = readFileSync(resolve(__dirname, "index.html"), "utf8");
const stylesSrc = readFileSync(resolve(__dirname, "styles.css"), "utf8");
const feedbackChecks = [
  [indexSrc.includes('id="route-loader"') && indexSrc.includes('role="status"'), "semantic delayed route loader"],
  [appSrc.includes("renderWithFeedback") && appSrc.includes('setAttribute("aria-busy", "true")'), "route busy wrapper"],
  [appSrc.includes("withBusyControl") && appSrc.includes("const controlBusy = new WeakSet()"), "duplicate-safe busy control helper"],
  [appSrc.includes("showFieldError") && appSrc.includes('alert.setAttribute("role", "alert")'), "alerting field-error helper"],
  [appSrc.includes('field.setAttribute("aria-invalid", "true")') && appSrc.includes("field.focus()"), "invalid field semantics and focus"],
  [appSrc.includes('document.addEventListener("input"'), "stale field-error clearing"],
  [appSrc.includes('el.setAttribute("role", isErr ? "alert" : "status")'), "toast urgency semantics"],
  [stylesSrc.includes(".route-loader"), "route loader styling"],
];
for (const [passed, label] of feedbackChecks) {
  if (!passed) {
    failures++;
    console.error(`FAIL shared feedback missing ${label}`);
  } else console.log(`ok  shared feedback has ${label}`);
}
const compactTypeContracts = [
  [/\.bottom-nav a\s*\{[^}]*font-size:\s*([\d.]+)px/s, 11, "bottom navigation labels"],
  [/\.field label\s*\{[^}]*font-size:\s*([\d.]+)px/s, 12, "form labels"],
  [/\.session-row time small\s*\{[^}]*font-size:\s*([\d.]+)px/s, 12, "session time metadata"],
  [/\.session-row \.spots\s*\{[^}]*font-size:\s*([\d.]+)px/s, 12, "session capacity metadata"],
  [/\.day-cell\s*\{[^}]*font-size:\s*([\d.]+)px/s, 11, "schedule day labels"],
  [/\.meta-grid small\s*\{[^}]*font-size:\s*([\d.]+)px/s, 12, "activity metadata labels"],
  [/\.member-row \.who span\s*\{[^}]*font-size:\s*([\d.]+)px/s, 12, "member identity metadata"],
];
for (const [pattern, minimum, label] of compactTypeContracts) {
  const size = Number(stylesSrc.match(pattern)?.[1]);
  if (!size || size < minimum) {
    failures++;
    console.error(`FAIL ${label} must be at least ${minimum}px`);
  } else console.log(`ok  ${label} meets the ${minimum}px minimum`);
}
if (!/\.route-loader\s*\{[^}]*top:\s*70px;[^}]*background:\s*var\(--surface-3\);/s.test(stylesSrc) ||
    /\.route-loader\s*\{[^}]*(?:--top-h|--panel)/s.test(stylesSrc)) {
  failures++;
  console.error("FAIL route loader must use defined, visible position and background values");
} else console.log("ok  route loader uses visible, defined position and background values");
for (const label of ["Connecting…", "Signing out…", "Submitting…", "Saving…", "Confirming…", "Processing…"]) {
  if (!appSrc.includes(label)) {
    failures++;
    console.error(`FAIL app.js missing exact busy label ${label}`);
  }
}
for (const [html, fieldId, errorId] of [
  [await views.viewAccount(), "signin-email", "signin-error"],
  [localApplyHtml, "ap-donor", "apply-error"],
  [views.viewCommunity("prayers"), "pr-text", "prayer-error"],
]) {
  if (!html.includes(`id="${fieldId}"`) || !html.includes(`id="${errorId}"`)) {
    failures++;
    console.error(`FAIL rendered form must pair #${fieldId} with #${errorId}`);
  }
}
const signoutBlock = appSrc.match(/case "signout":([\s\S]*?)break;/);
if (!signoutBlock || !signoutBlock[1].includes('location.hash = "#/account"')) {
  failures++;
  console.error("FAIL app.js: signout should navigate to #/account");
} else {
  console.log("ok  app.js: signout navigates to #/account");
}
if (!signoutBlock || !signoutBlock[1].includes("signOutLive")) {
  failures++;
  console.error("FAIL app.js: signout should clear the live Supabase session via signOutLive");
} else {
  console.log("ok  app.js: signout clears the live session via signOutLive");
}
if (!appSrc.includes('"#access_token"')) {
  failures++;
  console.error("FAIL app.js: router should ignore Supabase #access_token hashes");
} else {
  console.log("ok  app.js: router ignores #access_token hashes");
}
if (!/SIGNED_IN[\s\S]{0,300}location\.hash = "#\/home"/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: SIGNED_IN should route to #/home");
} else {
  console.log("ok  app.js: SIGNED_IN routes to #/home");
}
for (const removed of ["demo-signin", "reset-demo", "admin demo profile", "one-tap demo", "seeded email"]) {
  if (viewsSrc.toLowerCase().includes(removed) || appSrc.toLowerCase().includes(removed)) {
    failures++;
    console.error(`FAIL runtime source still contains removed demo UI/copy: ${removed}`);
  }
}
console.log("ok  runtime source contains no removed demo controls or copy");
if (!appSrc.includes("No account found for that email. Apply for membership below first.")) {
  failures++;
  console.error("FAIL local not-found sign-in copy should direct the visitor to apply");
} else console.log("ok  local not-found sign-in copy directs the visitor to apply");

// --- Live auth: home CTA + short application form ---
const homeFn = viewsSrc.match(/export function viewHome\(\) \{[\s\S]*?\n\}/);
if (!homeFn || !homeFn[0].includes('data-action="sign-in-google"')) {
  failures++;
  console.error("FAIL views.js: visitor home CTA should trigger Google sign-in directly in live mode");
} else {
  console.log("ok  views.js: visitor home CTA triggers Google sign-in directly");
}
if (!viewsSrc.includes('applyField("text", "mobile", "Mobile / WhatsApp number", true)')) {
  failures++;
  console.error("FAIL views.js: apply form should require mobile");
} else {
  console.log("ok  views.js: apply form requires mobile");
}
if (!viewsSrc.includes('applyField("text", "emergency_name", "Emergency contact name", true)')) {
  failures++;
  console.error("FAIL views.js: apply form should require emergency contact name");
} else {
  console.log("ok  views.js: apply form requires emergency contact name");
}
const applyFn = viewsSrc.match(/function applyFormHtml\(cu\) \{[\s\S]*?\n\}/);
if (!applyFn || !applyFn[0].includes('name="waiver"') || !applyFn[0].includes('name="guidelines"') || !applyFn[0].includes('name="privacy"')) {
  failures++;
  console.error("FAIL views.js: apply form should carry waiver, privacy and guidelines checkboxes");
} else {
  console.log("ok  views.js: apply form carries waiver, privacy and guidelines checkboxes");
}
if (!readFileSync(resolve(__dirname, "js/store.js"), "utf8").includes("waiver_accepted_at: new Date()")) {
  failures++;
  console.error("FAIL store.js: saveMyApplication should record waiver/privacy/guidelines acceptance");
} else {
  console.log("ok  store.js: saveMyApplication records waiver/privacy/guidelines acceptance");
}

// the RLS recursion fix must stay: profiles policies go through a
// SECURITY DEFINER role function, never a self-referential subquery
const rlsFix = readFileSync(resolve(__dirname, "../supabase/migrations/20260805000002_fix_profiles_rls_recursion.sql"), "utf8");
if (!rlsFix.includes("security definer") || !rlsFix.includes("current_user_role")) {
  failures++;
  console.error("FAIL migrations: profiles RLS recursion fix (current_user_role, security definer) missing");
} else {
  console.log("ok  migrations: profiles RLS recursion fix present");
}
if (!readFileSync(resolve(__dirname, "js/store.js"), "utf8").includes("profiles fetch failed")) {
  failures++;
  console.error("FAIL store.js: profile fetch errors must be logged, never swallowed");
} else {
  console.log("ok  store.js: profile fetch errors are logged");
}

// --- Live roles + nav mapping ---
if (viewsSrc.includes('["admin", "superadmin"]')) {
  failures++;
  console.error("FAIL views.js: admin role checks must include super_admin (live role)");
} else {
  console.log("ok  views.js: admin role checks include super_admin");
}
if (!/NAV_FOR = \{[\s\S]*?notifications: ""/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: Notifications must not activate a bottom tab");
} else {
  console.log("ok  app.js: Notifications route leaves bottom tabs inactive");
}
if (!/arg === "users"\s*\?\s*\{ redirect: "#\/admin\/members" \}/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: #/admin/users should redirect to canonical #/admin/members");
} else {
  console.log("ok  app.js: #/admin/users redirects to canonical Members tab");
}
if (viewsSrc.includes("viewAdminUsers") || /class="(?:row|avatar)"/.test(adminMembersOut)) {
  failures++;
  console.error("FAIL legacy Admin users row/avatar UI should be removed");
}

// --- Admin entry consistency, live profile editing, weekly encouragement ---
if (!/:\s*await views\.viewAdmin\(arg \|\| "approvals"\)/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: bare #/admin should render the tabbed admin page (same as Admin Tools)");
} else {
  console.log("ok  app.js: Admin Tools and the Admin tab land on the same page");
}
if (viewsSrc.includes('href: "#/admin/users"')) {
  failures++;
  console.error("FAIL views.js: bottom navigation must not contain the legacy Admin users link");
} else {
  console.log("ok  views.js: bottom navigation has no legacy Admin users link");
}
const storeSrc2 = readFileSync(resolve(__dirname, "js/store.js"), "utf8");
if (!storeSrc2.includes("listApprovalCandidates")) {
  failures++;
  console.error("FAIL store.js: live approvals need listApprovalCandidates");
} else {
  console.log("ok  store.js: listApprovalCandidates present");
}
if (!viewsSrc.includes("adminApprovals(await store.listApprovalCandidates())")) {
  failures++;
  console.error("FAIL views.js: approvals tab should render approval candidates, not submitted applications only");
} else {
  console.log("ok  views.js: approvals tab reads approval candidates");
}
const approvalCaseCount = (appSrc.match(/case "approve"/g) || []).length;
if (approvalCaseCount !== 1) {
  failures++;
  console.error(`FAIL app.js: admin approvals should have exactly one case "approve" block, found ${approvalCaseCount}`);
} else {
  console.log('ok  app.js: admin approvals have one case "approve" block');
}
if (!/case "approve":\s*case "decline":\s*\{[\s\S]*await store\.decideApplication\(el\.dataset\.user, decision\)/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: approve/decline must share one decideApplication handler");
} else {
  console.log("ok  app.js: approve/decline share decideApplication");
}
if (!appSrc.includes('const decision = action === "approve" ? "member" : "declined";')) {
  failures++;
  console.error("FAIL app.js: decline must map to the declined decision");
} else {
  console.log("ok  app.js: decline maps to declined");
}
if (!appSrc.includes("await views.viewAccount(")) {
  failures++;
  console.error("FAIL app.js: account route should await (live details view is async)");
} else {
  console.log("ok  app.js: account route is awaited");
}
if (!viewsSrc.includes('data-form="membership-details"') || !viewsSrc.includes("accountDetailsEdit")) {
  failures++;
  console.error("FAIL views.js: Membership Details summary/edit workflow missing");
} else {
  console.log("ok  views.js: Membership Details summary/edit workflow present");
}
if (!viewsSrc.includes('data-form="privacy-preferences"') || !viewsSrc.includes("accountPrivacyEdit")) {
  failures++;
  console.error("FAIL views.js: Privacy summary/edit workflow missing");
} else {
  console.log("ok  views.js: Privacy summary/edit workflow present");
}
if (!appSrc.includes("await views.viewAccount(arg, arg2)")) {
  failures++;
  console.error("FAIL app.js: account route should pass arg2 so #/account/details/edit can render edit mode");
} else {
  console.log("ok  app.js: account route passes arg2 to viewAccount");
}
const membershipSubmitBlock = appSrc.match(/if \(form\.dataset\.form === "membership-details"\) \{[\s\S]*?\n  \}\n\n  switch \(form\.id\)/);
if (!membershipSubmitBlock || !membershipSubmitBlock[0].includes('location.hash = "#/account/details"')) {
  failures++;
  console.error("FAIL app.js: successful membership saves should return to #/account/details");
} else {
  console.log("ok  app.js: successful membership saves return to #/account/details");
}
const privacySubmitBlock = appSrc.match(/if \(form\.dataset\.form === "privacy-preferences"\) \{[\s\S]*?\n  \}\n\n  switch \(form\.id\)/);
if (!privacySubmitBlock || !privacySubmitBlock[0].includes('location.hash = "#/account/privacy"')) {
  failures++;
  console.error("FAIL app.js: successful privacy saves should return to #/account/privacy");
} else {
  console.log("ok  app.js: successful privacy saves return to #/account/privacy");
}
const selfEditMigration = existsSync(
  resolve(__dirname, "../supabase/migrations/20260805000003_self_update_application.sql")
)
  ? readFileSync(resolve(__dirname, "../supabase/migrations/20260805000003_self_update_application.sql"), "utf8")
  : "";
if (!selfEditMigration.includes('drop policy "self update application"')) {
  failures++;
  console.error("FAIL migrations: members must be able to update their own application (not just pending)");
} else {
  console.log("ok  migrations: self update application allowed post-approval");
}
if (!viewsSrc.includes('${user ? encouragement : ""}')) {
  failures++;
  console.error('FAIL views.js: home encouragement should be gated by a signed-in user');
} else {
  console.log('ok  views.js: home encouragement is gated by a signed-in user');
}

// --- only pending users are pushed to the application form ---
const maybeRedirect = appSrc.match(/export async function maybeRedirectToApply\(\) \{[\s\S]*?\n\}/);
if (!maybeRedirect || !maybeRedirect[0].includes('cu.role !== "pending"')) {
  failures++;
  console.error("FAIL app.js: maybeRedirectToApply should only push pending users without an application to #/apply");
} else {
  console.log("ok  app.js: maybeRedirectToApply is pending-only");
}
if (!viewsSrc.includes('if (cu.role !== "pending")')) {
  failures++;
  console.error("FAIL views.js: viewApplyLive should show the form only to pending users");
} else {
  console.log("ok  views.js: viewApplyLive is pending-only");
}
if (!viewsSrc.includes("Application details unavailable")) {
  failures++;
  console.error("FAIL views.js: missing live applications should render an unavailable card, not redirect or fabricate details");
} else {
  console.log("ok  views.js: missing live applications render unavailable cards");
}
if (!/window\.addEventListener\("hashchange",[\s\S]*await renderWithFeedback\(\)[\s\S]*toast\(/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: hashchange should await render failures and toast them");
} else {
  console.log("ok  app.js: hashchange awaits render failures and toasts them");
}
if (!/await renderWithFeedback\(\);[\s\S]*await maybeRedirectToApply\(\);/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: boot/auth flows should await feedback-wrapped render and maybeRedirectToApply");
} else {
  console.log("ok  app.js: boot/auth flows await feedback-wrapped render and maybeRedirectToApply");
}
if (!appSrc.includes('out = u && u.status === "approved" ? { redirect: "#/account" } : await views.viewApply();')) {
  failures++;
  console.error("FAIL app.js: apply route should redirect approved users to #/account");
} else {
  console.log("ok  app.js: apply route redirects approved users to #/account");
}
const restorePendingInsert = existsSync(resolve(__dirname, "../supabase/migrations/20260805000006_restore_pending_self_insert_application.sql"))
  ? readFileSync(resolve(__dirname, "../supabase/migrations/20260805000006_restore_pending_self_insert_application.sql"), "utf8")
  : "";
if (
  !restorePendingInsert.includes('drop policy if exists "self insert application"') ||
  !restorePendingInsert.includes("auth.uid() = profile_id") ||
  !restorePendingInsert.includes("(select role from public.profiles where id = auth.uid()) = 'pending'")
) {
  failures++;
  console.error("FAIL migrations: self insert application should be restored to pending-only ownership checks");
} else {
  console.log("ok  migrations: self insert application is restored to pending-only ownership checks");
}
const adminDecisionSql = readFileSync(
  new URL("../supabase/migrations/20260805000007_admin_application_decisions.sql", import.meta.url),
  "utf8"
);
if (!adminDecisionSql.includes("'declined'") || !adminDecisionSql.includes("profiles_role_check")) {
  failures++;
  console.error("FAIL migrations: admin decision migration must permit the declined profile role");
} else if (!adminDecisionSql.includes("role in ('member', 'declined')")) {
  failures++;
  console.error("FAIL migrations: admin decision migration must allow submitted applications to be approved or declined");
} else if (
  !adminDecisionSql.includes("exists (") ||
  !adminDecisionSql.includes("submitted_application.profile_id = public.profiles.id") ||
  !adminDecisionSql.includes("submitted_application.submitted_at is not null")
) {
  failures++;
  console.error("FAIL migrations: admin decisions must require a submitted application for the target profile");
} else {
  console.log("ok  migration limits approve and decline decisions to submitted applications");
}

const adminNotificationsPath = resolve(
  __dirname,
  "../supabase/migrations/20260805000008_admin_operational_notifications.sql"
);
const adminNotificationsSql = existsSync(adminNotificationsPath)
  ? readFileSync(adminNotificationsPath, "utf8")
  : "";
let adminNotificationsOk = true;
const failAdminNotifications = message => {
  failures++;
  adminNotificationsOk = false;
  console.error(`FAIL ${message}`);
};
const submissionFunction = adminNotificationsSql.match(
  /create or replace function public\.notify_admins_application_submitted\(\)[\s\S]*?\n\$\$;/
)?.[0] || "";
const roleChangeFunction = adminNotificationsSql.match(
  /create or replace function public\.record_role_change\(\)[\s\S]*?\n\$\$;/
)?.[0] || "";

if (!submissionFunction || !roleChangeFunction) {
  failAdminNotifications("Admin notification SQL must contain both complete trigger function bodies");
}
for (const [functionName, functionSql] of [
  ["application submission", submissionFunction],
  ["role change", roleChangeFunction],
]) {
  if (!functionSql.includes("security definer") || !functionSql.includes("set search_path = public")) {
    failAdminNotifications(`${functionName} notification function must own trusted writes with a fixed search path`);
  }
  if (!functionSql.includes("role in ('admin', 'super_admin')")) {
    failAdminNotifications(`${functionName} notification function must fan out to current Admins and Super Admins`);
  }
}

if (
  !submissionFunction.includes("if TG_OP = 'INSERT' then") ||
  !submissionFunction.includes("should_notify := NEW.submitted_at is not null;") ||
  !submissionFunction.includes("elsif TG_OP = 'UPDATE' then") ||
  !submissionFunction.includes("should_notify := OLD.submitted_at is null and NEW.submitted_at is not null;") ||
  !submissionFunction.includes("'admin_application_submitted'") ||
  !submissionFunction.includes("'Membership application submitted'") ||
  !submissionFunction.includes("applicant_name || ' submitted a membership application.'")
) {
  failAdminNotifications("application notifications must use the exact first-submission event and copy");
}
if (
  !adminNotificationsSql.includes("drop trigger if exists applications_notify_admins_submitted on public.applications;") ||
  !adminNotificationsSql.includes("after insert or update of submitted_at on public.applications") ||
  /create\s+trigger[^;]*\bon\s+public\.profiles\b/i.test(adminNotificationsSql) ||
  submissionFunction.includes("TG_TABLE_NAME")
) {
  failAdminNotifications("Admin submission notifications must come only from the rerunnable applications trigger, not profile bootstrap");
}

const roleClassification = roleChangeFunction.match(/event_kind := case[\s\S]*?\n    end;/)?.[0]
  .replace(/\s+/g, " ")
  .trim() || "";
const exactRoleClassification = [
  "event_kind := case",
  "when OLD.role = 'pending' and NEW.role = 'member' then 'admin_application_approved'",
  "when OLD.role = 'pending' and NEW.role = 'declined' then 'admin_application_declined'",
  "when OLD.role = 'member' and NEW.role = 'admin' then 'admin_role_promoted'",
  "when OLD.role = 'admin' and NEW.role = 'member' then 'admin_role_demoted'",
  "when OLD.role in ('member', 'admin') and NEW.role = 'pending' then 'admin_membership_revoked'",
  "else null end;",
].join(" ");
if (roleClassification !== exactRoleClassification) {
  failAdminNotifications("role notification function must classify exactly the five supported transitions");
}
for (const eventContract of [
  "event_title := 'Application approved';\n          event_body := target_name || ' was approved by ' || actor_name || '.';",
  "event_title := 'Application declined';\n          event_body := target_name || ' was declined by ' || actor_name || '.';",
  "event_title := 'Member promoted';\n          event_body := actor_name || ' promoted ' || target_name || ' from Member to Admin.';",
  "event_title := 'Admin demoted';\n          event_body := actor_name || ' changed ' || target_name || ' from Admin to Member.';",
  "event_title := 'Membership revoked';\n          event_body := actor_name || ' revoked ' || target_name || '’s member access.';",
]) {
  if (!roleChangeFunction.includes(eventContract)) {
    failAdminNotifications(`role notification function is missing exact event copy: ${eventContract.split(";")[0]}`);
  }
}

const actorLookup = "select id, coalesce(nullif(full_name, ''), email, 'An administrator')\n      into actor_profile_id, actor_name\n      from public.profiles\n     where id = auth.uid();";
if (
  !roleChangeFunction.includes("actor_profile_id uuid;") ||
  !roleChangeFunction.includes(actorLookup) ||
  !roleChangeFunction.includes("actor_name := coalesce(actor_name, 'An administrator');") ||
  !roleChangeFunction.includes("values (NEW.id, actor_profile_id, OLD.role, NEW.role);") ||
  roleChangeFunction.includes("values (NEW.id, auth.uid(), OLD.role, NEW.role)") ||
  roleChangeFunction.indexOf(actorLookup) > roleChangeFunction.indexOf("insert into public.role_changes")
) {
  failAdminNotifications("role audit must resolve one nullable actor profile ID before insert and derive actor copy from that lookup");
}
if (
  !roleChangeFunction.includes("insert into public.role_changes (profile_id, changed_by, old_role, new_role)") ||
  !roleChangeFunction.includes("if NEW.role = 'member' then") ||
  !roleChangeFunction.includes("'welcome'")
) {
  failAdminNotifications("role notification function must preserve audit and member welcome writes inside its body");
}
if (adminNotificationsOk) {
  console.log("ok  migration creates trusted, transition-specific Admin notifications with nullable matched actors");
}

const notificationPrivilegesPath = resolve(
  __dirname,
  "../supabase/migrations/20260805000009_notification_read_at_privileges.sql"
);
const notificationPrivilegesSql = existsSync(notificationPrivilegesPath)
  ? readFileSync(notificationPrivilegesPath, "utf8")
  : "";
for (const [contract, label] of [
  [/revoke update on table public\.notifications from anon, authenticated;/i,
    "revokes broad browser UPDATE privileges"],
  [/grant update \(read_at\) on table public\.notifications to authenticated;/i,
    "grants authenticated clients only the read marker column"],
]) {
  if (!contract.test(notificationPrivilegesSql)) {
    failures++;
    console.error(`FAIL notification privileges migration ${label}`);
  } else console.log(`ok  notification privileges migration ${label}`);
}
if (
  /grant update(?:\s*\([^)]*\))? on table public\.notifications to anon/i.test(notificationPrivilegesSql) ||
  /grant update on table public\.notifications to authenticated/i.test(notificationPrivilegesSql)
) {
  failures++;
  console.error("FAIL notification privileges migration must not restore broad browser UPDATE");
} else {
  console.log("ok  notification privileges migration retains self-row RLS without broad UPDATE grants");
}

// --- store.getCurrentUser fallback (local mode) ---
store.signOut();
const localUser = await store.getCurrentUser();
const localCu = store.currentUser();
const localMatch = (localUser === null && localCu === null) ||
                   (localUser !== null && localCu !== null && localUser.id === localCu.id);
if (!localMatch) {
  failures++;
  console.error(`FAIL getCurrentUser: should mirror currentUser() in local mode (got ${JSON.stringify(localUser)} vs ${JSON.stringify(localCu)})`);
} else {
  console.log("ok  getCurrentUser: mirrors currentUser() in local mode");
}
// Install a neutral fixture so the local-mode mirror check has a real user.
store.resetLocalData();
installLocalFixtures();
store.signIn("member@example.test");
const signedUser = await store.getCurrentUser();
const signedCu = store.currentUser();
const signedMatch = signedUser && signedCu && signedUser.id === signedCu.id;
if (!signedMatch) {
  failures++;
  console.error(`FAIL getCurrentUser: signed-in user should match (got ${JSON.stringify(signedUser)} vs ${JSON.stringify(signedCu)})`);
} else {
  console.log("ok  getCurrentUser: signed-in user mirrors currentUser() in local mode");
}
store.signOut();

// --- Supabase config (no env vars set) ---
const cfg = await import("./js/config.js");
if (cfg.supabase !== null) {
  failures++;
  console.error("FAIL config: supabase should be null when env vars unset");
} else {
  console.log("ok  config: supabase is null when env vars unset");
}
if (cfg.isLive() !== false) {
  failures++;
  console.error("FAIL config: isLive() should be false when env vars unset");
} else {
  console.log("ok  config: isLive() is false when env vars unset");
}
if (cfg.config.url !== null || cfg.config.anonKey !== null) {
  failures++;
  console.error("FAIL config: url/anonKey should be null when window env vars unset");
} else {
  console.log("ok  config: url/anonKey are null when window env vars unset");
}

// --- Supabase admin store seams (source-only) ---
// The canonical Members tab exercises listProfiles and updateProfileRole in
// the live smoke; retain the role-audit seam for database compatibility.
const storeSrc = readFileSync(resolve(__dirname, "js/store.js"), "utf8");
for (const fn of ["listProfiles", "listRoleChanges", "updateProfileRole"]) {
  if (!storeSrc.includes(`export async function ${fn}`)) {
    failures++;
    console.error(`FAIL store.js: should export ${fn}`);
  } else {
    console.log(`ok  store.js: exports ${fn}`);
  }
}
for (const fn of [
  "getMyApplication",
  "saveMyApplication",
  "updateMyMembershipDetails",
  "updateMyPrivacyPreferences",
  "acceptMyIndemnity",
]) {
  if (!storeSrc.includes(`export async function ${fn}`)) {
    failures++;
    console.error(`FAIL store.js: should export ${fn}`);
  } else {
    console.log(`ok  store.js: exports ${fn}`);
  }
}
for (const fn of ["listMyNotifications", "markNotificationRead"]) {
  if (!storeSrc.includes(`export async function ${fn}`)) {
    failures++;
    console.error(`FAIL store.js: should export ${fn}`);
  } else {
    console.log(`ok  store.js: exports ${fn}`);
  }
}
const markReadStoreBlock = storeSrc.match(
  /export async function markNotificationRead\(id\) \{([\s\S]*?)\n\}/
)?.[1] || "";
for (const [contract, label] of [
  [/\.eq\("id", id\)[\s\S]*?\.is\("read_at", null\)/, "targets one unread notification"],
  [/\.select\("id, read_at"\)[\s\S]*?\.single\(\)/, "requires one returned update row"],
  [/if \(!data\?\.id\) throw new Error\("Notification update conflict\."\)/, "rejects zero-row conflicts"],
  [/return data;/, "returns the confirmed update"],
]) {
  if (!contract.test(markReadStoreBlock)) {
    failures++;
    console.error(`FAIL markNotificationRead ${label}`);
  } else console.log(`ok  markNotificationRead ${label}`);
}
const notificationOpenBlock = appSrc.match(/case "notification-open": \{([\s\S]*?)\n    \}/)?.[1] || "";
for (const [contract, label] of [
  [/dataset\.notificationRead !== "true"/, "skips writes for already-read rows"],
  [/await withBusyControl[\s\S]*?location\.hash = destination/, "waits for update before navigation"],
  [/withBusyControl[\s\S]*?replaceLabel: false[\s\S]*?announceWithoutReplacing: true/, "uses row-safe duplicate protection"],
  [/toast\("Failed to mark notification read", true\)/, "reports an accessible generic error"],
  [/location\.hash = destination;[\s\S]*?break;/, "delegates destination rendering to hashchange"],
]) {
  if (!contract.test(notificationOpenBlock)) {
    failures++;
    console.error(`FAIL notification-open ${label}`);
  } else console.log(`ok  notification-open ${label}`);
}

if (!viewsSrc.includes("export async function viewApplyLive")) {
  failures++;
  console.error("FAIL views.js: should export viewApplyLive");
} else {
  console.log("ok  views.js: exports viewApplyLive");
}
if (!viewsSrc.includes("data-form=\"apply\"")) {
  failures++;
  console.error("FAIL views.js: apply form should use data-form='apply'");
} else {
  console.log("ok  views.js: apply form uses data-form='apply'");
}
if (!viewsSrc.includes("data-minor-only")) {
  failures++;
  console.error("FAIL views.js: apply form should have data-minor-only block");
} else {
  console.log("ok  views.js: apply form has data-minor-only block");
}
if (!viewsSrc.includes("export async function viewNotifications")) {
  failures++;
  console.error("FAIL views.js: should export viewNotifications");
} else {
  console.log("ok  views.js: exports viewNotifications");
}
if (!viewsSrc.includes("export function notificationBellHTML")) {
  failures++;
  console.error("FAIL views.js: should export notificationBellHTML");
} else {
  console.log("ok  views.js: exports notificationBellHTML");
}
if (!viewsSrc.includes("New notifications will appear here.")) {
  failures++;
  console.error("FAIL views.js: an entirely empty inbox must explain where future notifications appear");
} else {
  console.log("ok  views.js: entirely empty inbox has approved explanatory copy");
}

// --- Delegated local member-role behavior ---
// Exercise app.js in local mode so stale events cannot produce false success,
// successful changes use setRole(), and filter-only UI state stays in memory.
store.resetLocalData();
installLocalFixtures();
const fixtureOwner = store.allUsers().find((user) => user.id === "fixture-admin");
fixtureOwner.role = "superadmin";
store.signIn("admin@example.test");
const localDomListeners = new Map();
const localWindowListeners = new Map();
let localActiveElement = null;
const makeLocalElement = () => ({
  children: [],
  className: "",
  innerHTML: "",
  textContent: "",
  hidden: false,
  disabled: false,
  attributes: new Map(),
  classList: { toggle() {} },
  appendChild(child) { this.children.push(child); },
  setAttribute(name, value) { this.attributes.set(name, String(value)); },
  getAttribute(name) { return this.attributes.get(name) ?? null; },
  hasAttribute(name) { return this.attributes.has(name); },
  removeAttribute(name) { this.attributes.delete(name); },
  focus() { localActiveElement = this; },
  remove() {},
  querySelector() { return null; },
});
const localElements = new Map([
  ["view", makeLocalElement()],
  ["bottom-nav", makeLocalElement()],
  ["top-notifications", makeLocalElement()],
  ["top-avatar", makeLocalElement()],
  ["toast-stack", makeLocalElement()],
  ["route-loader", makeLocalElement()],
]);
localElements.get("route-loader").hidden = true;
globalThis.document = {
  get activeElement() { return localActiveElement; },
  getElementById: (id) => localElements.get(id),
  createElement: () => makeLocalElement(),
  addEventListener: (event, callback) => localDomListeners.set(event, callback),
};
globalThis.HTMLInputElement = class {};
globalThis.location = { hash: "#/admin/members" };
globalThis.window = {
  location: globalThis.location,
  confirm: () => true,
  addEventListener: (event, callback) => localWindowListeners.set(event, callback),
  scrollTo() {},
};
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = () => 1;
globalThis.clearTimeout = () => {};
const localApp = await import("./js/app.js?local-admin-delegation");
await localApp.bootPromise;
const localClick = localDomListeners.get("click");
const localChange = localDomListeners.get("change");
const localInput = localDomListeners.get("input");
const localToasts = localElements.get("toast-stack");
const localToastText = () => localToasts.children.map((item) => item.textContent);
const clearLocalToasts = () => { localToasts.children.length = 0; };
const localControl = (dataset, value = "") => {
  const control = makeLocalElement();
  control.tagName = dataset.change === "set-role" ? "SELECT" : "BUTTON";
  control.dataset = dataset;
  control.value = value;
  control.closest = () => control;
  return control;
};

const staleLocalRole = localControl({
  change: "set-role",
  user: "removed-member",
  memberName: "Removed Member",
  currentRole: "member",
}, "admin");
await localChange({ target: staleLocalRole });
if (staleLocalRole.value !== "member" || staleLocalRole.disabled || staleLocalRole.hasAttribute("aria-busy") ||
    localToastText().join("|") !== "Member not found." || localToastText().some((text) => /is now/.test(text))) {
  failures++;
  console.error("FAIL stale local role event must restore its select without a success toast");
} else console.log("ok  stale local role event restores without false success");

clearLocalToasts();
const pendingFixture = store.applyForMembership({
  fullName: "Pending Fixture", preferredName: "Pending", email: "pending-fixture@example.test",
  phone: "+852 5000 0003", emergencyName: "Test Contact", emergencyPhone: "+852 5000 9003",
  heard: "Test fixture", donorId: "", indemnity: true, ageOver18: "yes",
});
store.signIn("admin@example.test");
const rejectedLocalRevoke = localControl({
  action: "revoke-member",
  user: pendingFixture.user.id,
  memberName: "Pending Fixture",
});
rejectedLocalRevoke.textContent = "Revoke access";
await localClick({ target: rejectedLocalRevoke });
if (rejectedLocalRevoke.textContent !== "Revoke access" || rejectedLocalRevoke.disabled ||
    rejectedLocalRevoke.hasAttribute("aria-busy") ||
    localToastText().join("|") !== "Only approved members can change roles." ||
    localToastText().some((text) => /moved to Pending/.test(text))) {
  failures++;
  console.error("FAIL rejected local revoke must restore its button without a success toast");
} else console.log("ok  rejected local revoke restores without false success");

clearLocalToasts();
const secondAdmin = {
  ...structuredClone(store.allUsers().find((user) => user.id === "fixture-member")),
  id: "fixture-second-admin", role: "admin", fullName: "Second Admin", preferredName: "Second",
  email: "second-admin@example.test",
};
store.allUsers().push(secondAdmin);
const localDemotion = localControl({
  change: "set-role",
  user: "fixture-second-admin",
  memberName: "Second Admin",
  currentRole: "admin",
}, "member");
await localChange({ target: localDemotion });
if (store.allUsers().find((user) => user.id === "fixture-second-admin")?.role !== "member" ||
    localToastText().join("|") !== "Second Admin is now Member.") {
  failures++;
  console.error("FAIL delegated local demotion must mutate through setRole and toast success");
} else console.log("ok  delegated local demotion confirms setRole success");

clearLocalToasts();
const localRevoke = localControl({ action: "revoke-member", user: "fixture-member", memberName: "Test Member" });
localRevoke.textContent = "Revoke access";
await localClick({ target: localRevoke });
const revokedLocalUser = store.allUsers().find((user) => user.id === "fixture-member");
if (revokedLocalUser?.role !== "pending" || revokedLocalUser?.status !== "pending" ||
    localToastText().join("|") !== "Test Member moved to Pending.") {
  failures++;
  console.error("FAIL delegated local revoke must confirm role and status mutation");
} else console.log("ok  delegated local revoke confirms setRole success");

const persistedBeforeFilters = mem.get("itc.prototype.v1");
const searchFilter = localControl({ input: "member-search" }, "tina");
searchFilter.getAttribute = () => null;
searchFilter.selectionStart = 4;
await localInput({ target: searchFilter });
const statusFilter = localControl({ action: "admin-member-filter", filterKey: "status", filterValue: "approved" });
localElements.set("member-filter-status-approved", statusFilter);
await localClick({ target: statusFilter });
const statusFocusRestored = localActiveElement === statusFilter;
const roleFilter = localControl({ action: "admin-member-filter", filterKey: "role", filterValue: "admin" });
localElements.set("member-filter-role-admin", roleFilter);
await localClick({ target: roleFilter });
if (mem.get("itc.prototype.v1") !== persistedBeforeFilters ||
    views.adminMemberFilters.query !== "tina" || views.adminMemberFilters.status !== "approved" ||
    views.adminMemberFilters.role !== "admin") {
  failures++;
  console.error("FAIL delegated member filters must remain in memory and avoid localStorage writes");
} else console.log("ok  delegated member filters do not persist");
if (!statusFocusRestored || localActiveElement !== roleFilter) {
  failures++;
  console.error("FAIL status and role chips must restore corresponding focus after rerender");
} else console.log("ok  status and role chips restore corresponding focus after rerender");
const resetSearch = localControl({ input: "member-search" });
localElements.set("member-search", resetSearch);
const clearFilters = localControl({ action: "admin-member-filters-clear" });
await localClick({ target: clearFilters });
if (views.adminMemberFilters.query || views.adminMemberFilters.status !== "all" ||
    views.adminMemberFilters.role !== "all" || localActiveElement !== resetSearch) {
  failures++;
  console.error("FAIL Clear filters must reset all view-local filters and focus search");
} else console.log("ok  Clear filters resets all filters and focuses search");
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;

// Direct callers receive checked failures for every rejected local transition.
for (const [userId, role, message] of [
  ["missing-user", "admin", "Member not found."],
  [pendingFixture.user.id, "admin", "Only approved members can change roles."],
  ["fixture-second-admin", "owner", "Invalid role transition."],
  ["fixture-second-admin", "member", "Member already has that role."],
]) {
  try {
    store.setRole(userId, role);
    failures++;
    console.error(`FAIL setRole(${userId}, ${role}) should reject`);
  } catch (err) {
    if (err.message !== message) {
      failures++;
      console.error(`FAIL setRole(${userId}, ${role}) returned ${err.message}`);
    }
  }
}
console.log("ok  local setRole rejects missing, non-approved, and invalid transitions");

// --- Reset ---
const reset = store.resetLocalData();
if (reset.users.length || reset.bookings.length || reset.receipts.length || reset.sessionUserId) {
  failures++;
  console.error("FAIL resetLocalData should restore the clean baseline");
} else console.log("ok  resetLocalData restores the clean baseline");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
