/**
 * Repairs the recurring shape mistakes local models make before schema
 * validation: singular keys, nested memoryWrites, field/op-name synonyms.
 * Runs after JSON extraction; the lenient validator then strips anything
 * still unknown. Everything here is best-effort and side-effect free on
 * already-correct output.
 */

const OP_ALIASES: Record<string, string> = {
  ADD_FINDING: 'ATTACH_FINDINGS',
  ADD_FINDINGS: 'ATTACH_FINDINGS',
  LINK_FINDING: 'ATTACH_FINDINGS',
  LINK_FINDINGS: 'ATTACH_FINDINGS',
  CREATE_HYPOTHESIS: 'ADD_HYPOTHESIS',
  NEW_HYPOTHESIS: 'ADD_HYPOTHESIS',
  LINK_INQUIRIES: 'LINK_INQUIRY',
  ADD_INQUIRY: 'LINK_INQUIRY',
  SET_STATUS: 'CHANGE_STATUS',
  UPDATE_STATUS: 'CHANGE_STATUS',
  CHANGE_SEVERITY: 'CHANGE_STATUS',
  ADD_EDGE: 'CREATE_EDGE',
  LINK_EDGE: 'CREATE_EDGE',
  CONNECT: 'CREATE_EDGE',
  DELETE_EDGE: 'REMOVE_EDGE',
  DISCONNECT: 'REMOVE_EDGE',
  DISCONNECT_EDGE: 'REMOVE_EDGE',
  SUPPORT_HYPOTHESIS: 'LINK_SUPPORT',
  ASSIGN_TO_HYPOTHESIS: 'LINK_SUPPORT',
  LINK_EVIDENCE: 'LINK_SUPPORT',
  ADD_SUPPORT: 'LINK_SUPPORT',
  ADD_COMMENT: 'ADD_NOTE',
  ADD_OBSERVATION: 'ADD_NOTE',
};

const ACTION_ALIASES: Record<string, string> = {
  NONE: 'NO_ACTION',
  NOOP: 'NO_ACTION',
  NO_OP: 'NO_ACTION',
  SKIP: 'NO_ACTION',
  ENRICH_INQUIRY: 'ENRICH_INQUIRY_MATCHERS',
};

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Rename `from` → `to` when `to` is absent. */
function alias(o: Obj, from: string, to: string): void {
  if (o[to] === undefined && o[from] !== undefined) {
    o[to] = o[from];
    delete o[from];
  }
}

function normalizeEnum(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

function repairRationale(o: Obj): void {
  alias(o, 'reason', 'rationale');
  alias(o, 'reasoning', 'rationale');
  alias(o, 'justification', 'rationale');
  alias(o, 'explanation', 'rationale');
  // Rationale is mandatory — synthesize a stub rather than failing the run.
  if (typeof o.rationale !== 'string' || o.rationale.trim().length < 20) {
    o.rationale = `(model omitted rationale) ${String(o.rationale ?? '')}`.padEnd(
      20,
      '.',
    );
  }
}

/** Common envelope fixes shared by both agents' outputs. */
function repairEnvelope(value: unknown): Obj {
  let root: Obj;
  if (Array.isArray(value)) {
    root = { decisions: value };
  } else if (isObj(value)) {
    root = value;
  } else {
    return { decisions: [], memoryWrites: [] };
  }

  alias(root, 'decision', 'decisions');
  if (isObj(root.decisions)) root.decisions = [root.decisions];
  if (!Array.isArray(root.decisions)) root.decisions = [];

  // Hoist memoryWrites the model nested inside decisions.
  const hoisted: unknown[] = Array.isArray(root.memoryWrites)
    ? [...(root.memoryWrites as unknown[])]
    : [];
  for (const d of root.decisions as unknown[]) {
    if (isObj(d) && Array.isArray(d.memoryWrites)) {
      hoisted.push(...(d.memoryWrites as unknown[]));
      delete d.memoryWrites;
    }
  }
  root.memoryWrites = hoisted;

  for (const m of root.memoryWrites as unknown[]) {
    if (!isObj(m)) continue;
    alias(m, 'name', 'key');
    alias(m, 'value', 'content');
    if (m.kind !== undefined) m.kind = normalizeEnum(m.kind);
  }
  return root;
}

export function repairInquiryOutput(value: unknown): unknown {
  const root = repairEnvelope(value);
  for (const d of root.decisions as unknown[]) {
    if (!isObj(d)) continue;
    d.action = ACTION_ALIASES[normalizeEnum(d.action)] ?? normalizeEnum(d.action);
    repairRationale(d);
    alias(d, 'matchers', 'inquiry');
  }
  return root;
}

export function repairCaseOutput(value: unknown): unknown {
  const root = repairEnvelope(value);
  for (const d of root.decisions as unknown[]) {
    if (!isObj(d)) continue;
    d.action = ACTION_ALIASES[normalizeEnum(d.action)] ?? normalizeEnum(d.action);
    repairRationale(d);
    alias(d, 'ops', 'operations');
    if (!Array.isArray(d.operations)) continue;
    for (const op of d.operations as unknown[]) {
      if (!isObj(op)) continue;
      alias(op, 'operation', 'op');
      alias(op, 'type', 'op');
      op.op = OP_ALIASES[normalizeEnum(op.op)] ?? normalizeEnum(op.op);
      repairRationale(op);
      // ADD_NOTE / ADD_THREAD_ENTRY want `body` ("note" stays a real field
      // on ADD_EVIDENCE / LINK_SUPPORT — only alias it for note-like ops).
      if (op.op === 'ADD_NOTE' || op.op === 'ADD_THREAD_ENTRY') {
        alias(op, 'note', 'body');
      }
      alias(op, 'text', 'body');
      alias(op, 'message', 'body');
      alias(op, 'content', 'body');
      // Hypothesis threads are addressed by threadId.
      alias(op, 'hypothesisId', 'threadId');
      // CHANGE_STATUS synonyms.
      alias(op, 'status', 'caseStatus');
      // ATTACH_FINDINGS synonyms.
      alias(op, 'findings', 'findingIds');
      alias(op, 'inquiries', 'inquiryIds');
    }
  }
  return root;
}
