// Headless smoke test: render every view for every user state.
// Run: node --input-type=module < smoke.mjs  (from the app/ directory)

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

let failures = 0;
async function check(label, fn) {
  try {
    const out = await Promise.resolve(fn());
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
    console.error(`FAIL ${label}: ${err.message}`);
    return "";
  }
}

const primaryNavLabels = (html) =>
  [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);

function assertPrimaryNav(user, expected, label) {
  const html = views.navHTML("home", user);
  const labels = primaryNavLabels(html);
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error(`${label} primary navigation labels were ${JSON.stringify(labels)}`);
  }
  if (labels.includes("Admin")) {
    throw new Error(`${label} primary navigation must not include Admin`);
  }
  if (labels.includes("Giving") !== !!user) {
    throw new Error(`Giving must appear only in signed-in primary navigation (${label})`);
  }
}

store.load();
const { existsSync, readFileSync } = await import("node:fs");
const { resolve, dirname } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const __dirnameSmoke = dirname(fileURLToPath(import.meta.url));
for (const relativePath of [
  "js/config.js",
  "live-auth-smoke.mjs",
  "../supabase/migrations/20260804000000_profiles.sql",
  "../supabase/migrations/20260805000007_admin_application_decisions.sql",
  "../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql",
]) {
  const absolutePath = resolve(__dirnameSmoke, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Payment Auth baseline missing ${relativePath}`);
  }
}
console.log("ok  Payment Auth baseline foundation files exist");

const profilesMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260804000000_profiles.sql"),
  "utf8"
);
const indemnityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql"),
  "utf8"
);
for (const column of [
  "waiver_signature_text",
  "waiver_signed_at",
  "waiver_form_version",
  "emergency_relationship",
]) {
  if (!indemnityMigrationSource.includes(column)) {
    throw new Error(`Hyrox indemnity migration missing ${column}`);
  }
}
const liveAuthRunbookSource = readFileSync(
  resolve(__dirnameSmoke, "../docs/runbooks/live-auth.md"),
  "utf8"
);
const readmeSource = readFileSync(resolve(__dirnameSmoke, "../README.md"), "utf8");
const deploymentDocs = `${readmeSource}\n${liveAuthRunbookSource}`;
for (const marker of [
  "20260805000011_giving_campaigns.sql",
  "20260806000001_donor_id.sql",
  "Admin Tools → Giving",
  "No fake campaign data is restored",
]) {
  if (!deploymentDocs.includes(marker)) {
    throw new Error(`Giving deployment recovery docs missing ${marker}`);
  }
}
console.log("ok  Giving deployment recovery is documented without fake campaign data");

if (!/values\s*\([\s\S]*?'pending'\s*\)/i.test(profilesMigrationSource)
    || /existing_count|count\s*\(\s*\*\s*\)[\s\S]*super_admin/i.test(profilesMigrationSource)) {
  throw new Error("fresh OAuth profiles must always bootstrap as pending");
}
for (const marker of ["trusted SQL", "known profile UUID", "role_changes", "Initial Super Admin bootstrap"]) {
  if (!liveAuthRunbookSource.includes(marker)) {
    throw new Error(`initial Super Admin bootstrap procedure missing ${marker}`);
  }
}
console.log("ok  fresh OAuth bootstrap is pending-only with an audited trusted procedure");

const appIndexSource = readFileSync(resolve(__dirnameSmoke, "index.html"), "utf8");
if (!appIndexSource.includes("window.SUPABASE_URL") || !appIndexSource.includes("window.SUPABASE_ANON_KEY")) {
  throw new Error("static Supabase configuration seam must remain explicit in app/index.html");
}
if (/## Vercel env vars|Vercel project settings[^\n]*Environment Variables/i.test(liveAuthRunbookSource)) {
  throw new Error("runbook must not claim Vercel env vars inject into static HTML");
}
for (const marker of ["static no-build deployment", "app/index.html", "does not inject", "service_role", "deployment-specific values"]) {
  if (!liveAuthRunbookSource.includes(marker)) {
    throw new Error(`static deployment procedure missing ${marker}`);
  }
}
console.log("ok  static Vercel documentation matches the app/index.html configuration seam");

const integrationSourceTips = {
  payment: "720dc732944dac692334e885db2d9418d024d9bc",
  notification: "5842839e08f5e486f4b9e175232acec3cb347eb2",
  giving: "3ef00adc4efb327826d5308b20610bc18a9102db",
  community: "40bb7c2acb5ee0a7460f840e73b283cfebce4d31",
};
if (new Set(Object.values(integrationSourceTips)).size !== 4) {
  throw new Error("integration source tips must stay explicit and distinct");
}
console.log("ok  integration source-tip provenance is explicit");

const integratedViewSource = readFileSync(resolve(__dirnameSmoke, "js/views.js"), "utf8");
const integratedAppSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
const combinedRuntimeSource = `${integratedViewSource}\n${integratedAppSource}`;
for (const marker of [
  "Continue with Google",
  "notification-filter",
  "Giving &amp; Fundraising",
  "ITC Anniversary",
  "Payments / Ops",
]) {
  if (!combinedRuntimeSource.includes(marker)) {
    throw new Error(`testing integration missing ${marker}`);
  }
}
console.log("ok  final cross-domain runtime markers coexist");
for (const marker of [
  "Continue with Google",
  "Membership Details",
  "Privacy &amp; Notifications",
  "Approvals",
  "Members",
  "Payments / Ops",
  "Duty",
  "Session controls",
]) {
  if (!integratedViewSource.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`integrated Payment/Auth UI missing ${marker}`);
  }
}
console.log("ok  composed Payment/Auth UI markers coexist");
for (const marker of ['case "pay"', 'case "form-reserve"', 'case "form-mark-paid"', "store.reserveSession", "store.markBookingPaid"]) {
  if (!integratedAppSource.includes(marker)) {
    throw new Error(`integrated Payment router missing ${marker}`);
  }
}
console.log("ok  Payment reserve and mark-paid routes remain delegated");
for (const marker of ['case "release-reservation"', 'case "defer-to"', 'case "copy-fps"']) {
  if (!integratedAppSource.includes(marker)) {
    throw new Error(`integrated Payment router missing ${marker}`);
  }
}
for (const retiredAction of [
  'case "demo-signin"', 'case "reset-demo"', 'case "form-checkout"',
  "store.payForSession", "use a demo profile",
]) {
  if (integratedAppSource.includes(retiredAction)) {
    throw new Error(`retired runtime action/copy remains: ${retiredAction}`);
  }
}
console.log("ok  rendered Payment controls are delegated and retired actions/copy are absent");
for (const marker of [
  "notificationBellHTML",
  "notification-filter",
  "notification-kind-badge",
  "notificationRelativeTime",
  "notificationHktTime",
]) {
  if (!integratedViewSource.includes(marker) && !integratedAppSource.includes(marker)) {
    throw new Error(`integrated Notification domain missing ${marker}`);
  }
}
console.log("ok  latest Notification domain markers coexist");

const anniversary = data.ANNOUNCEMENTS[0];
if (
  data.ANNOUNCEMENTS.length !== 1 ||
  anniversary?.title !== "Island Training Club turns 2" ||
  anniversary?.milestones?.length !== 5
) {
  failures++;
  console.error("FAIL announcement seeds should contain only the structured ITC anniversary");
} else console.log("ok  announcement seeds contain only the ITC anniversary");
if (
  anniversary?.postedAt == null ||
  new Date(anniversary.postedAt).getFullYear() !== 2026 ||
  new Date(anniversary.postedAt).getMonth() !== 7 ||
  new Date(anniversary.postedAt).getDate() !== 6
) {
  failures++;
  console.error("FAIL announcement postedAt should resolve to 2026-08-06 local date");
} else console.log("ok  announcement postedAt resolves to 2026-08-06 local date");

// --- Visitor state ---
store.signOut();
const allUpcoming = store.upcomingSessions(14);
// booking tests need a session that hasn't started yet — today's sessions
// are unbookable once their start time passes
const paid = allUpcoming.find((s) => s.kind === "paid" && !data.sessionStarted(s));
const free = allUpcoming.find((s) => s.kind === "free");
if (!paid || !free) throw new Error("expected both paid and free sessions in window");
const localVisitorHome = views.viewHome();
if (!localVisitorHome.includes("<h2>This week — open to all</h2>")) {
  throw new Error("visitor Home must show the exact open-to-all h2");
}
if (localVisitorHome.includes("My Week")) {
  throw new Error("visitor Home must not show My Week");
}
const assertRenderedActivityLinksAreFree = (html, label) => {
  const linkedIds = [...html.matchAll(/href="#\/activity\/([^"]+)"/g)].map((match) => match[1]);
  if (!linkedIds.length) {
    // Mirror viewHome()'s visitor branch: when no free sessions exist in the
    // current Mon–Sun window, the empty state is the expected output and
    // there are no links to verify. The seed data (Mon/Tue/Wed only) makes
    // this the case on Thu–Sun — without this guard the suite was green only
    // on Mon–Wed.
    const weekStart = data.mondayOf(data.todayLocal());
    const weekEnd = data.addDays(weekStart, 6);
    const freeInWeek = allUpcoming.filter((session) => {
      if (session.kind !== "free") return false;
      const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
      if (!iso) return false;
      const t = data.parseISO(iso).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });
    if (freeInWeek.length) {
      throw new Error(`${label} must render at least one activity link (${freeInWeek.length} free sessions this week)`);
    }
    if (!html.includes("No open sessions this week")) {
      throw new Error(`${label} should render the empty state when no free sessions are in the current week`);
    }
    return;
  }
  for (const id of linkedIds) {
    const session = allUpcoming.find((item) => item.id === id);
    if (!session || session.kind !== "free") {
      throw new Error(`${label} rendered a non-free activity link: ${id}`);
    }
  }
};
assertRenderedActivityLinksAreFree(localVisitorHome, "visitor Home");
{
  const weekStart = data.mondayOf(data.todayLocal());
  const weekEnd = data.addDays(weekStart, 6);
  const freeInWeek = allUpcoming.filter((session) => {
    if (session.kind !== "free") return false;
    const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
    if (!iso) return false;
    const t = data.parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  });
  if (freeInWeek.length) {
    // free is guaranteed non-null in this branch — guard above found one.
    if (!localVisitorHome.includes(free.name) || localVisitorHome.includes(paid.name)) {
      throw new Error("visitor Home must show free sessions only");
    }
  } else {
    // Thu–Sun: no free sessions in window, so neither name should appear.
    if (localVisitorHome.includes(free.name) || localVisitorHome.includes(paid.name)) {
      throw new Error("visitor Home should not list session names when the current week has no free sessions");
    }
  }
}
assertPrimaryNav(null, ["Home", "Schedule", "Community", "Account"], "visitor");
if (!localVisitorHome.includes('href="#/account">Sign in or join</a>')) {
  throw new Error("local signed-out Home must retain the Account sign-in link");
}
if (localVisitorHome.includes('data-action="sign-in-google"')) {
  throw new Error("local signed-out Home must not render the live Google action");
}
console.log("ok  signed-out Home uses the correct live/local sign-in action");
await check("home (visitor)", () => views.viewHome());
await check("schedule", () => views.viewSchedule());

// Schedule filters: Free/Paid kind filters restored; all chips render.
{
  const schedHtml = views.viewSchedule();
  for (const kept of ['data-filter="all"', 'data-filter="free"', 'data-filter="paid"', 'data-filter="Run"', 'data-filter="Strength"', 'data-filter="HYROX"', 'data-filter="Water"']) {
    if (!schedHtml.includes(kept)) {
      failures++;
      console.error(`FAIL Schedule should render the ${kept} filter chip`);
    }
  }
  const renderedFilterOrder = [...schedHtml.matchAll(/data-filter="([^"]+)"/g)].map((match) => match[1]);
  const expectedFilterOrder = ["all", "free", "paid", "Run", "Water", "Strength", "HYROX"];
  if (JSON.stringify(renderedFilterOrder) !== JSON.stringify(expectedFilterOrder)) {
    failures++;
    console.error(`FAIL Schedule filter order should be ${expectedFilterOrder.join(", ")}; got ${renderedFilterOrder.join(", ")}`);
  } else console.log("ok  Schedule filters follow access type then weekly event order");
  console.log("ok  Schedule renders All + Free/Paid + category filter chips");
}
const hyroxSid = store.nextSession().kind === "paid" ? store.nextSession().id : null;
await check("activity paid (visitor)", () => views.viewActivity(paid.id));
await check("activity free (visitor)", () => views.viewActivity(free.id));
await check("community", () => views.viewCommunity());
const commHtml = views.viewCommunity();
if (!commHtml.includes("Find your place in the crew.")) {
  failures++;
  console.error("FAIL visitor Community heading is not personalized");
} else console.log("ok  visitor Community heading is personalized");
for (const required of [
  "Next connection",
  "Post-training dinner",
  "Count me in",
  "Latest from ITC",
  "Island Training Club turns 2",
  "Ways to connect",
  "Explore",
]) {
  if (!commHtml.includes(required)) {
    failures++;
    console.error(`FAIL Community Pulse missing ${required}`);
  }
}
if (!commHtml.includes('data-action="connect-interest"')) {
  failures++;
  console.error("FAIL Community Pulse meal CTA should use the existing interest action");
}
const coexistenceSurface = `${integratedViewSource}\n${localVisitorHome}\n${commHtml}`;
for (const marker of ["Home", "notificationBellHTML", '#/giving', "community-pulse", "Payments / Ops"]) {
  if (!coexistenceSurface.includes(marker)) {
    failures++;
    console.error(`FAIL combined domain coexistence missing ${marker}`);
  }
}
console.log("ok  Home, Notification bell, Giving nav, Community pulse, and Payment Ops coexist");
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
if (commOk) console.log("ok  Community shows the five destination links");
if (!commHtml.includes('#/community/about')) {
  failures++;
  console.error("FAIL Community Explore should still link to About ITC");
} else console.log("ok  About ITC remains reachable from Community");
if (commHtml.includes("Arnold Wong") || commHtml.includes("Our foundation")) {
  failures++;
  console.error("FAIL leaders/culture should live behind the About card");
} else console.log("ok  leaders & culture live behind the About card");
await check("community > prayers", () => views.viewCommunity("prayers"));
await check("community > fellowship", () => views.viewCommunity("fellowship"));
await check("community > meals", () => views.viewCommunity("meals"));
await check("community > announcements", () => views.viewCommunity("announcements"));
const announcementHtml = views.viewCommunity("announcements");
for (const required of [
  "Island Training Club turns 2",
  "620",
  "members strong",
  "14",
  "committed leaders",
  "unwavering vision",
  "clear mission",
  "God who made this all possible",
  "ITC Leadership and Coaching Team",
  "fitness, friendship, community and faith",
]) {
  if (!announcementHtml.includes(required)) {
    failures++;
    console.error(`FAIL anniversary story missing ${required}`);
  }
}
const savedAnnouncements = [...data.ANNOUNCEMENTS];
data.ANNOUNCEMENTS.splice(0);
let emptyCommunity = "";
let emptyAnnouncements = "";
try {
  emptyCommunity = views.viewCommunity();
  emptyAnnouncements = views.viewCommunity("announcements");
} finally {
  data.ANNOUNCEMENTS.splice(0, data.ANNOUNCEMENTS.length, ...savedAnnouncements);
}
if (!emptyCommunity.includes("No announcements yet") || !emptyAnnouncements.includes("No announcements yet")) {
  failures++;
  console.error("FAIL Community announcement empty states should render safely");
} else console.log("ok  Community announcement empty states render safely");
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
  ["announcements", "Island Training Club turns 2."],
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
if (!views.viewApply().includes('name="donorId"')) {
  failures++;
  console.error("FAIL apply form missing optional Donor ID field");
} else console.log("ok  apply form collects optional Donor ID");

// --- apply form checkboxes render the read-and-accept links (all three docs) ---
// local mode: viewApply() dispatches to viewApplyLocal when isLive() is false
const applyLocalHtml = views.viewApply();
for (const [key, label] of [
  ["indemnity", "Indemnity"],
  ["privacy", "privacy policy"],
  ["guidelines", "community guidelines"],
]) {
  if (!applyLocalHtml.includes(`data-action="open-doc" data-doc="${key}"`)) {
    failures++;
    console.error(`FAIL local-mode apply form missing modal trigger for "${key}"`);
  }
  if (!applyLocalHtml.includes(`data-doc-accept="${key}"`)) {
    failures++;
    console.error(`FAIL local-mode apply form missing doc-accept container for "${key}"`);
  }
  if (!applyLocalHtml.includes(label)) {
    failures++;
    console.error(`FAIL local-mode apply form missing label text "${label}"`);
  }
}
if (!applyLocalHtml.includes("data-doc-checkbox")) {
  failures++;
  console.error("FAIL local-mode apply form checkboxes missing data-doc-checkbox attribute");
}
if (!applyLocalHtml.includes("Read the document to enable acceptance")) {
  failures++;
  console.error("FAIL local-mode apply form missing the read-first hint copy");
}
console.log("ok  local-mode apply form wires all three documents (indemnity, privacy, guidelines)");
for (const name of ["emergencyRelationship", "indemnitySignature", "indemnitySignedAt"]) {
  if (!applyLocalHtml.includes(`name="${name}"`)) {
    failures++;
    console.error(`FAIL local apply form missing ${name}`);
  }
}
if (!applyLocalHtml.includes("Participant's full name as signature")) {
  failures++;
  console.error("FAIL local apply form missing signature label");
}
if (!/name="indemnity"[^>]*disabled[^>]*data-doc-checkbox/.test(applyLocalHtml)) {
  failures++;
  console.error("FAIL local indemnity checkbox should stay disabled until the modal is read");
}
if (!applyLocalHtml.includes(`value="${data.isoDate(data.todayLocal())}"`)) {
  failures++;
  console.error("FAIL local signing date should default to today");
}
if (!applyLocalHtml.includes(`max="${data.isoDate(data.todayLocal())}"`)) {
  failures++;
  console.error("FAIL local signing date should be capped at today");
}
console.log("ok  local-mode apply form collects emergencyRelationship, signature, and signing date");
for (const marker of [
  'emergencyRelationship: fd.get("emergencyRelationship") || ""',
  'indemnitySignature: fd.get("indemnitySignature") || ""',
  'indemnitySignedAt: fd.get("indemnitySignedAt") || ""',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL local apply handler missing structured indemnity contract: ${marker}`);
  }
}
console.log("ok  local apply handler bridges the structured indemnity contract");

