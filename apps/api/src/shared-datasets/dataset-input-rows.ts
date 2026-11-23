import type { RowFilter } from '../data-query/row-filters';

/**
 * How many of an input's rows a shared dataset's owning group reads (DQ
 * §5.12: inputs are read with the group's row filters, §5.10): every row, the
 * rows its rules select, or none — filtering is on and no rule is for the
 * group, which fails closed.
 */
export type GroupRows = 'all' | 'filtered' | 'none';

export function groupRowsOf(
  table: { rowFilter?: RowFilter } | undefined,
): GroupRows | null {
  if (!table) return null;
  const filter = table.rowFilter;
  if (!filter) return 'all';
  if (!filter.anyOf.length) return 'none';
  // A rule without conditions selects every row.
  return filter.anyOf.some((conditions) => !conditions.length)
    ? 'all'
    : 'filtered';
}

/**
 * Inputs the owning group reads no row of. A dataset over such an input
 * shares, then silently answers without that table's rows, so it is refused
 * like an input the group cannot query.
 */
export function rowProblems(
  inputs: readonly { sqlName: string; groupRows: GroupRows | null }[],
): string[] {
  const none = inputs.filter((input) => input.groupRows === 'none');
  if (!none.length) return [];
  return [
    `The owning group reads no row of ${none.map((i) => i.sqlName).join(', ')}: row filtering is on there and no rule is for the group. Add one in the table’s Rows step, or pick another owning group.`,
  ];
}
