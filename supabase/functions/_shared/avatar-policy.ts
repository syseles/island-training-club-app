export const APPROVED_ROLES = new Set(['member', 'admin', 'super_admin']);
export const ADMIN_ROLES = new Set(['admin', 'super_admin']);
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_DECODED_EDGE = 4096;
export const OUTPUT_EDGE = 512;
export const MAX_ATTEMPTS_PER_HOUR = 10;
export const SIGNED_URL_TTL_SECONDS = 600;

export type AvatarState = 'active' | 'hidden' | 'pending_review';
export type AvatarAction = 'upload' | 'remove' | 'hide' | 'submit_review' | 'approve' | 'reject';
export type AvatarObjectKind = 'google' | 'custom' | 'pending';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertApprovedRole(role: string): void {
  if (!APPROVED_ROLES.has(role)) {
    throw new Error('Approved membership required');
  }
}

export function assertAdminRole(role: string): void {
  if (!ADMIN_ROLES.has(role)) {
    throw new Error('Administrator access required');
  }
}

export function assertUploadRate(priorAttempts: number): void {
  if (!Number.isInteger(priorAttempts) || priorAttempts < 0) {
    throw new Error('Invalid upload attempt count');
  }
  if (priorAttempts >= MAX_ATTEMPTS_PER_HOUR) {
    throw new Error('Too many photo attempts');
  }
}

export function nextAvatarState(current: AvatarState, action: AvatarAction): AvatarState {
  if (action === 'hide') return 'hidden';
  if (current === 'active' && (action === 'upload' || action === 'remove')) return 'active';
  if (current === 'hidden' && action === 'upload') return 'pending_review';
  if (current === 'hidden' && action === 'remove') return 'hidden';
  if (current === 'pending_review' && action === 'upload') return 'pending_review';
  if (current === 'pending_review' && action === 'remove') return 'hidden';
  if (current === 'pending_review' && action === 'approve') return 'active';
  if (current === 'pending_review' && action === 'reject') return 'hidden';
  if (current === 'hidden' && action === 'submit_review') return 'pending_review';
  throw new Error('Invalid avatar state transition');
}

export function avatarObjectPath(profileId: string, kind: AvatarObjectKind): string {
  if (!UUID_PATTERN.test(profileId)) {
    throw new Error('Invalid profile ID');
  }
  if (!['google', 'custom', 'pending'].includes(kind)) {
    throw new Error('Invalid avatar object kind');
  }
  return `${profileId}/${kind}-${crypto.randomUUID()}.jpg`;
}
