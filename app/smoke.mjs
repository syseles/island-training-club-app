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

const bannedAccountContent = [
  "owner@itc.hk",
  "admin@itc.hk",
  "member@itc.hk",
  'data-action="demo-signin"',
  "one-tap demo",
  'data-action="reset-demo"',
];
function assertCleanAccount(label, html) {
  let clean = true;
  for (const banned of bannedAccountContent) {
    if (html.toLowerCase().includes(banned.toLowerCase())) {
      failures++;
      clean = false;
      console.error(`FAIL ${label} Account contains removed demo content: ${banned}`);
    }
  }
  if (clean) console.log(`ok  ${label} Account has no demo identities or controls`);
}

store.load();

// --- Clean fresh state ---
const fresh = JSON.parse(mem.get("itc.prototype.v1"));
if (fresh.users.length || fresh.bookings.length || fresh.receipts.length || fresh.sessionUserId) {
  failures++;
  console.error("FAIL fresh state should have no users, bookings, receipts or session");
} else console.log("ok  fresh state has no identities or transactions");
if (!fresh.activities.length || fresh.activities.some((a) => "baseBooked" in a)) {
  failures++;
  console.error("FAIL fresh activities should remain without baseBooked");
} else console.log("ok  fresh activities remain without simulated demand");
assertCleanAccount("visitor", views.viewAccount());
const announcements = views.viewCommunity("announcements");
for (const fake of [
  "Sunday service at IECC",
  "New Wednesday venue being scouted",
  "Marathon fundraiser passes first milestone",
]) {
  if (announcements.includes(fake)) {
    failures++;
    console.error(`FAIL announcements contain fake runtime post: ${fake}`);
  }
}
console.log("ok  announcements contain no generic fake posts");

// Neutral local records drive authenticated smoke paths; clean installs do
// not receive these fixtures. Keep fixture identities under .example.test.
const fixtureSession = data
  .sessionsInRange(fresh.activities, data.todayLocal(), 14)
  .find((s) => s.kind === "paid" && !data.sessionStarted(s));
if (!fixtureSession) throw new Error("expected a future paid fixture session");
const fixtureState = {
  ...fresh,
  users: [
    {
      id: "test-admin-1", role: "admin", status: "approved", fullName: "Test Admin",
      preferredName: "Admin", email: "test-admin@example.test", phone: "+852 5000 0001",
      emergencyName: "Test Contact", emergencyPhone: "+852 5000 9001", heard: "Test fixture",
      ageConfirmed: true, appliedAt: Date.now() - 86400000, indemnityAcceptedAt: Date.now() - 86400000,
    },
    {
      id: "test-member-1", role: "member", status: "approved", fullName: "Existing Member",
      preferredName: "Existing", email: "test-member@example.test", phone: "+852 5000 0002",
      emergencyName: "Test Contact", emergencyPhone: "+852 5000 9002", heard: "Test fixture",
      ageConfirmed: true, donorId: "TEST-1234", appliedAt: Date.now() - 172800000,
      indemnityAcceptedAt: Date.now() - 172800000,
    },
  ],
  bookings: [{
    id: "test-booking-1", userId: "test-member-1", sessionId: fixtureSession.id,
    status: "confirmed", createdAt: Date.now() - 3600000,
    snapshot: {
      name: fixtureSession.name, kind: fixtureSession.kind, dateISO: fixtureSession.dateISO,
      time: fixtureSession.time, durationMin: fixtureSession.durationMin,
      location: fixtureSession.location, price: fixtureSession.price,
    },
  }],
  receipts: [{
    id: "test-receipt-1", number: "TEST-RECEIPT-0001", bookingId: "test-booking-1",
    userId: "test-member-1", amount: fixtureSession.price, currency: "HKD", cardLast4: "1111",
    status: "paid", issuedAt: Date.now() - 3600000, line: "Neutral fixture receipt",
  }],
};
mem.set("itc.prototype.v1", JSON.stringify(fixtureState));
store.load();

// --- Visitor state ---
store.signOut();
check("home (visitor)", () => views.viewHome());
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