// Live-mode apply form: old plain-checkbox copy and indemnity-only attributes
// must be gone. Source-level check: rendering viewApplyLive() requires
// Supabase state, so we assert against the integrated source instead.
for (const stale of [
  "I accept the participation waiver",
  "I accept the privacy policy. (⏳",
  "I accept the community guidelines. (⏳",
  'data-action="open-indemnity-doc"',
  "data-indemnity-checkbox",
]) {
  if (combinedRuntimeSource.includes(stale)) {
    failures++;
    console.error(`FAIL stale pre-registry pattern still present: "${stale}"`);
  }
}
console.log("ok  no stale plain-checkbox or indemnity-only patterns remain");
await check("checkout (visitor) -> redirect", () => views.viewCheckout(paid.id));
await check("admin (visitor) -> redirect", () => views.viewAdmin("approvals"));
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

// --- Application flow ---
const applyRes = store.applyForMembership({
  fullName: "Test Person",
  preferredName: "Test",
  email: "test@example.com",
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyRelationship: "Sibling",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
  indemnitySignature: "Test Person",
  indemnitySignedAt: data.isoDate(data.todayLocal()),
});
if (!applyRes.ok) throw new Error("apply failed");
if (applyRes.user.donorId !== null) {
  failures++;
  console.error('FAIL "Not applicable" donor ID should normalize to null');
} else console.log("ok  N/A donor ID at signup normalizes to null");
if (!applyRes.user.indemnityAcceptedAt) {
  failures++;
  console.error("FAIL indemnity acceptance not recorded at application");
} else console.log("ok  indemnity acceptance recorded at application");
for (const [field, expected] of [
  ["emergencyRelationship", "Sibling"],
  ["indemnitySignature", "Test Person"],
  ["indemnitySignedAt", data.isoDate(data.todayLocal())],
  ["indemnityFormVersion", "v1"],
]) {
  if (applyRes.user[field] !== expected) {
    failures++;
    console.error(`FAIL application ${field} expected ${expected}, got ${applyRes.user[field]}`);
  }
}
if (!store.isIndemnityCurrent(applyRes.user)) {
  failures++;
  console.error("FAIL signed v1 application should have current indemnity");
}
const localApplicationFixture = (email, overrides = {}) => ({
  fullName: "Contact Check",
  preferredName: "Contact",
  email,
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyRelationship: "Sibling",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
  indemnitySignature: "Contact Check",
  indemnitySignedAt: data.isoDate(data.todayLocal()),
  ...overrides,
});
for (const [label, email, overrides] of [
  ["missing emergency name", "missing-emergency-name@example.test", { emergencyName: "" }],
  ["missing emergency phone", "missing-emergency-phone@example.test", { emergencyPhone: "" }],
]) {
  let error = null;
  try { store.applyForMembership(localApplicationFixture(email, overrides)); } catch (err) { error = err; }
  if (!error || !/emergency contact name, relationship and phone/.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should reject with the canonical emergency-contact error`);
  }
}
if (store.isIndemnityCurrent({ ...applyRes.user, emergencyPhone: "" })) {
  failures++;
  console.error("FAIL indemnity currentness should require canonical emergency contact phone");
}
for (const [label, payload, pattern] of [
  ["short signature", { signature: "X", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "Sibling" }, /full name as your signature/],
  ["invalid date", { signature: "Test Person", signedAt: "2026-02-31", emergencyRelationship: "Sibling" }, /valid signing date/],
  ["future date", { signature: "Test Person", signedAt: "2999-01-01", emergencyRelationship: "Sibling" }, /cannot be in the future/],
  ["missing relationship", { signature: "Test Person", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "" }, /relationship/],
]) {
  let error = null;
  try { store.acceptIndemnity(applyRes.user.id, payload); } catch (err) { error = err; }
  if (!error || !pattern.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should reject with ${pattern}`);
  }
}
for (const [label, field] of [
  ["missing canonical emergency name", "emergencyName"],
  ["missing canonical emergency phone", "emergencyPhone"],
]) {
  const original = applyRes.user[field];
  applyRes.user[field] = "";
  let error = null;
  try {
    store.acceptIndemnity(applyRes.user.id, {
      signature: "Test Person",
      signedAt: data.isoDate(data.todayLocal()),
      emergencyRelationship: "Sibling",
    });
  } catch (err) {
    error = err;
  }
  applyRes.user[field] = original;
  if (!error || !/emergency contact name, relationship and phone/.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should block re-sign acceptance`);
  }
}

// --- Application draft persistence ---
{
  localStorage.removeItem("itc.device.id");
  localStorage.removeItem("itc.apply.draft.v1");

  if (store.getApplyDraft() !== null) {
    throw new Error("fresh application draft should be null");
  }

  const first = store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  if (!first?.deviceId || first.version !== 1 || first.fields.mobile !== "+852 6123 4567") {
    throw new Error("application draft should persist its device, version and fields");
  }

  const merged = store.saveApplyDraft({ fields: { preferred_name: "Jiffriy" } });
  if (merged.fields.mobile !== "+852 6123 4567" || merged.fields.preferred_name !== "Jiffriy") {
    throw new Error("application draft saves should merge fields");
  }

  localStorage.setItem("itc.apply.draft.v1", JSON.stringify({
    version: 99,
    deviceId: first.deviceId,
    savedAt: Date.now(),
    fields: { mobile: "stale" },
  }));
  if (store.getApplyDraft() !== null || localStorage.getItem("itc.apply.draft.v1") !== null) {
    throw new Error("incompatible application draft should be discarded");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6999 0000" } });
  store.clearApplyDraft();
  if (store.getApplyDraft() !== null) {
    throw new Error("clearApplyDraft should remove the application draft");
  }
  console.log("ok  application drafts persist, merge, version and clear");
}

{
  store.signOut();
  store.clearApplyDraft();
  const homeWithoutDraft = views.viewHome();
  if (homeWithoutDraft.includes("Continue your application")) {
    throw new Error("fresh visitor home should not advertise a draft");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  const homeWithDraft = views.viewHome();
  const accountWithDraft = await views.viewAccount();
  for (const [label, html] of [["home", homeWithDraft], ["account", accountWithDraft]]) {
    if (!html.includes("Continue your application") || !html.includes('data-action="discard-draft"')) {
      throw new Error(`${label} should expose Continue + Discard for a saved draft`);
    }
  }
  store.clearApplyDraft();
  store.signIn("test@example.com");
  console.log("ok  visitor Home and Account surface resumable drafts");
}

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
const pendingHome = views.viewHome();
{
  // Pending applicants see "My Week" filtered to free sessions in the
  // current Mon–Sun window (same as the visitor branch). On Thu–Sun the
  // seed data yields no such sessions, so neither session name appears.
  const weekStart = data.mondayOf(data.todayLocal());
  const weekEnd = data.addDays(weekStart, 6);
  const freeInWeek = allUpcoming.filter((session) => {
    if (session.kind !== "free") return false;
    const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
    if (!iso) return false;
    const t = data.parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  });
  if (freeInWeek.length) {
    if (!pendingHome.includes("My Week") || !pendingHome.includes(free.name) || pendingHome.includes(paid.name)) {
      throw new Error("pending Home must show My Week with free sessions only");
    }
  } else {
    if (!pendingHome.includes("My Week")) {
      throw new Error("pending Home must show My Week heading even when no sessions this week");
    }
    if (pendingHome.includes(free.name) || pendingHome.includes(paid.name)) {
      throw new Error("pending Home should not list session names when the current week has no free sessions");
    }
  }
}
assertRenderedActivityLinksAreFree(pendingHome, "pending Home");
const pendingCommunity = views.viewCommunity();
if (!pendingCommunity.includes("You’re welcome here.")) {
  failures++;
  console.error("FAIL pending Community heading is not personalized");
} else console.log("ok  pending Community heading is personalized");
// Use BFT (not Midtown) for the pending-user check — closed Midtown shows the
// generic "Members only" gate, while a bookable BFT shows the "Booking locked"
// message specifically for pending applicants.
const bftPaid = allUpcoming.find((s) => s.activityId === "hyrox" && !data.sessionStarted(s));
const pendHtml = views.viewActivity(bftPaid.id);
if (!pendHtml.includes("Booking locked")) {
  failures++;
  console.error("FAIL pending user should see booking locked");
} else console.log("ok  pending user blocked from paid booking");

// --- Admin approval flow ---
installLocalFixtures(); store.signIn("admin@example.test");
for (const tab of ["approvals", "members", "activities", "giving", "payments"]) {
  const adminHtml = await check(`admin ${tab}`, () => views.viewAdmin(tab));
  const activeTabs = adminHtml.match(/<a[^>]*aria-current="page"[^>]*>/g) || [];
  if (activeTabs.length !== 1 || !activeTabs[0].includes(`href="#/admin/${tab}"`)) {
    throw new Error(`Admin ${tab} must expose exactly one matching active tab`);
  }
}
console.log("ok  every Admin route exposes exactly one active tab");

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
    !localClosedGivingHtml.includes('<span class="badge neutral">closed</span>') ||
    !localClosedGivingHtml.includes("+ Create campaign")) {
  failures++;
  console.error("FAIL local closed Admin Giving must keep history visible and unlock Create campaign");
} else console.log("ok  local closed Admin Giving keeps history visible and unlocks Create campaign");
// Restore baseline so other tests do not observe this fixture campaign.
store.campaigns().pop();

const navFixtureUser = store.currentUser();
const originalNavFixtureRole = navFixtureUser.role;
try {
  for (const [role, label] of [
    ["member", "member"],
    ["admin", "Admin"],
    ["superadmin", "Super Admin"],
  ]) {
    navFixtureUser.role = role;
    assertPrimaryNav(
      navFixtureUser,
      ["Home", "Schedule", "Community", "Giving", "Profile"],
      label
    );
  }
} finally {
  navFixtureUser.role = originalNavFixtureRole;
}
const adminProfile = await views.viewAccount();
if (!adminProfile.includes("Admin Tools") || !adminProfile.includes('href="#/admin"')) {
  throw new Error("Admin Tools must remain available from Profile");
}
await check("admin activity edit", () => views.viewAdminActivity("hyrox"));
await check("admin activity new", () => views.viewAdminActivity("new"));
const newApplicant = store.pendingApplicants().find((u) => u.email === "test@example.com");
store.approveApplicant(newApplicant.id);
console.log("ok  admin approved new applicant");

// --- Member booking + payment flow ---
const signIn = store.signIn("test@example.com");
if (!signIn.ok || signIn.user.status !== "approved") throw new Error("approval did not take effect");
await check("account (new member)", () => views.viewAccount());
const approvedCommunity = views.viewCommunity();
if (!approvedCommunity.includes("Connect and grow with us.")) {
  failures++;
  console.error("FAIL approved Community heading is not personalized");
} else console.log("ok  approved Community heading is personalized");

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
const membershipDetailsHtml = await views.viewAccount("details");
const membershipDetailsEditHtml = await views.viewAccount("details", "edit");
if (!membershipDetailsHtml.includes("Emergency contact relationship")) {
  failures++;
  console.error("FAIL Membership Details summary missing emergency contact relationship");
}
if (!membershipDetailsEditHtml.includes('name="emergency_relationship"')) {
  failures++;
  console.error("FAIL Membership Details edit form missing emergency_relationship field");
} else console.log("ok  Membership Details summary and edit include emergency relationship");

// sub-page headings are title-cased to match the row titles
for (const [section, title] of [
  ["details", "Membership Details."],
  ["indemnity", "Indemnity."],
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
// "Indemnity confirmed on [date]" line; stale consent must be detected from
// store.isIndemnityCurrent(), not from the timestamp alone.
if (!newMemberAcct.includes("Indemnity confirmed on") || newMemberAcct.includes("Accepted on")) {
  failures++;
  console.error("FAIL Profile should show a single indemnity-confirmed-on-date line");
} else console.log("ok  Profile shows single-line indemnity confirmation");
const currentIndemnityHtml = await views.viewAccount("indemnity");
for (const marker of [
  "Indemnity confirmed on",
  "Signed by",
  "Test Person",
  "Date of signing",
  "Emergency contact relationship",
  "Sibling",
  "Document version",
  "v1",
]) {
  if (!currentIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL current Indemnity page missing "${marker}"`);
  }
}
console.log("ok  current indemnity page shows the stored consent record");
store.currentUser().indemnityAcceptedAt = Date.now() - 86400000;
store.currentUser().indemnityFormVersion = "v0";
const legacyIndemnityProfile = await views.viewAccount();
if (legacyIndemnityProfile.includes("Indemnity confirmed on") || !legacyIndemnityProfile.includes("Legacy acceptance recorded on")) {
  failures++;
  console.error("FAIL timestamp-only or stale indemnity should stay stale on Profile");
} else console.log("ok  timestamp-only or stale indemnity stays stale on Profile");
const staleIndemnityHtml = await views.viewAccount("indemnity");
for (const marker of [
  "A new version of the Indemnity is available",
  'data-doc-accept="indemnity"',
  'name="signature"',
  'name="signedAt"',
  'name="emergencyRelationship"',
  "Accept &amp; Confirm",
  "Edit in Membership Details",
]) {
  if (!staleIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL stale Indemnity page missing "${marker}"`);
  }
}
console.log("ok  stale indemnity page renders the re-sign flow");
if (staleIndemnityHtml.includes('name="indemnityAccept"') || !/data-doc-submit[^>]*disabled/.test(staleIndemnityHtml)) {
  failures++;
  console.error("FAIL stale Indemnity should use one modal acknowledgement to unlock Accept & Confirm");
} else console.log("ok  stale Indemnity uses one modal acknowledgement to unlock Accept & Confirm");
for (const marker of [
  'await store.acceptMyIndemnity({',
  'signature: fd.get("signature") || ""',
  'signedAt: fd.get("signedAt") || ""',
  'emergencyRelationship: fd.get("emergencyRelationship") || ""',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL Profile > Indemnity handler missing structured contract: ${marker}`);
  }
}
console.log("ok  Profile > Indemnity handler bridges the structured contract");
store.currentUser().indemnityAcceptedAt = null;
store.currentUser().indemnityFormVersion = null;
if (!(await views.viewAccount()).includes("To be accepted")) {
  failures++;
  console.error('FAIL unaccepted indemnity should read "To be accepted"');
} else console.log('ok  unaccepted indemnity reads "To be accepted"');
if (!(await views.viewAccount("indemnity")).includes("Accept &amp; Confirm")) {
  failures++;
  console.error("FAIL indemnity page missing Accept & Confirm");
} else console.log("ok  indemnity page offers Accept & Confirm");

