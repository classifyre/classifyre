import { createHash } from 'node:crypto';

export function normalizeEmbeddingText(
  ...parts: Array<string | null | undefined>
): string {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function embeddingContentHash(
  ...parts: Array<string | null | undefined>
): string {
  return createHash('sha256')
    .update(normalizeEmbeddingText(...parts), 'utf8')
    .digest('hex');
}
