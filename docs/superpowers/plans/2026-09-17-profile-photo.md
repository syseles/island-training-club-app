# Secure Profile Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, approved-member profile photos with manual cropping, sanitized private storage, attendee-list visibility, Google fallback, and Admin moderation.

**Architecture:** Browsers crop for UX but never write Storage directly. Authenticated Supabase Edge Functions verify role and identity, decode and re-encode every image, own private object paths, resolve attendee-scoped signed URLs, and perform moderated state transitions. The vanilla-JS app consumes narrow store APIs and renders one reusable avatar component with initials fallback.

**Tech Stack:** Vanilla ES modules, Canvas 2D, Supabase Auth/Postgres/Storage/Edge Functions, Deno, version-pinned ImageScript, SQL/RLS, Node smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-17-profile-photo-design.md`

## Global Constraints

- Work only on `feature/profile-photo`; this is non-Shop work based on `main` at `b44c76d`.
- Only approved `member`, `admin`, and `super_admin` profiles may upload.
- Public, pending, and declined viewers must never receive cross-member photo URLs.
- Use private bucket `profile-avatars`; browsers receive no direct object mutation privileges.
- Never accept a writable profile ID, object path, Google URL, or role from browser input.
- Uploaded crop payload: JPEG, at most 2 MB; trusted output: exactly 512×512 JPEG.
- Signed URLs expire after 600 seconds and are cached only in memory.
- Maximum ten upload attempts per profile per rolling hour.
- No image bytes or base64 strings in `localStorage`.
- Google photos come only from verified Google identity data and pass through the same sanitizer.
- A custom photo is immediately active unless the member is moderated; moderated replacements require Admin approval.
- Admin hide suppresses custom and Google photos and requires an internal reason.
- No Community feed, directory, public prayer list, arbitrary URL field, or automated content classifier.
- Do not add npm application dependencies or a build step. Pin the Edge image library by immutable Deno version.
- Preserve existing Google auth, member approval, payment, Giving, Community, and local-mode behavior.
- Every production change follows red-green TDD and ends with a focused commit.

---

## File map

### New files

- `supabase/migrations/20260917000001_profile_avatars.sql` — private bucket, avatar state, immutable audit rows, grants, RLS, and atomic state RPCs.
- `supabase/tests/profile_avatars_integration.sql` — schema, privilege, transition, attendee-scope, and audit assertions.
- `supabase/tests/verify_profile_avatars.sh` — destructive disposable-project migration/integration verifier.
- `supabase/tests/verify_profile_avatars_safety.sh` — verifies the destructive harness refuses unsafe targets.
- `supabase/functions/_shared/avatar-policy.ts` — request contracts, role checks, state validation, rate-limit helpers, and safe response types.
- `supabase/functions/_shared/avatar-image.ts` — bounded reads, image signature checks, decode/crop/resize/re-encode, and metadata-free output.
- `supabase/functions/_shared/avatar-service.ts` — Supabase client creation, JWT identity, object naming, signed URLs, and cleanup helpers.
- `supabase/functions/_shared/avatar-policy_test.ts` — pure authorization and transition tests.
- `supabase/functions/_shared/avatar-image_test.ts` — sanitizer and rejection tests.
- `supabase/functions/process-profile-avatar/index.ts` — Google import, custom upload, and member removal endpoint.
- `supabase/functions/resolve-profile-avatars/index.ts` — own-avatar and session-attendee resolution endpoint.
- `supabase/functions/moderate-profile-avatar/index.ts` — Admin hide/approve/reject endpoint.
- `app/js/avatar.js` — pure initials, safe avatar markup, presentation normalization, and crop geometry.
- `app/js/avatar-cropper.js` — accessible picker/crop/zoom/manage-photo dialog.
- `app/avatar-smoke.mjs` — pure frontend avatar and crop contracts.

### Modified files

- `app/js/store.js` — in-memory avatar caches and narrow Edge Function adapters.
- `app/js/views.js` — Profile, top-avatar, attendee, and Admin moderation rendering.
- `app/js/app.js` — async avatar hydration, manage-photo callbacks, and moderation delegation.
- `app/index.html` — top-avatar semantics only if required by the final renderer.
- `app/styles.css` — avatar, crop dialog, progress, attendee row, and moderation styles.
- `app/smoke.mjs` — integrated source and local-mode regression contracts.
- `app/live-auth-smoke.mjs` — Edge adapter, visibility, state, and error-flow coverage.
- `docs/runbooks/live-auth.md` — migration, bucket, function deployment, secrets, acceptance, and rollback instructions.
- `README.md` — feature boundary and local/live ownership note.

---

### Task 1: Create the private avatar schema and least-privilege database contract

**Files:**
- Create: `supabase/migrations/20260917000001_profile_avatars.sql`
- Create: `supabase/tests/profile_avatars_integration.sql`
- Create: `supabase/tests/verify_profile_avatars.sh`
- Create: `supabase/tests/verify_profile_avatars_safety.sh`

**Interfaces:**
- Consumes: existing `public.profiles`, `public.current_user_role()`, `public.operational_bookings`, and Supabase `storage.buckets` / `storage.objects`.
- Produces: `public.profile_avatars`, `public.profile_avatar_audit`, `public.avatar_activate_custom(uuid,text)`, `public.avatar_remove_custom(uuid)`, `public.avatar_hide(uuid,uuid,text)`, `public.avatar_submit_review(uuid,text)`, `public.avatar_decide_review(uuid,uuid,text,text)`, and private bucket `profile-avatars`.

- [ ] **Step 1: Write the destructive-harness safety test**

Create `verify_profile_avatars_safety.sh` following the existing Giving/operational pattern. It must assert exit `2` when either variable is missing:

```bash
ITC_AVATAR_TEST_DATABASE_URL
ITC_ALLOW_DATABASE_RESET=1
```

It must never invoke `psql` without both values.

- [ ] **Step 2: Run the safety test and verify RED**

Run:

```bash
bash supabase/tests/verify_profile_avatars_safety.sh
```

Expected: FAIL because `verify_profile_avatars.sh` does not exist.

- [ ] **Step 3: Write the SQL integration assertions before the migration**

The integration script must use transactional assertions that prove:

```sql
select public.current_user_role();
select to_regclass('public.profile_avatars');
select to_regclass('public.profile_avatar_audit');
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'profile-avatars';
```

It must also switch to `authenticated` claims and prove direct insert/update/delete on both avatar tables and `storage.objects` are denied. As service-role test setup, exercise these exact transitions:

```text
no row -> active custom
active custom -> custom removed
active -> hidden with reason
hidden -> pending_review
pending_review -> active on approve
pending_review -> hidden on reject
```

Assert audit rows are append-only and reject blank moderation reasons.

- [ ] **Step 4: Run integration verification and verify RED**

Run against an acknowledged disposable Supabase-compatible database:

```bash
ITC_AVATAR_TEST_DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_profile_avatars.sh
```

Expected: FAIL because avatar tables, functions, and bucket do not exist.

- [ ] **Step 5: Implement the migration**

Use these state and bucket constraints:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 2097152,
        array['image/jpeg']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.profile_avatars (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  google_object_path text,
  active_object_path text,
  pending_object_path text,
  state text not null default 'active'
    check (state in ('active','hidden','pending_review')),
  moderated_by uuid references public.profiles(id) on delete set null,
  moderation_reason text,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'pending_review' or pending_object_path is not null),
  check (state <> 'hidden' or nullif(btrim(moderation_reason), '') is not null)
);

create table public.profile_avatar_audit (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in
    ('upload_attempt','upload','remove','google_import','hide',
     'submit_review','approve','reject')),
  reason text,
  created_at timestamptz not null default now()
);
```

