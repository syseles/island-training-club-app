import { readBodyLimited, sanitizeAvatar } from '../_shared/avatar-image.ts';
import { assertApprovedRole, avatarObjectPath } from '../_shared/avatar-policy.ts';
import {
  assertOriginAllowed,
  type AvatarProfile,
  AvatarRequestError,
  bearerToken,
  bestEffortRemove,
  corsHeaders,
  createDefaultAvatarDependencies,
  fetchGoogleAvatar,
  jsonResponse,
  type ProcessAvatarDependencies,
  resolveOwnPresentation,
} from '../_shared/avatar-service.ts';

const MAX_MULTIPART_BYTES = 2 * 1024 * 1024 + 256 * 1024;

function invalidRequest(message = 'Invalid profile photo request'): never {
  throw new AvatarRequestError(message, 400);
}

async function parseBoundedMultipart(request: Request): Promise<FormData> {
  const headers = new Headers();
  for (const name of ['content-type', 'content-length']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const bytes = await readBodyLimited(
      new Response(request.body, { headers }),
      MAX_MULTIPART_BYTES,
    );
    return await new Request(request.url, {
      method: 'POST',
      headers,
      body: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    }).formData();
  } catch {
    throw new AvatarRequestError('Profile photo exceeds 2 MB or is malformed', 400);
  }
}

async function requireApprovedProfile(
  request: Request,
  dependencies: ProcessAvatarDependencies,
) {
  const token = bearerToken(request);
  const user = await dependencies.auth.getUser(token);
  if (!user) throw new AvatarRequestError('Authentication required', 401);
  const profile = await dependencies.database.getProfile(user.id);
  if (!profile) throw new AvatarRequestError('Approved membership required', 403);
  try {
    assertApprovedRole(profile.role);
  } catch {
    throw new AvatarRequestError('Approved membership required', 403);
  }
  return { user, profile };
}

async function requireAttempt(
  profileId: string,
  dependencies: ProcessAvatarDependencies,
): Promise<void> {
  const allowed = await dependencies.database.recordUploadAttempt(profileId);
  if (!allowed) throw new AvatarRequestError('Too many photo attempts', 429);
}

async function handleUpload(
  request: Request,
  profileId: string,
  current: AvatarProfile,
  dependencies: ProcessAvatarDependencies,
): Promise<Response> {
  const form = await parseBoundedMultipart(request);
  const keys = [...form.keys()];
  if (keys.some((key) => key !== 'action' && key !== 'file')) invalidRequest();
  if (form.get('action') !== 'upload') invalidRequest();
  const file = form.get('file');
  if (!(file instanceof File)) invalidRequest('A profile photo is required');

  await requireAttempt(profileId, dependencies);
  let sanitized: Uint8Array;
  try {
    sanitized = await sanitizeAvatar(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new AvatarRequestError('Invalid profile photo', 400);
  }

  const moderated = current.avatar.state === 'hidden' || current.avatar.state === 'pending_review';
  const kind = moderated ? 'pending' : 'custom';
  const candidatePath = avatarObjectPath(profileId, kind);
  await dependencies.storage.upload(candidatePath, sanitized);

  let transition;
  try {
    transition = moderated
      ? await dependencies.database.submitReview(profileId, candidatePath)
      : await dependencies.database.activateCustom(profileId, candidatePath);
  } catch (error) {
    await bestEffortRemove(dependencies.storage, [candidatePath]);
    throw error;
  }

  await bestEffortRemove(dependencies.storage, transition.replacedObjectPaths);
  const presentation = await resolveOwnPresentation(
    transition.avatar,
    dependencies.storage,
    dependencies.clock,
  );
  return jsonResponse(request, dependencies.allowedOrigins, { presentation });
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalidRequest();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AvatarRequestError) throw error;
    return invalidRequest();
  }
}

async function handleGoogleSync(
  request: Request,
  profileId: string,
  user: Parameters<ProcessAvatarDependencies['identity']['googleAvatarUrl']>[0],
  current: AvatarProfile,
  dependencies: ProcessAvatarDependencies,
): Promise<Response> {
  const body = await parseJsonObject(request);
  if (Object.keys(body).length !== 1 || body.action !== 'sync_google') invalidRequest();

  const sourceUrl = dependencies.identity.googleAvatarUrl(user);
  if (!sourceUrl) {
    const presentation = await resolveOwnPresentation(
      current.avatar,
      dependencies.storage,
      dependencies.clock,
    );
    return jsonResponse(request, dependencies.allowedOrigins, { presentation });
  }

  await requireAttempt(profileId, dependencies);
  const sourceBytes = await fetchGoogleAvatar(sourceUrl, dependencies.fetch);
  let sanitized: Uint8Array;
  try {
    sanitized = await sanitizeAvatar(sourceBytes);
  } catch {
    throw new AvatarRequestError('Invalid Google profile photo', 400);
  }

  const candidatePath = avatarObjectPath(profileId, 'google');
  await dependencies.storage.upload(candidatePath, sanitized);
  let transition;
  try {
    transition = await dependencies.database.setGoogle(profileId, candidatePath);
  } catch (error) {
    await bestEffortRemove(dependencies.storage, [candidatePath]);
    throw error;
  }
  await bestEffortRemove(dependencies.storage, transition.replacedObjectPaths);
  const presentation = await resolveOwnPresentation(
    transition.avatar,
    dependencies.storage,
    dependencies.clock,
  );
  return jsonResponse(request, dependencies.allowedOrigins, { presentation });
}

async function handleDelete(
  request: Request,
  profileId: string,
  _current: AvatarProfile,
  dependencies: ProcessAvatarDependencies,
): Promise<Response> {
  const transition = await dependencies.database.removeCustom(profileId);
  await bestEffortRemove(dependencies.storage, transition.replacedObjectPaths);
  const presentation = await resolveOwnPresentation(
    transition.avatar,
    dependencies.storage,
    dependencies.clock,
  );
  return jsonResponse(request, dependencies.allowedOrigins, { presentation });
}

export function createProcessProfileAvatarHandler(
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

      const { user, profile } = await requireApprovedProfile(request, dependencies);
      if (request.method === 'DELETE') {
        return await handleDelete(request, user.id, profile, dependencies);
      }
      if (request.method !== 'POST') {
        throw new AvatarRequestError('Method not allowed', 405);
      }

      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.startsWith('multipart/form-data')) {
        return await handleUpload(request, user.id, profile, dependencies);
      }
      if (contentType.startsWith('application/json')) {
        return await handleGoogleSync(request, user.id, user, profile, dependencies);
      }
      return invalidRequest();
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
        { error: 'Profile photo could not be updated' },
        500,
      );
    }
  };
}

if (import.meta.main) {
  Deno.serve(createProcessProfileAvatarHandler(createDefaultAvatarDependencies()));
}