// --- Profile > Indemnity: one modal acknowledgement + full document button ---
const indemnityPageHtml = await views.viewAccount("indemnity");
if (!indemnityPageHtml.includes("View as full document")) {
  failures++;
  console.error('FAIL Profile > Indemnity should expose a "View as full document" button');
} else console.log('ok  Profile > Indemnity exposes "View as full document" button');
if (!indemnityPageHtml.includes('data-action="open-doc" data-doc="indemnity"')) {
  failures++;
  console.error('FAIL Profile > Indemnity button should target the indemnity document');
} else console.log("ok  Profile > Indemnity button targets the indemnity document");
if (indemnityPageHtml.includes('class="doc-content"')) {
  failures++;
  console.error("FAIL Profile > Indemnity should not duplicate the full document inline");
} else console.log("ok  Profile > Indemnity uses the modal as its only document reader");
store.acceptIndemnity(store.currentUser().id, {
  signature: "Test Person",
  signedAt: data.isoDate(data.todayLocal()),
  emergencyRelationship: "Sibling",
});
if (!(await views.viewAccount()).includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL acceptIndemnity did not confirm on Profile");
} else console.log("ok  acceptIndemnity confirms on Profile");
if (!views.viewHome().includes("Nothing booked this week")) {
  failures++;
  console.error('FAIL "My week" should prompt when the member has no bookings');
} else console.log('ok  "My week" empty state prompts to book');
await check("checkout (member)", () => views.viewCheckout(paid.id));

// --- document registry (indemnity + privacy + guidelines) ---
const docsModule = await import("./js/documents.js");
const DOCS = docsModule.DOCUMENTS;
if (docsModule.INDEMNITY_VERSION !== "v1") {
  failures++;
  console.error(`FAIL indemnity version should be v1, got ${docsModule.INDEMNITY_VERSION}`);
}
if (DOCS.indemnity?.title !== "Indemnity") {
  failures++;
  console.error(`FAIL indemnity title should be Indemnity, got ${DOCS.indemnity?.title}`);
}
for (const key of ["indemnity", "privacy", "guidelines"]) {
  if (!DOCS[key] || typeof DOCS[key].renderBody !== "function" || !DOCS[key].title) {
    failures++;
    console.error(`FAIL documents registry missing entry for "${key}"`);
  }
}
console.log("ok  documents registry exposes indemnity + privacy + guidelines");
for (const [key, expected] of [["indemnity", false], ["privacy", true], ["guidelines", true]]) {
  if (!!DOCS[key]?.provisional !== expected) {
    failures++;
    console.error(`FAIL ${key} provisional watermark flag expected ${expected}, got ${!!DOCS[key]?.provisional}`);
  }
}
console.log("ok  document registry scopes provisional watermarks by document");

const indemnityBody = DOCS.indemnity?.renderBody?.() || "";
for (const marker of [
  "ITC Hyrox Training - Liability Release &amp; Data Privacy Form",
  "Hyrox Training from the date of signing to 31 December 2026",
]) {
  if (!indemnityBody.includes(marker)) {
    failures++;
    console.error(`FAIL indemnity document missing opening marker "${marker}"`);
  }
}
for (const [clause, phrase] of [
  ["1", "to assume and accept all and any risks"],
  ["2", "to waive any and all claims"],
  ["3", "to release:"],
  ["4", "to hold harmless and indemnify:"],
  ["5", "that appropriate insurance shall be taken out by me"],
  ["6", "the leaders of ITC and/or IECC have the right"],
  ["7", "that my level of physical fitness is adequate"],
  ["8", "that this Form shall be effective and binding"],
  ["9", "that I agree to the personal data privacy statement"],
  ["10", "that the laws of Hong Kong shall govern this Form"],
]) {
  if (!indemnityBody.includes(`data-clause="${clause}"`) || !indemnityBody.includes(phrase)) {
    failures++;
    console.error(`FAIL indemnity document missing clause ${clause}: "${phrase}"`);
  }
}
if (!indemnityBody.includes("https://www.islandecc.hk/privacy-policy/")) {
  failures++;
  console.error("FAIL indemnity document missing the IECC privacy-policy URL");
}
for (const removed of [
  "Health declaration",
  "Participation at my own risk",
  "Draft — pending ITC leadership review",
]) {
  if (indemnityBody.includes(removed)) {
    failures++;
    console.error(`FAIL indemnity document still contains draft marker "${removed}"`);
  }
}
console.log("ok  indemnity registry exposes versioned Hyrox legal copy");

