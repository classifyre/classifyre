import { parseActorRef } from '../identity/actor-ref';

/**
 * The rules of governed data assets (docs/prd/GOV-governed-data-assets.md
 * §4, §5.1), free of the database so they can be tested on their own.
 */
export type GovernanceRoleKind = 'OWNER' | 'STEWARD' | 'CUSTODIAN';
export type GovernanceScopeKind = 'SOURCE' | 'ASSET';
export type GovernanceStatusKind =
  | 'DRAFT'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'RETIRED';

export const GOVERNANCE_ROLES: readonly GovernanceRoleKind[] = [
  'OWNER',
  'STEWARD',
  'CUSTODIAN',
];
export const GOVERNANCE_STATUSES: readonly GovernanceStatusKind[] = [
  'DRAFT',
  'ACTIVE',
  'DEPRECATED',
  'RETIRED',
];

export interface RoleRow {
  id: string;
  scopeType: GovernanceScopeKind;
  scopeId: string;
  role: GovernanceRoleKind;
  principalRef: string;
  dateIn: Date;
  dateOut: Date | null;
  replacedByRef: string | null;
  assignedBy: string | null;
  removedBy: string | null;
}

export interface EffectiveRole extends RoleRow {
  /** Set on the asset's source, not on the asset (R2). */
  inherited: boolean;
}

/** The signed-in person: their `user:` ref and every group they are in. */
export interface GovernancePerson {
  actorRef: string;
  groupIds: readonly string[];
}

/**
 * Why `principalRef` cannot hold `role`, or null (R1): an owner is one
 * person, a custodian is a team, a steward is either.
 */
export function principalError(
  role: GovernanceRoleKind,
  principalRef: string,
): string | null {
  const parsed = parseActorRef(principalRef);
  if (parsed.kind !== 'user' && parsed.kind !== 'group') {
    return 'Name a person (user:<id>) or a group (group:<id>).';
  }
  if (parsed.via) return 'Name a person or a group, not a token.';
  if (role === 'OWNER' && parsed.kind !== 'user') {
    return 'The owner is one person: accountability needs a name.';
  }
  if (role === 'CUSTODIAN' && parsed.kind !== 'group') {
    return 'The custodian is a team: name a group.';
  }
  return null;
}

const isOpen = (row: RoleRow) => row.dateOut === null;

/**
 * The roles that apply to an asset (R2): per kind, the asset's own open rows,
 * or else its source's, marked inherited. An asset that names its own steward
 * no longer shows the source's stewards.
 */
export function effectiveRoles(
  assetRows: readonly RoleRow[],
  sourceRows: readonly RoleRow[],
): EffectiveRole[] {
  const out: EffectiveRole[] = [];
  for (const kind of GOVERNANCE_ROLES) {
    const own = assetRows.filter((row) => row.role === kind && isOpen(row));
    const rows = own.length
      ? own.map((row) => ({ ...row, inherited: false }))
      : sourceRows
          .filter((row) => row.role === kind && isOpen(row))
          .map((row) => ({ ...row, inherited: true }));
    out.push(...rows.sort((a, b) => a.dateIn.getTime() - b.dateIn.getTime()));
  }
  return out;
}

/** Whether the person is named in one of `rows` (directly, or through a group). */
export function holdsRole(
  rows: readonly RoleRow[],
  person: GovernancePerson | null,
  kinds: readonly GovernanceRoleKind[] = ['OWNER', 'STEWARD'],
): boolean {
  if (!person) return false;
  const refs = new Set([
    person.actorRef,
    ...person.groupIds.map((id) => `group:${id}`),
  ]);
  return rows.some(
    (row) =>
      isOpen(row) && kinds.includes(row.role) && refs.has(row.principalRef),
  );
}

/**
 * Who may change an asset's or a source's governance (R3): `asset.govern` on
 * the workspace, or an open OWNER or STEWARD row on the asset or its source.
 * Inheritance does not narrow this: a source's steward keeps the right on an
 * asset that names its own.
 */