Enable RLS, revoke browser table mutation, create no broad object policies, fix every SECURITY DEFINER `search_path`, derive actor role server-side, and make transition functions executable only by `service_role`.

- [ ] **Step 6: Complete the verifier and run GREEN**

The verifier must apply every ordered migration, then run `profile_avatars_integration.sql`. Run both:

```bash
bash supabase/tests/verify_profile_avatars_safety.sh
ITC_AVATAR_TEST_DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_profile_avatars.sh
```

Expected: safety PASS; disposable integration PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260917000001_profile_avatars.sql \
  supabase/tests/profile_avatars_integration.sql \
  supabase/tests/verify_profile_avatars.sh \
  supabase/tests/verify_profile_avatars_safety.sh
git commit -m "feat(profile): add private avatar data model"
```

---

### Task 2: Build pure avatar authorization and image-sanitization modules

**Files:**
- Create: `supabase/functions/_shared/avatar-policy.ts`
- Create: `supabase/functions/_shared/avatar-image.ts`
- Create: `supabase/functions/_shared/avatar-policy_test.ts`
- Create: `supabase/functions/_shared/avatar-image_test.ts`
- Create: `supabase/functions/deno.json`

**Interfaces:**
- Produces:
  - `APPROVED_ROLES: ReadonlySet<string>`
  - `assertApprovedRole(role: string): void`
  - `assertAdminRole(role: string): void`
  - `assertUploadRate(attempts: number): void`
  - `nextAvatarState(current, action): AvatarState`
  - `readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array>`
  - `sanitizeAvatar(bytes: Uint8Array): Promise<Uint8Array>`
  - `avatarObjectPath(profileId: string, kind: 'google'|'custom'|'pending'): string`

- [ ] **Step 1: Write policy tests**

Cover exact roles and state transitions:

```ts
Deno.test('pending cannot upload', () => {
  assertThrows(() => assertApprovedRole('pending'), Error, 'Approved membership required');
});