for (const [key, headings] of Object.entries({
  privacy: [
    "What we collect",
    "Why we collect it",
    "Who sees it",
    "Your choices",
  ],
  guidelines: [
    "Everyone is welcome",
    "Respect and encouragement",
    "Safety first",
    "Photos and media",
    "Conduct",
  ],
})) {
  const body = DOCS[key]?.renderBody?.() || "";
  for (const heading of headings) {
    if (!body.includes(heading)) {
      failures++;
      console.error(`FAIL ${key} document missing heading "${heading}"`);
    }
  }
}
console.log("ok  privacy and guidelines registry bodies still expose their section headings");

// --- modal component: scroll-end math (Task 2) ---
const components = await import("./js/components.js");
if (components.SCROLL_END_THRESHOLD_PX !== 4) {
  failures++;
  console.error(`FAIL scroll-end threshold should be 4, got ${components.SCROLL_END_THRESHOLD_PX}`);
} else console.log("ok  scroll-end threshold is 4px");

const scrollCases = [
  [100, 200, 300, true],   // 300 >= 296
  [50, 200, 300, false],   // 250 < 296
  [0, 200, 200, true],     // everything fits, 200 >= 196
  [0, 100, 50, true],      // degenerate: doc smaller than viewport
];
for (const [top, height, scroll, expected] of scrollCases) {
  const got = components.isAtScrollEnd(top, height, scroll);
  if (got !== expected) {
    failures++;
    console.error(`FAIL isAtScrollEnd(${top},${height},${scroll}) expected ${expected}, got ${got}`);
  }
}
console.log("ok  isAtScrollEnd math returns correct values for 4 cases");

// --- generalized modal API ---
if (typeof components.openReadAndAcceptModal !== "function") {
  failures++;
  console.error("FAIL components should export openReadAndAcceptModal");
} else console.log("ok  components exports openReadAndAcceptModal");

// --- applyDocumentAcceptance: scoped per document container ---
const mkContainer = () => {
  const checkbox = { disabled: true, checked: false };
  const submit = { disabled: true };
  const hint = { hidden: false };
  return {
    checkbox,
    submit,
    hint,
    el: {
      querySelector: (sel) =>
        sel === "[data-doc-checkbox]" ? checkbox
        : sel === "[data-doc-submit]" ? submit
        : sel === "[data-doc-hint]" ? hint
        : null,
    },
  };
};
const indemnityC = mkContainer();
const privacyC = mkContainer();
const guidelinesC = mkContainer();
const privacyTrigger = { closest: (sel) => (sel === "[data-doc-accept]" ? privacyC.el : null) };
if (components.applyDocumentAcceptance(privacyTrigger) !== true) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should return true when a container is paired");
}
if (privacyC.checkbox.disabled !== false || privacyC.checkbox.checked !== true || privacyC.submit.disabled !== false || privacyC.hint.hidden !== true) {
  failures++;
  console.error("FAIL applyDocumentAcceptance did not unlock the privacy checkbox, submit button, and hint");
}
if (indemnityC.checkbox.checked || guidelinesC.checkbox.checked || indemnityC.submit.disabled !== true || guidelinesC.submit.disabled !== true || indemnityC.hint.hidden || guidelinesC.hint.hidden) {
  failures++;
  console.error("FAIL applyDocumentAcceptance mutated a container other than the trigger's");
}
const submitOnly = {
  submit: { disabled: true },
  hint: { hidden: false },
  querySelector: (sel) =>
    sel === "[data-doc-submit]" ? submitOnly.submit
    : sel === "[data-doc-hint]" ? submitOnly.hint
    : null,
};
const submitOnlyTrigger = { closest: (sel) => (sel === "[data-doc-accept]" ? submitOnly : null) };
if (components.applyDocumentAcceptance(submitOnlyTrigger) !== true || submitOnly.submit.disabled || !submitOnly.hint.hidden) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should unlock a submit-only document container");
}
console.log("ok  applyDocumentAcceptance mutates only the trigger's document container");

// applyDocumentAcceptance: returns false when no container is paired (Profile trigger)
const orphanTrigger = { closest: () => null };
if (components.applyDocumentAcceptance(orphanTrigger) !== false) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should return false when no container is found");
} else console.log("ok  applyDocumentAcceptance returns false for orphan triggers");

// --- modal CSS classes present (Task 3) ---
const stylesSource = readFileSync(resolve(__dirnameSmoke, "styles.css"), "utf8");
for (const cls of [
  ".modal-backdrop",
  ".modal-dialog",
  ".modal-header",
  ".modal-doc",
  ".modal-doc-body",
  ".modal-doc-ack",
  ".modal-link",
  ".check input[disabled] + span",
]) {
  if (!stylesSource.includes(cls)) {
    failures++;
    console.error(`FAIL styles.css missing rule for "${cls}"`);
  }
}
if (!stylesSource.includes(".modal-doc-body.doc-provisional::after")) {
  failures++;
  console.error("FAIL modal document watermark should be scoped to provisional documents");
}
if (stylesSource.includes(".modal-doc-body::after {")) {
  failures++;
  console.error("FAIL modal document watermark should not apply to every document body");
}
console.log("ok  styles.css contains all modal-related class definitions");

// --- HYROX payment system: reserve -> mark -> collector confirm (Task 2) ---
const bftSession = allUpcoming.find(
  (s) => s.activityId === "hyrox" && !data.sessionStarted(s)
);
if (!bftSession) throw new Error("expected an upcoming BFT session");
const before = store.spotsLeft(bftSession);
const reservationNow = Date.now();
const r1 = store.reserveSession(signIn.user.id, bftSession, reservationNow);
if (r1.status !== "reserved") throw new Error("new booking should be reserved");
if (r1.payDeadlineAt !== data.nextPayDeadline(bftSession.dateISO, reservationNow))
  throw new Error("reservation deadline should follow the checkpoint rule");
const after = store.spotsLeft(bftSession);
if (after !== before - 1) throw new Error(`reserved spot not held (${before} -> ${after})`);
console.log(`ok  reservation holds a spot ${before} -> ${after}`);
let dup = null;
try { store.reserveSession(signIn.user.id, bftSession); } catch (e) { dup = e; }
if (!dup) throw new Error("double reservation should be rejected");
console.log("ok  double booking rejected");
store.markBookingPaid(r1.id, "PayMe", "REF123");
if (!store.getBooking(r1.id).paymentMarkedAt) throw new Error("payment not marked");
const tinaNotes = store.notificationsFor("fixture-admin");
if (!tinaNotes.some((n) => n.kind === "payment-marked"))
  throw new Error("collector should be notified of a marked payment");
console.log("ok  member marks paid -> collector notified");
store.signIn("admin@example.test");
const conf = store.confirmBookingPayment(r1.id);
store.signIn(signIn.user.email);
if (conf.booking.status !== "confirmed") throw new Error("collector confirm should confirm");
if (conf.receipt.method !== "PayMe") throw new Error("receipt should record the method");
if (!store.receiptForBooking(r1.id)) throw new Error("receipt should attach to the booking");
console.log("ok  collector confirms -> booking confirmed + receipt (PayMe)");
const booking = conf.booking, receipt = conf.receipt;
const bookedActivityLink = `href="#/activity/${booking.sessionId}"`;
const approvedHome = views.viewHome();
if (!approvedHome.includes("My Week") || !approvedHome.includes(booking.snapshot.name)
    || !approvedHome.includes(bookedActivityLink)) {
  throw new Error("approved Home must show the confirmed future booking in My Week");
}
for (const session of allUpcoming.filter((item) => item.id !== booking.sessionId)) {
  if (approvedHome.includes(`href="#/activity/${session.id}"`)) {
    throw new Error("approved My Week must exclude unbooked sessions");
  }
}
for (const status of ["reserved", "deferred", "cancelled", "attended"]) {
  try {
    booking.status = status;
    if (views.viewHome().includes(bookedActivityLink)) {
      throw new Error(`approved My Week must exclude ${status} bookings`);
    }
  } finally {
    booking.status = "confirmed";
  }
}
const futureSnapshotDateISO = booking.snapshot.dateISO;
const futureSnapshotStartTime = booking.snapshot.startTime;
try {
  booking.snapshot.dateISO = "2000-01-01";
  booking.snapshot.startTime = "00:00";
  if (views.viewHome().includes(bookedActivityLink)) {
    throw new Error("approved My Week must exclude confirmed bookings whose snapshot has started");
  }
} finally {
  booking.snapshot.dateISO = futureSnapshotDateISO;
  booking.snapshot.startTime = futureSnapshotStartTime;
}
if (!views.viewHome().includes(bookedActivityLink)) {
  throw new Error("confirmed future booking fixture must be restored after My Week mutations");
}
await check("booking confirmation", () => views.viewBooking(booking.id));
await check("receipt", () => views.viewReceipt(receipt.id));
await check("activity (member, booked)", () => views.viewActivity(paid.id));

// the booked class is badged on Home "My week" and on the Schedule row;
// "My week" shows booked sessions only, so unbooked ones stay out
const homeBooked = views.viewHome();
if (!homeBooked.includes("Booked") || !homeBooked.includes("BFT Causeway Bay")) {
  failures++;
  console.error('FAIL home "My week" does not show the booked session');
} else console.log('ok  home "My week" shows the booked session');
if (homeBooked.includes("Midtown 28") || homeBooked.includes("Just show up")) {
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

// the member's only booking is an upcoming confirmed session, so History
// is empty — past bookings live behind the History card, not inline on Profile
if ((await views.viewAccount()).includes("booking-card")) {
  failures++;
  console.error("FAIL Profile should not list history inline");
} else console.log("ok  Profile keeps history behind the card");
const histHtml = await views.viewAccount("history");
if (histHtml.includes("booking-card") || !histHtml.includes("Past sessions will appear here")) {
  failures++;
  console.error("FAIL History sub-page should hide upcoming confirmed bookings");
} else console.log("ok  History sub-page hides upcoming bookings");

// --- Seeded member view ---
installLocalFixtures(); store.signIn("member@example.test");
await check("account (seeded member)", () => views.viewAccount());
const memberAcct = await views.viewAccount();
// fixture-member has donorId TEST-1234
if (!(await views.viewAccount("donor")).includes("TEST-1234")) {
  failures++;
  console.error("FAIL seeded member donor ID not shown in Donor Profile");
} else console.log("ok  seeded member donor ID shown in Donor Profile");
if (memberAcct.includes("TEST-1234")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  seeded member card faces carry no donor details");
// Seeded receipts (ITC-2026-0048) are removed; Payments shows receipts created during the test.
if ((await views.viewAccount("payments")).includes("ITC-2026-0048")) {
  failures++;
  console.error("FAIL seeded receipts should not be present in fresh state");
} else console.log("ok  no demo receipts are present");
if (!memberAcct.includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL seeded member should have indemnity confirmed");
} else console.log("ok  seeded member indemnity confirmed");
if (!memberAcct.includes('class="kicker">Profile</div>') || memberAcct.includes("Member Profile") || memberAcct.includes("’s training")) {
  failures++;
  console.error('FAIL Profile header should read "Profile" with no name headline');
} else console.log('ok  Profile header reads "Profile"');
if (memberAcct.includes("member@example.test")) {
  failures++;
  console.error("FAIL email should not appear on the Profile face");
} else console.log("ok  Profile face carries no contact details");
if (!(await views.viewAccount("details")).includes("member@example.test")) {
  failures++;
  console.error("FAIL email missing from Membership Details sub-page");
} else console.log("ok  email lives on Membership Details sub-page");
installLocalFixtures({ withMemberBooking: true });
store.signIn("member@example.test");
await check("home (member)", () => views.viewHome());
const memberHome = views.viewHome();
const fixtureMember = store.currentUser();
const fixtureBookings = store.bookingsForUser(fixtureMember.id);
const bookedMarker = fixtureBookings[0]?.snapshot?.location ?? "BFT Causeway Bay";
const otherMarker = "Midtown 28";
if (!memberHome.includes(bookedMarker) || memberHome.includes(otherMarker)) {
  failures++;
  console.error(`FAIL "My week" should show only the member's booked HYROX (${bookedMarker})`);
} else console.log(`ok  "My week" shows only the member's booked session (${bookedMarker})`);
// community: prayer request records locally (no public reader by design)
const member = store.currentUser();
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
    { id: "legacy-member", role: "member", status: "approved", fullName: "Legacy", email: "legacy1@example.test", donorId: "CHUI08879" },
    { id: "legacy-admin", role: "admin", status: "approved", fullName: "Legacy Admin", email: "legacy2@example.test", donorId: "not a real id" },
  ];
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const allUsers = store.allUsers();
  const fixed = allUsers.find((u) => u.id === "legacy-member")?.donorId;
  if (fixed !== "CHUI-08879") {
    failures++;
    console.error(`FAIL v7 migration should repair CHUI08879 -> CHUI-08879, got ${fixed}`);
  } else console.log("ok  v7 migration inserts the missing hyphen");
  const cleared = allUsers.find((u) => u.id === "legacy-admin")?.donorId;
  if (cleared !== null) {
    failures++;
    console.error(`FAIL v7 migration should clear unrecognizable donor ID, got ${cleared}`);
  } else console.log("ok  v7 migration clears unrecognizable donor ID");
}

