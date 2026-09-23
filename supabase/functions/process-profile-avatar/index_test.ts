import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type {
  AuthUser,
  AvatarDatabaseAdapter,
  AvatarRecord,
  AvatarStorageAdapter,
  ProcessAvatarDependencies,
} from '../_shared/avatar-service.ts';
import { MAX_UPLOAD_BYTES } from '../_shared/avatar-policy.ts';
import { createProcessProfileAvatarHandler } from './index.ts';

const MEMBER_ID = '22000000-0000-4000-8000-000000000002';
const ORIGIN = 'http://127.0.0.1:4173';
const JPEG_2X1 = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDVooor4Q/io//Z',
  ),
  (character) => character.charCodeAt(0),
);
const PNG_2X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGOUOJHAwMAAAAYGAUL2fM46AAAAAElFTkSuQmCC',
  ),
  (character) => character.charCodeAt(0),
);

function avatar(overrides: Partial<AvatarRecord> = {}): AvatarRecord {
  return {
    profileId: MEMBER_ID,
    state: 'active',
    googleObjectPath: null,
    activeObjectPath: null,
    pendingObjectPath: null,
    moderationReason: null,
    moderatedAt: null,
    ...overrides,
  };
}

function testHarness(options: {
  role?: string;
  user?: AuthUser | null;
  avatar?: AvatarRecord;
  attemptAllowed?: boolean;
  failTransition?: boolean;
  racePathBeforeTransition?: string;
  fetcher?: typeof fetch;
} = {}) {
  let current = options.avatar ?? avatar();
  const objects = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const user = options.user === undefined ? { id: MEMBER_ID, identities: [] } : options.user;

  const database: AvatarDatabaseAdapter = {
    getProfile(profileId) {
      return Promise.resolve({ profileId, role: options.role ?? 'member', avatar: current });
    },
    recordUploadAttempt() {
      if (options.racePathBeforeTransition) {
        current = avatar({ ...current, activeObjectPath: options.racePathBeforeTransition });
      }
      return Promise.resolve(options.attemptAllowed ?? true);
    },
    activateCustom(profileId, path) {
      if (options.failTransition) {
        return Promise.reject(new Error('SECRET database transition detail'));
      }
      const replacedObjectPaths = current.activeObjectPath ? [current.activeObjectPath] : [];
      current = avatar({ ...current, profileId, state: 'active', activeObjectPath: path });
      return Promise.resolve({ avatar: current, replacedObjectPaths });
    },
    submitReview(profileId, path) {
      if (options.failTransition) {
        return Promise.reject(new Error('SECRET database transition detail'));
      }
      const replacedObjectPaths = current.pendingObjectPath ? [current.pendingObjectPath] : [];
      current = avatar({ ...current, profileId, state: 'pending_review', pendingObjectPath: path });
      return Promise.resolve({ avatar: current, replacedObjectPaths });
    },
    setGoogle(profileId, path) {
      if (options.failTransition) {
        return Promise.reject(new Error('SECRET database transition detail'));
      }
      const replacedObjectPaths = current.googleObjectPath ? [current.googleObjectPath] : [];
      current = avatar({ ...current, profileId, googleObjectPath: path });
      return Promise.resolve({ avatar: current, replacedObjectPaths });
    },
    removeCustom(profileId) {
      const replacedObjectPaths = [
        current.activeObjectPath,
        current.pendingObjectPath,
      ].filter((path): path is string => Boolean(path));
      current = avatar({
        ...current,
        profileId,
        activeObjectPath: null,
        pendingObjectPath: null,
        state: current.state === 'active' ? 'active' : 'hidden',
      });
      return Promise.resolve({ avatar: current, replacedObjectPaths });
    },
    isRetiredHyroxSession: () => Promise.resolve(false),
    listSessionAttendees: () => Promise.resolve([]),
    listAdminMembers: () => Promise.resolve([]),
    hideAvatar: () => Promise.reject(new Error('unused')),
    decideReview: () => Promise.reject(new Error('unused')),
  };
  const storage: AvatarStorageAdapter = {
    upload(path, bytes) {
      objects.set(path, bytes);
      return Promise.resolve();
    },
    remove(paths) {
      for (const path of paths) {
        removed.push(path);
        objects.delete(path);
      }
      return Promise.resolve();
    },
    createSignedUrl(path) {
      return Promise.resolve(`https://signed.invalid/${encodeURIComponent(path)}`);
    },
  };
  const dependencies: ProcessAvatarDependencies = {
    auth: {
      getUser(token) {
        return Promise.resolve(token === 'valid-token' ? user : null);
      },
    },
    identity: {
      googleAvatarUrl(authUser) {
        const identity = authUser.identities.find((item) => item.provider === 'google');
        const value = identity?.identityData?.avatar_url;
        return typeof value === 'string' ? value : null;
      },
    },
    database,
    storage,
    clock: { now: () => new Date('2026-09-17T10:00:00.000Z') },
    fetch: options.fetcher ?? fetch,
    allowedOrigins: new Set([ORIGIN]),
  };

  return {
    handler: createProcessProfileAvatarHandler(dependencies),
    objects,
    removed,
    current: () => current,
  };
}

