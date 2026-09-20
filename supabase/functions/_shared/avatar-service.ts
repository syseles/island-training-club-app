import { createClient } from '@supabase/supabase-js';
import { readBodyLimited } from './avatar-image.ts';
import { type AvatarState, SIGNED_URL_TTL_SECONDS } from './avatar-policy.ts';

export const AVATAR_BUCKET = 'profile-avatars';

export type AvatarPresentation = {
  profileId: string;
  url: string | null;
  state: AvatarState;
  source: 'custom' | 'google' | 'initials';
  expiresAt: string | null;
};

export type AvatarRecord = {
  profileId: string;
  state: AvatarState;
  googleObjectPath: string | null;
  activeObjectPath: string | null;
  pendingObjectPath: string | null;
  moderationReason: string | null;
  moderatedAt: string | null;
};

export type AuthIdentity = {
  provider: string;
  identityData: Record<string, unknown>;
};

export type AuthUser = {
  id: string;
  identities: AuthIdentity[];
};

export type AvatarProfile = {
  profileId: string;
  role: string;
  avatar: AvatarRecord;
};

export type AvatarTransition = {
  avatar: AvatarRecord;
  replacedObjectPaths: string[];
};

export type AvatarMemberRow = {
  profileId: string;
  displayName: string;
  avatar: AvatarRecord;
};

export interface AvatarAuthAdapter {
  getUser(token: string): Promise<AuthUser | null>;
}

export interface AvatarIdentityAdapter {
  googleAvatarUrl(user: AuthUser): string | null;
}

export interface AvatarDatabaseAdapter {
  getProfile(profileId: string): Promise<AvatarProfile | null>;
  recordUploadAttempt(profileId: string): Promise<boolean>;
  activateCustom(profileId: string, path: string): Promise<AvatarTransition>;
  submitReview(profileId: string, path: string): Promise<AvatarTransition>;
  setGoogle(profileId: string, path: string): Promise<AvatarTransition>;
  removeCustom(profileId: string): Promise<AvatarTransition>;
  listSessionAttendees(sessionId: string): Promise<AvatarMemberRow[]>;
  listAdminMembers(): Promise<AvatarMemberRow[]>;
  hideAvatar(profileId: string, actorId: string, reason: string): Promise<AvatarTransition>;
  decideReview(
    profileId: string,
    actorId: string,
    decision: 'approve' | 'reject',
    reason: string | null,
  ): Promise<AvatarTransition>;
}

export interface AvatarStorageAdapter {
  upload(path: string, bytes: Uint8Array): Promise<void>;
  remove(paths: string[]): Promise<void>;
  createSignedUrl(path: string, expiresIn: number): Promise<string>;
}

export interface AvatarClockAdapter {
  now(): Date;
}

export type ProcessAvatarDependencies = {
  auth: AvatarAuthAdapter;
  identity: AvatarIdentityAdapter;
  database: AvatarDatabaseAdapter;
  storage: AvatarStorageAdapter;
  clock: AvatarClockAdapter;
  fetch: typeof fetch;
  allowedOrigins: ReadonlySet<string>;
};

export class AvatarRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AvatarRequestError';
  }
}

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function defaultAvatar(profileId: string): AvatarRecord {
  return {
    profileId,
    state: 'active',
    googleObjectPath: null,
    activeObjectPath: null,
    pendingObjectPath: null,
    moderationReason: null,
    moderatedAt: null,
  };
}

function avatarRecord(value: Record<string, unknown> | null, profileId: string): AvatarRecord {
  if (!value) return defaultAvatar(profileId);
  return {
    profileId,
    state: value.state as AvatarState,
    googleObjectPath: value.google_object_path as string | null,
    activeObjectPath: value.active_object_path as string | null,
    pendingObjectPath: value.pending_object_path as string | null,
    moderationReason: value.moderation_reason as string | null,
    moderatedAt: value.moderated_at as string | null,
  };
}

function rpcTransition(data: unknown, profileId: string): AvatarTransition {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object') {
    throw new Error('Avatar transition returned no result');
  }
  const result = value as Record<string, unknown>;
  if (!result.avatar || typeof result.avatar !== 'object') {
    throw new Error('Avatar transition returned no row');
  }
  const rawPaths = result.replaced_object_paths;
  if (!Array.isArray(rawPaths) || rawPaths.some((path) => typeof path !== 'string')) {
    throw new Error('Avatar transition returned invalid cleanup paths');
  }
  return {
    avatar: avatarRecord(result.avatar as Record<string, unknown>, profileId),
    replacedObjectPaths: rawPaths as string[],
  };
}

export function parseAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  );
}

export function corsHeaders(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function assertOriginAllowed(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): void {
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins.has(origin)) {
    throw new AvatarRequestError('Origin not allowed', 403);
  }
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new AvatarRequestError('Authentication required', 401);
  return match[1];
}

