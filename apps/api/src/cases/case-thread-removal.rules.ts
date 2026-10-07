/**
 * The pure half of "delete a hypothesis together with its evidence": which
 * findings and assets of a case leave with it, and which stay and why.
 *
 * Nothing leaves that something else still stands on. A finding another
 * hypothesis is linked to stays (it is that hypothesis's evidence too), and
 * so does anything a person wrote a note on (their words are not a rule's to
 * throw away). An asset leaves only when it has nothing left in the case:
 * every finding of it leaves too.
 */

export interface RemovalLink {
  targetType: 'finding' | 'evidence';
  /** A case-finding id or a case-evidence id, as the link row stores it. */
  targetId: string;
}

export interface RemovalFinding {
  id: string;
  evidenceId: string;
  note: string | null;
}

export interface RemovalEvidence {
  id: string;
  note: string | null;
  /** Every case finding on this evidence (case-finding ids). */
  findingIds: readonly string[];
}

export interface ThreadRemovalPlan {
  /** Case-finding ids that leave. */
  findingIds: Set<string>;
  /** Case-evidence ids that leave (their findings with them). */
  evidenceIds: Set<string>;
  /** Findings of the case linked to the hypothesis. */
  linkedFindings: number;
  /** Assets of the case linked to the hypothesis. */
  linkedAssets: number;
  /** Findings that stay because another hypothesis is linked to them too. */
  keptShared: number;
  /** Findings and assets that stay because someone wrote a note. */
  keptNoted: number;
}

const blank = (note: string | null | undefined) =>
  note == null || note.trim() === '';

export function planThreadRemoval(input: {
  /** The hypothesis's own links. */
  own: readonly RemovalLink[];
  /** Links of every other hypothesis of the case. */
  others: readonly RemovalLink[];
  evidence: readonly RemovalEvidence[];
  findings: readonly RemovalFinding[];
}): ThreadRemovalPlan {
  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const findingById = new Map(input.findings.map((f) => [f.id, f]));

  const ownFindings = new Set<string>();
  const ownEvidence = new Set<string>();
  for (const link of input.own) {
    if (link.targetType === 'finding' && findingById.has(link.targetId)) {
      ownFindings.add(link.targetId);
    } else if (
      link.targetType === 'evidence' &&
      evidenceById.has(link.targetId)
    ) {
      ownEvidence.add(link.targetId);
    }
  }
  const otherFindings = new Set<string>();
  const otherEvidence = new Set<string>();
  for (const link of input.others) {
    (link.targetType === 'finding' ? otherFindings : otherEvidence).add(
      link.targetId,
    );
  }

  // A link to an asset speaks for all of its findings.
  const linkedFindings = new Set(ownFindings);
  for (const id of ownEvidence) {
    for (const fid of evidenceById.get(id)!.findingIds) linkedFindings.add(fid);
  }
  const linkedAssets = new Set(ownEvidence);
  for (const fid of ownFindings) {
    linkedAssets.add(findingById.get(fid)!.evidenceId);
  }

  let keptShared = 0;
  let keptNoted = 0;
  const findingIds = new Set<string>();
  for (const id of linkedFindings) {
    const finding = findingById.get(id);
    if (!finding) continue;
    if (otherFindings.has(id) || otherEvidence.has(finding.evidenceId)) {
      keptShared += 1;
    } else if (!blank(finding.note)) {
      keptNoted += 1;
    } else {
      findingIds.add(id);
    }
  }

  const evidenceIds = new Set<string>();
  for (const id of linkedAssets) {
    const ev = evidenceById.get(id);
    if (!ev || otherEvidence.has(id)) continue;
    const remaining = ev.findingIds.filter((f) => !findingIds.has(f));
    // An asset with findings left stays; so does one nobody linked as a whole
    // and that never held a finding (it was not there for this hypothesis).
    if (remaining.length > 0) continue;
    if (ev.findingIds.length === 0 && !ownEvidence.has(id)) continue;
    if (!blank(ev.note)) {
      keptNoted += 1;
      continue;
    }
    evidenceIds.add(id);
  }

  return {
    findingIds,
    evidenceIds,
    linkedFindings: linkedFindings.size,
    linkedAssets: linkedAssets.size,
    keptShared,
    keptNoted,
  };
}