function requestHeaders(): Record<string, string> {
  return { authorization: 'Bearer valid-token', origin: ORIGIN };
}

function uploadRequest(bytes = JPEG_2X1, extra: Record<string, string> = {}): Request {
  const form = new FormData();
  form.set('action', 'upload');
  form.set('file', new File([bytes], 'avatar.jpg', { type: 'image/jpeg' }));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return new Request('http://edge.invalid/process-profile-avatar', {
    method: 'POST',
    headers: requestHeaders(),
    body: form,
  });
}

Deno.test('missing bearer token returns 401', async () => {
  const { handler } = testHarness();
  const response = await handler(new Request('http://edge.invalid/process-profile-avatar'));
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: 'Authentication required' });
});

Deno.test('pending profile upload returns 403', async () => {
  const { handler } = testHarness({ role: 'pending' });
  const response = await handler(uploadRequest());
  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: 'Approved membership required' });
});

Deno.test('eleventh upload attempt returns 429 without creating an object', async () => {
  const { handler, objects } = testHarness({ attemptAllowed: false });
  const response = await handler(uploadRequest());
  assertEquals(response.status, 429);
  assertEquals(objects.size, 0);
});

Deno.test('browser-supplied profile and path fields are rejected', async () => {
  const suppliedFields: Record<string, string>[] = [
    { profileId: 'other' },
    { path: '../other/avatar.jpg' },
  ];
  for (const extra of suppliedFields) {
    const { handler, objects } = testHarness();
    const response = await handler(uploadRequest(JPEG_2X1, extra));
    assertEquals(response.status, 400);
    assertEquals(objects.size, 0);
  }
});