// --- Application flow ---
const applyRes = store.applyForMembership({
  fullName: "Test Person",
  preferredName: "Test",
  email: "new-member@example.test",
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
const pendingAccountHtml = check("account (pending)", () => views.viewAccount());
assertCleanAccount("pending", pendingAccountHtml);
for (const removedGuidance of ["admin demo profile", "see the approval side"]) {
  if (pendingAccountHtml.toLowerCase().includes(removedGuidance)) {
    failures++;
    console.error(`FAIL pending Account contains removed admin-demo guidance: ${removedGuidance}`);
  }
}
console.log("ok  pending Account has no removed admin-demo approval guidance");
const pendHtml = views.viewActivity(paid.id);
if (!pendHtml.includes("Booking locked")) {
  failures++;
  console.error("FAIL pending user should see booking locked");
} else console.log("ok  pending user blocked from paid booking");

// --- Admin approval flow ---
store.signIn("test-admin@example.test");
check("admin approvals", () => views.viewAdmin("approvals"));
check("admin activities", () => views.viewAdmin("activities"));
check("admin members", () => views.viewAdmin("members"));
check("admin activity edit", () => views.viewAdminActivity("hyrox"));
check("admin activity new", () => views.viewAdminActivity("new"));
const newApplicant = store.pendingApplicants().find((u) => u.email === "new-member@example.test");
store.approveApplicant(newApplicant.id);
console.log("ok  admin approved new applicant");

// --- Member booking + payment flow ---
const signIn = store.signIn("new-member@example.test");
if (!signIn.ok || signIn.user.status !== "approved") throw new Error("approval did not take effect");
check("account (new member)", () => views.viewAccount());
assertCleanAccount("approved", views.viewAccount());

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

// --- Existing member fixture view ---
store.signIn("test-member@example.test");
check("account (existing member)", () => views.viewAccount());
const memberAcct = views.viewAccount();
if (!views.viewAccount("donor").includes("TEST-1234")) {
  failures++;
  console.error("FAIL fixture member donor ID not shown in Donor Profile");
} else console.log("ok  fixture member donor ID shown in Donor Profile");
if (memberAcct.includes("TEST-1234")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  fixture member card faces carry no donor details");
if (!views.viewAccount("payments").includes("TEST-RECEIPT-0001")) {
  failures++;
  console.error("FAIL fixture receipt missing from Payments sub-page");
} else console.log("ok  fixture receipt shows on Payments sub-page");
if (!memberAcct.includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL fixture member should have indemnity confirmed");
} else console.log("ok  fixture member indemnity confirmed");
if (!memberAcct.includes('class="kicker">Profile</div>') || memberAcct.includes("Member Profile") || memberAcct.includes("’s training")) {
  failures++;
  console.error('FAIL Profile header should read "Profile" with no name headline');
} else console.log('ok  Profile header reads "Profile"');
if (memberAcct.includes("test-member@example.test")) {
  failures++;
  console.error("FAIL email should not appear on the Profile face");
} else console.log("ok  Profile face carries no contact details");
if (!views.viewAccount("details").includes("test-member@example.test")) {
  failures++;
  console.error("FAIL email missing from Membership Details sub-page");
} else console.log("ok  email lives on Membership Details sub-page");
check("home (member)", () => views.viewHome());
const memberHome = views.viewHome();
if (!memberHome.includes(fixtureSession.location)) {
  failures++;
  console.error('FAIL "My week" should show the fixture member\'s booked session');
} else console.log('ok  "My week" shows only the fixture member\'s booked session');
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
    { id: "legacy-member-1", email: "legacy-one@example.test", donorId: "TEST1234" },
    { id: "legacy-member-2", email: "legacy-two@example.test", donorId: "not a real id" },
  ];
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const fixed = store.allUsers().find((u) => u.id === "legacy-member-1").donorId;
  if (fixed !== "TEST-1234") {
    failures++;
    console.error(`FAIL v7 migration should repair TEST1234 -> TEST-1234, got ${fixed}`);
  } else console.log("ok  v7 migration inserts the missing hyphen");
  const cleared = store.allUsers().find((u) => u.id === "legacy-member-2").donorId;
  if (cleared !== null) {
    failures++;
    console.error(`FAIL v7 migration should clear unrecognizable donor ID, got ${cleared}`);
  } else console.log("ok  v7 migration clears unrecognizable donor ID");
}

// --- Legacy migrations normalize absent collections before accessing them ---
for (const [version, absentKey] of [
  [0, "activities"],
  [3, "bookings"],
  [6, "users"],
  [8, "receipts"],
]) {
  store.resetLocalData();
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = version;
  raw.users = null;
  raw.activities = null;
  raw.bookings = null;
  raw.receipts = null;
  delete raw[absentKey];
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  try {
    store.load();
    const migrated = JSON.parse(mem.get("itc.prototype.v1"));
    if (migrated.version !== 9
      || !Array.isArray(migrated.users)
      || !Array.isArray(migrated.activities)
      || !Array.isArray(migrated.bookings)
      || !Array.isArray(migrated.receipts)) {
      throw new Error("collections were not normalized to arrays");
    }
    console.log(`ok  v${version} migration normalizes missing/null collections`);
  } catch (err) {
    failures++;
    console.error(`FAIL v${version} migration should normalize missing/null collections: ${err.message}`);
  }
}

// --- v8/v9 prayer state is repaired before migrations or early return ---
for (const [version, prayerShape] of [
  [8, "null"],
  [8, "missing"],
  [9, "null"],
  [9, "missing"],
]) {
  store.resetLocalData();
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = version;
  if (prayerShape === "missing") delete raw.prayers;
  else raw.prayers = null;
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  try {
    store.load();
    const recorded = store.recordPrayer({
      userId: null,
      name: "Migration tester",
      request: `v${version} ${prayerShape} prayer regression`,
    });
    const migrated = JSON.parse(mem.get("itc.prototype.v1"));
    if (!recorded.id
      || !Array.isArray(migrated.prayers)
      || migrated.prayers.length !== 1
      || migrated.prayers[0].id !== recorded.id) {
      throw new Error("recordPrayer did not persist into a normalized array");
    }
    console.log(`ok  v${version} ${prayerShape} prayers normalize and recordPrayer works`);
  } catch (err) {
    failures++;
    console.error(`FAIL v${version} ${prayerShape} prayers should normalize before load returns: ${err.message}`);
  }
}

// --- v9 migration: exact legacy demo sentinels are removed, local records survive ---
store.resetLocalData();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 8;
  raw.sessionUserId = "u-admin";
  raw.users = [
    { id: "u-super", email: "owner@itc.hk" },
    { id: "u-admin", email: " ADMIN@ITC.HK " },
    { id: "u-member", email: "member@itc.hk" },
    { id: "u-pend-1", email: "marco.santos@example.com" },
    { id: "u-pend-2", email: "jenny.wu@example.com" },
    { id: "renamed-demo-owner", email: " OWNER@ITC.HK " },
    { id: "test-member-1", email: "real-member@example.test", donorId: "REAL-1234" },
  ];
  raw.bookings = [
    { id: "b-seed-past", userId: "u-member", sessionId: "hyrox-legacy-past" },
    { id: "b-seed-next", userId: "renamed-demo-owner", sessionId: "hyrox-legacy-next" },
    { id: "real-booking-1", userId: "test-member-1", sessionId: "hyrox-real" },
  ];
  raw.receipts = [
    { id: "r-seed-past", bookingId: "b-seed-past", userId: "u-member" },
    { id: "r-seed-next", bookingId: "b-seed-next", userId: "renamed-demo-owner" },
    { id: "real-receipt-1", bookingId: "real-booking-1", userId: "test-member-1" },
  ];
  raw.prayers = [{
    id: "real-prayer-1",
    userId: "test-member-1",
    name: "Existing Member",
    request: "Please preserve this genuine prayer",
    createdAt: Date.now() - 7200000,
  }];
  raw.activities[0].baseBooked = 7;
  raw.activities[0].location = "Genuine admin edit";
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  const preserved = migrated.users.length === 1 && migrated.users[0].id === "test-member-1"
    && migrated.bookings.length === 1 && migrated.bookings[0].id === "real-booking-1"
    && migrated.receipts.length === 1 && migrated.receipts[0].id === "real-receipt-1"
    && migrated.prayers.length === 1 && migrated.prayers[0].id === "real-prayer-1"
    && migrated.activities[0].location === "Genuine admin edit";
  const cleaned = migrated.version === 9 && migrated.sessionUserId === null
    && migrated.activities.every((a) => !("baseBooked" in a));
  if (!preserved || !cleaned) {
    failures++;
    console.error("FAIL v9 migration should remove exact demo records/demand and preserve unmatched local records");
  } else console.log("ok  v9 migration removes only exact demo records and simulated demand");
}

// --- Reset ---
const reset = store.resetLocalData();
if (reset.users.length || reset.bookings.length || reset.receipts.length) {
  failures++;
  console.error("FAIL resetLocalData should restore the clean baseline");
} else console.log("ok  resetLocalData restores clean local state");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
