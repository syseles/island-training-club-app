import { assertEquals } from '@std/assert';
import type {
  AvatarRecord,
  AvatarTransition,
  ProcessAvatarDependencies,
} from '../_shared/avatar-service.ts';
import { createModerateProfileAvatarHandler } from './index.ts';

const ADMIN_ID = '11000000-0000-4000-8000-000000000001';
const TARGET_ID = '22000000-0000-4000-8000-000000000002';
const ORIGIN = 'http://127.0.0.1:4173';
const CUSTOM_PATH = `${TARGET_ID}/custom-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
const GOOGLE_PATH = `${TARGET_ID}/google-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
const PENDING_PATH = `${TARGET_ID}/pending-cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg`;

function avatar(overrides: Partial<AvatarRecord> = {}): AvatarRecord {
  return {
    profileId: TARGET_ID,
    state: 'active',
    googleObjectPath: GOOGLE_PATH,
    activeObjectPath: CUSTOM_PATH,
    pendingObjectPath: null,
    moderationReason: null,
    moderatedAt: null,
    ...overrides,
  };
}

function moderationHarness(options: {
  actorRole?: string;
  target?: AvatarRecord;
} = {}) {
  let target = options.target ?? avatar();
  const removed: string[] = [];
  const audit: Array<{
    actorId: string;
    action: string;
    reason: string | null;
    at: string;
  }> = [];

  const transition = (replacedObjectPaths: string[]): AvatarTransition => ({
    avatar: target,
    replacedObjectPaths,
  });

  const dependencies: ProcessAvatarDependencies = {
    auth: {
      getUser: (token) =>
        Promise.resolve(
          token === 'valid-token' ? { id: ADMIN_ID, identities: [] } : null,
        ),
    },
    identity: { googleAvatarUrl: () => null },
    database: {
      getProfile(profileId) {
        if (profileId === ADMIN_ID) {
          return Promise.resolve({
            profileId,
            role: options.actorRole ?? 'admin',
            avatar: avatar({ profileId: ADMIN_ID }),
          });
        }
        return Promise.resolve(null);
      },
      recordUploadAttempt: () => Promise.resolve(true),
      activateCustom: () => Promise.reject(new Error('unused')),
      submitReview: () => Promise.reject(new Error('unused')),
      setGoogle: () => Promise.reject(new Error('unused')),
      removeCustom: () => Promise.reject(new Error('unused')),
      listSessionAttendees: () => Promise.resolve([]),
      listAdminMembers: () => Promise.resolve([]),
      hideAvatar(profileId, actorId, reason) {
        if (profileId !== TARGET_ID) return Promise.reject(new Error('missing target'));
        const replaced = target.pendingObjectPath ? [target.pendingObjectPath] : [];
        if (!(target.state === 'hidden' && target.moderationReason === reason)) {
          target = avatar({
            ...target,
            state: 'hidden',
            pendingObjectPath: null,
            moderationReason: reason,
            moderatedAt: '2026-09-17T10:00:00.000Z',
          });
        }
        audit.push({
          actorId,
          action: 'hide',
          reason,
          at: '2026-09-17T10:00:00.000Z',
        });
        return Promise.resolve(transition(replaced));
      },
      decideReview(profileId, actorId, decision, reason) {
        if (profileId !== TARGET_ID) return Promise.reject(new Error('missing target'));
        const pending = target.pendingObjectPath;
        let replaced: string[] = [];
        if (decision === 'approve' && target.state === 'pending_review' && pending) {
          replaced = target.activeObjectPath ? [target.activeObjectPath] : [];
          target = avatar({
            ...target,
            state: 'active',
            activeObjectPath: pending,
            pendingObjectPath: null,
            moderationReason: null,
            moderatedAt: null,
          });
        } else if (decision === 'reject' && target.state === 'pending_review' && pending) {
          replaced = [pending];
          target = avatar({
            ...target,
            state: 'hidden',
            pendingObjectPath: null,
            moderationReason: reason,
            moderatedAt: '2026-09-17T10:00:00.000Z',
          });
        }
        audit.push({
          actorId,
          action: decision,
          reason,
          at: '2026-09-17T10:00:00.000Z',
        });
        return Promise.resolve(transition(replaced));
      },
    },
    storage: {
      upload: () => Promise.reject(new Error('unused')),
      remove(paths) {
        removed.push(...paths);
        return Promise.resolve();
      },
      createSignedUrl(path, expiresIn) {
        return Promise.resolve(`https://signed.invalid/${expiresIn}/${encodeURIComponent(path)}`);
      },
    },
    clock: { now: () => new Date('2026-09-17T10:00:00.000Z') },
    fetch,
    allowedOrigins: new Set([ORIGIN]),
  };

  return {
    handler: createModerateProfileAvatarHandler(dependencies),
    target: () => target,
    removed,
    audit,
  };
}

