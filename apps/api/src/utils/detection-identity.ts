import { createHash } from 'crypto';

export interface DetectionIdentityInput {
  assetId: string;
  detectorType: string;
  findingType: string;
  matchedContent: string;
  customDetectorKey?: string | null;
}

/**
 * Generates deterministic SHA-256 hash for detection identity.
 * Matches detections across scans by:
 * assetId + detectorType + customDetectorKey? + findingType + matchedContent.
 * Location excluded - line numbers change on edits.
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
  } = input;
  const normalized = matchedContent.trim().toLowerCase();
  const detector = detectorType.trim().toUpperCase();
  const customKey = (customDetectorKey ?? '').trim();
  const compositeKey = `${assetId}:${detector}:${customKey}:${findingType}:${normalized}`;
  return createHash('sha256').update(compositeKey, 'utf8').digest('hex');
}
