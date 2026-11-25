import { tableFromIPC, type Table, type Vector } from 'apache-arrow';
import { dataRow, type FieldDescription } from './pg-protocol';
import {
  type ArrowFieldType,
  EncodeError,
  type PlainValue,
  encodeValue,
  plainValue,
} from './pg-types';

/** A data statement failed: what the client is told, as PostgreSQL would. */
export class DataError extends Error {
  constructor(
    readonly sqlState: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Tabular result rows ready for on-demand PostgreSQL wire `DataRow` encoding.
 *
 * Keeps columnar Apache Arrow vectors directly in memory (SG §5.1) instead of
 * materialising boxed JS `PlainValue[][]` arrays, so only the sliced page sent
 * on the wire is ever converted to wire frames and the IPC buffer is freed as
 * soon as the portal or cursor closes.
 */
export interface DataRows {
  readonly numRows: number;
  readonly numCols: number;
  /** Encode row `rowIndex` directly into a PG wire `DataRow` frame. */
  encodeRow(rowIndex: number, fields: readonly FieldDescription[]): Buffer;
}

function encodeCell(value: PlainValue, field: FieldDescription): Buffer | null {
  try {
    return encodeValue(value, field.typeOid, field.format);
  } catch (error) {
    if (error instanceof EncodeError) {
      throw new DataError('22P03', `Column ${field.name}: ${error.message}`);
    }
    throw new DataError(
      '22P03',
      `Column ${field.name}: the value does not fit its type.`,
    );
  }
}

function assertColumnCount(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new DataError(
      'XX000',
      `The result has ${actual} columns, the catalog says ${expected}: rescan the source.`,
    );
  }
}

/** Columnar Apache Arrow IPC stream → on-demand `DataRow` encoder (zero `PlainValue[][]`). */
export function arrowRows(bytes: Buffer): DataRows {
  const table: Table = tableFromIPC(bytes);
  const columns: { vector: Vector; type: ArrowFieldType }[] =
    table.schema.fields.map((field, i) => ({
      vector: table.getChildAt(i)!,
      type: field.type,
    }));
  const numRows = table.numRows;
  const numCols = columns.length;
  return {
    numRows,
    numCols,
    encodeRow(rowIndex: number, fields: readonly FieldDescription[]): Buffer {
      assertColumnCount(numCols, fields.length);
      const values = new Array<Buffer | null>(numCols);
      for (let c = 0; c < numCols; c += 1) {
        const col = columns[c];
        values[c] = encodeCell(
          plainValue(col.vector.get(rowIndex), col.type),
          fields[c],
        );
      }
      return dataRow(values);
    },
  };
}

/** In-memory `PlainValue[][]` adapter (used by tests and mock runners). */
export function plainRows(rows: readonly (readonly PlainValue[])[]): DataRows {
  const numRows = rows.length;
  const numCols = rows[0]?.length ?? 0;
  return {
    numRows,
    numCols,
    encodeRow(rowIndex: number, fields: readonly FieldDescription[]): Buffer {
      const row = rows[rowIndex];
      assertColumnCount(row.length, fields.length);
      const values = new Array<Buffer | null>(row.length);
      for (let c = 0; c < row.length; c += 1) {
        values[c] = encodeCell(row[c], fields[c]);
      }
      return dataRow(values);
    },
  };
}
