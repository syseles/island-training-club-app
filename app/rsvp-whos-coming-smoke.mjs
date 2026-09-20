import assert from "node:assert/strict";
import { SEED_ACTIVITIES } from "./js/data.js";
import * as store from "./js/store.js";
import * as views from "./js/views.js";

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

memory.set("itc.prototype.v1", JSON.stringify({
  version: 22,
  sessionUserId: null,
  activities: structuredClone(SEED_ACTIVITIES),
  users: [
    { id: "rsvp-admin", role: "admin", status: "approved", fullName: "Admin Member", preferredName: "Admin", email: "admin@test" },
    { id: "rsvp-member", role: "member", status: "approved", fullName: "Taylor Member", preferredName: "Taylor", email: "taylor@test" },
    { id: "rsvp-pending", role: "pending", status: "pending", fullName: "Pending Member", preferredName: "Pending", email: "pending@test" },
    { id: "rsvp-declined", role: "pending", status: "declined", fullName: "Declined Member", preferredName: "Declined", email: "declined@test" },
  ],
  bookings: [], receipts: [], receiptCounter: 49, paymentPayouts: {}, campaigns: [], donations: [],
  prayers: [], oneOffEvents: [], sessionOverrides: {}, queues: {}, hyroxCycles: {}, hyroxCycleQueues: {},
  replacementRequests: [], replacementAudit: [], notifications: [], duty: {},
}));
store.load();
const freeEvent = store.upcomingSessions(21).find((session) => session.kind === "free");
assert.ok(freeEvent, "focused RSVP smoke needs an upcoming free event");
assert.equal(freeEvent.requiresRsvp, true);
assert.equal(freeEvent.capacity, null);
assert.equal(store.sessionRequiresRsvp(freeEvent), true);

const rsvpAction = /data-action="rsvp-(?:join|withdraw)"/;
store.signIn("taylor@test");
const freeMemberHtml = views.viewActivity(freeEvent.id);
assert.match(freeMemberHtml, /badge free">Free/);
assert.match(freeMemberHtml, /Free · No booking needed/);
assert.match(freeMemberHtml, /RSVP helps the team plan; walk-ins are welcome/);
assert.match(freeMemberHtml, /data-action="rsvp-join"[^>]*>I’m coming</);
assert.doesNotMatch(freeMemberHtml, /Book &amp; pay|Book & pay|checkout|spots? left|capacity/i);

const freeRsvp = await store.rsvpSession("rsvp-member", freeEvent.id);
const freeGoingHtml = views.viewActivity(freeEvent.id);
assert.match(freeGoingHtml, /You’re going/);
assert.match(freeGoingHtml, /data-action="rsvp-withdraw"[^>]*>Can’t make it</);
assert.match(freeGoingHtml, /Who’s coming/);
assert.match(freeGoingHtml, /Taylor M\./);
assert.match(freeGoingHtml, /attendee-avatar/);
const freeBookingHtml = views.viewBooking(freeRsvp.id);
assert.match(freeBookingHtml, /You’re going/);
assert.doesNotMatch(freeBookingHtml, /payment|pay your own bill|View receipt|>Receipt<|checkout|capacity|waitlist/i);
const freeAccountHtml = await views.viewAccount("bookings");
assert.match(freeAccountHtml, /· RSVP/);
assert.doesNotMatch(freeAccountHtml, /paid HK\$0|HK\$0 to be paid/i);

store.signIn("admin@test");
const freeAdminHtml = views.viewActivity(freeEvent.id);
assert.match(freeAdminHtml, /data-action="rsvp-join"[^>]*>I’m coming/);
assert.match(freeAdminHtml, /Taylor M\./);

for (const email of [null, "pending@test", "declined@test"]) {
  if (email) store.signIn(email);
  else store.signOut();
  const restrictedHtml = views.viewActivity(freeEvent.id);
  assert.doesNotMatch(restrictedHtml, rsvpAction);
  assert.doesNotMatch(restrictedHtml, /Taylor M\./);
  assert.doesNotMatch(restrictedHtml, /attendee-avatar/);
}

store.signIn("admin@test");
store.cancelSessionWeek(freeEvent.id, "Weather warning");
assert.doesNotMatch(views.viewActivity(freeEvent.id), rsvpAction);
const startedDate = new Date(freeEvent.date);
startedDate.setDate(startedDate.getDate() - 7);
const startedId = `${freeEvent.activityId}-${startedDate.getFullYear()}-${String(startedDate.getMonth() + 1).padStart(2, "0")}-${String(startedDate.getDate()).padStart(2, "0")}`;
assert.doesNotMatch(views.viewActivity(startedId), rsvpAction);
assert.ok(freeRsvp.id);

const event = store.upcomingSessions(21).find((session) => session.kind === "rsvp");
assert.ok(event, "focused RSVP smoke needs an upcoming RSVP event");
store.signIn("taylor@test");
await store.rsvpSession("rsvp-member", event.id);
const html = views.viewActivity(event.id);
assert.match(html, /Who’s coming/);
assert.match(html, /Taylor M\./);
store.signOut();
assert.match(views.viewActivity(event.id), /Member-only: the attendee list is visible after approval/);
assert.doesNotMatch(views.viewActivity(event.id), /Taylor M\./);
console.log("rsvp who’s coming smoke passed");