export function jsonResponse(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
  body: unknown,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request, allowedOrigins),
      'Cache-Control': 'private, no-store',
    },
  });
}

export function assertGoogleAvatarUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AvatarRequestError('Google profile photo URL is invalid', 400);
  }
  const hostname = url.hostname.toLowerCase();
  const trustedHost = hostname === 'googleusercontent.com' ||
    hostname.endsWith('.googleusercontent.com');
  if (
    url.protocol !== 'https:' || !trustedHost || url.username || url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new AvatarRequestError('Google profile photo URL is invalid', 400);
  }
  return url;
}

export async function fetchGoogleAvatar(
  initialUrl: string,
  fetcher: typeof fetch,
): Promise<Uint8Array> {
  let currentUrl = assertGoogleAvatarUrl(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetcher(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'image/jpeg, image/png' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 3) {
        throw new AvatarRequestError('Google profile photo redirect was rejected', 400);
      }
      currentUrl = assertGoogleAvatarUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AvatarRequestError('Google profile photo could not be downloaded', 400);
    }
    try {
      return await readBodyLimited(response, 2 * 1024 * 1024);
    } catch {
      throw new AvatarRequestError('Google profile photo exceeds 2 MB', 400);
    }
  }
  throw new AvatarRequestError('Google profile photo redirect was rejected', 400);
}