Deno.test('eleventh rolling-hour attempt is rejected', () => {
  assertThrows(() => assertUploadRate(10), Error, 'Too many photo attempts');
});

Deno.test('hidden upload becomes pending review', () => {
  assertEquals(nextAvatarState('hidden', 'upload'), 'pending_review');
});
```

Also reject member moderation and invalid state/action combinations.

- [ ] **Step 2: Write image tests**

Use in-test byte fixtures for a small JPEG, PNG, SVG text, GIF header, malformed JPEG, and payload over 2 MB. Assert:

- JPEG and PNG decode;
- SVG/GIF/malformed/oversized reject;
- excessive decoded dimensions reject;
- result starts with JPEG magic `ff d8 ff`;
- output represents 512×512 pixels;
- a fixture EXIF marker and GPS text do not appear in output.

- [ ] **Step 3: Run tests and verify RED**

Install Deno as an operator tool if absent; do not add an npm application dependency:

```bash
command -v deno >/dev/null || brew install deno
```

Then run:

```bash
deno test --allow-net supabase/functions/_shared/avatar-policy_test.ts \
  supabase/functions/_shared/avatar-image_test.ts
```

Expected: FAIL because shared modules do not exist.

- [ ] **Step 4: Implement policy helpers**

Use exact role and limit constants:

```ts
export const APPROVED_ROLES = new Set(['member', 'admin', 'super_admin']);
export const ADMIN_ROLES = new Set(['admin', 'super_admin']);
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_DECODED_EDGE = 4096;
export const OUTPUT_EDGE = 512;
export const MAX_ATTEMPTS_PER_HOUR = 10;
export const SIGNED_URL_TTL_SECONDS = 600;
```

`avatarObjectPath` must validate UUID shape and return:

```ts
`${profileId}/${kind}-${crypto.randomUUID()}.jpg`
```

- [ ] **Step 5: Implement trusted image processing**

Pin the Deno-native dependency:

```ts
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
```

Check JPEG/PNG magic before decode, reject all other types, reject dimensions above `4096`, center-crop Google sources when needed, resize to exactly `512×512`, and use:

```ts
const output = await image.encodeJPEG(85);
```

Because the output is freshly encoded pixels, no original EXIF/GPS/comment blocks survive.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
deno test --allow-net supabase/functions/_shared/avatar-policy_test.ts \
  supabase/functions/_shared/avatar-image_test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared supabase/functions/deno.json
git commit -m "feat(profile): add trusted avatar processing"
```

---

### Task 3: Implement approved-member upload, Google import, and removal

**Files:**
- Create: `supabase/functions/_shared/avatar-service.ts`
- Create: `supabase/functions/process-profile-avatar/index.ts`
- Create: `supabase/functions/process-profile-avatar/index_test.ts`

**Interfaces:**
- Consumes Task 1 state RPCs and Task 2 policy/image helpers.
- Produces HTTP contracts:
  - `POST multipart/form-data` with `action=upload`, `file=<cropped JPEG>`.
  - `POST application/json` with `{ "action": "sync_google" }`.
  - `DELETE` removes the caller's custom photo.
  - Success returns `{ presentation: AvatarPresentation }`.

