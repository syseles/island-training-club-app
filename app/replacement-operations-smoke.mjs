import assert from "node:assert/strict";

const calls = [];
let request = {
  requestId: "replacement-request-1",
  bookingId: "booking-replacement-1",
  status: "pending",
  originalDisplayName: "Payer Member",
  replacementDisplayName: null,
  sessionId: "hyrox-bft-2099-01-03",
  snapshot: { name: "ITC HYROX", kind: "paid", dateISO: "2099-01-03", time: "11:15" },
  createdAt: "2098-12-31T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const fakeSupabase = {
  createClient() { return this; },
  auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  from() {
    const result = { data: [], error: null };
    const chain = {
      select() { return chain; },
      gte() { return chain; },
      order() { return chain; },
      or() { return chain; },
      in() { return chain; },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return chain;
  },
  rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (name === "get_assigned_collector_payout_profiles"
        || name === "get_operational_rsvp_counts") {
      return Promise.resolve({ data: [], error: null });
    }
    if (name === "admin_decide_operational_replacement") {
      return Promise.resolve({ data: null, error: { message: "replacement decision unavailable" } });
    }
    if (name === "list_operational_replacement_requests") {
      return Promise.resolve({ data: [request], error: null });
    }
    if (name === "accept_operational_replacement_request") {
      request = { ...request, status: "accepted", replacementDisplayName: "Friend Member" };
    }
    return Promise.resolve({ data: request, error: null });
  },
};

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.window = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  supabase: fakeSupabase,
};

const operations = await import("./js/operations.js");
const hash = await operations.hashReplacementToken("invite-token");
assert.equal(hash, "f9e3c47d452a8fab2dc56ef07d766534cb2cd31c5f63de7107412acc65daa5b8");

const created = await operations.liveCreateReplacementRequest(
  "booking-replacement-1", hash, Date.parse("2099-01-01T00:00:00.000Z")
);
assert.equal(created.status, "pending");
assert.deepEqual(calls.filter((call) => call.name === "create_operational_replacement_request").at(-1), {
  name: "create_operational_replacement_request",
  args: {
    p_booking_id: "booking-replacement-1",
    p_token_hash: hash,
    p_expires_at: "2099-01-01T00:00:00.000Z",
  },
});

const invite = await operations.liveReplacementInvite(hash);
assert.equal(invite.originalDisplayName, "Payer Member");
assert.equal(invite.tokenHash, undefined);
assert.equal((await operations.liveAcceptReplacement(hash)).status, "accepted");
assert.equal((await operations.liveListReplacementRequests())[0].status, "accepted");
await assert.rejects(
  () => operations.liveDecideReplacement("replacement-request-1", true, ""),
  /replacement decision unavailable/,
);
assert.equal(
  operations.liveReplacementRequestForBooking("booking-replacement-1").status,
  "accepted",
);
console.log("replacement operations smoke passed");
