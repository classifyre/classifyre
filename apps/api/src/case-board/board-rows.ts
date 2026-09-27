import { CaseStatus, Prisma } from '@prisma/client';

/**
 * Small row helpers shared by the board's read and write paths and by
 * automatic case clean-up. A leaf module on purpose: it imports nothing of the
 * application, so anything may use it without dragging in the services.
 */

type Db = Prisma.TransactionClient;

/** A closed case is a record: its board can be read, never changed. */
export const READ_ONLY_CASE_STATUSES: ReadonlySet<CaseStatus> = new Set([
  CaseStatus.CLOSED,
  CaseStatus.ARCHIVED,
]);

export function isReadOnlyCase(status: CaseStatus): boolean {
  return READ_ONLY_CASE_STATUSES.has(status);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : null;
}

/**
 * Detach the children of items that are leaving the board (members of a
 * frame, comment pins anchored to a bubble), converting their positions from
 * parent-relative to absolute so nothing jumps.
 *
 * Soft-deleted children are converted too: no row may point at a parent that
 * is gone, or restoring the child later would place it relative to nothing.
 */
export async function unparentChildren(
  tx: Db,
  boardId: string,
  parentIds: string[],
): Promise<string[]> {
  if (parentIds.length === 0) return [];
  const rows = await tx.caseBoardItem.findMany({
    where: { boardId },
    select: { id: true, parentId: true, x: true, y: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const absolute = (
    id: string,
    seen = new Set<string>(),
  ): { x: number; y: number } => {
    const row = byId.get(id);
    if (!row || seen.has(id)) return { x: 0, y: 0 };
    seen.add(id);
    const own = { x: row.x ?? 0, y: row.y ?? 0 };
    if (!row.parentId) return own;
    const parent = absolute(row.parentId, seen);
    return { x: parent.x + own.x, y: parent.y + own.y };
  };
  const leaving = new Set(parentIds);
  const moved: string[] = [];
  for (const child of rows) {
    if (!child.parentId || !leaving.has(child.parentId)) continue;
    const pos = absolute(child.id);
    await tx.caseBoardItem.update({
      where: { id: child.id },
      data: {
        parentId: null,
        x: child.x === null ? null : pos.x,
        y: child.y === null ? null : pos.y,
      },
    });
    moved.push(child.id);
  }
  return moved;
}
