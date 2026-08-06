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

store.load();

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

for (const oldTitle of [
  "Sunday service at IECC",
  "New Wednesday venue being scouted",
  "Marathon fundraiser passes first milestone",
]) {
  if (data.ANNOUNCEMENTS.some((item) => item.title === oldTitle)) {
    failures++;
    console.error(`FAIL old announcement seed remains: ${oldTitle}`);
  }
}

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
check("community > prayers", () => views.viewCommunity("prayers"));
check("community > fellowship", () => views.viewCommunity("fellowship"));
check("community > meals", () => views.viewCommunity("meals"));
check("community > announcements", () => views.viewCommunity("announcements"));
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
for (const removed of [
  "Sunday service at IECC",
  "New Wednesday venue being scouted",
  "Marathon fundraiser passes first milestone",
]) {
  if (announcementHtml.includes(removed)) {
    failures++;
    console.error(`FAIL announcements page still renders ${removed}`);
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
const pendingCommunity = views.viewCommunity();
if (!pendingCommunity.includes("You’re welcome here.")) {
  failures++;
  console.error("FAIL pending Community heading is not personalized");
} else console.log("ok  pending Community heading is personalized");
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
const approvedCommunity = views.viewCommunity();
if (!approvedCommunity.includes("Connect and grow with us.")) {
  failures++;
  console.error("FAIL approved Community heading is not personalized");
} else console.log("ok  approved Community heading is personalized");

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

// --- Reset ---
store.resetDemo();
console.log("ok  reset");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
