import { createHash } from 'crypto';

export const MAX_IDENTITY_KEY_CHARS = 256;

/**
 * A wire `identity_key` of at most 256 chars; longer keys hash.
 *
 * Mirrors the CLI's `_identity_key` (results.py): short keys travel verbatim
 * (readable in the UI), long ones as their SHA-256 hex digest, so every layer
 * keys the same finding the same way.
 */
export function hashIdentityKey(identityKey: string): string {
  if (identityKey.length <= MAX_IDENTITY_KEY_CHARS) return identityKey;
  return createHash('sha256').update(identityKey, 'utf8').digest('hex');
}

export interface DetectionIdentityInput {
  assetId: string;
  detectorType: string;
  findingType: string;
  matchedContent: string;
  customDetectorKey?: string | null;
  /**
   * A detector-supplied stable identity (contract C1, `identity_key` on the
   * wire). When present it replaces the matched content in the key, so a code
   * detector's "total 523 != 520" and next run's "total 524 != 520" on the
   * same row are one finding whose value changed, not a resolve plus a new
   * finding. Absent for every finding that existed before it, so no existing
   * identity changes.
   */
  identityKey?: string | null;
}

/**
 * Generates deterministic SHA-256 hash for detection identity.
 * Matches detections across scans by:
 * assetId + detectorType + customDetectorKey? + findingType + matchedContent,
 * or, when the detector supplies one, + `id:` + identityKey instead of the
 * matched content. Location excluded - line numbers change on edits.
 */
export function generateDetectionIdentity(
  input: DetectionIdentityInput,
): string {
  const {
    assetId,
    detectorType,
    customDetectorKey,
    findingType,
    matchedContent,
    identityKey,
  } = input;
  const detector = detectorType.trim().toUpperCase();
  const customKey = (customDetectorKey ?? '').trim();
  const identity =
    typeof identityKey === 'string' && identityKey.trim()
      ? hashIdentityKey(identityKey.trim())
      : '';
  // The NUL prefix keeps the two key spaces apart: extracted text never
  // starts with one, so no matched content can spell an identity key.
  const discriminator = identity
    ? `\u0000id:${identity}`
    : matchedContent.trim().toLowerCase();
  const compositeKey = `${assetId}:${detector}:${customKey}:${findingType}:${discriminator}`;
  return createHash('sha256').update(compositeKey, 'utf8').digest('hex');
}
