/**
 * How a finding's content is shown next to a mention or a candidate.
 *
 * The one place the entity layer hands matched content to a caller, so the
 * content presenter of the enterprise seams (S1 R9, R10) has a single function
 * to stand behind when it exists: today every purpose gets the content in
 * full, exactly as the findings list does.
 */
export type SnippetPurpose = 'ui' | 'export' | 'integration' | 'ai_context';

export interface FindingSnippet {
  before: string;
  matched: string;
  after: string;
  /** A short human-readable position ("page 3", "row 12 · iban"), if known. */
  location: string | null;
}

const CONTEXT_CHARS = 160;

export function presentFindingSnippet(
  finding: {
    matchedContent: string | null;
    contextBefore: string | null;
    contextAfter: string | null;
    location?: unknown;
  },
  purpose: SnippetPurpose,
): FindingSnippet {
  // Exports carry the whole context; the UI and agents get a readable window.
  const window = purpose === 'export' ? Number.MAX_SAFE_INTEGER : CONTEXT_CHARS;
  const before = finding.contextBefore ?? '';
  const after = finding.contextAfter ?? '';
  return {
    before: before.length > window ? `…${before.slice(-window)}` : before,
    matched: finding.matchedContent ?? '',
    after: after.length > window ? `${after.slice(0, window)}…` : after,
    location: describeLocation(finding.location),
  };
}

function describeLocation(location: unknown): string | null {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    return null;
  }
  const record = location as Record<string, unknown>;
  const parts: string[] = [];
  const pick = (key: string, label: string) => {
    const value = record[key];
    if (typeof value === 'number' || (typeof value === 'string' && value)) {
      parts.push(`${label} ${value}`);
    }
  };
  pick('page', 'page');
  pick('sheet', 'sheet');
  pick('row', 'row');
  pick('line', 'line');
  if (typeof record.column === 'string' && record.column) {
    parts.push(record.column);
  }
  if (typeof record.path === 'string' && record.path) parts.push(record.path);
  return parts.length ? parts.join(' · ') : null;
}
