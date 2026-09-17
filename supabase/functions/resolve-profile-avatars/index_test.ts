import { assertEquals, assertStringIncludes } from '@std/assert';
import type {
  AuthUser,
  AvatarMemberRow,
  AvatarRecord,
  ProcessAvatarDependencies,
} from '../_shared/avatar-service.ts';
import { createResolveProfileAvatarsHandler } from './index.ts';

const VIEWER_ID = '11000000-0000-4000-8000-000000000001';
const MEMBER_ID = '22000000-0000-4000-8000-000000000002';
const HIDDEN_ID = '33000000-0000-4000-8000-000000000003';
const PENDING_ID = '44000000-0000-4000-8000-000000000004';
const OUTSIDE_ID = '55000000-0000-4000-8000-000000000005';
const ORIGIN = 'http://127.0.0.1:4173';

function avatar(profileId: string, overrides: Partial<AvatarRecord> = {}): AvatarRecord {
  return {
    profileId,
    state: 'active',
    googleObjectPath: null,
    activeObjectPath: null,
    pendingObjectPath: null,
    moderationReason: null,
    moderatedAt: null,
    ...overrides,
  };
}

function row(
  profileId: string,
  displayName: string,
  overrides: Partial<AvatarRecord> = {},
): AvatarMemberRow {
  return { profileId, displayName, avatar: avatar(profileId, overrides) };
}

function resolverHarness(options: {
  viewerRole?: string;
  viewer?: AuthUser | null;
  failSigningPath?: string;
} = {}) {
  const customPath = `${MEMBER_ID}/custom-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const hiddenPath = `${HIDDEN_ID}/custom-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
  const pendingPath = `${PENDING_ID}/pending-cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg`;
  const rows = new Map<string, AvatarMemberRow>([
    [VIEWER_ID, row(VIEWER_ID, 'Viewer Member')],
    [MEMBER_ID, row(MEMBER_ID, 'Active Member', { activeObjectPath: customPath })],
    [
      HIDDEN_ID,
      row(HIDDEN_ID, 'Hidden Member', {
        state: 'hidden',
        activeObjectPath: hiddenPath,
        moderationReason: 'Hidden reason',
        moderatedAt: '2026-09-17T09:00:00.000Z',
      }),
    ],
    [
      PENDING_ID,
      row(PENDING_ID, 'Pending Review', {
        state: 'pending_review',
        activeObjectPath: hiddenPath,
        pendingObjectPath: pendingPath,
        moderationReason: 'Prior moderation',
        moderatedAt: '2026-09-17T09:30:00.000Z',
      }),
    ],
    [
      OUTSIDE_ID,
      row(OUTSIDE_ID, 'Outside Session', {
        activeObjectPath: `${OUTSIDE_ID}/custom-dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg`,
      }),
    ],
  ]);
  const viewer = options.viewer === undefined ? { id: VIEWER_ID, identities: [] } : options.viewer;
  const resolvedSessionIds: string[] = [];

  const dependencies: ProcessAvatarDependencies = {
    auth: {
      getUser(token) {
        return Promise.resolve(token === 'valid-token' ? viewer : null);
      },
    },
    identity: { googleAvatarUrl: () => null },
    database: {
      getProfile(profileId) {
        const member = rows.get(profileId);
        return Promise.resolve(
          member
            ? { profileId, role: options.viewerRole ?? 'member', avatar: member.avatar }
            : null,
        );
      },
      recordUploadAttempt: () => Promise.resolve(true),
      activateCustom: () => Promise.reject(new Error('unused')),
      submitReview: () => Promise.reject(new Error('unused')),
      setGoogle: () => Promise.reject(new Error('unused')),
      removeCustom: () => Promise.reject(new Error('unused')),
      listSessionAttendees(sessionId) {
        resolvedSessionIds.push(sessionId);
        return Promise.resolve([
          rows.get(MEMBER_ID)!,
          rows.get(HIDDEN_ID)!,
          rows.get(PENDING_ID)!,
        ]);
      },
      listAdminMembers() {
        return Promise.resolve([...rows.values()]);
      },
      hideAvatar: () => Promise.reject(new Error('unused')),
      decideReview: () => Promise.reject(new Error('unused')),
    },
    storage: {
      upload: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      createSignedUrl(path, expiresIn) {
        if (path === options.failSigningPath) return Promise.reject(new Error('signing failed'));
        return Promise.resolve(`https://signed.invalid/${expiresIn}/${encodeURIComponent(path)}`);
      },
    },
    clock: { now: () => new Date('2026-09-17T10:00:00.000Z') },
    fetch,
    allowedOrigins: new Set([ORIGIN]),
  };

  return {
    handler: createResolveProfileAvatarsHandler(dependencies),
    resolvedSessionIds,
    paths: { customPath, hiddenPath, pendingPath },
  };
}

function get(path: string, authenticated = true): Request {
  return new Request(`http://edge.invalid/resolve-profile-avatars${path}`, {
    headers: {
      origin: ORIGIN,
      ...(authenticated ? { authorization: 'Bearer valid-token' } : {}),
    },
  });
}

