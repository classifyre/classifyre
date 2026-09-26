import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TRANSFER_TABLES } from './transfer-scopes';

/**
 * The import walks tables in ascending `order` and has no constraint deferral,
 * so a table written before one its foreign keys point at loses every row to a
 * foreign-key violation — silently, because the importer skips rows it cannot
 * insert. That is how case findings came to be imported before the evidence
 * they hang off. These tests read the foreign keys out of the schema itself,
 * so a new relation cannot land out of order unnoticed.
 */

interface Relation {
  field: string;
  /** Prisma model name of the referenced table. */
  target: string;
  columns: string[];
}

/** The owning side of every `@relation` in schema.prisma, per model. */
function schemaRelations(): Map<string, Relation[]> {
  const schema = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    'utf8',
  );
  const out = new Map<string, Relation[]>();
  for (const [, model, body] of schema.matchAll(
    /^model (\w+) \{([\s\S]*?)^\}/gm,
  )) {
    const relations: Relation[] = [];
    for (const line of body.split('\n')) {
      const field = line.match(/^\s*(\w+)\s+(\w+)\??\s+@relation\(([^)]*)\)/);
      // Only the side that holds the columns (`fields: [...]`) is a foreign key.
      const columns = field?.[3].match(/fields:\s*\[([^\]]*)\]/);
      if (!field || !columns) continue;
      relations.push({
        field: field[1],
        target: field[2],
        columns: columns[1].split(',').map((c) => c.trim()),
      });
    }
    out.set(model, relations);
  }
  return out;
}

/** Transfer specs name Prisma delegates: the model name, first letter lowered. */
const delegateOf = (model: string) =>
  model.charAt(0).toLowerCase() + model.slice(1);

describe('transfer table order', () => {
  const relations = schemaRelations();
  const modelByDelegate = new Map(
    [...relations.keys()].map((model) => [delegateOf(model), model]),
  );
  const specByDelegate = new Map(TRANSFER_TABLES.map((t) => [t.model, t]));

  it('names a real Prisma model for every table', () => {
    const unknown = TRANSFER_TABLES.filter(
      (t) => !modelByDelegate.has(t.model),
    );
    expect(unknown.map((t) => t.model)).toEqual([]);
  });

  it('imports every table after the tables its foreign keys point at', () => {
    const outOfOrder: string[] = [];
    for (const table of TRANSFER_TABLES) {
      for (const rel of relations.get(modelByDelegate.get(table.model)!) ??
        []) {
        const target = specByDelegate.get(delegateOf(rel.target));
        // Same-table references are sequenced by `selfRefs`, below.
        if (!target || target === table) continue;
        if (target.order >= table.order) {
          outOfOrder.push(
            `${table.model} (${table.order}).${rel.columns.join(',')} → ` +
              `${target.model} (${target.order})`,
          );
        }
      }
    }
    expect(outOfOrder).toEqual([]);
  });

  it('declares every same-table reference as a selfRef, so it is restored after its table', () => {
    const undeclared: string[] = [];
    for (const table of TRANSFER_TABLES) {
      for (const rel of relations.get(modelByDelegate.get(table.model)!) ??
        []) {
        if (delegateOf(rel.target) !== table.model) continue;
        for (const column of rel.columns) {
          if (!table.selfRefs?.includes(column)) {
            undeclared.push(`${table.model}.${column}`);
          }
        }
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('keeps every order unique, so the sequence never depends on sort stability', () => {
    const orders = TRANSFER_TABLES.map((t) => t.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