// --- HYROX payment system: deadline helpers (Task 1) ---
{
  const sat = "2026-08-08"; // a Saturday
  const main = new Date(data.mainDeadlineFor(sat));
  const fin = new Date(data.finalCheckpointFor(sat));
  if (main.getDay() !== 4 || main.getHours() !== 18 || main.getMinutes() !== 0)
    throw new Error("main deadline should be Thursday 18:00");
  if (fin.getDay() !== 5 || fin.getHours() !== 14 || fin.getMinutes() !== 0)
    throw new Error("final checkpoint should be Friday 14:00");
  const before = data.parseISO(sat).getTime() - 7 * 24 * 3600 * 1000; // a week early
  if (data.nextPayDeadline(sat, before) !== data.mainDeadlineFor(sat))
    throw new Error("before Thursday: deadline should be the main checkpoint");
  const between = data.mainDeadlineFor(sat) + 3600 * 1000; // Thursday evening
  if (data.nextPayDeadline(sat, between) !== data.finalCheckpointFor(sat))
    throw new Error("after Thursday: deadline should be the Friday checkpoint");
  const late = data.finalCheckpointFor(sat) + 3600 * 1000; // Friday afternoon
  if (data.nextPayDeadline(sat, late) !== late + data.LAST_MINUTE_WINDOW_MS)
    throw new Error("after Friday checkpoint: deadline should be now + 2h");
  console.log("ok  deadline checkpoints (Thu 18:00 / Fri 14:00 / 2h window)");
}
{
  const bft = store.activities().find((a) => a.id === "hyrox");
  const mid = store.activities().find((a) => a.id === "hyrox-midtown");
  if (bft.capacity !== 20 || mid.capacity !== 12)
    throw new Error("HYROX capacities should be BFT 20 / Midtown 12");
  console.log("ok  seeds: capacities 20/12");
}
{
  // v9 migration: persist a v8-shaped snapshot and reload
  const raw = localStorage.getItem("itc.prototype.v1");
  const snap = JSON.parse(raw);
  snap.version = 8;
  delete snap.sessionOverrides; delete snap.queues; delete snap.duty; delete snap.notifications;
  const bft = snap.activities.find((a) => a.id === "hyrox");
  const mid = snap.activities.find((a) => a.id === "hyrox-midtown");
  bft.capacity = 18; mid.capacity = 18;
  for (const u of snap.users) { delete u.paymeLink; delete u.fpsPhone; }
  localStorage.setItem("itc.prototype.v1", JSON.stringify(snap));
  store.load();
  const bft2 = store.activities().find((a) => a.id === "hyrox");
  const mid2 = store.activities().find((a) => a.id === "hyrox-midtown");
  if (bft2.capacity !== 20 || mid2.capacity !== 12) throw new Error("v9 migration must fix capacities");
  console.log("ok  v9 migration: capacities fixed");
}

// --- HYROX payment system: sweep + cascade (Task 3) ---
store.resetLocalData();
installLocalFixtures(); store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s) &&
      !store.userBookingFor(store.currentUser().id, s.id)
  );
  // Fill the session with confirmed bookings so only the reservation holds a spot.
  // We register a fleet of fixture-member-* users and pay for them.
  const fill = store.reserveSession(store.currentUser().id, sess);
  const st = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const act = st.activities.find((a) => a.id === "hyrox");
  const fleet = [];
  for (let i = 0; i < act.capacity - 1; i++) {
    const id = `cascade-fixture-${i}`;
    st.users.push({
      id, role: "member", status: "approved", fullName: `Cascade ${i}`,
      preferredName: `C${i}`, email: `${id}@example.test`, phone: "+852 5555 0000",
      emergencyName: "x", emergencyPhone: "+852 5555 9999", heard: "test",
      isMinor: false, appliedAt: Date.now() - 86400000,
      indemnityAcceptedAt: Date.now() - 86400000,
      privacyAcceptedAt: Date.now() - 86400000,
      whatsappReminders: false, emailReceipts: false, communityNews: false,
    });
    st.bookings.push({
      id: `cascade-b-${i}`, userId: id, sessionId: sess.id,
      status: "confirmed", createdAt: Date.now() - 86400000,
      snapshot: {
        name: sess.name, kind: sess.kind, dateISO: sess.dateISO,
        time: sess.time, durationMin: sess.durationMin, location: sess.location,
        price: sess.price,
      },
    });
    fleet.push(id);
  }
  st.queues = st.queues || {};
  st.queues[sess.id] = { waitlist: [{ userId: "fixture-admin", joinedAt: Date.now() }], interest: [] };
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st));
  store.load();
  installLocalFixtures(); store.signIn("member@example.test");
  // expire the held reservation and sweep
  const st2 = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const held = st2.bookings.find((b) => b.id === fill.id);
  held.payDeadlineAt = Date.now() - 1000;
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st2));
  store.load();
  if (store.getBooking(fill.id).status !== "expired") throw new Error("overdue reservation should expire");
  const promoted = store.userReservationFor("fixture-admin", sess.id);
  if (!promoted) throw new Error("freed spot should cascade to waitlist #1");
  const memberNotes = store.notificationsFor("fixture-member");
  if (!memberNotes.some((n) => n.kind === "reservation-expired")) throw new Error("member should be told their reservation expired");
  const adminNotes = store.notificationsFor("fixture-admin");
  if (!adminNotes.some((n) => n.kind === "waitlist-promoted")) throw new Error("promoted member should be notified");
  console.log("ok  sweep expires overdue reservation and cascades to waitlist #1");
}

// --- HYROX payment system: queues + tie-break (Task 4) ---
store.resetLocalData();
installLocalFixtures();
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const p1 = store.joinWaitlist("fixture-member", sess.id);
  const p2 = store.joinWaitlist("fixture-admin", sess.id);
  if (p1 !== 1 || p2 !== 2) throw new Error("waitlist positions should be join order");
  if (store.waitlistPosition("fixture-admin", sess.id) !== 2) throw new Error("position lookup failed");
  store.leaveWaitlist("fixture-member", sess.id);
  if (store.waitlistPosition("fixture-admin", sess.id) !== 1) throw new Error("positions should close ranks");
  console.log("ok  waitlist join/leave keeps honest positions");
}
{
  // both-queues tie-break: reserved at BFT + reserved at Midtown (opened) +
  // waitlisted at BFT's sibling... paying for one releases the rest
  const sat = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id)
  );
  const mid = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-midtown" && s.dateISO === sat.dateISO
  );
  const st = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  st.sessionOverrides[mid.id] = { midtownOpen: true };
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st));
  store.load();
  const bBft = store.reserveSession("fixture-member", sat);
  const bMid = store.reserveSession("fixture-member", mid);
  store.markBookingPaid(bBft.id, "FPS", "");
  store.confirmBookingPayment(bBft.id);
  if (store.getBooking(bMid.id).status !== "cancelled")
    throw new Error("paying for BFT should release the Midtown reservation");
  const promotedMid = store.notificationsFor("fixture-member");
  if (!promotedMid.some((n) => n.kind === "hold-released"))
    throw new Error("member should be told the other hold was released");
  console.log("ok  paying for one venue releases the other venue's hold");
}
// queue join guards existing bookings
{
  const sess = store.upcomingSessions(21).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const b = store.reserveSession("fixture-member", sess);
  let threw = null;
  try { store.joinWaitlist("fixture-member", sess.id); } catch (e) { threw = e; }
  if (!threw) throw new Error("joinWaitlist should reject a member who already holds the session");
  store.releaseReservation(b.id);
  console.log("ok  queue join rejects already-booked members");
}

// --- HYROX payment system: Midtown open auto-converts (Task 5) ---
store.resetLocalData();
installLocalFixtures();
{
  const mid = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-midtown" && !data.sessionStarted(s)
  );
  store.joinInterest("fixture-member", mid.id);
  store.joinInterest("fixture-admin", mid.id);
  // shrink capacity to 1 so only the first interested member converts
  const st = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const act = st.activities.find((a) => a.id === "hyrox-midtown");
  act.capacity = 1;
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st));
  store.load();
  store.setMidtownOpen(mid.id, true);
  const converted = store.userReservationFor("fixture-member", mid.id);
  if (!converted) throw new Error("first interested member should get a reserved spot");
  if (store.waitlistPosition("fixture-admin", mid.id) !== 1)
    throw new Error("leftover interest should become the waitlist");
  if (!store.notificationsFor("fixture-member").some((n) => n.kind === "midtown-open"))
    throw new Error("converted member should be notified with a pay deadline");
  console.log("ok  Midtown open converts interest in order, rest waitlist");
}

// --- HYROX payment system: deferral + week cancellation (Task 6) ---
store.resetLocalData();
installLocalFixtures(); store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const b = store.reserveSession("fixture-member", sess);
  store.markBookingPaid(b.id, "PayMe", "");
  store.signIn("admin@example.test");
  store.confirmBookingPayment(b.id);
  store.signIn("member@example.test");
  const targets = store.deferTargetsFor(store.getBooking(b.id));
  if (!targets.length) throw new Error("expected future defer targets");
  if (targets.some((t) => t.id === sess.id)) throw new Error("own session is not a defer target");
  const moved = store.deferBooking(b.id, targets[0].id);
  if (moved.status !== "confirmed") throw new Error("paid deferral should stay confirmed");
  if (store.getBooking(b.id).status !== "deferred") throw new Error("original should read deferred");
  if (store.receiptForBooking(moved.id)?.bookingId !== moved.id)
    throw new Error("receipt should follow the deferred booking");
  if (!store.notificationsFor("fixture-admin").some((n) => n.kind === "defer"))
    throw new Error("collector should be notified of the deferral");
  console.log("ok  paid deferral moves booking + receipt, notifies collector");
}
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const b = store.reserveSession("fixture-member", sess);
  store.markBookingPaid(b.id, "FPS", "");
  store.signIn("admin@example.test");
  store.confirmBookingPayment(b.id);

  store.joinWaitlist("fixture-admin", sess.id);
  store.cancelSessionWeek(sess.id, "HYROX race weekend — no session");
  const after = store.getSession(sess.id);
  if (!after.cancelled || after.cancelReason !== "HYROX race weekend — no session")
    throw new Error("cancelled week should carry the reason");
  if (store.getBooking(b.id).status !== "deferred")
    throw new Error("paid booking should auto-defer on week cancellation");
  if (store.waitlistPosition("fixture-admin", sess.id) !== null)
    throw new Error("waitlist should dissolve on week cancellation");
  if (!store.notificationsFor("fixture-admin").some((n) => n.kind === "session-cancelled"))
    throw new Error("waitlisted member should be notified of the cancellation");
  console.log("ok  cancelled week: reason, auto-defer, queue dissolved");
}
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s)
  );
  store.setSessionTime(sess.id, "10:00");
  store.setVenueTBC(sess.id, true);
  store.setSessionNotice(sess.id, "Weather watch — check WhatsApp Saturday morning");
  const s = store.getSession(sess.id);
  if (s.time !== "10:00" || !s.venueTBC || s.location !== "TBC" || !s.notice)
    throw new Error("session overrides should decorate the session");
  console.log("ok  session overrides: time change, venue TBC, notice");
}

