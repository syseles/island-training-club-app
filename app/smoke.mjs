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

// --- Visitor state ---
store.signOut();
check("home (visitor)", () => views.viewHome());
check("schedule", () => views.viewSchedule());
const hyroxSid = store.nextSession().kind === "paid" ? store.nextSession().id : null;
const allUpcoming = store.upcomingSessions(14);
const paid = allUpcoming.find((s) => s.kind === "paid");
const free = allUpcoming.find((s) => s.kind === "free");
if (!paid || !free) throw new Error("expected both paid and free sessions in window");
check("activity paid (visitor)", () => views.viewActivity(paid.id));
check("activity free (visitor)", () => views.viewActivity(free.id));
check("community", () => views.viewCommunity());
check("account (visitor)", () => views.viewAccount());
check("apply", () => views.viewApply());
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
});
if (!applyRes.ok) throw new Error("apply failed");
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
check("checkout (member)", () => views.viewCheckout(paid.id));
const before = store.spotsLeft(paid);
const { booking, receipt } = store.payForSession(signIn.user.id, paid, "4242");
const after = store.spotsLeft(paid);
if (after !== before - 1) throw new Error(`spots did not decrement (${before} -> ${after})`);
console.log(`ok  payment decremented spots ${before} -> ${after}`);
check("booking confirmation", () => views.viewBooking(booking.id));
check("receipt", () => views.viewReceipt(receipt.id));
check("activity (member, booked)", () => views.viewActivity(paid.id));

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

// --- Seeded member view ---
store.demoSignIn("member");
check("account (seeded member)", () => views.viewAccount());
check("home (member)", () => views.viewHome());

// --- ICS generation ---
const ics = data.buildICS(free);
if (!ics.includes("BEGIN:VEVENT") || !ics.includes(free.name)) throw new Error("bad ICS");
console.log("ok  ICS generation");

// --- Reset ---
store.resetDemo();
console.log("ok  reset");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