`AvatarPresentation` is:

```ts
export type AvatarPresentation = {
  profileId: string;
  url: string | null;
  state: 'active' | 'hidden' | 'pending_review';
  source: 'custom' | 'google' | 'initials';
  expiresAt: string | null;
};
```

- [ ] **Step 1: Write endpoint tests with injected adapters**

Test without live secrets by injecting auth, database, identity, storage, and clock adapters. Assert:

- missing JWT → 401;
- pending profile → 403;
- eleventh attempt → 429;
- request profile ID/path fields are ignored or rejected;
- invalid bytes leave active path unchanged;
- normal upload activates immediately;
- hidden upload writes pending path and stays invisible;
- DELETE removes custom and resolves Google/initials;
- Google sync reads `identities[].identity_data.avatar_url` only for provider `google`;
- provider URLs require HTTPS plus exact host `googleusercontent.com` or a `.googleusercontent.com` subdomain;
- redirects outside that host family and responses over 2 MB are rejected;
- client JSON `googleUrl` is rejected;
- failed DB transition deletes the newly uploaded candidate.

- [ ] **Step 2: Run tests and verify RED**

```bash
deno test --allow-net supabase/functions/process-profile-avatar/index_test.ts
```

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Implement shared service adapters**

Create the user-scoped Supabase client with the request Authorization header and call `auth.getUser()`. Create a separate service client from function secrets only:

```ts
Deno.env.get('SUPABASE_URL')
Deno.env.get('SUPABASE_ANON_KEY')
Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
```

Never return service errors verbatim. Add helpers for upload, remove, signed URL, identity lookup, audit count, best-effort cleanup, and origin-aware CORS headers. Every endpoint must answer `OPTIONS`; accepted origins come from a comma-separated `ITC_APP_ORIGINS` function secret and never default to `*`.

- [ ] **Step 4: Implement endpoint state flow**

For uploads:

1. Authenticate and fetch current profile role.
2. Insert `upload_attempt` audit.
3. Enforce rolling-hour count.
4. Sanitize bytes.
5. Choose `custom` or `pending` from current moderation state.
6. Upload candidate with `contentType: 'image/jpeg'` and `upsert: false`.
7. Invoke atomic state RPC.
8. Delete obsolete object after successful transition.
9. Return a fresh signed presentation.

For Google sync, use the verified auth identity URL, bounded-fetch it, sanitize, and store under `google-*`. For removal, clear only the custom object and resolve Google or initials.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
deno test --allow-net supabase/functions/process-profile-avatar/index_test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/avatar-service.ts \
  supabase/functions/process-profile-avatar
git commit -m "feat(profile): process private member avatars"
```

---

### Task 4: Resolve only own or session-authorized avatars

**Files:**
- Create: `supabase/functions/resolve-profile-avatars/index.ts`
- Create: `supabase/functions/resolve-profile-avatars/index_test.ts`

**Interfaces:**
- Produces:
  - `GET ?scope=self` → `{ avatars: AvatarPresentation[] }`.
  - `GET ?scope=session&sessionId=<id>` → `{ avatars: AttendeeAvatar[] }`.
  - `GET ?scope=admin_members` → `{ rows: ModerationRow[] }`, Admin-only.

```ts
export type AttendeeAvatar = AvatarPresentation & {
  displayName: string;
};

export type ModerationRow = AvatarPresentation & {
  displayName: string;
  pendingPreviewUrl: string | null;
  moderationReason: string | null;
  moderatedAt: string | null;
};
```

- [ ] **Step 1: Write authorization and enumeration tests**

Assert:

- public/pending/declined session requests return 403 and no rows;
- approved self returns only own presentation;
- session resolution derives profile IDs from confirmed authoritative bookings;
- arbitrary `profileId` and comma-separated ID parameters return 400;
- a caller cannot resolve members outside the requested session;
- hidden and pending-review targets return initials to other members;
- owner/Admin preview may resolve pending image;
- Admin-members scope rejects non-Admins and returns active, hidden, and pending rows for the existing Admin member list;
- signed URLs expire in 600 seconds;
- storage signing failure returns initials for only the affected row.

- [ ] **Step 2: Run tests and verify RED**

```bash
deno test --allow-net supabase/functions/resolve-profile-avatars/index_test.ts
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement resolver**

