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

/** A finding's evidence as it is embedded: the match, and the words either side. */
export interface EvidenceWindow {
  matched: string;
  before?: string | null;
  after?: string | null;
}

/**
 * Whether two pieces of evidence are two windows onto ONE passage rather than
 * the same passage twice.
 *
 * Evidence is the match with the text around it. Two findings a few words
 * apart in one sentence (a name, and the date after it) therefore carry
 * almost the same text, and their vectors lie almost on top of each other.
 * That is not a repeat: it is one sentence, read once for each finding. Taken
 * for near-duplicates, such pairs put most of a workspace's findings into
 * "duplicate groups" with their own neighbours and marked every one of them
 * down for it.
 *
 * They are told apart by where the match sits. In a real repeat (a notice
 * sent twice, a footer on every page) each match is at the centre of its own
 * window and absent from the other's surroundings. In two windows onto one
 * passage, one finding's match lies in the other's surroundings.
 *
 * A match of one or two characters says nothing either way and is ignored.
 */
export function windowsOntoOnePassage(
  left: EvidenceWindow,
  right: EvidenceWindow,
): boolean {
  const within = (needle: string, window: EvidenceWindow) => {
    const value = normalizeEmbeddingText(needle);
    if (value.length < 3) return false;
    return (
      normalizeEmbeddingText(window.before).includes(value) ||
      normalizeEmbeddingText(window.after).includes(value)
    );
  };
  return within(left.matched, right) || within(right.matched, left);
}
