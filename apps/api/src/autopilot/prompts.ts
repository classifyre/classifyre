import type { JsonSchema } from '../ai';
import { inquiryDecisionSchema } from './schemas/inquiry-decision.schema';
import { caseDecisionSchema } from './schemas/case-decision.schema';
import {
  DREAM_OUTPUT_EXAMPLE,
  dreamConsolidationSchema,
} from './schemas/dream.schema';
import type {
  CaseSummary,
  FindingGroupSummary,
  FocusedCaseDetail,
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

/**
 * The output contract is embedded verbatim into each system prompt — the
 * provider layer does not do native structured output, so the model must see
 * the exact JSON schema it will be validated against (AJV, no extra
 * properties allowed).
 */
function outputContract(schema: JsonSchema, example: unknown): string {
  return [
    `## Output format (STRICT)`,
    `Your entire response must be ONE JSON object that validates against this JSON Schema. ` +
      `Top-level keys are exactly "decisions" (non-empty array) and "memoryWrites" (array, may be empty). ` +
      `No other top-level keys. No additional properties anywhere. ` +
      `"memoryWrites" lives at the TOP level only — never inside a decision.`,
    'JSON Schema:',
    JSON.stringify(schema),
    'Minimal valid example:',
    JSON.stringify(example, null, 1),
  ].join('\n');
}

const INQUIRY_OUTPUT_EXAMPLE = {
  decisions: [
    {
      action: 'CREATE_INQUIRY',
      rationale:
        'Recurring AWS access keys across 3 assets form a coherent secrets-exposure topic no inquiry covers.',
      inquiry: {
        title: 'Leaked AWS access keys',
        detectorTypes: ['SECRETS'],
        findingTypes: ['aws-access-key'],
        matchAllSources: true,
      },
    },
    {
      action: 'NO_ACTION',
      rationale:
        'The remaining BROKEN_LINKS findings are routine and already monitored by an existing inquiry.',
    },
  ],
  memoryWrites: [
    {
      kind: 'GLOSSARY',
      key: 'aws-access-key',
      content: 'AKIA-prefixed credentials; always investigation-worthy.',
    },
  ],
};

const CASE_OUTPUT_EXAMPLE = {
  decisions: [
    {
      action: 'UPDATE_CASE',
      rationale:
        'New credential findings strengthen the existing key-leak investigation.',
      caseId: '00000000-0000-0000-0000-000000000000',
      operations: [
        {
          op: 'ATTACH_FINDINGS',
          rationale: 'These three findings are direct evidence of the leak.',
          findingIds: ['00000000-0000-0000-0000-000000000001'],
        },
        {
          op: 'ADD_HYPOTHESIS',
          rationale: 'All keys share one prefix, suggesting a single origin.',
          title: 'Single CI pipeline origin',
          statement:
            'The leaked keys all come from one misconfigured CI pipeline.',
          confidence: 0.6,
        },
      ],
    },
  ],
  memoryWrites: [],
};

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
    outputContract(inquiryDecisionSchema, INQUIRY_OUTPUT_EXAMPLE),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildInquiryUserPrompt(input: {
  sourceName: string;
  sourceId: string | null;
  manual: boolean;
  instruction: string | null;
  findingGroups: FindingGroupSummary[];
  inquiries: InquirySummary[];
  archivedInquiries: Array<{
    id: string;
    title: string;
    description: string | null;
  }>;
  memories: RecalledMemory[];
  part?: { index: number; total: number };
}): string {
  return [
    input.manual
      ? `## Manual review requested by the operator\nScope: ${input.sourceName}. Review ALL existing open findings below — this is not a scan delta.`
      : `## Scan that just finished\nSource: ${input.sourceName}${input.sourceId ? ` (id: ${input.sourceId})` : ''}`,
    input.instruction
      ? `## Operator instruction for THIS cycle (highest priority — follow it)\n${input.instruction}`
      : '',
    partNote(input.part),
    `## ${input.manual ? 'Open findings in scope' : 'New findings from this scan'} (grouped; ${input.findingGroups.length} group(s))`,
    json(input.findingGroups.map(compactGroup)),
    `## Existing ACTIVE inquiries (${input.inquiries.length})`,
    json(input.inquiries.map(compactInquiry)),
    input.archivedInquiries.length > 0
      ? `## Recently ARCHIVED inquiries (intentionally closed — do NOT recreate these topics unless the operator explicitly asks)\n` +
        json(
          input.archivedInquiries.map((q) => ({
            id: q.id,
            title: q.title,
            ...(q.description
              ? { description: q.description.slice(0, 200) }
              : {}),
          })),
        )
      : '',
    `## Your memories (glossary, precedents, topic→inquiry map)`,
    json(input.memories),
    `Respond with the decision JSON.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildCaseSystemPrompt(
  guidance: string | null,
  opts?: { focused?: boolean },
): string {
  return [
    DOMAIN_PRIMER,
    opts?.focused
      ? `Your job in this cycle: a FOCUSED run on ONE case. The operator asked you to work on exactly this case — its full detail (hypothesis threads, evidence, findings, graph edges, all with their real ids) is in the user message. Follow the operator instruction; if there is none, do whatever most advances the investigation. Emit UPDATE_CASE decisions for this case (CREATE_CASE only if the instruction explicitly demands a new case).
Your toolbox on this case:
- Connect the dots: CREATE_EDGE between assets/findings whose data supports a relationship; REMOVE_EDGE (by edgeId) for MANUAL edges the evidence no longer supports (INFERRED edges cannot be removed).
- Build evidence paths: a chain of CREATE_EDGE operations that links evidence step by step (A REFERENCES B, B SENT_TO C…), plus an ADD_NOTE narrating the path and what it shows.
- Hypotheses: ADD_HYPOTHESIS (testable statement + confidence) or UPDATE_HYPOTHESIS (threadId; status SUPPORTED/REFUTED/INCONCLUSIVE + confidence), then assign the evidence that bears on them with LINK_SUPPORT (threadId + targetType "evidence"/"finding" + targetId from the case detail, stance SUPPORTS or CONTRADICTS).
- ADD_EVIDENCE / ATTACH_FINDINGS to bring in material the case is missing, ADD_NOTE for analyst-readable observations, CHANGE_STATUS when warranted.`
      : `Your job in this cycle: manage INVESTIGATION CASES based on inquiries with new matches.`,
    `Rules:
1. Check existing open cases first. If a case already investigates the topic, UPDATE_CASE: add hypotheses, attach findings, add evidence, add notes, link inquiries, adjust status/severity — whatever moves the investigation forward.
2. CREATE_CASE only for a coherent new investigation that no open case covers. Give it a precise title, a description stating the investigation question, and LINK_INQUIRY + ATTACH_FINDINGS operations so it starts with substance.
3. Hypotheses are the heart of every case. A case you CREATE must include at least one ADD_HYPOTHESIS operation (title + a testable statement + confidence 0–1). When you UPDATE a case that has no hypothesis yet, add one. When evidence accumulates, move hypotheses with UPDATE_HYPOTHESIS (SUPPORTED/REFUTED + new confidence) — never leave them stale.
4. Use ADD_NOTE for analyst-readable observations about what this scan changed.
5. Connect the dots with CREATE_EDGE: when two assets in the context share the same matched value, when one asset clearly references another, or when a finding ties two pieces of evidence together, add an edge (fromType/fromId → toType/toId with a relationType such as REFERENCES, MENTIONS, SENT_TO). Only use asset/finding ids that appear in the provided context. Edges make the case graph tell the story — prefer one good edge over none. REMOVE_EDGE (edgeId) disconnects a MANUAL edge the data no longer supports.
6. Tie evidence to hypotheses with LINK_SUPPORT: threadId of the hypothesis + targetType ("evidence" or "finding") + targetId, with stance SUPPORTS or CONTRADICTS — a hypothesis without linked support is just a guess.
7. Only reference ids that appear in the provided context. Never invent ids.
8. If nothing should change, return exactly one NO_ACTION decision explaining why.
9. Propose memoryWrites (GLOSSARY / DECISION_PRECEDENT) that improve future cycles.`,
    guidance ? `Operator guidance for case management:\n${guidance}` : '',
    outputContract(caseDecisionSchema, CASE_OUTPUT_EXAMPLE),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildCaseUserPrompt(input: {
  sourceName: string;
  manual: boolean;
  instruction: string | null;
  part?: { index: number; total: number };
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
  closedCases: Array<{
    id: string;
    title: string;
    status: string;
    conclusion: string | null;
  }>;
  focusCase?: FocusedCaseDetail | null;
  memories: RecalledMemory[];
}): string {
  return [
    input.focusCase
      ? `## FOCUSED CASE — work on this case (caseId ${input.focusCase.id})\n` +
        `Every id below is real and may be referenced in operations: hypothesis threadIds, evidenceIds, caseFindingIds/findingIds, assetIds and edgeIds.\n` +
        json(input.focusCase)
      : '',
    input.manual
      ? `## Manual review requested by the operator\nScope: ${input.sourceName}. Candidate inquiries include ALL with current matches — this is not a scan delta.`
      : `## Scan that just finished\nSource: ${input.sourceName}`,
    input.instruction
      ? `## Operator instruction for THIS cycle (highest priority — follow it)\n${input.instruction}`
      : '',
    partNote(input.part),
    `## Candidate inquiries (matches and/or flagged case-ready)`,
    json(
      input.candidateInquiries.map((q) => ({
        ...compactInquiry(q),
        caseReadySignal: q.caseReadySignal,
        sampleMatches: q.sampleMatches,
      })),
    ),
    `## Open cases (${input.openCases.length})`,
    json(input.openCases),
    input.closedCases.length > 0
      ? `## Recently CLOSED cases with their conclusions (solved topics — do not reopen; learn from how they were resolved)\n` +
        json(
          input.closedCases.map((c) => ({
            title: c.title,
            status: c.status,
            ...(c.conclusion ? { conclusion: c.conclusion.slice(0, 300) } : {}),
          })),
        )
      : '',
    `## Your memories`,
    json(input.memories),
    `Respond with the decision JSON.`,
  ]
    .filter(Boolean)
    .join('\n\n');
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

// ── Dream agent (memory consolidation) ───────────────────────────────────────

export function buildDreamSystemPrompt(): string {
  return [
    DOMAIN_PRIMER,
    `Your job in this cycle: DREAM — consolidate your own long-term memory. No inquiry or case is touched; you only maintain the memory store that future cycles recall from.
Rules:
1. DELETE noise: one-off observations tied to a single scan, stale facts, entries about inquiries/cases that no longer exist, anything that will not improve a future decision.
2. MERGE duplicates: when several entries say the same thing, rewrite the strongest one into a single crisp lesson and delete the rest.
3. REWRITE verbose entries into short, generalized lessons (what to do next time, not what happened once).
4. KEEP operator-set knowledge: entries recording operator deletions or explicit corrections (e.g. "operator deleted …", "do not recreate …") are sacred — never delete or weaken them.
5. KEEP topic→inquiry mappings that point at inquiries which still exist; they are your main duplicate-prevention tool.
6. CREATE at most a few new entries that distill the recent run summaries into important notes and decision precedents.
7. Every operation needs a rationale an analyst can audit. The "summary" is your dream journal entry: what you cleaned up and the important notes you took.`,
    dreamOutputContract(dreamConsolidationSchema, DREAM_OUTPUT_EXAMPLE),
  ].join('\n\n');
}

export function buildDreamUserPrompt(input: {
  memories: Array<{
    id: string;
    kind: string;
    key: string;
    content: string;
    tags: string[];
    weight: number;
    updatedAt: Date;
  }>;
  recentRuns: Array<{
    agentKind: string;
    status: string;
    summary: string | null;
    finishedAt: Date | null;
  }>;
  liveInquiryTitles: string[];
  openCaseTitles: string[];
  part?: { index: number; total: number };
}): string {
  return [
    `You are dreaming: review and consolidate your memory store.`,
    partNote(input.part),
    `## Your memory entries (${input.memories.length})`,
    json(input.memories),
    `## Recent run summaries (for new notes/precedents)`,
    json(input.recentRuns),
    `## Inquiries that still exist (titles)`,
    json(input.liveInquiryTitles),
    `## Open cases (titles)`,
    json(input.openCaseTitles),
    `Respond with the consolidation JSON.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function dreamOutputContract(schema: JsonSchema, example: unknown): string {
  return [
    `## Output format (STRICT)`,
    `Your entire response must be ONE JSON object that validates against this JSON Schema. ` +
      `Top-level keys are exactly "deletions", "rewrites", "creations" (arrays, may be empty) and "summary" (string). ` +
      `No other top-level keys. No additional properties anywhere. Only reference memory ids that appear in the provided entries.`,
    'JSON Schema:',
    JSON.stringify(schema),
    'Minimal valid example:',
    JSON.stringify(example, null, 1),
  ].join('\n');
}

/**
 * When the data exceeds the context window it is assessed in parts; the model
 * must not assume the visible slice is everything.
 */
function partNote(part?: { index: number; total: number }): string {
  if (!part || part.total <= 1) return '';
  return (
    `## Note: data part ${part.index} of ${part.total}\n` +
    `The data below is one slice of a larger set; the other slices are assessed in separate calls. ` +
    `Judge only what you see, rely on the existing-inquiry list and your topic-map memories to avoid duplicates across parts.`
  );
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 1);
}