Deno.test('invalid image bytes leave the active path unchanged', async () => {
  const existing = `${MEMBER_ID}/custom-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const { handler, current, objects } = testHarness({
    avatar: avatar({ activeObjectPath: existing }),
  });
  const response = await handler(uploadRequest(new TextEncoder().encode('<svg/>')));
  assertEquals(response.status, 400);
  assertEquals(current().activeObjectPath, existing);
  assertEquals(objects.size, 0);
});

Deno.test('normal upload activates a sanitized custom photo', async () => {
  const { handler, current, objects } = testHarness();
  const response = await handler(uploadRequest());
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assertEquals(body.presentation.state, 'active');
  assertEquals(body.presentation.source, 'custom');
  assertStringIncludes(body.presentation.url, 'https://signed.invalid/');
  assert(current().activeObjectPath?.startsWith(`${MEMBER_ID}/custom-`));
  assertEquals(objects.size, 1);
  const stored = [...objects.values()][0];
  assertEquals([...stored.slice(0, 3)], [0xff, 0xd8, 0xff]);
});

Deno.test('successful upload cleans the path replaced inside the transition', async () => {
  const stalePath = `${MEMBER_ID}/custom-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const concurrentPath = `${MEMBER_ID}/custom-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
  const { handler, removed } = testHarness({
    avatar: avatar({ activeObjectPath: stalePath }),
    racePathBeforeTransition: concurrentPath,
  });
  const response = await handler(uploadRequest());
  assertEquals(response.status, 200);
  assertEquals(removed, [concurrentPath]);
});

Deno.test('streamed multipart body is cancelled at the bounded envelope limit', async () => {
  const oversizedRequest = uploadRequest(new Uint8Array(MAX_UPLOAD_BYTES + 512 * 1024));
  const contentType = oversizedRequest.headers.get('content-type') ?? '';
  const encoded = new Uint8Array(await oversizedRequest.arrayBuffer());
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 64 * 1024, encoded.length);
      controller.enqueue(encoded.slice(offset, end));
      offset = end;
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamedRequest = new Request('http://edge.invalid/process-profile-avatar', {
    method: 'POST',
    headers: { ...requestHeaders(), 'content-type': contentType },
    body: stream,
  });
  const { handler } = testHarness();
  const response = await handler(streamedRequest);
  assertEquals(response.status, 400);
  assertEquals(cancelled, true);
  assert(offset < encoded.length);
});

Deno.test('hidden profile upload writes pending path and stays invisible', async () => {
  const { handler, current, objects } = testHarness({
    avatar: avatar({ state: 'hidden', moderationReason: 'Hidden by Admin' }),
  });
  const response = await handler(uploadRequest());
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.presentation, {
    profileId: MEMBER_ID,
    url: null,
    state: 'pending_review',
    source: 'initials',
    expiresAt: null,
  });
  assert(current().pendingObjectPath?.startsWith(`${MEMBER_ID}/pending-`));
  assertEquals(objects.size, 1);
});

Deno.test('DELETE removes custom photo and resolves Google fallback', async () => {
  const customPath = `${MEMBER_ID}/custom-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const googlePath = `${MEMBER_ID}/google-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
  const { handler, current, removed } = testHarness({
    avatar: avatar({ activeObjectPath: customPath, googleObjectPath: googlePath }),
  });
  const response = await handler(
    new Request('http://edge.invalid/process-profile-avatar', {
      method: 'DELETE',
      headers: requestHeaders(),
    }),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.presentation.source, 'google');
  assertEquals(current().activeObjectPath, null);
  assertEquals(removed, [customPath]);
});

Deno.test('Google sync uses only verified Google identity avatar URL', async () => {
  const googleUrl = 'https://lh3.googleusercontent.com/a/member-photo';
  const { handler, current } = testHarness({
    user: {
      id: MEMBER_ID,
      identities: [
        { provider: 'github', identityData: { avatar_url: 'https://evil.invalid/photo' } },
        { provider: 'google', identityData: { avatar_url: googleUrl } },
      ],
    },
    fetcher: (input) => {
      assertEquals(String(input), googleUrl);
      return Promise.resolve(
        new Response(PNG_2X1, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    },
  });
  const response = await handler(
    new Request('http://edge.invalid/process-profile-avatar', {
      method: 'POST',
      headers: { ...requestHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync_google' }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).presentation.source, 'google');
  assert(current().googleObjectPath?.startsWith(`${MEMBER_ID}/google-`));
});

Deno.test('Google sync rejects non-Google hosts and client URL overrides', async () => {
  const invalidHosts = [
    'http://lh3.googleusercontent.com/photo',
    'https://googleusercontent.com.evil.invalid/photo',
    'https://evil.invalid/photo',
  ];
  for (const avatarUrl of invalidHosts) {
    const { handler } = testHarness({
      user: {
        id: MEMBER_ID,
        identities: [{ provider: 'google', identityData: { avatar_url: avatarUrl } }],
      },
    });
    const response = await handler(
      new Request('http://edge.invalid/process-profile-avatar', {
        method: 'POST',
        headers: { ...requestHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync_google' }),
      }),
    );
    assertEquals(response.status, 400);
  }

  const { handler } = testHarness();
  const override = await handler(
    new Request('http://edge.invalid/process-profile-avatar', {
      method: 'POST',
      headers: { ...requestHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'sync_google',
        googleUrl: 'https://lh3.googleusercontent.com/x',
      }),
    }),
  );
  assertEquals(override.status, 400);
});

Deno.test('Google sync rejects redirects outside the trusted host family', async () => {
  const { handler } = testHarness({
    user: {
      id: MEMBER_ID,
      identities: [{
        provider: 'google',
        identityData: { avatar_url: 'https://lh3.googleusercontent.com/start' },
      }],
    },
    fetcher: () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.invalid/redirected' },
        }),
      ),
  });
  const response = await handler(
    new Request('http://edge.invalid/process-profile-avatar', {
      method: 'POST',
      headers: { ...requestHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync_google' }),
    }),
  );
  assertEquals(response.status, 400);
});

Deno.test('Google sync rejects a response over 2 MB', async () => {
  const { handler } = testHarness({
    user: {
      id: MEMBER_ID,
      identities: [{
        provider: 'google',
        identityData: { avatar_url: 'https://lh3.googleusercontent.com/large' },
      }],
    },
    fetcher: () =>
      Promise.resolve(
        new Response('small', {
          status: 200,
          headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
        }),
      ),
  });
  const response = await handler(
    new Request('http://edge.invalid/process-profile-avatar', {
      method: 'POST',
      headers: { ...requestHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync_google' }),
    }),
  );
  assertEquals(response.status, 400);
});

Deno.test('failed database transition deletes candidate and hides service detail', async () => {
  const { handler, objects, removed } = testHarness({ failTransition: true });
  const response = await handler(uploadRequest());
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body, { error: 'Profile photo could not be updated' });
  assertEquals(JSON.stringify(body).includes('SECRET'), false);
  assertEquals(objects.size, 0);
  assertEquals(removed.length, 1);
});

Deno.test('CORS preflight admits configured origin and rejects other origins', async () => {
  const { handler } = testHarness();
  const allowed = await handler(
    new Request('http://edge.invalid/process-profile-avatar', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
    }),
  );
  assertEquals(allowed.status, 204);
  assertEquals(allowed.headers.get('access-control-allow-origin'), ORIGIN);

  const rejected = await handler(
    new Request('http://edge.invalid/process-profile-avatar', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.invalid' },
    }),
  );
  assertEquals(rejected.status, 403);
  assertEquals(rejected.headers.has('access-control-allow-origin'), false);
});
