/**
 * What a finding found — its matched value and the text around it — is the
 * very data column masks protect (docs/prd/DQ-data-query.md §5.8). Who may
 * read it is decided per finding (FindingContentService); this walks any
 * response and replaces it wherever the reader may not.
 *
 * Every object with a `matchedContent` (or `matched_content`) string is a
 * finding as far as this goes: the findings list, search, quick search,
 * cases, inquiries, the graph, MCP tools. New shapes are covered without
 * being listed, which is the point of doing it here and not per endpoint.
 */

/** What a hidden value reads as. */
export const HIDDEN_VALUE = '••••';

/** Fields that carry the value, or text a value can be read back from. */
const VALUE_FIELDS = ['matchedContent', 'matched_content'] as const;
const TEXT_FIELDS = [
  'redactedContent',
  'redacted_content',
  'contextBefore',
  'contextAfter',
  'context_before',
  'context_after',
  'snippet',
  'contextSnippet',
] as const;

export type FindingLike = Record<string, unknown> & {
  assetId?: unknown;
  asset_id?: unknown;
  sourceId?: unknown;
  source_id?: unknown;
};

function isFinding(value: Record<string, unknown>): boolean {
  return VALUE_FIELDS.some((field) => typeof value[field] === 'string');
}

/** A code detector's extraction: the fields it read out of a finding. */
function isExtraction(value: Record<string, unknown>): boolean {
  return (
    typeof value.findingId === 'string' &&
    !!value.pipelineResult &&
    typeof value.pipelineResult === 'object'
  );
}

/**
 * A copy of `body` with the content of every finding `mayRead` refuses
 * replaced: the value by {@link HIDDEN_VALUE} (also the redacted form, which
 * keeps part of it), the text around it dropped, `contentHidden: true` set so
 * a client can say why. Returns the body unchanged (same object) when nothing
 * was hidden.
 */
export function redactFindingContent<T>(
  body: T,
  mayRead: (finding: FindingLike) => boolean,
): { body: T; changed: number } {
  let changed = 0;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      let copy: unknown[] | null = null;
      value.forEach((item, index) => {
        const next = walk(item);
        if (next !== item) {
          copy ??= [...value];
          copy[index] = next;
        }
      });
      return copy ?? value;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      value instanceof Date ||
      value instanceof Map ||
      value instanceof Set ||
      ArrayBuffer.isView(value) ||
      typeof (value as { pipe?: unknown }).pipe === 'function'
    ) {
      // Files, Arrow results and streams are not findings.
      return value;
    }
    const record = value as Record<string, unknown>;
    let copy: Record<string, unknown> | null = null;
    for (const [key, item] of Object.entries(record)) {
      const next = walk(item);
      if (next !== item) {
        copy ??= { ...record };
        copy[key] = next;
      }
    }
    const current = copy ?? record;
    if (isExtraction(current) && !mayRead(current)) {
      changed += 1;
      return { ...current, pipelineResult: {}, contentHidden: true };
    }
    if (isFinding(current) && !mayRead(current)) {
      changed += 1;
      const hidden: Record<string, unknown> = { ...current };
      for (const field of VALUE_FIELDS) {
        if (typeof hidden[field] === 'string') hidden[field] = HIDDEN_VALUE;
      }
      for (const field of TEXT_FIELDS) {
        if (field === 'redactedContent' || field === 'redacted_content') {
          if (typeof hidden[field] === 'string') hidden[field] = HIDDEN_VALUE;
        } else {
          delete hidden[field];
        }
      }
      hidden.contentHidden = true;
      return hidden;
    }
    return current;
  };
  const result = walk(body) as T;
  return { body: result, changed };
}

/** The asset a finding-shaped object belongs to, when it says. */
export function assetIdOf(finding: FindingLike): string | null {
  const value = finding.assetId ?? finding.asset_id;
  return typeof value === 'string' && value ? value : null;
}

/** The source a finding-shaped object belongs to, when it says. */
export function sourceIdOf(finding: FindingLike): string | null {
  const value = finding.sourceId ?? finding.source_id;
  return typeof value === 'string' && value ? value : null;
}

/** Every asset id named by a finding-shaped object anywhere in `body`. */
export function findingAssetIds(body: unknown): Set<string> {
  const ids = new Set<string>();
  redactFindingContent(body, (finding) => {
    const id = assetIdOf(finding);
    if (id) ids.add(id);
    return true;
  });
  return ids;
}

/**
 * Text that should have been JSON (a result cut short) with the value of
 * every finding field blanked, whoever's finding it is.
 */
export function hideValuesInText(text: string): string {
  return text.replace(
    /("(?:matchedContent|matched_content|redactedContent|redacted_content|contextBefore|contextAfter|context_before|context_after|snippet|contextSnippet)"\s*:\s*)"(?:[^"\\]|\\.)*("|$)/g,
    (_match, key: string) => `${key}"${HIDDEN_VALUE}"`,
  );
}
