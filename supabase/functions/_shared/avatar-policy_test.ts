import { assertEquals, assertThrows } from '@std/assert';
import {
  assertAdminRole,
  assertApprovedRole,
  assertUploadRate,
  avatarObjectPath,
  nextAvatarState,
} from './avatar-policy.ts';

Deno.test('pending profile cannot upload', () => {
  assertThrows(
    () => assertApprovedRole('pending'),
    Error,
    'Approved membership required',
  );
});

Deno.test('approved member and administrative roles may upload', () => {
  for (const role of ['member', 'admin', 'super_admin']) {
    assertEquals(assertApprovedRole(role), undefined);
  }
});

Deno.test('member cannot moderate profile photos', () => {
  assertThrows(
    () => assertAdminRole('member'),
    Error,
    'Administrator access required',
  );
});

Deno.test('eleventh rolling-hour attempt is rejected', () => {
  assertThrows(
    () => assertUploadRate(10),
    Error,
    'Too many photo attempts',
  );
});

Deno.test('first ten rolling-hour attempts are admitted', () => {
  for (const priorAttempts of [0, 1, 9]) {
    assertEquals(assertUploadRate(priorAttempts), undefined);
  }
});

Deno.test('hidden profile upload becomes pending review', () => {
  assertEquals(nextAvatarState('hidden', 'upload'), 'pending_review');
});

Deno.test('pending replacement approval becomes active', () => {
  assertEquals(nextAvatarState('pending_review', 'approve'), 'active');
});

Deno.test('pending replacement rejection remains hidden', () => {
  assertEquals(nextAvatarState('pending_review', 'reject'), 'hidden');
});

Deno.test('invalid avatar transition is rejected', () => {
  assertThrows(
    () => nextAvatarState('active', 'approve'),
    Error,
    'Invalid avatar state transition',
  );
});

Deno.test('avatar object path is owned by the validated profile and kind', () => {
  const profileId = '22000000-0000-4000-8000-000000000002';
  const path = avatarObjectPath(profileId, 'custom');
  assertEquals(
    new RegExp(`^${profileId}/custom-[0-9a-f-]{36}\\.jpg$`).test(path),
    true,
  );
});

Deno.test('avatar object path rejects invalid profile IDs and kinds', () => {
  assertThrows(() => avatarObjectPath('../other', 'custom'), Error, 'Invalid profile ID');
  assertThrows(
    () => avatarObjectPath('22000000-0000-4000-8000-000000000002', 'other' as 'custom'),
    Error,
    'Invalid avatar object kind',
  );
});