Validate `scope` and `sessionId`, authenticate, and check current role. For session scope query only active confirmed bookings for that session, then join safe display identity. Admin-members scope requires Admin/Super Admin and may return the internal moderation reason and pending preview but never raw object paths or audit history. Self/session responses do not expose email, role, moderation reason, or audit data.

Resolution order:

```text
state hidden/pending_review for peer -> initials
active custom path -> signed custom URL
google path -> signed Google URL
otherwise -> initials
```

Return signed URLs and ISO expiry timestamps; do not persist them.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
deno test --allow-net supabase/functions/resolve-profile-avatars/index_test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/resolve-profile-avatars
git commit -m "feat(profile): scope avatar reads to authorized surfaces"
```

---

### Task 5: Implement Admin moderation and pending-review decisions

**Files:**
- Create: `supabase/functions/moderate-profile-avatar/index.ts`
- Create: `supabase/functions/moderate-profile-avatar/index_test.ts`

**Interfaces:**
- Produces `POST` JSON actions:

```ts
{ action: 'hide', profileId: string, reason: string }
{ action: 'approve', profileId: string }
{ action: 'reject', profileId: string, reason: string }
```

- [ ] **Step 1: Write moderation tests**

Assert member and pending actors receive 403; Admin and Super Admin succeed. Assert blank hide/reject reasons return 400, target ID must be UUID-shaped, hide suppresses Google/custom, approve promotes pending, reject deletes pending, retries are idempotent, and every successful action records actor/reason/time.

- [ ] **Step 2: Run tests and verify RED**

```bash
deno test --allow-net supabase/functions/moderate-profile-avatar/index_test.ts
```

Expected: FAIL because the moderation endpoint does not exist.

- [ ] **Step 3: Implement moderation endpoint**

Authenticate the actor, query role server-side, validate JSON, invoke the Task 1 transition RPC, clean obsolete objects after commit, and return the target's new safe presentation. Do not return raw paths or audit internals.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
deno test --allow-net supabase/functions/moderate-profile-avatar/index_test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/moderate-profile-avatar
git commit -m "feat(profile): moderate member avatars"
```

---

### Task 6: Add pure frontend avatar and crop contracts

**Files:**
- Create: `app/js/avatar.js`
- Create: `app/avatar-smoke.mjs`

**Interfaces:**
- Produces:

```js
avatarInitials(name) => string
normalizeAvatarPresentation(value) => { url, source, state, expiresAt }
avatarMarkup({ name, presentation, size, className, decorative }) => string
fitCrop({ imageWidth, imageHeight, viewportSize }) => CropState
clampCrop(state) => CropState
cropSourceRect(state) => { sx, sy, sw, sh }
```

- [ ] **Step 1: Write failing pure tests**

Cover empty/single/multi-word initials, HTML escaping, safe HTTPS signed URLs only, rejection of `javascript:`/`data:`/arbitrary Google URLs, initials fallback, crop centering, zoom bounds, drag clamping, portrait/landscape source rectangles, and deterministic 512-square output intent.

- [ ] **Step 2: Run tests and verify RED**

```bash
node app/avatar-smoke.mjs
```

Expected: FAIL because `app/js/avatar.js` does not exist.

- [ ] **Step 3: Implement pure helpers**

`avatarMarkup` must use only normalized server presentation data. Emit an `<img>` with escaped `src`, descriptive `alt` unless decorative, fixed width/height, `loading="lazy"` outside the own top avatar, and an `onerror`-independent initials sibling that CSS can reveal.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
node app/avatar-smoke.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/avatar.js app/avatar-smoke.mjs
git commit -m "feat(profile): add avatar presentation primitives"
```

---

### Task 7: Build the accessible crop and Manage Photo dialog

**Files:**
- Create: `app/js/avatar-cropper.js`
- Modify: `app/styles.css`
- Modify: `app/avatar-smoke.mjs`

**Interfaces:**
- Consumes Task 6 crop helpers.
- Produces:

```js
openAvatarManager({
  memberName,
  presentation,
  moderated,
  onUpload,   // async (jpegBlob) => AvatarPresentation
  onRemove,   // async () => AvatarPresentation
}) => { close() }

