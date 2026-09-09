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
  ],
  bookings: [], receipts: [], receiptCounter: 49, paymentPayouts: {}, campaigns: [], donations: [],
  prayers: [], oneOffEvents: [], sessionOverrides: {}, queues: {}, hyroxCycles: {}, hyroxCycleQueues: {},
  replacementRequests: [], replacementAudit: [], notifications: [], duty: {},
}));
store.load();
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