export async function resolveOwnPresentation(
  avatar: AvatarRecord,
  storage: AvatarStorageAdapter,
  clock: AvatarClockAdapter,
): Promise<AvatarPresentation> {
  if (avatar.state !== 'active') {
    return {
      profileId: avatar.profileId,
      url: null,
      state: avatar.state,
      source: 'initials',
      expiresAt: null,
    };
  }

  const path = avatar.activeObjectPath ?? avatar.googleObjectPath;
  const source = avatar.activeObjectPath
    ? 'custom'
    : avatar.googleObjectPath
    ? 'google'
    : 'initials';
  if (!path || source === 'initials') {
    return {
      profileId: avatar.profileId,
      url: null,
      state: avatar.state,
      source: 'initials',
      expiresAt: null,
    };
  }

  try {
    const url = await storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    return {
      profileId: avatar.profileId,
      url,
      state: avatar.state,
      source,
      expiresAt: new Date(clock.now().getTime() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    };
  } catch {
    return {
      profileId: avatar.profileId,
      url: null,
      state: avatar.state,
      source: 'initials',
      expiresAt: null,
    };
  }
}

export async function bestEffortRemove(
  storage: AvatarStorageAdapter,
  paths: Array<string | null | undefined>,
): Promise<void> {
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (!uniquePaths.length) return;
  try {
    await storage.remove(uniquePaths);
  } catch {
    // State transitions remain authoritative; stale objects are handled by cleanup operations.
  }
}

export function defaultIdentityAdapter(): AvatarIdentityAdapter {
  return {
    googleAvatarUrl(user) {
      const identity = user.identities.find((item) => item.provider === 'google');
      const value = identity?.identityData.avatar_url;
      return typeof value === 'string' ? value : null;
    },
  };
}

export function effectiveAttendeeProfileIds(
  bookings: Array<{ profile_id: unknown; replacement_profile_id?: unknown }>,
): string[] {
  return bookings.flatMap((booking) => {
    const effectiveId = typeof booking.replacement_profile_id === 'string' &&
        booking.replacement_profile_id
      ? booking.replacement_profile_id
      : booking.profile_id;
    return typeof effectiveId === 'string' && effectiveId ? [effectiveId] : [];
  });
}

export function createDefaultAvatarDependencies(): ProcessAvatarDependencies {
  const supabaseUrl = requireEnvironment('SUPABASE_URL');
  const anonKey = requireEnvironment('SUPABASE_ANON_KEY');
  const serviceRoleKey = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY');
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const hydrateMemberRows = async (
    profileIds: string[],
  ): Promise<AvatarMemberRow[]> => {
    const ids = [...new Set(profileIds)];
    if (!ids.length) return [];
    const [{ data: profiles, error: profilesError }, { data: avatars, error: avatarsError }] =
      await Promise.all([
        service.from('profiles').select('id, full_name').in('id', ids),
        service.from('profile_avatars').select(
          'profile_id, state, google_object_path, active_object_path, pending_object_path, moderation_reason, moderated_at',
        ).in('profile_id', ids),
      ]);
    if (profilesError || avatarsError) throw new Error('Avatar member lookup failed');
    const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const avatarsById = new Map((avatars ?? []).map((item) => [item.profile_id, item]));
    return ids.flatMap((profileId) => {
      const profile = profilesById.get(profileId);
      if (!profile) return [];
      return [{
        profileId,
        displayName: profile.full_name?.trim() || 'ITC Member',
        avatar: avatarRecord(avatarsById.get(profileId) ?? null, profileId),
      }];
    });
  };

  const database: AvatarDatabaseAdapter = {
    async getProfile(profileId) {
      const { data: profile, error: profileError } = await service
        .from('profiles')
        .select('id, role')
        .eq('id', profileId)
        .maybeSingle();
      if (profileError) throw new Error('Profile lookup failed');
      if (!profile) return null;

      const { data: avatar, error: avatarError } = await service
        .from('profile_avatars')
        .select(
          'profile_id, state, google_object_path, active_object_path, pending_object_path, moderation_reason, moderated_at',
        )
        .eq('profile_id', profileId)
        .maybeSingle();
      if (avatarError) throw new Error('Avatar lookup failed');
      return {
        profileId,
        role: profile.role,
        avatar: avatarRecord(avatar, profileId),
      };
    },
    async recordUploadAttempt(profileId) {
      const { data, error } = await service.rpc('avatar_record_upload_attempt', {
        p_profile_id: profileId,
        p_actor_id: profileId,
      });
      if (error || typeof data !== 'boolean') {
        throw new Error('Upload attempt could not be recorded');
      }
      return data;
    },
    async activateCustom(profileId, path) {
      const { data, error } = await service.rpc('avatar_activate_custom', {
        p_profile_id: profileId,
        p_actor_id: profileId,
        p_object_path: path,
      });
      if (error) throw new Error('Custom avatar transition failed');
      return rpcTransition(data, profileId);
    },
    async submitReview(profileId, path) {
      const { data, error } = await service.rpc('avatar_submit_review', {
        p_profile_id: profileId,
        p_actor_id: profileId,
        p_object_path: path,
      });
      if (error) throw new Error('Avatar review transition failed');
      return rpcTransition(data, profileId);
    },
    async setGoogle(profileId, path) {
      const { data, error } = await service.rpc('avatar_set_google', {
        p_profile_id: profileId,
        p_actor_id: profileId,
        p_object_path: path,
      });
      if (error) throw new Error('Google avatar transition failed');
      return rpcTransition(data, profileId);
    },
    async removeCustom(profileId) {
      const { data, error } = await service.rpc('avatar_remove_custom', {
        p_profile_id: profileId,
        p_actor_id: profileId,
      });
      if (error) throw new Error('Avatar removal failed');
      return rpcTransition(data, profileId);
    },
    async listSessionAttendees(sessionId) {
      const { data, error } = await service
        .from('operational_bookings')
        .select('profile_id, replacement_profile_id, created_at')
        .eq('session_id', sessionId)
        .in('status', ['confirmed', 'attended'])
        .order('created_at', { ascending: true });
      if (error) throw new Error('Session attendee lookup failed');
      return await hydrateMemberRows(effectiveAttendeeProfileIds(data ?? []));
    },
    async listAdminMembers() {
      const { data, error } = await service
        .from('profiles')
        .select('id, created_at')
        .order('created_at', { ascending: true });
      if (error) throw new Error('Admin member lookup failed');
      return await hydrateMemberRows((data ?? []).map((profile) => profile.id));
    },
    async hideAvatar(profileId, actorId, reason) {
      const { data, error } = await service.rpc('avatar_hide', {
        p_profile_id: profileId,
        p_actor_id: actorId,
        p_reason: reason,
      });
      if (error) throw new Error('Avatar hide transition failed');
      return rpcTransition(data, profileId);
    },
    async decideReview(profileId, actorId, decision, reason) {
      const { data, error } = await service.rpc('avatar_decide_review', {
        p_profile_id: profileId,
        p_actor_id: actorId,
        p_decision: decision,
        p_reason: reason,
      });
      if (error) throw new Error('Avatar review decision failed');
      return rpcTransition(data, profileId);
    },
  };

  const storage: AvatarStorageAdapter = {
    async upload(path, bytes) {
      const { error } = await service.storage.from(AVATAR_BUCKET).upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error) throw new Error('Avatar object upload failed');
    },
    async remove(paths) {
      if (!paths.length) return;
      const { error } = await service.storage.from(AVATAR_BUCKET).remove(paths);
      if (error) throw new Error('Avatar object cleanup failed');
    },
    async createSignedUrl(path, expiresIn) {
      const { data, error } = await service.storage.from(AVATAR_BUCKET)
        .createSignedUrl(path, expiresIn);
      if (error || !data?.signedUrl) throw new Error('Avatar URL signing failed');
      return data.signedUrl;
    },
  };

  return {
    auth: {
      async getUser(token) {
        const client = createClient(supabaseUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data, error } = await client.auth.getUser(token);
        if (error || !data.user) return null;
        return {
          id: data.user.id,
          identities: (data.user.identities ?? []).map((identity) => ({
            provider: identity.provider,
            identityData: identity.identity_data ?? {},
          })),
        };
      },
    },
    identity: defaultIdentityAdapter(),
    database,
    storage,
    clock: { now: () => new Date() },
    fetch,
    allowedOrigins: parseAllowedOrigins(Deno.env.get('ITC_APP_ORIGINS')),
  };
}
