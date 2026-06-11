import type {
  CaseSummary,
  FindingGroupSummary,
  InquirySummary,
  RecalledMemory,
} from './autopilot.types';

/**
 * Prompt builders for the autopilot agents. Context is always pre-aggregated
 * and capped by AgentSearchService, so these stay token-bounded by design.
 */

const DOMAIN_PRIMER = `You are the Investigation Autopilot of Classifyre, a metadata ingestion and
security-findings platform. Glossary of the domain:
- Source: a connected system (Confluence, Jira, SharePoint, …) that is scanned periodically.
- Asset: a document/page/file discovered in a source.
- Finding: a detector hit on an asset (detector types: SECRETS, PII, YARA, CODE_SECURITY, BROKEN_LINKS, CUSTOM). Findings have a type, severity and matched content.
- Inquiry: a saved query ("monitor") over findings, defined by matchers: sources, detector types, custom detector keys, exact finding types, finding-type regexes, finding-value regexes. An inquiry answers one investigation question and tracks how many findings currently match.
- Case: an investigation workspace. It links inquiries (guides), owns evidence (assets), case findings, hypothesis threads (with status PROPOSED/SUPPORTED/REFUTED/INCONCLUSIVE and confidence 0–1), notes and graph edges.
You run automatically after each source scan. You never talk to a user; your only output is structured JSON decisions. Every decision — including doing nothing — must carry a clear rationale an analyst can audit later.`;

export function buildInquirySystemPrompt(guidance: {
  desired: string | null;
  searchable: string | null;
}): string {
  return [
    DOMAIN_PRIMER,
    `Your job in this cycle: manage INQUIRIES for the scanned source.
Rules:
1. Avoid duplicates at all costs. If an existing inquiry already covers a topic, prefer ENRICH_INQUIRY_MATCHERS (your matcher arrays are UNIONED into the existing ones) or UPDATE_INQUIRY over CREATE_INQUIRY. Use the topic→inquiry memories provided.
2. Only create an inquiry when the new findings represent a coherent, investigation-worthy topic that no existing inquiry covers. Set duplicateOfInquiryId when you considered an existing inquiry and decided it already covers the topic.
3. Matchers must be as precise as the data allows: prefer exact findingTypes over regexes; keep regexes short and safe (no catastrophic backtracking).
4. When an inquiry has accumulated strong, related evidence that warrants an investigation case, emit SIGNAL_CASE_READY for it (no mutation — a signal for the case agent).
5. If nothing should change, return exactly one NO_ACTION decision explaining why the new findings do not warrant inquiry changes.
6. Propose memoryWrites that improve future cycles: GLOSSARY entries for domain/business language you learned from the data, DECISION_PRECEDENT entries generalizing this decision, TOPIC_INQUIRY_MAP entries mapping a topic key to the inquiry that covers it.`,
    guidance.desired
      ? `Operator guidance — what is DESIRED (what the operator wants investigated):\n${guidance.desired}`
      : '',
    guidance.searchable
      ? `Operator guidance — what is SEARCHABLE (data/topics worth matching in this instance):\n${guidance.searchable}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildInquiryUserPrompt(input: {
  sourceName: string;
  sourceId: string;
  findingGroups: FindingGroupSummary[];
  inquiries: InquirySummary[];
  memories: RecalledMemory[];
}): string {
  return [
    `## Scan that just finished`,
    `Source: ${input.sourceName} (id: ${input.sourceId})`,
    `## New findings from this scan (grouped; ${input.findingGroups.length} group(s))`,
    json(input.findingGroups.map(compactGroup)),
    `## Existing ACTIVE inquiries (${input.inquiries.length})`,
    json(input.inquiries.map(compactInquiry)),
    `## Your memories (glossary, precedents, topic→inquiry map)`,
    json(input.memories),
    `Respond with the decision JSON.`,
  ].join('\n\n');
}

export function buildCaseSystemPrompt(guidance: string | null): string {
  return [
    DOMAIN_PRIMER,
    `Your job in this cycle: manage INVESTIGATION CASES based on inquiries with new matches.
Rules:
1. Check existing open cases first. If a case already investigates the topic, UPDATE_CASE: add hypotheses, attach findings, add evidence, add notes, link inquiries, adjust status/severity — whatever moves the investigation forward.
2. CREATE_CASE only for a coherent new investigation that no open case covers. Give it a precise title, a description stating the investigation question, and LINK_INQUIRY + ATTACH_FINDINGS operations so it starts with substance.
3. Hypotheses are testable statements (ADD_HYPOTHESIS with title + statement; confidence 0–1). Update them (UPDATE_HYPOTHESIS) when new findings support or refute them.
4. Use ADD_NOTE for analyst-readable observations about what this scan changed.
5. Use CREATE_EDGE only for relationships you can justify from the data (asset/finding ids you were given).
6. Only reference ids that appear in the provided context. Never invent ids.
7. If nothing should change, return exactly one NO_ACTION decision explaining why.
8. Propose memoryWrites (GLOSSARY / DECISION_PRECEDENT) that improve future cycles.`,
    guidance ? `Operator guidance for case management:\n${guidance}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildCaseUserPrompt(input: {
  sourceName: string;
  candidateInquiries: Array<
    InquirySummary & {
      caseReadySignal: boolean;
      sampleMatches: Array<{
        findingId: string;
        assetId: string;
        label: string;
        severity: string;
        value?: string;
      }>;
    }
  >;
  openCases: CaseSummary[];
  memories: RecalledMemory[];
}): string {
  return [
    `## Scan that just finished`,
    `Source: ${input.sourceName}`,
    `## Candidate inquiries (new matches and/or flagged case-ready)`,
    json(
      input.candidateInquiries.map((q) => ({
        ...compactInquiry(q),
        caseReadySignal: q.caseReadySignal,
        sampleMatches: q.sampleMatches,
      })),
    ),
    `## Open cases (${input.openCases.length})`,
    json(input.openCases),
    `## Your memories`,
    json(input.memories),
    `Respond with the decision JSON.`,
  ].join('\n\n');
}

function compactGroup(g: FindingGroupSummary): Record<string, unknown> {
  return {
    detectorType: g.detectorType,
    ...(g.customDetectorKey ? { customDetectorKey: g.customDetectorKey } : {}),
    findingType: g.findingType,
    severity: g.severity,
    count: g.count,
    sampleValues: g.sampleValues,
    sampleFindingIds: g.sampleFindingIds.slice(0, 5),
    sampleAssetIds: [...new Set(g.sampleAssetIds)].slice(0, 5),
  };
}

function compactInquiry(q: InquirySummary): Record<string, unknown> {
  return {
    id: q.id,
    title: q.title,
    ...(q.description ? { description: q.description.slice(0, 300) } : {}),
    aiMode: q.aiMode,
    matchers: {
      matchAllSources: q.matchAllSources,
      sourceIds: q.sourceIds,
      detectorTypes: q.detectorTypes,
      customDetectorKeys: q.customDetectorKeys,
      findingTypes: q.findingTypes,
      findingTypeRegex: q.findingTypeRegex,
      findingValueRegex: q.findingValueRegex,
    },
    matchCount: q.matchCount,
    newMatchCount: q.newMatchCount,
    linkedCaseIds: q.linkedCaseIds,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 1);
}
