import { CLS_ORG_ID, CLS_PERSON } from '../identity/iam-access-policy';
import { effectiveColumnPolicy } from '../data-query/column-masks';
import { GovernanceService } from './governance.service';

/**
 * `asset.govern` is not `data.unmask` (docs/prd/DQ-data-query.md §5.8): an
 * admin or curator who does not read a table in clear may make its columns
 * stricter, and may name others to answer for it, but may neither make a
 * column show more nor name themselves owner or steward (who read in clear).
 */

const STOP = new Error('stop: past the checks');

function column(input: {
  access?: 'clear' | 'mask' | 'hide' | null;
  maskKind?: 'redact' | 'partial' | 'hash' | 'null' | null;
  classification?: string | null;
  derived?: 'personal' | 'sensitive' | 'secret' | null;
}) {
  const access = input.access ?? null;
  const maskKind = input.maskKind ?? null;
  const classification = input.classification ?? null;
  const derived = input.derived ?? null;
  return {
    name: 'email',
    type: 'VARCHAR',
    businessName: null,
    description: null,
    term: null,
    criticalDataElement: false,
    classification,
    derivedClassification: derived,
    effectiveClassification: classification ?? derived,
    findings: [],
    access,
    maskKind,
    effectiveAccess: effectiveColumnPolicy({
      access,
      maskKind,
      classification: classification ?? derived,
    }),
    reviewedAt: null,
    reviewedBy: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function service(input: {
  capabilities?: string[];
  unmaskAssets?: string[];
  /** Roles the caller (user:ana) holds, as governanceRole rows. */
  holds?: { scopeType: 'ASSET' | 'SOURCE'; scopeId: string; role: string }[];
  state?: ReturnType<typeof column>;
}) {
  const caps = new Set(input.capabilities ?? ['asset.govern', 'data.query']);
  const holds = input.holds ?? [];
  const prisma = {
    asset: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'a-1', sourceId: 's-1', name: 'contacts' }),
    },
    governanceRole: {
      findMany: jest.fn(
        ({ where }: { where: { role?: unknown; scopeId?: string } }) =>
          Promise.resolve(
            // governedDataScope asks by role and person; rows() by scope.
            typeof where.role === 'object'
              ? holds.filter((h) => h.role === 'OWNER' || h.role === 'STEWARD')
              : holds
                  .filter((h) => h.scopeId === where.scopeId)
                  .map((h) => ({
                    ...h,
                    principalRef: 'user:ana',
                    dateOut: null,
                  })),
          ),
      ),
    },
    assetColumnAnnotation: {
      findUnique: jest.fn().mockRejectedValue(STOP),
    },
    $transaction: jest.fn().mockRejectedValue(STOP),
  };
  const values: Record<string, unknown> = {
    [CLS_PERSON]: { actorRef: 'user:ana', groupIds: ['g-1'] },
    [CLS_ORG_ID]: 'org-1',
  };
  const cls = { isActive: () => true, get: (key: string) => values[key] };
  const actors = { current: () => ({ ref: 'user:ana', id: 'user:ana' }) };
  const policy = {
    check: jest.fn((_actor: unknown, capability: string) => ({
      allow: caps.has(capability),
    })),
    capabilities: jest.fn().mockResolvedValue(caps),
    resourceGrants: (capability: string) =>
      capability === 'data.unmask'
        ? { sourceIds: [], assetIds: input.unmaskAssets ?? [] }
        : { sourceIds: [], assetIds: [] },
  };
  const columns = {
    state: jest.fn().mockResolvedValue({
      columns: [input.state ?? column({ derived: 'personal' })],
      removed: [],
      findingsWithoutColumn: 0,
    }),
  };
  const identity = {
    membership: {
      members: jest.fn().mockResolvedValue([{ id: 'ana' }, { id: 'ben' }]),
      groups: jest.fn().mockResolvedValue([{ id: 'g-1' }, { id: 'g-2' }]),
    },
  };
  return new GovernanceService(
    prisma as never,
    cls as never,
    actors as never,
    {} as never,
    {} as never,
    columns as never,
    {} as never,
    {} as never,
    {} as never,
    policy,
    identity as never,
  );
}

const code = (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.().code;

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'done';
  } catch (error) {
    if (error === STOP) return 'allowed';
    return code(error) ?? String(error);
  }
}

describe('column access needs clear reading to show more', () => {
  it.each([
    ['clear instead of masked', { access: 'clear' }],
    ['last four instead of redacted', { access: 'mask', maskKind: 'partial' }],
    ['hashed instead of redacted', { maskKind: 'hash' }],
    ['a lower classification', { classification: 'public' }],
  ])('refuses %s to an admin who does not unmask', async (_, body) => {
    expect(
      await outcome(() => service({}).updateColumn('a-1', 'email', body)),
    ).toBe('UNMASK_REQUIRED');
  });

  it.each([
    ['hidden instead of masked', { access: 'hide' }],
    ['emptied instead of redacted', { maskKind: 'null' }],
    ['a higher classification', { classification: 'secret' }],
    ['a description', { description: 'Where we write to them' }],
  ])('lets the same admin make it %s', async (_, body) => {
    expect(
      await outcome(() => service({}).updateColumn('a-1', 'email', body)),
    ).toBe('allowed');
  });

  it.each([
    [
      'data.unmask on the workspace',
      { capabilities: ['asset.govern', 'data.unmask'] },
    ],
    ['an unmasked grant on the table', { unmaskAssets: ['a-1'] }],
    [
      'the steward role on the table',
      {
        capabilities: ['data.query'],
        holds: [
          { scopeType: 'ASSET' as const, scopeId: 'a-1', role: 'STEWARD' },
        ],
      },
    ],
  ])('lets someone with %s show more', async (_, setup) => {
    expect(
      await outcome(() =>
        service(setup).updateColumn('a-1', 'email', { access: 'clear' }),
      ),
    ).toBe('allowed');
  });
});

describe('naming owners and stewards', () => {
  it.each([
    ['themselves as steward', 'STEWARD', 'user:ana'],
    ['themselves as owner', 'OWNER', 'user:ana'],
    ['a group of theirs as steward', 'STEWARD', 'group:g-1'],
  ])('refuses an admin who does not unmask naming %s', async (_, role, ref) => {
    expect(
      await outcome(() => service({}).assignAssetRole('a-1', role, ref)),
    ).toBe('UNMASK_REQUIRED');
  });

  it.each([
    ['someone else as steward', 'STEWARD', 'user:ben'],
    ['someone else as owner', 'OWNER', 'user:ben'],
    ['a group of theirs as custodian', 'CUSTODIAN', 'group:g-1'],
  ])('lets the same admin name %s', async (_, role, ref) => {
    expect(
      await outcome(() => service({}).assignAssetRole('a-1', role, ref)),
    ).toBe('allowed');
  });

  it('lets an admin who unmasks name themselves', async () => {
    expect(
      await outcome(() =>
        service({
          capabilities: ['asset.govern', 'data.unmask'],
        }).assignAssetRole('a-1', 'STEWARD', 'user:ana'),
      ),
    ).toBe('allowed');
  });
});