renderCropToJpeg({ image, crop, edge = 512, quality = 0.9 }) => Promise<Blob>
```

- [ ] **Step 1: Extend tests before implementation**

Add DOM-light assertions for accepted picker MIME values, 512 canvas dimensions, JPEG output type, zoom min/max, keyboard arrow movement, duplicate-save suppression, cancellation cleanup, focus restoration, and the absence of base64/localStorage writes in source.

- [ ] **Step 2: Run tests and verify RED**

```bash
node app/avatar-smoke.mjs
```

Expected: FAIL because manager/cropper exports do not exist.

- [ ] **Step 3: Implement image selection and cropping**

Use a hidden standard picker:

```html
<input type="file" accept="image/jpeg,image/png,image/webp">
```

Do not add the `capture` attribute because some mobile browsers would force camera-only behavior; the standard image picker must offer both camera and library where supported. Decode with `createImageBitmap` where available and an object-URL `<img>` fallback. Revoke object URLs after decode.

Render crop to an offscreen 512×512 canvas and call:

```js
canvas.toBlob(resolve, 'image/jpeg', 0.9)
```

Reject a null blob or a result above 2 MB before network submission.

- [ ] **Step 4: Implement accessible modal behavior and styles**

Provide labelled zoom range, pointer/touch drag, arrow-key movement, circular preview mask, progress text with `aria-live`, disabled busy controls, Escape close, focus trap, and trigger focus restoration. Moderated copy must distinguish hidden from pending review.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/js/avatar-cropper.js app/avatar-smoke.mjs app/styles.css
git commit -m "feat(profile): add accessible avatar crop flow"
```

---

### Task 8: Add store adapters and own Profile/top-navigation behavior

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/index.html`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Produces:

```js
getOwnAvatar({ force = false } = {}) => Promise<AvatarPresentation>
uploadMyAvatar(jpegBlob) => Promise<AvatarPresentation>
removeMyAvatar() => Promise<AvatarPresentation>
clearAvatarCache() => void
```

- [ ] **Step 1: Write failing live adapter tests**

Mock `supabase.functions.invoke` and assert exact function names, methods/bodies, generic errors, busy recovery, cache replacement, 401 behavior, and no Storage API call from the browser. Assert local mode returns initials and never serializes image data.

- [ ] **Step 2: Write failing render/delegation tests**

Assert approved Profile avatar is a labelled manage-photo button; pending/declined avatar is not; top navigation uses resolved presentation; Google sync is requested after approved sign-in; sign-out clears in-memory avatar URLs; upload/remove rerender without page reload; image error reveals initials.

- [ ] **Step 3: Run tests and verify RED**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: FAIL on missing adapters, manager action, and resolved avatar markup.

- [ ] **Step 4: Implement store adapters and memory cache**

Invoke only Edge Functions:

```js
supabase.functions.invoke('resolve-profile-avatars', { method: 'GET', query: { scope: 'self' } })
supabase.functions.invoke('process-profile-avatar', { body: formData })
supabase.functions.invoke('process-profile-avatar', { method: 'DELETE' })
```

If the client helper cannot encode GET query options, call the function URL with the current access token through one private adapter in `store.js`. Do not duplicate auth headers in views.

- [ ] **Step 5: Wire Profile and top navigation**

Replace initials-only rendering with Task 6 markup. On the approved Profile hero, wrap the avatar in `data-action="manage-profile-photo"`. Open Task 7 manager, pass upload/remove callbacks, and update both Profile and top navigation after success.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/js/store.js app/js/views.js app/js/app.js app/index.html \
  app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(profile): manage approved member photos"
```

---

### Task 9: Add attendee avatars and Admin moderation UI

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Produces:

```js
getSessionAvatars(sessionId, { force = false } = {}) => Promise<AttendeeAvatar[]>
getAdminAvatarRows({ force = false } = {}) => Promise<ModerationRow[]>
moderateAvatar(profileId, action, reason = '') => Promise<AvatarPresentation>
```

- [ ] **Step 1: Write failing attendee tests**