// --- HYROX payment system: duty roster (Task 7) ---
store.resetLocalData();
installLocalFixtures();
// Add a second admin so we can exercise a handover.
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.users.push({
    id: "fixture-super", role: "superadmin", status: "approved",
    fullName: "Test Super", preferredName: "Super",
    email: "super@example.test", phone: "+852 5000 0003",
    emergencyName: "Test", emergencyPhone: "+852 5000 9003", heard: "Test",
    isMinor: false, appliedAt: Date.now() - 86400000,
    indemnityAcceptedAt: Date.now() - 86400000,
    privacyAcceptedAt: Date.now() - 86400000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
}
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s)
  );
  // No duty set yet → collectorFor falls back to the first approved admin.
  if (store.collectorFor(sess.id)?.id !== "fixture-admin")
    throw new Error("default collector should fall back to fixture-admin");
  // Setting duty with a non-admin user is silently rejected.
  store.setDuty("fixture-member", sess.dateISO);
  if (store.collectorFor(sess.id)?.id !== "fixture-admin")
    throw new Error("setDuty should ignore non-admin users");
  // Handover to the second admin.
  store.setDuty("fixture-super", sess.dateISO);
  if (store.dutyFor(sess.id)?.userId !== "fixture-super")
    throw new Error("dutyFor should record the handover");
  if (store.collectorFor(sess.id)?.id !== "fixture-super")
    throw new Error("collectorFor should follow the handover");
  // Collector payout details save.
  store.updateCollectorPayouts("fixture-super", {
    paymeLink: "https://payme.hsbc.com.hk/test-super",
    fpsPhone: "+852 1111 2222",
  });
  const c = store.collectorFor(sess.id);
  if (c.paymeLink !== "https://payme.hsbc.com.hk/test-super"
      || c.fpsPhone !== "+852 1111 2222")
    throw new Error("collector payout details should save");
  console.log("ok  duty switch changes whose PayMe/FPS details are shown");
}

// --- HYROX payment system: schedule & activity surfacing (Task 8) ---
store.resetLocalData();
installLocalFixtures();
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s)
  );
  store.setSessionNotice(sess.id, "Weather watch — check WhatsApp");
  views.scheduleState.selected = sess.dateISO;
  const row = views.viewSchedule();
  if (!row.includes("Weather watch"))
    throw new Error("schedule row should surface the notice");
  console.log("ok  schedule row surfaces session notice");
  store.cancelSessionWeek(sess.id, "HYROX race weekend — no session");
  views.scheduleState.selected = sess.dateISO;
  const sched = views.viewSchedule();
  if (!sched.includes("Cancelled") || !sched.includes("HYROX race weekend"))
    throw new Error("cancelled week must show in Schedule with badge + reason");
  const detail = views.viewActivity(sess.id);
  if (!detail.includes("HYROX race weekend"))
    throw new Error("detail page should show the reason");
  console.log("ok  cancelled week shows in Schedule (badge + reason) and detail");
}
{
  const mid = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-midtown" && !data.sessionStarted(s)
  );
  views.scheduleState.selected = mid.dateISO;
  if (!views.viewSchedule().includes("Not yet open"))
    throw new Error("closed Midtown should read Not yet open in Schedule");
  store.signIn("member@example.test");
  const detail = views.viewActivity(mid.id);
  if (!detail.includes('data-action="join-interest"'))
    throw new Error("closed Midtown should offer wait-for-Midtown");
  console.log("ok  closed Midtown: badge + interest action");
}

// --- HYROX payment system: member payment UI (Task 9) ---
store.resetLocalData();
installLocalFixtures();
store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s)
  );
  const co = views.viewCheckout(sess.id);
  if (typeof co !== "string" || co.includes("Card number") || !co.includes('id="form-reserve"'))
    throw new Error("checkout should be a reserve screen (no card form)");
  console.log("ok  checkout is now a reserve screen");
  const b = store.reserveSession("fixture-member", sess);
  const pay = views.viewPay(b.id);
  if (!pay.includes("PayMe to") || !pay.includes("FPS to") || !pay.includes("HK$"))
    throw new Error("pay screen should show PayMe/FPS to the collector + amount");
  if (!pay.includes("Admin"))
    throw new Error("pay screen should name the on-duty collector");
  console.log("ok  pay screen shows collector PayMe/FPS + amount");
  store.markBookingPaid(b.id, "PayMe", "");
  const awaiting = views.viewBooking(b.id);
  if (!awaiting.includes("being confirmed"))
    throw new Error("booking should show awaiting confirmation");
  console.log("ok  booking shows awaiting-confirmation state");
  store.signIn("admin@example.test");
  store.confirmBookingPayment(b.id);
  store.signIn("member@example.test");
  const conf = views.viewBooking(b.id);
  if (!conf.includes('data-action="defer-to"'))
    throw new Error("confirmed booking should offer defer targets");
  if (conf.includes("Cancel & refund"))
    throw new Error("member refund flow should be gone");
  console.log("ok  confirmed booking offers defer, no member refund");
}

// --- HYROX payment system: admin ops (Task 10) ---
store.resetLocalData();
installLocalFixtures();
store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox" && !data.sessionStarted(s)
  );
  const b = store.reserveSession("fixture-member", sess);
  store.markBookingPaid(b.id, "FPS", "9921");
  store.signIn("admin@example.test");
  const ops = await views.viewAdmin("payments");
  if (!ops.includes("Payments / Ops") || (ops.match(/aria-current="page"/g) || []).length !== 1)
    throw new Error("Admin payments tab should be labeled and expose one active tab");
  if (!ops.includes("Pending payments") || !ops.includes("9921"))
    throw new Error("ops should list pending payments with references");
  if (!ops.includes('data-action="confirm-payment"'))
    throw new Error("pending payments need a confirm action");
  console.log("ok  ops lists pending payments for the collector");
  if (!ops.includes("Finalize with gym") || !ops.includes("wa.me"))
    throw new Error("ops should include the finalize card with a WhatsApp link");
  if (!ops.toLowerCase().includes("duty"))
    throw new Error("ops should include the duty card");
  console.log("ok  ops has finalize-with-gym (WhatsApp) + duty cards");
  const conf = store.confirmBookingPayment(b.id);
  if (!conf) throw new Error("collector confirm failed from ops flow");
  console.log("ok  collector confirms payment from ops");
}

// --- Reset ---
store.resetLocalData();
console.log("ok  reset");

// --- v10 cleanup: fresh state, no demo UI, no simulated demand, no demo queues/duty ---
{
  const fresh = JSON.parse(mem.get("itc.prototype.v1"));
  if (Array.isArray(fresh.users) && fresh.users.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero users");
  } else console.log("ok  v10 fresh state has zero users");
  if (Array.isArray(fresh.bookings) && fresh.bookings.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero bookings");
  } else console.log("ok  v10 fresh state has zero bookings");
  if (Array.isArray(fresh.receipts) && fresh.receipts.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero receipts");
  } else console.log("ok  v10 fresh state has zero receipts");
  if (!fresh.paymentPayouts || Array.isArray(fresh.paymentPayouts)
      || Object.keys(fresh.paymentPayouts).length) {
    failures++;
    console.error("FAIL v14 fresh state must have an empty UUID-keyed payout map");
  } else console.log("ok  v14 fresh state has an empty UUID-keyed payout map");
  if (Array.isArray(fresh.activities)) {
    for (const a of fresh.activities) {
      if ("baseBooked" in a) {
        failures++;
        console.error(`FAIL v10 fresh state activity ${a.id} must not carry baseBooked`);
      }
    }
  }
  // No seed collectors or duty assignments in fresh state
  if (fresh.duty && Object.keys(fresh.duty).length > 0) {
    failures++;
    console.error("FAIL v10 fresh state must not carry demo duty assignments");
  } else console.log("ok  v10 fresh state has no demo duty");
  if (fresh.queues && Object.keys(fresh.queues).length > 0) {
    failures++;
    console.error("FAIL v10 fresh state must not carry seed queue entries");
  } else console.log("ok  v10 fresh state has no seed queues");
  const accountHtml = await views.viewAccount();
  for (const removed of ["demo-signin", "reset-demo", "one-tap demo", "seeded email"]) {
    if (accountHtml.toLowerCase().includes(removed)) {
      failures++;
      console.error(`FAIL Account still renders removed demo content: ${removed}`);
    }
  }
  for (const email of ["super@example.test", "admin@example.test", "member@example.test",
    "marco@example.test", "jenny@example.test"]) {
    if (accountHtml.includes(email)) {
      failures++;
      console.error(`FAIL Account still exposes demo email ${email}`);
    }
  }
}

// --- v10 mixed migration: known demo records removed, genuine records preserved ---
{
  store.resetLocalData();
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 9;
  raw.users = [
    { id: "u-super", role: "superadmin", status: "approved", fullName: "Demo Super", email: "owner@itc.hk" },
    { id: "u-admin", role: "admin", status: "approved", fullName: "Demo Admin", email: "admin@itc.hk" },
    { id: "u-member", role: "member", status: "approved", fullName: "Demo Member", email: "member@itc.hk" },
    { id: "real-member", role: "member", status: "approved", fullName: "Real Member", email: "real@example.test" },
  ];
  raw.sessionUserId = "u-member";
  raw.bookings = [
    { id: "b-seed-1", userId: "u-member" },
    { id: "b-user-1", userId: "real-member" },
  ];
  raw.receipts = [
    { id: "r-seed-1", bookingId: "b-seed-1", userId: "u-member" },
    { id: "r-user-1", bookingId: "b-user-1", userId: "real-member" },
  ];
  raw.queues = {
    "hyrox-2026-09-05": {
      waitlist: [
        { userId: "u-member", joinedAt: 1 },
        { userId: "real-member", joinedAt: 2 },
      ],
      interest: ["u-member", "real-member"],
    },
  };
  raw.duty = {
    "2026-08-15": { userId: "u-admin", setAt: 1 },
    "2026-08-22": { userId: "real-member", setAt: 1 },
  };
  raw.activities[0].baseBooked = 7;
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  if (!migrated.users.some((u) => u.id === "real-member")) {
    failures++;
    console.error("FAIL v10 migration must keep genuine users");
  } else console.log("ok  v10 migration keeps genuine users");
  for (const demoId of ["u-super", "u-admin", "u-member"]) {
    if (migrated.users.some((u) => u.id === demoId)) {
      failures++;
      console.error(`FAIL v10 migration must remove demo user ${demoId}`);
    }
  }
  if (migrated.bookings.some((b) => b.id === "b-seed-1")) {
    failures++;
    console.error("FAIL v10 migration must remove demo-owned bookings");
  } else console.log("ok  v10 migration removes demo-owned bookings");
  if (!migrated.bookings.some((b) => b.id === "b-user-1")) {
    failures++;
    console.error("FAIL v10 migration must keep genuine bookings");
  } else console.log("ok  v10 migration keeps genuine bookings");
  // Demo entries are removed in both current object and legacy string shapes;
  // genuine entries and their original shape survive.
  const q = migrated.queues?.["hyrox-2026-09-05"];
  if (q?.waitlist.some((entry) => entry.userId === "u-member") || q?.interest.includes("u-member")) {
    failures++;
    console.error("FAIL v13 migration must remove current and legacy demo queue entries");
  } else console.log("ok  v13 migration removes current and legacy demo queue entries");
  if (!q?.waitlist.some((entry) => entry.userId === "real-member" && entry.joinedAt === 2)
      || !q?.interest.includes("real-member")) {
    failures++;
    console.error("FAIL v13 migration must keep current and legacy genuine queue entries");
  } else console.log("ok  v13 migration keeps current and legacy genuine queue entries");
  // Duty reassignment for removed demo collector, but genuine duty survives.
  if (migrated.duty?.["2026-08-15"]?.userId === "u-admin") {
    failures++;
    console.error("FAIL v10 migration must clear duty assignments for removed demo users");
  } else console.log("ok  v10 migration clears demo duty assignments");
  if (migrated.duty?.["2026-08-22"]?.userId !== "real-member") {
    failures++;
    console.error("FAIL v10 migration must keep genuine duty assignments");
  } else console.log("ok  v10 migration keeps genuine duty assignments");
  if (migrated.activities.some((a) => "baseBooked" in a)) {
    failures++;
    console.error("FAIL v10 migration must strip baseBooked from every activity");
  } else console.log("ok  v10 migration strips simulated demand");
  if (migrated.sessionUserId !== null) {
    failures++;
    console.error("FAIL v10 migration must clear session tied to a removed demo user");
  } else console.log("ok  v10 migration clears removed session");
  if (migrated.version !== 14) {
    failures++;
    console.error(`FAIL integrated migration must advance version to 14, got ${migrated.version}`);
  } else console.log("ok  integrated migration advances genuine v9 state to v14");
}

{
  store.resetLocalData();
  const v13 = JSON.parse(mem.get("itc.prototype.v1"));
  v13.version = 13;
  v13.users = [{
    id: "real-v13-member",
    role: "member",
    status: "approved",
    fullName: "Real Member",
    email: "real-v13@example.test",
    indemnityAcceptedAt: 123456789,
  }];
  mem.set("itc.prototype.v1", JSON.stringify(v13));
  store.load();
  const v14 = JSON.parse(mem.get("itc.prototype.v1"));
  const migratedUser = v14.users.find((user) => user.id === "real-v13-member");
  if (v14.version !== 14 || !migratedUser) throw new Error("v14 migration lost the genuine member");
  for (const field of ["indemnitySignature", "indemnitySignedAt", "indemnityFormVersion", "emergencyRelationship"]) {
    if (!(field in migratedUser) || migratedUser[field] !== null) {
      throw new Error(`v14 migration should initialize ${field} to null`);
    }
  }
  if (migratedUser.indemnityAcceptedAt !== 123456789) {
    throw new Error("v14 migration must preserve indemnityAcceptedAt");
  }
  if (store.isIndemnityCurrent(migratedUser)) {
    throw new Error("timestamp-only v13 acceptance must be stale in v14");
  }
  console.log("ok  v14 migration preserves legacy acceptance and initializes consent fields");
}