Deno.test('resolver preflight advertises GET to an allowed browser origin', async () => {
  const { handler } = resolverHarness();
  const response = await handler(
    new Request('http://edge.invalid/resolve-profile-avatars', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
    }),
  );

  assertEquals(response.status, 204);
  assertEquals(response.headers.get('access-control-allow-origin'), ORIGIN);
  assertStringIncludes(response.headers.get('access-control-allow-methods') ?? '', 'GET');
});

Deno.test('public, pending, and declined viewers cannot resolve a session', async () => {
  const publicHarness = resolverHarness({ viewer: null });
  assertEquals(
    (await publicHarness.handler(get('?scope=session&sessionId=hyrox-2026-09-19', false))).status,
    403,
  );

  for (const viewerRole of ['pending', 'declined']) {
    const { handler } = resolverHarness({ viewerRole });
    const response = await handler(get('?scope=session&sessionId=hyrox-2026-09-19'));
    assertEquals(response.status, 403);
    assertEquals(await response.json(), { error: 'Approved membership required' });
  }
});

Deno.test('approved self scope returns only the authenticated profile', async () => {
  const { handler } = resolverHarness();
  const response = await handler(get('?scope=self'));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.avatars.length, 1);
  assertEquals(body.avatars[0].profileId, VIEWER_ID);
});

Deno.test('session scope derives rows from the authoritative session query', async () => {
  const { handler, resolvedSessionIds } = resolverHarness();
  const response = await handler(get('?scope=session&sessionId=hyrox-2026-09-19'));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(resolvedSessionIds, ['hyrox-2026-09-19']);
  assertEquals(body.avatars.map((item: { profileId: string }) => item.profileId), [
    MEMBER_ID,
    HIDDEN_ID,
    PENDING_ID,
  ]);
  assertEquals(
    body.avatars.some((item: { profileId: string }) => item.profileId === OUTSIDE_ID),
    false,
  );
});

Deno.test('arbitrary profile identifiers and list parameters are rejected', async () => {
  const invalidQueries = [
    '?scope=self&profileId=22000000-0000-4000-8000-000000000002',
    '?scope=session&sessionId=hyrox-2026-09-19&ids=a,b',
    '?scope=session&sessionId=hyrox-2026-09-19,other',
  ];
  for (const query of invalidQueries) {
    const { handler } = resolverHarness();
    assertEquals((await handler(get(query))).status, 400);
  }
});

Deno.test('hidden and pending-review peers receive initials only', async () => {
  const { handler } = resolverHarness();
  const response = await handler(get('?scope=session&sessionId=hyrox-2026-09-19'));
  const body = await response.json();
  for (const profileId of [HIDDEN_ID, PENDING_ID]) {
    const item = body.avatars.find((entry: { profileId: string }) => entry.profileId === profileId);
    assertEquals(item.url, null);
    assertEquals(item.source, 'initials');
  }
});

Deno.test('owner can preview a pending replacement in self scope', async () => {
  const { handler, paths } = resolverHarness({
    viewer: { id: PENDING_ID, identities: [] },
  });
  const response = await handler(get('?scope=self'));
  const body = await response.json();
  assertStringIncludes(body.avatars[0].url, encodeURIComponent(paths.pendingPath));
  assertEquals(body.avatars[0].state, 'pending_review');
  assertEquals(body.avatars[0].source, 'custom');
});

Deno.test('admin-members scope rejects members', async () => {
  const { handler } = resolverHarness({ viewerRole: 'member' });
  assertEquals((await handler(get('?scope=admin_members'))).status, 403);
});

Deno.test('admin-members scope returns all states and pending preview only to Admin', async () => {
  const { handler, paths } = resolverHarness({ viewerRole: 'admin' });
  const response = await handler(get('?scope=admin_members'));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.rows.length, 5);
  const pending = body.rows.find((item: { profileId: string }) => item.profileId === PENDING_ID);
  assertStringIncludes(pending.pendingPreviewUrl, encodeURIComponent(paths.pendingPath));
  assertEquals(pending.moderationReason, 'Prior moderation');
  assertEquals('activeObjectPath' in pending, false);
  assertEquals('email' in pending, false);
  assertEquals('role' in pending, false);
});

Deno.test('signed avatar URLs expire after exactly 600 seconds', async () => {
  const { handler } = resolverHarness();
  const response = await handler(get('?scope=session&sessionId=hyrox-2026-09-19'));
  const body = await response.json();
  const active = body.avatars.find((item: { profileId: string }) => item.profileId === MEMBER_ID);
  assertStringIncludes(active.url, '/600/');
  assertEquals(active.expiresAt, '2026-09-17T10:10:00.000Z');
});

Deno.test('one signing failure falls back to initials without suppressing other rows', async () => {
  const initial = resolverHarness();
  const { handler } = resolverHarness({ failSigningPath: initial.paths.customPath });
  const response = await handler(get('?scope=session&sessionId=hyrox-2026-09-19'));
  const body = await response.json();
  const active = body.avatars.find((item: { profileId: string }) => item.profileId === MEMBER_ID);
  assertEquals(active.url, null);
  assertEquals(active.source, 'initials');
  assertEquals(body.avatars.length, 3);
});
