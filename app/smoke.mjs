// Headless smoke test: render every view for every user state.
// Run: node --input-type=module < smoke.mjs  (from the app/ directory)

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const liveAuth = spawnSync(process.execPath, [fileURLToPath(new URL("./live-auth-smoke.mjs", import.meta.url))], {
  encoding: "utf8",
});
if (liveAuth.stdout) process.stdout.write(liveAuth.stdout);
if (liveAuth.status !== 0) {
  if (liveAuth.stderr) process.stderr.write(liveAuth.stderr);
  process.exit(liveAuth.status || 1);
}

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
function check(label, fn) {
  try {
    const out = fn();
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

// --- Visitor state ---
store.signOut();
check("home (visitor)", () => views.viewHome());
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
if (homeVisitor.includes("Book & pay")) {
  failures++;
  console.error("FAIL visitor home preview must not contain paid booking language");
} else console.log("ok  visitor home preview has no paid booking language");
check("schedule", () => views.viewSchedule());
const hyroxSid = store.nextSession().kind === "paid" ? store.nextSession().id : null;
const allUpcoming = store.upcomingSessions(14);
// booking tests need a session that hasn't started yet — today's sessions
// are unbookable once their start time passes
const paid = allUpcoming.find((s) => s.kind === "paid" && !data.sessionStarted(s));
const free = allUpcoming.find((s) => s.kind === "free");
if (!paid || !free) throw new Error("expected both paid and free sessions in window");
check("activity paid (visitor)", () => views.viewActivity(paid.id));
check("activity free (visitor)", () => views.viewActivity(free.id));
check("community", () => views.viewCommunity());
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
check("community > prayers", () => views.viewCommunity("prayers"));
check("community > fellowship", () => views.viewCommunity("fellowship"));
check("community > meals", () => views.viewCommunity("meals"));
check("community > announcements", () => views.viewCommunity("announcements"));
check("community > about", () => views.viewCommunity("about"));
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
check("account (visitor)", () => views.viewAccount());
check("apply", () => views.viewApply());
if (!views.viewApply().includes('name="donorId"')) {
  failures++;
  console.error("FAIL apply form missing optional Donor ID field");
} else console.log("ok  apply form collects optional Donor ID");
check("checkout (visitor) -> redirect", () => views.viewCheckout(paid.id));
check("admin (visitor) -> redirect", () => views.viewAdmin("approvals"));
check("notfound", () => views.viewNotFound());

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
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
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
check("account (pending)", () => views.viewAccount());
const pendHtml = views.viewActivity(paid.id);
if (!pendHtml.includes("Booking locked")) {
  failures++;
  console.error("FAIL pending user should see booking locked");
} else console.log("ok  pending user blocked from paid booking");

// --- Admin approval flow ---
store.demoSignIn("admin");
check("admin approvals", () => views.viewAdmin("approvals"));
check("admin activities", () => views.viewAdmin("activities"));
check("admin members", () => views.viewAdmin("members"));
check("admin activity edit", () => views.viewAdminActivity("hyrox"));
check("admin activity new", () => views.viewAdminActivity("new"));
const newApplicant = store.pendingApplicants().find((u) => u.email === "test@example.com");
store.approveApplicant(newApplicant.id);
console.log("ok  admin approved new applicant");

// --- Member booking + payment flow ---
const signIn = store.signIn("test@example.com");
if (!signIn.ok || signIn.user.status !== "approved") throw new Error("approval did not take effect");
check("account (new member)", () => views.viewAccount());

// Profile sections are tappable rows that open sub-pages; row faces carry
// a one-line description, not live details
const newMemberAcct = views.viewAccount();
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
check("profile > details", () => views.viewAccount("details"));
check("profile > indemnity", () => views.viewAccount("indemnity"));
check("profile > donor", () => views.viewAccount("donor"));
check("profile > payments", () => views.viewAccount("payments"));
check("profile > privacy", () => views.viewAccount("privacy"));
check("profile > history", () => views.viewAccount("history"));

// sub-page headings are title-cased to match the row titles
for (const [section, title] of [
  ["details", "Membership Details."],
  ["indemnity", "Health &amp; Liability Indemnity."],
  ["donor", "Donor Profile."],
  ["payments", "Payments &amp; Receipts."],
  ["privacy", "Privacy &amp; Notifications."],
  ["history", "History."],
]) {
  if (!views.viewAccount(section).includes(title)) {
    failures++;
    console.error(`FAIL profile > ${section} heading should read "${title}"`);
  }
}
console.log("ok  sub-page headings title-cased");
if (!views.viewAccount("nope").includes("Page not found")) {
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
if (!views.viewAccount().includes("To be accepted")) {
  failures++;
  console.error('FAIL unaccepted indemnity should read "To be accepted"');
} else console.log('ok  unaccepted indemnity reads "To be accepted"');
if (!views.viewAccount("indemnity").includes("Accept &amp; Confirm")) {
  failures++;
  console.error("FAIL indemnity page missing Accept & Confirm");
} else console.log("ok  indemnity page offers Accept & Confirm");
store.acceptIndemnity(store.currentUser().id);
if (!views.viewAccount().includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL acceptIndemnity did not confirm on Profile");
} else console.log("ok  acceptIndemnity confirms on Profile");
if (!views.viewHome().includes("Nothing booked this week")) {
  failures++;
  console.error('FAIL "My week" should prompt when the member has no bookings');
} else console.log('ok  "My week" empty state prompts to book');
check("checkout (member)", () => views.viewCheckout(paid.id));
const before = store.spotsLeft(paid);
const { booking, receipt } = store.payForSession(signIn.user.id, paid, "4242");
const after = store.spotsLeft(paid);
if (after !== before - 1) throw new Error(`spots did not decrement (${before} -> ${after})`);
console.log(`ok  payment decremented spots ${before} -> ${after}`);
check("booking confirmation", () => views.viewBooking(booking.id));
check("receipt", () => views.viewReceipt(receipt.id));
check("activity (member, booked)", () => views.viewActivity(paid.id));

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
if (views.viewAccount().includes(">Upcoming<")) {
  failures++;
  console.error("FAIL Profile still repeats the upcoming bookings list");
} else console.log("ok  Profile drops redundant upcoming list");

// donor ID skipped at signup ("Not applicable" above) can be added later;
// it lives inside the Donor Profile sub-page, not on the card face
store.updateDonorId(signIn.user.id, "IECC-99999");
if (store.currentUser().donorId !== "IECC-99999") throw new Error("donor ID not saved");
if (views.viewAccount().includes("IECC-99999")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  Profile card face carries no donor details");
if (!views.viewAccount("donor").includes("IECC-99999")) {
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
if (views.viewAccount().includes("booking-card")) {
  failures++;
  console.error("FAIL Profile should not list history inline");
} else console.log("ok  Profile keeps history behind the card");
const histHtml = views.viewAccount("history");
if (!histHtml.includes("booking-card") || !histHtml.includes("Cancelled")) {
  failures++;
  console.error("FAIL History sub-page missing past bookings");
} else console.log("ok  History sub-page lists past bookings");

// --- Seeded member view ---
store.demoSignIn("member");
check("account (seeded member)", () => views.viewAccount());
const memberAcct = views.viewAccount();
if (!views.viewAccount("donor").includes("CHUI-08879")) {
  failures++;
  console.error("FAIL seeded member donor ID not shown in Donor Profile");
} else console.log("ok  seeded member donor ID shown in Donor Profile");
if (memberAcct.includes("CHUI-08879")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  seeded member card faces carry no donor details");
if (!views.viewAccount("payments").includes("ITC-2026-0048")) {
  failures++;
  console.error("FAIL seeded receipts missing from Payments sub-page");
} else console.log("ok  seeded receipts show on Payments sub-page");
if (!memberAcct.includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL seeded member should have indemnity confirmed");
} else console.log("ok  seeded member indemnity confirmed");
if (!memberAcct.includes('class="kicker">Profile</div>') || memberAcct.includes("Member Profile") || memberAcct.includes("’s training")) {
  failures++;
  console.error('FAIL Profile header should read "Profile" with no name headline');
} else console.log('ok  Profile header reads "Profile"');
if (memberAcct.includes("member@itc.hk")) {
  failures++;
  console.error("FAIL email should not appear on the Profile face");
} else console.log("ok  Profile face carries no contact details");
if (!views.viewAccount("details").includes("member@itc.hk")) {
  failures++;
  console.error("FAIL email missing from Membership Details sub-page");
} else console.log("ok  email lives on Membership Details sub-page");
check("home (member)", () => views.viewHome());
const memberHome = views.viewHome();
if (!memberHome.includes("BFT Causeway Bay") || memberHome.includes("Midtown 28")) {
  failures++;
  console.error('FAIL "My week" should show only the member\'s booked 11:15 HYROX');
} else console.log('ok  "My week" shows only the member\'s booked session');
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
store.resetDemo();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 6;
  raw.users.find((u) => u.id === "u-member").donorId = "CHUI08879"; // no separator
  raw.users.find((u) => u.id === "u-admin").donorId = "not a real id"; // unrecognizable
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const fixed = store.allUsers().find((u) => u.id === "u-member").donorId;
  if (fixed !== "CHUI-08879") {
    failures++;
    console.error(`FAIL v7 migration should repair CHUI08879 -> CHUI-08879, got ${fixed}`);
  } else console.log("ok  v7 migration inserts the missing hyphen");
  const cleared = store.allUsers().find((u) => u.id === "u-admin").donorId;
  if (cleared !== null) {
    failures++;
    console.error(`FAIL v7 migration should clear unrecognizable donor ID, got ${cleared}`);
  } else console.log("ok  v7 migration clears unrecognizable donor ID");
}

// --- viewAccount live-mode branch ---
// The live-mode HTML is rendered when isLive() is true at viewAccount
// call time. We can't re-route views.js's captured config import to a
// bustered version (cache busting only affects the top-level URL), so we
// verify the live-mode HTML source exists in views.js and that the live
// config evaluates correctly when imported fresh. The live render path
// is verified manually against a deployed staging environment.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

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
if (!/!isLive\(\)[\s\S]{0,200}admin demo profile/.test(viewsSrc)) {
  failures++;
  console.error("FAIL views.js: pending view's demo-profile tip should be local-only");
} else {
  console.log("ok  views.js: pending view's demo-profile tip is local-only");
}
if (!/!isLive\(\)[\s\S]{0,200}data-action="reset-demo"/.test(viewsSrc)) {
  failures++;
  console.error("FAIL views.js: Reset demo data button should be local-only");
} else {
  console.log("ok  views.js: Reset demo data button is local-only");
}

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
if (!/NAV_FOR = \{[\s\S]*?notifications: "notifications"/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: NAV_FOR should map notifications -> notifications");
} else {
  console.log("ok  app.js: NAV_FOR maps notifications to its own tab");
}
if (!/arg === "users" \|\| !arg \|\| isLive\(\)[\s\S]{0,120}?viewAdminUsers\(\)/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: #/admin/users should route to viewAdminUsers");
} else {
  console.log("ok  app.js: #/admin/users routes to viewAdminUsers");
}

// --- Admin entry consistency, live profile editing, weekly encouragement ---
if (!appSrc.includes('arg === "users" || !arg || isLive()')) {
  failures++;
  console.error("FAIL app.js: bare #/admin should also reach viewAdminUsers (same page as the Admin tab)");
} else {
  console.log("ok  app.js: Admin Tools and the Admin tab land on the same page");
}
if (!appSrc.includes("await views.viewAccount(")) {
  failures++;
  console.error("FAIL app.js: account route should await (live details view is async)");
} else {
  console.log("ok  app.js: account route is awaited");
}
if (!viewsSrc.includes("viewAccountDetailsLive")) {
  failures++;
  console.error("FAIL views.js: live Membership Details editor missing");
} else {
  console.log("ok  views.js: live Membership Details editor present");
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
const homeNow = views.viewHome();
if (!homeNow.includes("Encouragement of the week")) {
  failures++;
  console.error("FAIL home should show the weekly encouragement below the greeting");
} else {
  console.log("ok  home shows the weekly encouragement");
}

// --- every role must apply (incl. the bootstrap super admin) ---
const maybeRedirect = appSrc.match(/export async function maybeRedirectToApply\(\) \{[\s\S]*?\n\}/);
if (!maybeRedirect || maybeRedirect[0].includes('cu.role !== "pending"')) {
  failures++;
  console.error("FAIL app.js: maybeRedirectToApply should push any user without an application to #/apply, not just pending");
} else {
  console.log("ok  app.js: maybeRedirectToApply applies to every role");
}
if (viewsSrc.includes('if (cu.role !== "pending")')) {
  failures++;
  console.error("FAIL views.js: viewApplyLive should offer the form to any role without an application");
} else {
  console.log("ok  views.js: viewApplyLive offers the form to any role without an application");
}
if (!appSrc.includes('!isLive() && u && u.status === "approved"')) {
  failures++;
  console.error("FAIL app.js: apply route approved-redirect should be local-mode only");
} else {
  console.log("ok  app.js: apply route approved-redirect is local-mode only");
}
const applyAnyRole = existsSync(resolve(__dirname, "../supabase/migrations/20260805000004_apply_any_role.sql"))
  ? readFileSync(resolve(__dirname, "../supabase/migrations/20260805000004_apply_any_role.sql"), "utf8")
  : "";
if (!applyAnyRole.includes('drop policy "self insert application"')) {
  failures++;
  console.error("FAIL migrations: self insert application must allow any role (not just pending)");
} else {
  console.log("ok  migrations: self insert application allowed for any role");
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
// Sign in as a seeded user so the local-mode mirror check has a real user.
store.signIn("member@itc.hk");
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

// --- viewAdminUsers smoke (source-only) ---
// viewAdminUsers depends on store.getCurrentUser / listProfiles /
// listRoleChanges, which talk to Supabase in live mode. ES module exports
// are read-only and cannot be stubbed. We verify the function exists in
// views.js and that the helper functions are exported from store.js; the
// actual render path is verified manually on a deployed staging
// environment.
if (!viewsSrc.includes("export async function viewAdminUsers")) {
  failures++;
  console.error("FAIL views.js: should export viewAdminUsers");
} else {
  console.log("ok  views.js: exports viewAdminUsers");
}
const storeSrc = readFileSync(resolve(__dirname, "js/store.js"), "utf8");
for (const fn of ["listProfiles", "listRoleChanges", "updateProfileRole"]) {
  if (!storeSrc.includes(`export async function ${fn}`)) {
    failures++;
    console.error(`FAIL store.js: should export ${fn}`);
  } else {
    console.log(`ok  store.js: exports ${fn}`);
  }
}
for (const fn of ["getMyApplication", "saveMyApplication"]) {
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
if (!viewsSrc.includes("export async function unreadBadge")) {
  failures++;
  console.error("FAIL views.js: should export unreadBadge");
} else {
  console.log("ok  views.js: exports unreadBadge");
}
if (!viewsSrc.includes('#/notifications')) {
  failures++;
  console.error("FAIL views.js: should reference #/notifications");
} else {
  console.log("ok  views.js: references #/notifications");
}

// --- Reset ---
store.resetDemo();
console.log("ok  reset");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