// --- Install neutral fixtures for local authenticated paths (no demo seeds) ---
function installLocalFixtures({ withMemberBooking = false } = {}) {
  const clean = JSON.parse(mem.get("itc.prototype.v1"));
  const preserved = (clean.users || []).filter((u) =>
    !["fixture-admin", "fixture-member", "fixture-super"].includes(u.id)
  );
  clean.sessionUserId = "fixture-admin";
  clean.users = [
    ...preserved,
    {
      id: "fixture-admin", role: "admin", status: "approved", fullName: "Test Admin",
      preferredName: "Admin", email: "admin@example.test", phone: "+852 5000 0001",
      emergencyName: "Test Contact", emergencyRelationship: "Sibling", emergencyPhone: "+852 5000 9001", heard: "Test fixture",
      isMinor: false, appliedAt: Date.now() - 86400000, indemnityAcceptedAt: Date.now() - 86400000,
      indemnitySignature: "Test Admin", indemnitySignedAt: data.isoDate(data.todayLocal()), indemnityFormVersion: "v1",
      privacyAcceptedAt: Date.now() - 86400000, whatsappReminders: false, emailReceipts: false,
      communityNews: false,
    },
    {
      id: "fixture-member", role: "member", status: "approved", fullName: "Test Member",
      preferredName: "Tester", email: "member@example.test", phone: "+852 5000 0002",
      emergencyName: "Test Contact", emergencyRelationship: "Sibling", emergencyPhone: "+852 5000 9002", heard: "Test fixture",
      mediaConsent: true, donorId: "TEST-1234", isMinor: false,
      appliedAt: Date.now() - 172800000, indemnityAcceptedAt: Date.now() - 172800000,
      indemnitySignature: "Test Member", indemnitySignedAt: data.isoDate(data.todayLocal()), indemnityFormVersion: "v1",
      privacyAcceptedAt: Date.now() - 172800000, whatsappReminders: false,
      emailReceipts: false, communityNews: false,
    },
  ];
  if (withMemberBooking) {
    const upcoming = store.upcomingSessions(14);
    const fixtureMemberSession = upcoming.find((s) => s.activityId === "hyrox" && !data.sessionStarted(s));
    if (fixtureMemberSession) {
      clean.bookings = [
        ...(clean.bookings || []),
        {
          id: "fixture-booking", userId: "fixture-member", sessionId: fixtureMemberSession.id,
          status: "confirmed", createdAt: Date.now(),
          snapshot: {
            name: fixtureMemberSession.name, kind: fixtureMemberSession.kind,
            dateISO: fixtureMemberSession.dateISO, time: fixtureMemberSession.time,
            durationMin: fixtureMemberSession.durationMin, location: fixtureMemberSession.location,
            price: fixtureMemberSession.price,
          },
        },
      ];
    }
  }
  mem.set("itc.prototype.v1", JSON.stringify(clean));
  store.load();
}

