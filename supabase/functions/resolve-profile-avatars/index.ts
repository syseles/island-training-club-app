import {
  assertAdminRole,
  assertApprovedRole,
  SIGNED_URL_TTL_SECONDS,
} from '../_shared/avatar-policy.ts';
import {
  assertOriginAllowed,
  type AvatarMemberRow,
  type AvatarPresentation,
  type AvatarRecord,
  AvatarRequestError,
  bearerToken,
  corsHeaders,
  createDefaultAvatarDependencies,
  jsonResponse,
  type ProcessAvatarDependencies,
  resolveOwnPresentation,
} from '../_shared/avatar-service.ts';

export type AttendeeAvatar = AvatarPresentation & {
  displayName: string;
};

export type ModerationRow = AvatarPresentation & {
  displayName: string;
  pendingPreviewUrl: string | null;
  moderationReason: string | null;
  moderatedAt: string | null;
};

type ResolveScope =
  | { kind: 'self' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'admin_members' };

const SESSION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function invalidRequest(): never {
  throw new AvatarRequestError('Invalid avatar resolution request', 400);
}

function parseScope(request: Request): ResolveScope {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  const scopeValues = params.getAll('scope');
  if (scopeValues.length !== 1) invalidRequest();
  const scope = scopeValues[0];

  if (scope === 'self') {
    if (keys.length !== 1 || keys[0] !== 'scope') invalidRequest();
    return { kind: 'self' };
  }
  if (scope === 'admin_members') {
    if (keys.length !== 1 || keys[0] !== 'scope') invalidRequest();
    return { kind: 'admin_members' };
  }
  if (scope === 'session') {
    const sessionValues = params.getAll('sessionId');
    if (
      keys.some((key) => key !== 'scope' && key !== 'sessionId') ||
      sessionValues.length !== 1 ||
      !SESSION_ID_PATTERN.test(sessionValues[0]) ||
      sessionValues[0].length > 100
    ) invalidRequest();
    return { kind: 'session', sessionId: sessionValues[0] };
  }
  return invalidRequest();
}

async function pendingOwnerPresentation(
  avatar: AvatarRecord,
  dependencies: ProcessAvatarDependencies,
): Promise<AvatarPresentation> {
  if (avatar.state !== 'pending_review' || !avatar.pendingObjectPath) {
    return await resolveOwnPresentation(avatar, dependencies.storage, dependencies.clock);
  }
  try {
    const url = await dependencies.storage.createSignedUrl(
      avatar.pendingObjectPath,
      SIGNED_URL_TTL_SECONDS,
    );
    return {
      profileId: avatar.profileId,
      url,
      state: avatar.state,
      source: 'custom',
      expiresAt: new Date(
        dependencies.clock.now().getTime() + SIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
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

async function attendeePresentation(
  member: AvatarMemberRow,
  dependencies: ProcessAvatarDependencies,
): Promise<AttendeeAvatar> {
  const presentation = await resolveOwnPresentation(
    member.avatar,
    dependencies.storage,
    dependencies.clock,
  );
  return { ...presentation, displayName: member.displayName };
}

async function moderationPresentation(
  member: AvatarMemberRow,
  dependencies: ProcessAvatarDependencies,
): Promise<ModerationRow> {
  const presentation = await resolveOwnPresentation(
    member.avatar,
    dependencies.storage,
    dependencies.clock,
  );
  let pendingPreviewUrl: string | null = null;
  if (member.avatar.state === 'pending_review' && member.avatar.pendingObjectPath) {
    try {
      pendingPreviewUrl = await dependencies.storage.createSignedUrl(
        member.avatar.pendingObjectPath,
        SIGNED_URL_TTL_SECONDS,
      );
    } catch {
      pendingPreviewUrl = null;
    }
  }
  return {
    ...presentation,
    displayName: member.displayName,
    pendingPreviewUrl,
    moderationReason: member.avatar.moderationReason,
    moderatedAt: member.avatar.moderatedAt,
  };
}

function approvedRole(role: string): void {
  try {
    assertApprovedRole(role);
  } catch {
    throw new AvatarRequestError('Approved membership required', 403);
  }
}

function adminRole(role: string): void {
  try {
    assertAdminRole(role);
  } catch {
    throw new AvatarRequestError('Administrator access required', 403);
  }
}

export function createResolveProfileAvatarsHandler(
  dependencies: ProcessAvatarDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      assertOriginAllowed(request, dependencies.allowedOrigins);
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request, dependencies.allowedOrigins),
        });
      }
      if (request.method !== 'GET') throw new AvatarRequestError('Method not allowed', 405);

      const scope = parseScope(request);
      let token: string;
      try {
        token = bearerToken(request);
      } catch (error) {
        if (scope.kind === 'session') {
          throw new AvatarRequestError('Approved membership required', 403);
        }
        throw error;
      }
      const user = await dependencies.auth.getUser(token);
      if (!user) {
        throw new AvatarRequestError(
          scope.kind === 'session' ? 'Approved membership required' : 'Authentication required',
          scope.kind === 'session' ? 403 : 401,
        );
      }
      const profile = await dependencies.database.getProfile(user.id);
      if (!profile) throw new AvatarRequestError('Approved membership required', 403);
      approvedRole(profile.role);

      if (scope.kind === 'self') {
        const presentation = await pendingOwnerPresentation(profile.avatar, dependencies);
        return jsonResponse(request, dependencies.allowedOrigins, { avatars: [presentation] });
      }

      if (scope.kind === 'session') {
        if (await dependencies.database.isRetiredHyroxSession(scope.sessionId)) {
          throw new AvatarRequestError('Session not found', 404);
        }
        const members = await dependencies.database.listSessionAttendees(scope.sessionId);
        const avatars = await Promise.all(
          members.map((member) => attendeePresentation(member, dependencies)),
        );
        return jsonResponse(request, dependencies.allowedOrigins, { avatars });
      }

      adminRole(profile.role);
      const members = await dependencies.database.listAdminMembers();
      const rows = await Promise.all(
        members.map((member) => moderationPresentation(member, dependencies)),
      );
      return jsonResponse(request, dependencies.allowedOrigins, { rows });
    } catch (error) {
      if (error instanceof AvatarRequestError) {
        return jsonResponse(
          request,
          dependencies.allowedOrigins,
          { error: error.message },
          error.status,
        );
      }
      return jsonResponse(
        request,
        dependencies.allowedOrigins,
        { error: 'Profile photos could not be loaded' },
        500,
      );
    }
  };
}

if (import.meta.main) {
  Deno.serve(createResolveProfileAvatarsHandler(createDefaultAvatarDependencies()));
}