export function canGovern(input: {
  hasCapability: boolean;
  person: GovernancePerson | null;
  rows: readonly RoleRow[];
}): boolean {
  return input.hasCapability || holdsRole(input.rows, input.person);
}

/**
 * The lifecycle an asset shows (§4): none while nobody owns it — it is not
 * governed, whatever was written before — else its record's status, DRAFT
 * when it has no record yet (an owner inherited from the source).
 */
export function effectiveStatus(
  record: { status: GovernanceStatusKind } | null,
  hasOwner: boolean,
): GovernanceStatusKind | null {
  if (!hasOwner) return null;
  return record?.status ?? 'DRAFT';
}

export interface ChecklistItem {
  key:
    | 'owner'
    | 'steward'
    | 'description'
    | 'meaning'
    | 'classification'
    | 'certified';
  done: boolean;
}

/** What is still missing to be fully governed (§4), computed, never stored. */
export function checklist(input: {
  roles: readonly EffectiveRole[];
  description: string | null | undefined;
  approvedTerms: number;
  status: GovernanceStatusKind | null;
  /**
   * For tables: whether every column findings classify has been reviewed by
   * a steward. Undefined for assets without columns (no such item).
   */
  classificationReviewed?: boolean;
}): ChecklistItem[] {
  const has = (kind: GovernanceRoleKind) =>
    input.roles.some((role) => role.role === kind);
  return [
    { key: 'owner', done: has('OWNER') },
    { key: 'steward', done: has('STEWARD') },
    { key: 'description', done: Boolean(input.description?.trim()) },
    { key: 'meaning', done: input.approvedTerms > 0 },
    ...(input.classificationReviewed === undefined
      ? []
      : [
          {
            key: 'classification' as const,
            done: input.classificationReviewed,
          },
        ]),
    { key: 'certified', done: input.status === 'ACTIVE' },
  ];
}

// ── Column classification (GOV §5.1, R6) ────────────────────────────────────

/**
 * What a column holds, from least to most guarded. Stewards pick from all of
 * them; findings derive only the last three. ODCS `classification` is free
 * text; these are the values Classifyre writes.
 */
export const CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'personal',
  'sensitive',
  'secret',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** PII types that identify a person or reach their money or their state. */
const SENSITIVE_PII = new Set([
  'CREDIT_CARD',
  'IBAN_CODE',
  'US_SSN',
  'US_PASSPORT',
  'US_BANK_NUMBER',
  'US_DRIVER_LICENSE',
  'US_ITIN',
  'UK_NHS',
  'MEDICAL_LICENSE',
  'CRYPTO',
]);

export interface ColumnFindingGroup {
  detectorType: string;
  findingType: string;
  count: number;
  maxSeverity: string;
}

/**
 * The classification open findings give a column: a secret makes it
 * `secret`; a national id, card or account number `sensitive`; any other
 * personal data `personal`; nothing else classifies.
 */
export function deriveClassification(
  groups: readonly ColumnFindingGroup[],
): Classification | null {
  let best: Classification | null = null;
  const rank = (value: Classification | null) =>
    value ? CLASSIFICATIONS.indexOf(value) : -1;
  for (const group of groups) {
    const label: Classification | null =
      group.detectorType === 'SECRETS'
        ? 'secret'
        : group.detectorType === 'PII'
          ? SENSITIVE_PII.has(group.findingType.toUpperCase())
            ? 'sensitive'
            : 'personal'
          : null;
    if (rank(label) > rank(best)) best = label;
  }
  return best;
}

/**
 * Whether a steward has reviewed every column the findings classify (the
 * checklist item): a confirmed or overridden classification on each.
 */
export function classificationReviewed(
  columns: readonly {
    derived: Classification | null;
    reviewedAt: Date | null;
  }[],
): boolean {
  return columns.every((column) => !column.derived || column.reviewedAt);
}
