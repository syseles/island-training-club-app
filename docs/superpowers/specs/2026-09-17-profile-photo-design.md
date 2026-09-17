# Profile Photo Design

Date: 2026-09-17  
Status: Approved 2026-09-17
Branch: `feature/profile-photo`, based on `main`

## Purpose

Allow approved ITC members to use a profile photo while preserving the app's pending-first membership model and preventing public access, arbitrary image URLs, direct Storage writes, metadata leakage, and member-directory enumeration.

This is a live Supabase feature. Local prototype mode must not store image binaries or base64 data in `localStorage`.

## Confirmed product decisions

- Only approved members may upload, replace, or remove a photo.
- Approved members and Admins may see photos on authorized member surfaces.
- Pending and declined users do not receive other members' photos.
- Public visitors never receive member photo URLs.
- Photos appear in the Profile header, top navigation avatar, and approved-member activity attendee lists.
- The UI will provide a reusable avatar component for future Community features, but this work does not add a Community feed, directory, or public prayer list.
- Google-authenticated approved members use their Google photo automatically when one is available.
- A custom upload takes precedence over the Google photo.
- Removing a custom upload restores the sanitized Google photo; members without one see initials.
- Members manage their photo by tapping the Profile avatar.
- Mobile users may choose from the library or use the camera.
- Members manually drag and zoom a square crop before saving.
- Admin and Super Admin may hide inappropriate photos with a required internal reason.
- An Admin-hidden member sees initials. Their next upload remains private until an Admin approves or rejects it.

## Non-goals

- Public profile photos.
- A searchable member directory.
- Community posts, comments, reactions, or prayer-request visibility.
- Automated face recognition, identity verification, or content classification.
- Arbitrary remote image URLs.
- Direct browser writes to Supabase Storage.
- Persisting photos in `localStorage`.
- Native iOS or Android upload implementations.

## Trust boundary and architecture

Use a private Supabase Storage bucket named `profile-avatars`. Authenticated browsers receive no insert, update, or delete access to its objects.

The browser performs the interactive crop for responsiveness, then sends the cropped image to an authenticated Supabase Edge Function. Browser processing is not trusted as validation. The function derives the member ID from the verified JWT, verifies the current profile role, decodes the submitted image, enforces limits, re-encodes a clean 512×512 JPEG, and writes it under a server-generated path with the service role.

Use three narrow Edge Function interfaces:

1. `process-profile-avatar`
   - Upload or replace the caller's custom image.
   - Remove the caller's custom image.
   - Import and sanitize the caller's verified Google identity photo.
2. `resolve-profile-avatars`
   - Resolve the caller's own avatar.
   - Resolve avatars for an activity by session ID; the server derives eligible attendee IDs rather than accepting an enumerable list of profile IDs.
3. `moderate-profile-avatar`
   - Admin hide, pending replacement preview, approve, and reject actions.

Shared image validation, authorization, signed-URL, state-transition, and cleanup code belongs in a small Edge Function shared module rather than being duplicated between handlers.

No Edge Function secret or Supabase service-role key may enter browser code, repository files, logs, or screenshots. Edge endpoints answer CORS preflight explicitly and allow only configured local, preview, and production app origins.

## Data model

Add `public.profile_avatars`:

- `profile_id uuid primary key references public.profiles(id) on delete cascade`
- `google_object_path text null`
- `active_object_path text null`
- `pending_object_path text null`
- `state text not null` constrained to `active`, `hidden`, or `pending_review`
- `moderated_by uuid null references public.profiles(id) on delete set null`
- `moderation_reason text null`
- `moderated_at timestamptz null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

`active` includes both a custom active image and the no-custom state. Resolution order determines whether the Google object or initials appears. `hidden` suppresses every photo source. `pending_review` also resolves to initials for other members while allowing only the owner and Admins to preview the pending object.

Add `public.profile_avatar_audit`:

- immutable event ID;
- target profile ID;
- actor profile ID;
- action (`upload_attempt`, `upload`, `remove`, `hide`, `submit_review`, `approve`, `reject`);
- optional moderation reason;
- timestamp.

Audit rows contain no signed URLs, image bytes, original filenames, or provider tokens. Upload-rate checks use recent audit attempts for the authenticated profile and enforce no more than ten attempts per rolling hour.

Direct client access to raw object paths and avatar tables is not required. Edge Functions return only resolved presentation data. RLS and grants deny browser mutation; the service role performs validated transitions.

The app must stop treating a client-editable `profiles.avatar_url` as a general image source. Google fallback is obtained from verified Google identity data by the Edge Function, sanitized, cached in the private bucket, and then resolved through the same private delivery path.

## Avatar state and lifecycle

### Google fallback

For an approved Google-authenticated member, the processing function reads the verified Google identity, downloads the provider image server-side, validates it, stores a sanitized JPEG, and caches its path. Magic-link members or Google accounts without a usable image fall back to initials.

The original Google URL is never exposed to other members and is never accepted from request input. Provider fetches require HTTPS, an exact `googleusercontent.com` host or subdomain, bounded redirects that remain on that host family, and bounded response reads to prevent SSRF and oversized downloads.

### Normal custom upload

An approved, non-moderated member crops an image and submits it. A successful processed object becomes active immediately. The prior custom object is deleted only after the database transition succeeds. The sanitized Google object remains available as fallback.

### Member removal

Removing a custom image deletes its stored object and clears its path. Resolution then returns the sanitized Google object or initials.

### Admin hide

Admin and Super Admin may hide a member's photo with a required reason. The transition suppresses both custom and Google objects from presentation and records an audit event. Other members immediately receive initials.

### Replacement after moderation

A hidden member may submit one processed replacement. It is stored as `pending_object_path` and changes state to `pending_review`. Only that member and Admins may preview it. Other members continue to see initials.

Approval atomically promotes the pending object, clears the moderation restriction, and deletes obsolete custom objects. Rejection deletes the pending object and returns the state to `hidden`.

### Deletion and cleanup

Account deletion cascades metadata and triggers best-effort removal of associated bucket objects. Replacement, rejection, and failed database transitions also remove orphan candidates. A scheduled cleanup task may remove objects not referenced by either avatar path after a conservative retention window.

## Image validation and processing

The Edge Function must:

- require an authenticated approved member for member actions;
- derive identity exclusively from the JWT;
- accept no caller-controlled object path;
- cap the submitted cropped payload at 2 MB;
- allow JPEG, PNG, or WebP source selection in the browser, while sending a cropped JPEG payload to the function;
- accept only successfully decoded JPEG or PNG payloads at the trusted processing boundary;
- reject SVG, GIF/animation, malformed data, and excessive decoded dimensions;
- ignore claimed filename extensions and client MIME values;
- normalize orientation;
- output exactly 512×512 JPEG;
- strip EXIF, GPS, comments, profiles, and original filenames;
- use a random version component in the object name;
- discard the submitted source after processing.

The crop UI may send a 512×512 output for efficiency, but server-side decoding and re-encoding remain mandatory.

## Read authorization and delivery

All avatar objects are private. The resolver produces signed URLs with an approximately ten-minute expiry.

- Own-profile resolution is allowed to the authenticated owner.
- Admin resolution is allowed for operational moderation surfaces.
- Attendee resolution accepts a session ID, verifies that the caller is approved, derives visible confirmed attendee identities from authoritative booking data, and returns only those display identities and signed photo URLs.
- Public, pending, and declined callers receive no cross-member avatar data.
- A caller cannot request the full membership list through the avatar API.

The client caches signed URLs only in memory and refreshes when needed. Failed or expired images render initials without exposing internal object paths.

## Member experience

The Profile hero and top navigation use one reusable avatar renderer. Tapping the Profile avatar opens **Manage Profile Photo**.

The management dialog provides:

- camera or photo-library selection through the device's standard picker;
- square crop with drag and zoom;
- circular presentation preview;
- upload progress and a disabled duplicate-submit state;
- replace and remove controls;
- clear Google-photo or initials fallback copy;
- moderated and pending-review status copy.

The crop interaction must work with pointer, touch, and keyboard input. The dialog traps focus, closes with Escape, restores focus to the trigger, labels controls, and does not rely on color alone.

No original image is uploaded before the member confirms the crop.

## Attendee lists and future Community use

Approved-member activity attendee lists show a compact avatar next to the existing abbreviated display name. Signed-out and pending viewers retain the existing member-only gate and never request avatar data.

The reusable avatar renderer supports image, initials, accessible name, size, and fallback. It may be reused by future Community work, but no current prayer or Community data becomes visible through this feature.

## Admin moderation

Admin → Members adds photo moderation state and controls. A separate pending-photo review section shows only pending replacements and safe member identity.

Admin actions:

- Hide active/provider photo with a required internal reason.
- Preview a pending replacement.
- Approve and publish the pending replacement.
- Reject and delete the pending replacement with a required reason.

Every action is authorized again inside the Edge Function and records an audit event. UI role checks are presentation only, not authorization.

## Error handling

- Invalid or unsupported files produce actionable generic copy without echoing server internals.
- Upload failure leaves the existing active photo unchanged.
- Database failure after object creation triggers candidate-object cleanup.
- Cleanup failure is logged with object identifiers only and is retryable.
- Google import failure falls back to initials and does not block authentication.
- Resolver, network, processing, or signed-URL failures fall back to initials.
- Duplicate upload and moderation requests are suppressed while in flight.
- A rejected or expired session returns an authentication error and performs no write.

## Testing

### Frontend and smoke coverage

- Initials, Google, custom, hidden, and pending display states.
- Approved-only Manage Photo controls.
- Camera/library input contract.
- Crop drag, zoom, preview, confirmation, and cancellation.
- Busy-state duplicate suppression and failure recovery.
- Profile, top navigation, and attendee-list avatar fallback.
- Community and prayer visibility remain unchanged.
- Local mode stores no image binary in `localStorage`.

### Edge Function and database coverage

- Signed-out, pending, declined, approved, Admin, and Super Admin authorization.
- User-ID, session-ID, and object-path tampering.
- Real signature versus claimed MIME.
- Malformed, SVG, animated, oversized, and excessive-dimension rejection.
- Metadata stripping and exact sanitized output shape.
- Upload rate limiting.
- Google identity verification and sanitization.
- Normal activation, removal, and fallback.
- Hide, submit-for-review, approve, and reject transitions.
- Audit creation and least-privilege reads.
- Public/pending cross-member denial and attendee-scoped resolution.
- Atomic replacement and orphan cleanup behavior.

### Manual acceptance

Test Safari/iOS and Chrome/Android camera/library flows, crop gestures, keyboard controls, narrow attendee rows, expired URL fallback, Admin moderation, and processed-output metadata. Verify that signed-out and pending sessions never receive member image URLs.

## Deployment and rollback

Deployment order:

1. Apply avatar-table, audit, private-bucket, grants, and RLS migrations.
2. Configure and deploy the Edge Functions with secrets only in Supabase.
3. Run authorization and image-processing acceptance tests against the testing project.
4. Deploy the frontend controls and attendee rendering.
5. Test Google and magic-link members in both normal and moderated states.
6. Monitor function errors, processing latency, and Storage growth.

Rollback disables upload and resolution UI first, then disables the Edge Functions. Existing private objects remain inaccessible while a trusted cleanup is planned. Rollback must not delete profiles, bookings, membership status, or unrelated auth data.

## Branch and integration

Implementation occurs on `feature/profile-photo`, created from `main` at `b44c76d`. The feature remains non-Shop work. After feature verification, integration into the then-current `testing` branch must preserve newer auth, attendee, Community, and Admin behavior and rerun both smoke suites on the integrated result.
