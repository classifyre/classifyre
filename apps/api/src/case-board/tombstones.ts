import { Prisma } from '@prisma/client';

/**
 * Undo state for evidence and findings that left a case, kept on the board
 * item they belonged to (`content.tombstone` / `content.detached`) and never
 * sent to clients (see toBoardItemDto).
 *
 * Shared by the board's own ops and by automatic clean-up, so a finding the
 * clean-up took out comes back exactly — same case_findings row, note and
 * stances — when someone attaches it again from the board.
 */

/** Removed evidence, kept on its board item so undo can restore it exactly. */
export interface EvidenceTombstone {
  evidence: {
    id: string;
    caseId: string;
    entityType: string;
    entityId: string;
    label: string | null;
    assetType: string | null;
    sourceType: string | null;
    note: string | null;
    addedBy: string | null;
    createdAt: string;
  };
  findings: CaseFindingTombstone[];
}

export interface CaseFindingTombstone {
  id: string;
  caseId: string;
  caseEvidenceId: string;
  findingId: string;
  label: string;
  severity: string | null;
  detectorType: string | null;
  customDetectorName: string | null;
  matchedContent: string | null;
  note: string | null;
  createdAt: string;
  detachedAt?: string;
  /** An escalated finding comes back escalated. */
  escalatedAt?: string | null;
  escalationRuleId?: string | null;
  escalationLabel?: string | null;
}

export function caseFindingTombstone(cf: {
  id: string;
  caseId: string;
  caseEvidenceId: string;
  findingId: string;
  label: string;
  severity: string | null;
  detectorType: string | null;
  customDetectorName: string | null;
  matchedContent: string | null;
  note: string | null;
  createdAt: Date;
  escalatedAt?: Date | null;
  escalationRuleId?: string | null;
  escalationLabel?: string | null;
}): CaseFindingTombstone {
  return {
    id: cf.id,
    caseId: cf.caseId,
    caseEvidenceId: cf.caseEvidenceId,
    findingId: cf.findingId,
    label: cf.label,
    severity: cf.severity,
    detectorType: cf.detectorType,
    customDetectorName: cf.customDetectorName,
    matchedContent: cf.matchedContent,
    note: cf.note,
    createdAt: cf.createdAt.toISOString(),
    ...(cf.escalatedAt
      ? {
          escalatedAt: cf.escalatedAt.toISOString(),
          escalationRuleId: cf.escalationRuleId ?? null,
          escalationLabel: cf.escalationLabel ?? null,
        }
      : {}),
  };
}

export function fromCaseFindingTombstone(
  t: CaseFindingTombstone,
): Prisma.CaseFindingCreateManyInput {
  return {
    id: t.id,
    caseId: t.caseId,
    caseEvidenceId: t.caseEvidenceId,
    findingId: t.findingId,
    label: t.label,
    severity: t.severity,
    detectorType: t.detectorType,
    customDetectorName: t.customDetectorName,
    matchedContent: t.matchedContent,
    note: t.note,
    createdAt: new Date(t.createdAt),
    escalatedAt: t.escalatedAt ? new Date(t.escalatedAt) : null,
    escalationRuleId: t.escalationRuleId ?? null,
    escalationLabel: t.escalationLabel ?? null,
  };
}

export function evidenceTombstone(evidence: {
  id: string;
  caseId: string;
  entityType: string;
  entityId: string;
  label: string | null;
  assetType: string | null;
  sourceType: string | null;
  note: string | null;
  addedBy: string | null;
  createdAt: Date;
  findings: Parameters<typeof caseFindingTombstone>[0][];
}): EvidenceTombstone {
  return {
    evidence: {
      id: evidence.id,
      caseId: evidence.caseId,
      entityType: evidence.entityType,
      entityId: evidence.entityId,
      label: evidence.label,
      assetType: evidence.assetType,
      sourceType: evidence.sourceType,
      note: evidence.note,
      addedBy: evidence.addedBy,
      createdAt: evidence.createdAt.toISOString(),
    },
    findings: evidence.findings.map(caseFindingTombstone),
  };
}
