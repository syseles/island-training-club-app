import assert from "node:assert/strict";

const configuredOrigin = process.env.ITC_DEPLOYMENT_ORIGIN;
if (!configuredOrigin) {
  throw new Error("Set ITC_DEPLOYMENT_ORIGIN to the exact Vercel deployment origin.");
}
const origin = new URL(configuredOrigin);
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("ITC_DEPLOYMENT_ORIGIN must be an HTTPS origin with no path, query, or hash.");
}
const url = (path) => new URL(path, origin).toString();

const rootResponse = await fetch(url("/"), { redirect: "manual", cache: "no-store" });
assert.equal(rootResponse.status, 200, "canonical root must serve the app document directly");
const rootHTML = await rootResponse.text();
assert.doesNotMatch(rootHTML, /<base\b/i,
  "root document must not rewrite hash-only route links through /app/");
for (const marker of [
  'href="/app/manifest.webmanifest"',
  'href="/app/styles.css"',
  'src="/app/js/app.js"',
  'src="/assets/itc/logo-header.png"',
]) {
  assert.ok(rootHTML.includes(marker), `root document is missing ${marker}`);
}

const callbackResponse = await fetch(url("/app/?code=route-smoke&next=profile"), {
  redirect: "manual",
  cache: "no-store",
});
assert.equal(callbackResponse.status, 308, "legacy /app/ document path must redirect permanently");
const callbackLocation = new URL(callbackResponse.headers.get("location"), origin);
assert.equal(callbackLocation.origin, origin.origin, "callback redirect must stay on its deployment origin");
assert.equal(callbackLocation.pathname, "/", "callback redirect must land on the canonical root");
assert.equal(callbackLocation.searchParams.get("code"), "route-smoke",
  "callback redirect must preserve the authentication code");
assert.equal(callbackLocation.searchParams.get("next"), "profile",
  "callback redirect must preserve all query parameters");

for (const path of [
  "/app/js/store.js?route-smoke=1",
  "/app/styles.css?route-smoke=1",
  "/assets/itc/logo-header.png?route-smoke=1",
]) {
  const response = await fetch(url(path), { redirect: "manual", cache: "no-store" });
  assert.equal(response.status, 200, `${path} must remain an asset response, not a document redirect`);
}

console.log(`deployment routing smoke passed for ${origin.origin}`);