Assert approved Activity Details requests resolver data by session ID and renders avatar/name rows. Signed-out and pending views must retain the current member-only gate and make no function call. Resolver failure must keep safe attendee copy or initials without exposing IDs/paths.

- [ ] **Step 2: Write failing moderation tests**

Assert Admin Members renders photo state and Hide control, requires a reason, and exposes a pending replacement queue. Assert member views contain no moderation controls. Test approve/reject duplicate suppression, failure preservation, and rerender after success.

- [ ] **Step 3: Run tests and verify RED**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: FAIL on absent session resolver and moderation controls.

- [ ] **Step 4: Implement attendee resolution and rendering**

Hydrate by session ID in the route layer, pass resolved rows into `viewActivity`, and render Task 6 compact avatars beside existing abbreviated display names. Do not change RSVP/payment eligibility or attendee counts.

- [ ] **Step 5: Implement Admin moderation adapters and UI**

Invoke `resolve-profile-avatars` with `scope=admin_members` for Admin member rows and pending-review data, and invoke `moderate-profile-avatar` for actions. Hide/reject require trimmed reason; approve does not. Pending image preview URLs remain Admin/owner-only and expire normally.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/js/store.js app/js/views.js app/js/app.js app/styles.css \
  app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(profile): show and moderate attendee avatars"
```

---

### Task 10: Document deployment, verify the complete feature, and prepare integration

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/live-auth.md`
- Modify: `docs/superpowers/specs/2026-09-17-profile-photo-design.md` only if implementation names changed during reviewed execution.

**Interfaces:**
- Consumes every prior task.
- Produces an operator-ready deployment and rollback procedure with no secrets.

- [ ] **Step 1: Write runbook assertions before documentation**

Extend `app/smoke.mjs` to require these runbook markers:

```text
20260917000001_profile_avatars.sql
profile-avatars
process-profile-avatar
resolve-profile-avatars
moderate-profile-avatar
SUPABASE_SERVICE_ROLE_KEY
ITC_APP_ORIGINS
600 seconds
rollback
```

Also assert the runbook never contains a JWT/service-role literal.

- [ ] **Step 2: Run smoke and verify RED**

```bash
node app/smoke.mjs
```

Expected: FAIL because deployment instructions are missing.

- [ ] **Step 3: Write deployment and rollback instructions**

Document exact order:

```bash
supabase db push
supabase functions deploy process-profile-avatar
supabase functions deploy resolve-profile-avatars
supabase functions deploy moderate-profile-avatar
```

Document Dashboard secret configuration without values, bucket privacy verification, Google/magic-link acceptance accounts, Admin moderation cases, Storage cleanup checks, and disabling frontend/function access before object cleanup during rollback.

Clarify that local mode keeps initials and never stores image data.

- [ ] **Step 4: Run all repository and feature verification**

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
deno test --allow-net supabase/functions/_shared/*_test.ts \
  supabase/functions/process-profile-avatar/index_test.ts \
  supabase/functions/resolve-profile-avatars/index_test.ts \
  supabase/functions/moderate-profile-avatar/index_test.ts
bash supabase/tests/verify_profile_avatars_safety.sh
git diff --check origin/main...HEAD
```

When a disposable Supabase-compatible database is available, also run:

```bash
ITC_AVATAR_TEST_DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_profile_avatars.sh
```

Expected: every available check PASS. A missing acknowledged disposable database is reported as an unexecuted deployment acceptance item, never as a fabricated pass.

- [ ] **Step 5: Perform manual browser acceptance**

Serve with:

```bash
python3 -m http.server 4173
```

Verify current Safari/iOS and Chrome/Android camera/library choice, drag/zoom/keyboard crop, upload progress, Google fallback, remove, top/Profile sync, attendee visibility, signed-out denial, Admin hide, moderated replacement, approve/reject, broken image fallback, and narrow layouts.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md docs/runbooks/live-auth.md app/smoke.mjs
git commit -m "docs(profile): add avatar deployment runbook"
```

- [ ] **Step 7: Request review before integration**

Compare against the spec, request code review, and keep `feature/profile-photo` plus its worktree available. Do not merge directly into `testing` from this task. After approval, use the finishing-branch workflow to integrate against the then-current `testing` branch and rerun all Node suites on the integrated result.
