import * as fs from 'fs';
import { resolveSchemaFile } from '../utils/schema-path';

type SourceSchema = {
  definitions?: {
    AssetType?: {
      enum?: readonly string[];
    };
  };
};

const schemaPath = resolveSchemaFile(__dirname, 'all_input_sources.json');

if (!fs.existsSync(schemaPath)) {
  throw new Error(`Source schema not found: ${schemaPath}`);
}

const sourceSchema = JSON.parse(
  fs.readFileSync(schemaPath, 'utf8'),
) as SourceSchema;
const sourceTypeValues = sourceSchema.definitions?.AssetType?.enum;

if (!Array.isArray(sourceTypeValues) || sourceTypeValues.length === 0) {
  throw new Error(
    'Invalid source type schema: definitions.AssetType.enum must be a non-empty array',
  );
}

export const SOURCE_TYPE_ENUM = sourceTypeValues as [string, ...string[]];
export type SourceType = (typeof SOURCE_TYPE_ENUM)[number];

const TABULAR_TYPES = new Set([
  'POSTGRESQL',
  'MYSQL',
  'MSSQL',
  'ORACLE',
  'HIVE',
  'DATABRICKS',
  'SNOWFLAKE',
]);

export function getSourceCategory(type: string): 'TABULAR' | 'UNSTRUCTURED' {
  return TABULAR_TYPES.has(type) ? 'TABULAR' : 'UNSTRUCTURED';
}
