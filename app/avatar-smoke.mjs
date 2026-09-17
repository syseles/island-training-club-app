import assert from "node:assert/strict";
import {
  avatarInitials,
  avatarMarkup,
  clampCrop,
  cropSourceRect,
  fitCrop,
  normalizeAvatarPresentation,
} from "./js/avatar.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const SIGNED_URL = "https://project.supabase.co/storage/v1/object/sign/profile-avatars/member/custom.jpg?token=signed-token";

test("initials handle empty, single, and multi-word names", () => {
  assert.equal(avatarInitials(""), "?");
  assert.equal(avatarInitials("  Cher  "), "C");
  assert.equal(avatarInitials("Ada Lovelace"), "AL");
  assert.equal(avatarInitials("Ada Byron Lovelace"), "AL");
});

test("presentation accepts only private HTTPS signed avatar URLs", () => {
  assert.deepEqual(
    normalizeAvatarPresentation({
      url: SIGNED_URL,
      source: "custom",
      state: "active",
      expiresAt: "2026-09-17T10:10:00.000Z",
    }),
    {
      url: SIGNED_URL,
      source: "custom",
      state: "active",
      expiresAt: "2026-09-17T10:10:00.000Z",
    },
  );

  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "https://lh3.googleusercontent.com/a/provider-photo",
    "https://evil.invalid/avatar.jpg",
    "https://evil.invalid/storage/v1/object/sign/profile-avatars/avatar.jpg?token=fake",
    "https://project.supabase.co/storage/v1/object/public/profile-avatars/avatar.jpg",
    "http://project.supabase.co/storage/v1/object/sign/profile-avatars/avatar.jpg?token=x",
  ]) {
    assert.deepEqual(
      normalizeAvatarPresentation({ url, source: "google", state: "active" }),
      { url: null, source: "initials", state: "active", expiresAt: null },
    );
  }
});

test("hidden presentation always normalizes to initials", () => {
  assert.deepEqual(
    normalizeAvatarPresentation({ url: SIGNED_URL, source: "custom", state: "hidden" }),
    { url: null, source: "initials", state: "hidden", expiresAt: null },
  );
});

test("avatar markup escapes content and keeps an independent initials sibling", () => {
  const html = avatarMarkup({
    name: `Ada <Admin> & "Coach"`,
    presentation: { url: SIGNED_URL, source: "custom", state: "active" },
    size: 48,
    className: "attendee-avatar unsafe<script>",
  });
  assert.match(html, /class="avatar attendee-avatar"/);
  assert.doesNotMatch(html, /unsafe<script>/);
  assert.match(html, /alt="Ada &lt;Admin&gt; &amp; &quot;Coach&quot;&#39;s profile photo"/);
  assert.match(html, /width="48" height="48"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /class="avatar__initials"/);
  assert.doesNotMatch(html, /onerror=/i);
});

test("decorative eager avatar emits empty alt and omits lazy loading", () => {
  const html = avatarMarkup({
    name: "Ada Lovelace",
    presentation: { url: SIGNED_URL, source: "custom", state: "active" },
    decorative: true,
    eager: true,
  });
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /loading="lazy"/);
});

test("initials fallback omits image markup", () => {
  const html = avatarMarkup({
    name: "Ada Lovelace",
    presentation: { url: "https://evil.invalid/photo", source: "custom", state: "active" },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Ada Lovelace&#39;s profile photo"/);
  assert.match(html, />AL</);
});

test("fitCrop centers portrait and landscape sources for a square viewport", () => {
  const portrait = fitCrop({ imageWidth: 1000, imageHeight: 2000, viewportSize: 300 });
  assert.equal(portrait.offsetX, 0);
  assert.equal(portrait.offsetY, 0);
  assert.equal(portrait.zoom, 1);
  assert.equal(portrait.outputSize, 512);
  assert.deepEqual(cropSourceRect(portrait), { sx: 0, sy: 500, sw: 1000, sh: 1000 });

  const landscape = fitCrop({ imageWidth: 2000, imageHeight: 1000, viewportSize: 300 });
  assert.deepEqual(cropSourceRect(landscape), { sx: 500, sy: 0, sw: 1000, sh: 1000 });
});

test("clampCrop enforces zoom bounds and keeps image covering viewport", () => {
  const base = fitCrop({ imageWidth: 2000, imageHeight: 1000, viewportSize: 300 });
  const clamped = clampCrop({ ...base, zoom: 99, offsetX: 99999, offsetY: -99999 });
  assert.equal(clamped.zoom, 4);
  assert.equal(clamped.offsetX, 1050);
  assert.equal(clamped.offsetY, -450);

  const minimum = clampCrop({ ...base, zoom: 0.1, offsetX: 999, offsetY: 100 });
  assert.equal(minimum.zoom, 1);
  assert.equal(minimum.offsetX, 150);
  assert.equal(minimum.offsetY, 0);
});

test("cropSourceRect reflects clamped drag and zoom without changing output intent", () => {
  const base = fitCrop({ imageWidth: 1000, imageHeight: 2000, viewportSize: 300 });
  const moved = clampCrop({ ...base, zoom: 2, offsetY: 150 });
  assert.deepEqual(cropSourceRect(moved), { sx: 250, sy: 500, sw: 500, sh: 500 });
  assert.equal(moved.outputSize, 512);
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok  ${name}`);
    console.error(error);
  }
}
if (failures) process.exitCode = 1;
else console.log(`\nAll ${tests.length} avatar smoke tests passed.`);