function request(body: Record<string, unknown>): Request {
  return new Request('http://edge.invalid/moderate-profile-avatar', {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      origin: ORIGIN,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

Deno.test('member and pending actors cannot moderate avatars', async () => {
  for (const actorRole of ['member', 'pending']) {
    const { handler, audit } = moderationHarness({ actorRole });
    const response = await handler(request({
      action: 'hide',
      profileId: TARGET_ID,
      reason: 'Inappropriate image',
    }));
    assertEquals(response.status, 403);
    assertEquals(audit.length, 0);
  }
});

Deno.test('Admin and Super Admin can hide an active photo', async () => {
  for (const actorRole of ['admin', 'super_admin']) {
    const { handler, target, audit } = moderationHarness({ actorRole });
    const response = await handler(request({
      action: 'hide',
      profileId: TARGET_ID,
      reason: '  Inappropriate image  ',
    }));
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.presentation.source, 'initials');
    assertEquals(body.presentation.url, null);
    assertEquals('activeObjectPath' in body.presentation, false);
    assertEquals('googleObjectPath' in body.presentation, false);
    assertEquals(target().state, 'hidden');
    assertEquals(audit[0], {
      actorId: ADMIN_ID,
      action: 'hide',
      reason: 'Inappropriate image',
      at: '2026-09-17T10:00:00.000Z',
    });
  }
});

Deno.test('blank hide and reject reasons are rejected', async () => {
  for (const action of ['hide', 'reject']) {
    const { handler, audit } = moderationHarness();
    const response = await handler(request({ action, profileId: TARGET_ID, reason: '   ' }));
    assertEquals(response.status, 400);
    assertEquals(audit.length, 0);
  }
});

Deno.test('moderation target must be a UUID-shaped profile ID', async () => {
  const { handler, audit } = moderationHarness();
  const response = await handler(request({
    action: 'hide',
    profileId: '../other',
    reason: 'Invalid target',
  }));
  assertEquals(response.status, 400);
  assertEquals(audit.length, 0);
});

Deno.test('approve promotes pending replacement and removes replaced active object', async () => {
  const { handler, target, removed, audit } = moderationHarness({
    target: avatar({
      state: 'pending_review',
      pendingObjectPath: PENDING_PATH,
      moderationReason: 'Prior moderation',
      moderatedAt: '2026-09-17T09:00:00.000Z',
    }),
  });
  const response = await handler(request({ action: 'approve', profileId: TARGET_ID }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.presentation.state, 'active');
  assertEquals(body.presentation.source, 'custom');
  assertEquals(target().activeObjectPath, PENDING_PATH);
  assertEquals(target().pendingObjectPath, null);
  assertEquals(removed, [CUSTOM_PATH]);
  assertEquals(audit[0].action, 'approve');
  assertEquals(audit[0].actorId, ADMIN_ID);
  assertEquals(audit[0].at, '2026-09-17T10:00:00.000Z');
});

Deno.test('reject hides target and removes pending replacement', async () => {
  const { handler, target, removed, audit } = moderationHarness({
    target: avatar({
      state: 'pending_review',
      pendingObjectPath: PENDING_PATH,
      moderationReason: 'Prior moderation',
    }),
  });
  const response = await handler(request({
    action: 'reject',
    profileId: TARGET_ID,
    reason: 'Still inappropriate',
  }));
  assertEquals(response.status, 200);
  assertEquals(target().state, 'hidden');
  assertEquals(target().pendingObjectPath, null);
  assertEquals(removed, [PENDING_PATH]);
  assertEquals(audit[0].reason, 'Still inappropriate');
});

Deno.test('moderation retries remain successful without changing final state', async () => {
  for (const action of ['hide', 'approve', 'reject'] as const) {
    const initial = action === 'hide'
      ? avatar()
      : avatar({ state: 'pending_review', pendingObjectPath: PENDING_PATH });
    const { handler, target, audit, removed } = moderationHarness({ target: initial });
    const body = action === 'approve'
      ? { action, profileId: TARGET_ID }
      : { action, profileId: TARGET_ID, reason: 'Moderation reason' };
    assertEquals((await handler(request(body))).status, 200);
    const stateAfterFirst = target().state;
    assertEquals((await handler(request(body))).status, 200);
    assertEquals(target().state, stateAfterFirst);
    assertEquals(audit.length, 2);
    assertEquals(
      removed,
      action === 'approve' ? [CUSTOM_PATH] : action === 'reject' ? [PENDING_PATH] : [],
    );
  }
});
