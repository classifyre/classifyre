import { readersWithoutRows } from './row-coverage';

/**
 * Found 2026-11-23 (Kestrel & Finch battle test): the tenant admin, and a
 * shared dataset's owning group, read no row of a filtered table and nobody
 * was told. The Rows step now names who would see nothing.
 */
describe('readers a row filter leaves with no rows', () => {
  const table = { assetId: 'a1', sourceId: 's1', namespaceId: 'ns' };
  const grant = (
    subjectId: string,
    path: string,
    roleKey: string,
    scopeType = 'workspace',
    scopeId = 'ns',
  ) => ({ subjectId, subjectLabel: path, roleKey, scopeType, scopeId });
  const grants = [
    grant('g-admins', '/admins', 'tenant-admin', 'tenant', 't1'),
    grant(
      'g-dach',
      '/sales/sales-dach',
      'data-reader-unmasked',
      'asset',
      'ns/a1',
    ),
    grant('g-mkt', '/marketing', 'data-reader', 'asset', 'ns/a1'),
    grant('g-mkt', '/marketing', 'viewer'),
    grant('g-dpo', '/privacy-office', 'data-reader', 'source', 'ns/s1'),
    grant('g-fin', '/finance', 'data-reader', 'source', 'ns/s2'),
    grant('g-bi', '/bi-analysts', 'data-reader', 'asset', 'ns/a2'),
  ];
  const groups = new Map([
    ['g-sales', '/sales'],
    ['g-dach', '/sales/sales-dach'],
    ['g-mkt', '/marketing'],
  ]);

  it('names every group that may query the table and has no rule', () => {
    expect(
      readersWithoutRows({
        table,
        grants,
        ruleRefs: ['group:g-dach', 'group:g-mkt'],
        groupPaths: groups,
        stewardGroupIds: [],
      }).map((r) => r.path),
    ).toEqual(['/admins', '/privacy-office']);
  });

  it('counts a rule for a parent group for its subgroups', () => {
    expect(
      readersWithoutRows({
        table,
        grants,
        ruleRefs: ['group:g-sales', 'group:g-mkt'],
        groupPaths: groups,
        stewardGroupIds: ['g-dpo'],
      }).map((r) => r.path),
    ).toEqual(['/admins']);
  });

  it('names nobody when a rule is for everyone', () => {
    expect(
      readersWithoutRows({
        table,
        grants,
        ruleRefs: ['everyone'],
        groupPaths: groups,
        stewardGroupIds: [],
      }),
    ).toEqual([]);
  });
});