// --- Integrated Giving + shape-aware v13 contracts ---
for (const marker of [
  'case "giving"', 'case "giving-amount"', 'case "giving-confirm"',
  'case "campaign-publish"', 'case "campaign-close"', 'case "form-campaign"',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL integrated Giving router missing ${marker}`);
  }
}
for (const api of [
  "updateMyDonorId", "campaigns", "activeGivingCampaign", "listGivingCampaigns",
  "getActiveGivingCampaign", "saveGivingCampaign", "publishGivingCampaign",
  "closeGivingCampaign", "campaignRaised", "donationsForUser", "recordDonation",
]) {
  if (typeof store[api] !== "function") {
    failures++;
    console.error(`FAIL integrated Giving store missing ${api}`);
  }
}

// Exercise the approved-member amount/FPS/thanks/history path and role gates.
const givingFixture = {
  version: 13, sessionUserId: "giving-admin", activities: structuredClone(data.SEED_ACTIVITIES),
  users: [
    { id: "giving-admin", role: "admin", status: "approved", fullName: "Giving Admin", email: "giving-admin@example.test" },
    { id: "giving-member", role: "member", status: "approved", fullName: "Giving Member", email: "giving-member@example.test" },
    { id: "giving-other", role: "member", status: "approved", fullName: "Giving Other", email: "giving-other@example.test" },
    { id: "giving-pending", role: "pending", status: "pending", fullName: "Giving Pending", email: "giving-pending@example.test" },
    { id: "giving-declined", role: "pending", status: "declined", fullName: "Giving Declined", email: "giving-declined@example.test" },
  ],
  bookings: [], receipts: [], campaigns: [], donations: [], prayers: [], notifications: [],
  sessionOverrides: {}, queues: {}, duty: {},
};
mem.set("itc.prototype.v1", JSON.stringify(givingFixture));
store.load();

// Payment access belongs at the state seam, including mutations called
// without rendering their gated controls first.
const paymentGateSession = store.upcomingSessions(14).find(
  (session) => session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
);
if (!paymentGateSession) throw new Error("Payment seam checks need an upcoming paid session");
for (const blockedId of ["giving-pending", "giving-declined", "missing-member"]) {
  for (const mutate of [
    () => store.reserveSession(blockedId, paymentGateSession),
    () => store.joinWaitlist(blockedId, paymentGateSession.id),
    () => store.leaveWaitlist(blockedId, paymentGateSession.id),
    () => store.joinInterest(blockedId, paymentGateSession.id),
    () => store.leaveInterest(blockedId, paymentGateSession.id),
  ]) {
    try {
      mutate();
      throw new Error(`${blockedId} Payment mutation should be rejected`);
    } catch (err) {
      if (!/Approved member access required/.test(err.message)) throw err;
    }
  }
}
const authoritySessions = store.upcomingSessions(42).filter(
  (session) => session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
);
const cancelledAuthoritySession = authoritySessions.find((session) => session.id !== paymentGateSession.id);
const tamperAuthoritySession = authoritySessions.find(
  (session) => session.id !== paymentGateSession.id && session.id !== cancelledAuthoritySession?.id
);
if (!cancelledAuthoritySession || !tamperAuthoritySession) {
  throw new Error("reservation authority regression needs three upcoming paid sessions");
}
store.cancelSessionWeek(cancelledAuthoritySession.id, "Authority regression cancellation");
store.signIn("giving-member@example.test");
try {
  store.reserveSession("giving-member", {
    ...cancelledAuthoritySession, cancelled: false, price: 1, capacity: 999,
  });
  throw new Error("forged uncancelled session should not bypass authoritative cancellation");
} catch (err) {
  if (!/Session is cancelled/.test(err.message)) throw err;
}
try {
  store.reserveSession("giving-member", { id: "unknown-weekly-session", kind: "paid", price: 1, capacity: 999 });
  throw new Error("unknown session ID should not reserve");
} catch (err) {
  if (!/Unknown session/.test(err.message)) throw err;
}
const freeAuthoritySession = store.upcomingSessions(14).find((session) => session.kind === "free");
try {
  store.reserveSession("giving-member", { ...freeAuthoritySession, kind: "paid", price: 1, capacity: 999 });
  throw new Error("forged paid session should not bypass authoritative eligibility");
} catch (err) {
  if (!/Session is not paid/.test(err.message)) throw err;
}
const tamperReservation = store.reserveSession("giving-member", {
  ...tamperAuthoritySession, price: 1, capacity: 999,
});
const authoritativeTamperSession = store.getSession(tamperAuthoritySession.id);
if (tamperReservation.snapshot.price !== authoritativeTamperSession.price
    || tamperReservation.snapshot.capacity !== authoritativeTamperSession.capacity) {
  throw new Error("reservation snapshot must use authoritative price and capacity");
}
if (!store.releaseReservation(tamperReservation.id)) {
  throw new Error("tamper regression cleanup should release the reservation");
}
const beforeFullFixture = JSON.parse(mem.get("itc.prototype.v1"));
for (let i = 0; i < authoritativeTamperSession.capacity; i++) {
  beforeFullFixture.bookings.push({
    id: `authority-full-${i}`, userId: `authority-user-${i}`,
    sessionId: authoritativeTamperSession.id, status: "confirmed", createdAt: Date.now(),
    snapshot: { price: authoritativeTamperSession.price, capacity: authoritativeTamperSession.capacity },
  });
}
mem.set("itc.prototype.v1", JSON.stringify(beforeFullFixture));
store.load();
store.signIn("giving-member@example.test");
try {
  store.reserveSession("giving-member", { ...tamperAuthoritySession, capacity: 999 });
  throw new Error("forged capacity should not bypass an authoritatively full session");
} catch (err) {
  if (!/Session is full/.test(err.message)) throw err;
}
beforeFullFixture.bookings = beforeFullFixture.bookings.filter(
  (booking) => !booking.id.startsWith("authority-full-")
);
mem.set("itc.prototype.v1", JSON.stringify(beforeFullFixture));
store.load();
store.signIn("giving-member@example.test");
const approvedReservation = store.reserveSession("giving-member", paymentGateSession.id);
if (approvedReservation.sessionId !== paymentGateSession.id || approvedReservation.status !== "reserved") {
  throw new Error("approved member should reserve a normal authoritative session by ID");
}
console.log("ok  reservations resolve authoritative sessions and reject forged/unknown input");
store.joinWaitlist("giving-member", "authz-waitlist-session");
store.joinInterest("giving-member", "authz-interest-session");
const assertPaymentImpersonationRejected = (label, mutate) => {
  try {
    mutate();
    throw new Error(`${label} Payment impersonation should be rejected`);
  } catch (err) {
    if (!/Approved actor access required|Approved Admin access required|Payment mutation not authorized/.test(err.message)) throw err;
  }
};
for (const actor of [
  { label: "pending", email: "giving-pending@example.test" },
  { label: "declined", email: "giving-declined@example.test" },
  { label: "approved non-admin", email: "giving-other@example.test" },
  { label: "signed-out", email: null },
]) {
  if (actor.email) store.signIn(actor.email);
  else store.signOut();
  for (const mutate of [
    () => store.reserveSession("giving-member", paymentGateSession),
    () => store.markBookingPaid(approvedReservation.id, "FPS", `IMPERSONATED-${actor.label}`),
    () => store.joinWaitlist("giving-member", `authz-join-waitlist-${actor.label}`),
    () => store.leaveWaitlist("giving-member", "authz-waitlist-session"),
    () => store.joinInterest("giving-member", `authz-join-interest-${actor.label}`),
    () => store.leaveInterest("giving-member", "authz-interest-session"),
  ]) assertPaymentImpersonationRejected(actor.label, mutate);
}
if (store.getBooking(approvedReservation.id).paymentMarkedAt
    || store.waitlistPosition("giving-member", "authz-waitlist-session") !== 1
    || store.interestPosition("giving-member", "authz-interest-session") !== 1) {
  throw new Error("rejected Payment impersonation must not mutate state");
}
store.signIn("giving-admin@example.test");
givingFixture.users.find((user) => user.id === "giving-member").status = "declined";
mem.set("itc.prototype.v1", JSON.stringify({
  ...JSON.parse(mem.get("itc.prototype.v1")),
  users: givingFixture.users,
}));
store.load();
try {
  store.markBookingPaid(approvedReservation.id, "FPS", "BLOCKED-PAYMENT");
  throw new Error("declined reservation owner should not mark payment paid");
} catch (err) {
  if (!/Approved member access required/.test(err.message)) throw err;
}
givingFixture.users.find((user) => user.id === "giving-member").status = "approved";
mem.set("itc.prototype.v1", JSON.stringify({
  ...JSON.parse(mem.get("itc.prototype.v1")),
  users: givingFixture.users,
}));
store.load();
store.signIn("giving-member@example.test");
if (!store.markBookingPaid(approvedReservation.id, "FPS", "APPROVED-PAYMENT")) {
  throw new Error("approved booking owner should retain self-service payment access");
}
try {
  store.confirmBookingPayment(approvedReservation.id);
  throw new Error("approved booking owner must not self-confirm payment");
} catch (err) {
  if (!/Approved Admin access required/.test(err.message)) throw err;
}
if (store.getBooking(approvedReservation.id).status !== "reserved"
    || store.receiptForBooking(approvedReservation.id)) {
  throw new Error("rejected self-confirmation must not issue a receipt");
}
for (const actor of [
  { label: "pending", email: "giving-pending@example.test" },
  { label: "declined", email: "giving-declined@example.test" },
  { label: "approved non-admin", email: "giving-other@example.test" },
  { label: "signed-out", email: null },
]) {
  if (actor.email) store.signIn(actor.email);
  else store.signOut();
  assertPaymentImpersonationRejected(
    `${actor.label} confirmation`,
    () => store.confirmBookingPayment(approvedReservation.id)
  );
}
store.signIn("giving-admin@example.test");
const authorizedConfirmation = store.confirmBookingPayment(
  approvedReservation.id, Date.now(), "arbitrary-collector-id"
);
if (!authorizedConfirmation) {
  throw new Error("Admin should confirm payment for an approved affected profile");
}
if (authorizedConfirmation.booking.confirmedBy !== "giving-admin") {
  throw new Error("payment confirmation must derive confirmedBy from the authenticated Admin");
}
const deferTarget = store.deferTargetsFor(authorizedConfirmation.booking)[0];
if (!deferTarget) throw new Error("authorization regression needs a deferral target");
store.signIn("giving-other@example.test");
for (const mutate of [
  () => store.deferBooking(approvedReservation.id, deferTarget.id),
  () => store.cancelBooking(approvedReservation.id),
  () => store.setSessionTime(paymentGateSession.id, "11:00"),
  () => store.setSessionNotice(paymentGateSession.id, "Unauthorized note"),
  () => store.setVenueTBC(paymentGateSession.id, true),
  () => store.setMidtownOpen(paymentGateSession.id, true),
  () => store.setDuty("giving-other", paymentGateSession.dateISO),
  () => store.updateCollectorPayouts("giving-other", { paymeLink: "bad", fpsPhone: "bad" }),
  () => store.confirmGymBooking(paymentGateSession.id, "Unauthorized"),
]) {
  try {
    mutate();
    throw new Error("non-Admin cross-user/operational Payment mutation should be rejected");
  } catch (err) {
    if (!/Approved Admin access required|Payment mutation not authorized/.test(err.message)) throw err;
  }
}
store.signIn("giving-member@example.test");
try {
  store.cancelBooking(approvedReservation.id);
  throw new Error("booking owner must not use the Admin cancellation/refund seam");
} catch (err) {
  if (!/Approved Admin access required/.test(err.message)) throw err;
}
const movedByOwner = store.deferBooking(approvedReservation.id, deferTarget.id);
if (movedByOwner.userId !== "giving-member" || movedByOwner.status !== "confirmed") {
  throw new Error("approved booking owner should be able to defer their booking");
}
const releaseSession = store.upcomingSessions(28).find((session) =>
  session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
  && session.id !== movedByOwner.sessionId
);
if (!releaseSession) throw new Error("authorization regression needs a release session");
const ownerReservation = store.reserveSession("giving-member", releaseSession);
store.signIn("giving-other@example.test");
try {
  store.releaseReservation(ownerReservation.id);
  throw new Error("non-owner member must not release another member's reservation");
} catch (err) {
  if (!/Payment mutation not authorized/.test(err.message)) throw err;
}
store.signIn("giving-member@example.test");
if (!store.releaseReservation(ownerReservation.id)
    || store.getBooking(ownerReservation.id).status !== "cancelled") {
  throw new Error("approved booking owner should be able to release their reservation");
}
store.signIn("giving-admin@example.test");
if (!store.cancelBooking(movedByOwner.id)
    || store.receiptForBooking(movedByOwner.id)?.status !== "refunded") {
  throw new Error("Admin cancellation should cancel and refund a confirmed booking");
}
store.setSessionTime(paymentGateSession.id, "11:00");
store.setSessionNotice(paymentGateSession.id, "Admin note");
store.setVenueTBC(paymentGateSession.id, true);
store.confirmGymBooking(paymentGateSession.id, "Confirmed by Admin", Date.now());
const administeredSession = store.getSession(paymentGateSession.id);
if (administeredSession.time !== "11:00" || !administeredSession.notice
    || !administeredSession.venueTBC || !administeredSession.gymConfirmedAt) {
  throw new Error("approved Admin should retain weekly session operations");
}
store.leaveWaitlist("giving-member", "authz-waitlist-session");
store.leaveInterest("giving-member", "authz-interest-session");
console.log("ok  Payment seams enforce self-service/Admin boundaries and derive confirmation identity");

const givingCampaign = await store.saveGivingCampaign({
  title: "Member campaign", description: "Support the community.", goalHKD: 1000,
  fpsId: "1234567", fpsPayee: "Island Training Club",
});
await store.publishGivingCampaign(givingCampaign.id);
store.signIn("giving-member@example.test");
const memberGivingHtml = await views.viewGiving();
if (!/form-giving|Give via FPS/.test(memberGivingHtml)) throw new Error("approved members must access Giving transfer controls");
await store.updateMyDonorId("member-1234");
if (store.currentUser().donorId !== "MEMBER-1234") throw new Error("Giving donor ID must normalize and persist");
const gift = store.recordDonation({ userId: "giving-member", name: "Giving Member", amount: 250, ref: "GIVE-TEST", campaignId: givingCampaign.id });
if (gift.status !== "pending" || store.campaignRaised(givingCampaign) !== 250 || !store.donationsForUser("giving-member").length) {
  throw new Error("Giving amount/FPS/history persistence failed");
}
const derivedGift = store.recordDonation({ name: "Derived Owner", amount: 100, ref: "GIVE-DERIVED", campaignId: givingCampaign.id });
if (derivedGift.userId !== "giving-member") throw new Error("Giving must derive donation ownership from currentUser().id");
for (const badUserId of ["giving-admin", null, ""]) {
  try {
    store.recordDonation({ userId: badUserId, name: "Wrong Owner", amount: 10, ref: `WRONG-${badUserId}`, campaignId: givingCampaign.id });
    throw new Error(`Giving should reject caller userId ${JSON.stringify(badUserId)}`);
  } catch (err) {
    if (!/Donation owner must match the approved member/.test(err.message)) throw err;
  }
}
console.log("ok  Giving donation ownership is derived and caller IDs must match");
store.signOut();
try {
  store.recordDonation({ name: "No Identity", amount: 10, ref: "NO-IDENTITY", campaignId: givingCampaign.id });
  throw new Error("Giving should reject absent identity");
} catch (err) {
  if (!/Approved member access required/.test(err.message)) throw err;
}
store.signIn("giving-member@example.test");
views.givingState.step = 3;
views.givingState.name = "Giving Member";
views.givingState.amount = 250;
views.givingState.ref = "GIVE-TEST";
views.givingState.campaignId = givingCampaign.id;
if (!(await views.viewGiving()).includes("Thank you, Giving")) throw new Error("Giving thank-you step missing");
for (const email of ["giving-pending@example.test", "giving-declined@example.test"]) {
  store.signIn(email);
  const locked = await views.viewGiving();
  if (!locked.includes("approved ITC members") || locked.includes("FPS ID")) throw new Error(`${email} must be gated from Giving`);
  try {
    store.recordDonation({ userId: store.currentUser().id, name: "Blocked", amount: 10, ref: `BLOCKED-${email}` });
    throw new Error(`${email} must not record gifts`);
  } catch (err) {
    if (!/Approved member access required/.test(err.message)) throw err;
  }
}
store.signIn("giving-admin@example.test");
await store.closeGivingCampaign(givingCampaign.id);
if (await store.getActiveGivingCampaign()) throw new Error("closed campaigns must not remain active");
const emptyGivingHtml = await views.viewGiving();
if (!emptyGivingHtml.includes("No active Giving campaign at the moment")
    || !emptyGivingHtml.includes("Check back soon for the next opportunity to support the ITC community.")) {
  throw new Error("closed campaigns must render the exact Giving empty state");
}
console.log("ok  Giving access, donor ID, campaign, FPS, thanks, history, and close flow");

const sourceSnapshots = [
  { version: 9, prayers: [{ id: "p-real" }] },
  {
    version: 10,
    paymentPayouts: null,
    queues: {
      real: {
        waitlist: [{ userId: "real-user", joinedAt: 123 }],
        interest: ["real-user"],
      },
    },
    duty: { "2026-08-08": { userId: "real-user" } },
  },
  { version: 11, paymentPayouts: [], notifications: [{ id: "n-real", userId: "real-user" }] },
  {
    version: 12,
    paymentPayouts: { "real-admin": { paymeLink: "https://payme.example/real", fpsPhone: "+852 6000 0000" } },
    campaigns: [{ id: "c-real", title: "Member campaign" }],
    donations: [{ id: "d-real", userId: "real-user" }],
  },
];
for (const fixture of sourceSnapshots) {
  const snapshot = {
    version: fixture.version,
    sessionUserId: null,
    users: [], activities: structuredClone(data.SEED_ACTIVITIES), bookings: [], receipts: [],
    ...fixture,
  };
  mem.set("itc.prototype.v1", JSON.stringify(snapshot));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  const serialized = JSON.stringify(migrated);
  const suppliedIds = JSON.stringify(fixture).match(/[pcnd]-real|real-user/g) || [];
  const payoutMapValid = migrated.paymentPayouts
    && typeof migrated.paymentPayouts === "object"
    && !Array.isArray(migrated.paymentPayouts);
  const suppliedPayoutsPreserved = fixture.version !== 12
    || migrated.paymentPayouts["real-admin"]?.fpsPhone === "+852 6000 0000";
  if (migrated.version !== 14 || suppliedIds.some((id) => !serialized.includes(id))
      || !payoutMapValid || !suppliedPayoutsPreserved) {
    failures++;
    console.error(`FAIL genuine v${fixture.version} fixture must reach v14 intact`);
  } else console.log(`ok  genuine v${fixture.version} fixture reaches v14 intact`);
}

for (const invalidCounter of [null, -1, 1.5, "broken"]) {
  mem.set("itc.prototype.v1", JSON.stringify({
    version: 13,
    activities: structuredClone(data.SEED_ACTIVITIES),
    users: [], bookings: [], receipts: [],
    receiptCounter: invalidCounter,
  }));
  store.load();
  const repairedCounter = JSON.parse(mem.get("itc.prototype.v1")).receiptCounter;
  if (!Number.isInteger(repairedCounter) || repairedCounter < 0) {
    throw new Error(`v13 must normalize invalid receiptCounter ${JSON.stringify(invalidCounter)}`);
  }
}
console.log("ok  v13 normalizes invalid receiptCounter shapes");

// Migration acceptance must prove resulting behavior, not only retained IDs.
// This v12 snapshot deliberately omits receiptCounter, then exercises the real
// reserve -> mark paid -> Admin confirm path that issues a receipt.
const receiptMigrationFixture = {
  version: 12,
  sessionUserId: "receipt-member",
  activities: structuredClone(data.SEED_ACTIVITIES),
  users: [
    { id: "receipt-admin", role: "admin", status: "approved", fullName: "Receipt Admin", email: "receipt-admin@example.test" },
    { id: "receipt-member", role: "member", status: "approved", fullName: "Receipt Member", email: "receipt-member@example.test" },
  ],
  bookings: [], receipts: [], campaigns: [], donations: [], prayers: [], notifications: [],
  sessionOverrides: {}, queues: {}, duty: {},
};
mem.set("itc.prototype.v1", JSON.stringify(receiptMigrationFixture));
store.load();
const receiptSession = store.upcomingSessions(14).find(
  (session) => session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
);
if (!receiptSession) throw new Error("post-migration receipt check needs an upcoming paid session");
const migratedReservation = store.reserveSession("receipt-member", receiptSession, Date.now());
store.markBookingPaid(migratedReservation.id, "FPS", "MIGRATED-RECEIPT", Date.now());
store.signIn("receipt-admin@example.test");
const migratedConfirmation = store.confirmBookingPayment(migratedReservation.id, Date.now());
const migratedReceiptState = JSON.parse(mem.get("itc.prototype.v1"));
if (!migratedConfirmation?.receipt
    || !/^ITC-\d{4}-\d{4,}$/.test(migratedConfirmation.receipt.number)
    || migratedConfirmation.receipt.number.includes("NaN")
    || !Number.isInteger(migratedReceiptState.receiptCounter)
    || migratedReceiptState.receiptCounter < 0) {
  throw new Error("post-migration receipt issuance must use a valid normalized counter");
}
console.log("ok  v13 migration normalizes receiptCounter before real receipt issuance");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
