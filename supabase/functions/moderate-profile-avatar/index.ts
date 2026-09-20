import { assertAdminRole, assertProfileId } from '../_shared/avatar-policy.ts';
import {
  assertOriginAllowed,
  AvatarRequestError,
  bearerToken,
  bestEffortRemove,
  corsHeaders,
  createDefaultAvatarDependencies,
  jsonResponse,
  type ProcessAvatarDependencies,
  resolveOwnPresentation,
} from '../_shared/avatar-service.ts';

type ModerationCommand =
  | { action: 'hide'; profileId: string; reason: string }
  | { action: 'approve'; profileId: string }
  | { action: 'reject'; profileId: string; reason: string };

function invalidRequest(message = 'Invalid profile photo moderation request'): never {
  throw new AvatarRequestError(message, 400);
}

async function parseCommand(request: Request): Promise<ModerationCommand> {
  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidRequest();
    body = value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AvatarRequestError) throw error;
    return invalidRequest();
  }

  if (typeof body.profileId !== 'string') invalidRequest();
  try {
    assertProfileId(body.profileId);
  } catch {
    invalidRequest('Invalid profile ID');
  }

  if (body.action === 'approve') {
    if (Object.keys(body).length !== 2) invalidRequest();
    return { action: 'approve', profileId: body.profileId };
  }
  if (body.action === 'hide' || body.action === 'reject') {
    if (Object.keys(body).length !== 3 || typeof body.reason !== 'string') invalidRequest();
    const reason = body.reason.trim();
    if (!reason) invalidRequest('A moderation reason is required');
    return { action: body.action, profileId: body.profileId, reason };
  }
  return invalidRequest();
}

function requireAdmin(role: string): void {
  try {
    assertAdminRole(role);
  } catch {
    throw new AvatarRequestError('Administrator access required', 403);
  }
}

export function createModerateProfileAvatarHandler(
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
      if (request.method !== 'POST') throw new AvatarRequestError('Method not allowed', 405);

      const token = bearerToken(request);
      const actor = await dependencies.auth.getUser(token);
      if (!actor) throw new AvatarRequestError('Authentication required', 401);
      const actorProfile = await dependencies.database.getProfile(actor.id);
      if (!actorProfile) throw new AvatarRequestError('Administrator access required', 403);
      requireAdmin(actorProfile.role);

      const command = await parseCommand(request);
      const transition = command.action === 'hide'
        ? await dependencies.database.hideAvatar(
          command.profileId,
          actor.id,
          command.reason,
        )
        : await dependencies.database.decideReview(
          command.profileId,
          actor.id,
          command.action,
          command.action === 'reject' ? command.reason : null,
        );

      await bestEffortRemove(dependencies.storage, transition.replacedObjectPaths);
      const presentation = await resolveOwnPresentation(
        transition.avatar,
        dependencies.storage,
        dependencies.clock,
      );
      return jsonResponse(request, dependencies.allowedOrigins, { presentation });
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
        { error: 'Profile photo moderation could not be completed' },
        500,
      );
    }
  };
}

if (import.meta.main) {
  Deno.serve(createModerateProfileAvatarHandler(createDefaultAvatarDependencies()));
}
