import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { Prisma } from '@prisma/client';
import {
  BindingAsset,
  BindingFinding,
  assetTermsSql,
  buildLookupIndex,
  findingPredicateSql,
  findingTermsSql,
  matchAssetTerms,
  matchFindingTerms,
} from './binding-compiler';
import type { CompiledBinding } from './binding-spec';
import { glossaryNorm, matchKeysFor } from '../../glossary/glossary-norm';

/**
 * The binding compiler's two halves, run over one fixture (SL2 §4.6).
 *
 * The SQL half drives the linker, filters, watch candidate queries and
 * previews; the in-memory half drives Meaning cards and watch matching. They
 * must agree row for row, for every mode, with source scopes, split values,
 * Unicode edge cases and ambiguous lookups — otherwise a finding's Meaning card
 * says one thing and the term page another.
 *
 * Needs Postgres: set SEMANTIC_TEST_DATABASE_URL (any database the user may
 * create a schema in). The fixture lives in a throwaway schema with only the
 * columns the compiler reads, and `glossary_norm` is created from the
 * migration file itself so the spec cannot drift from what ships.
 */
const url = process.env.SEMANTIC_TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const SCHEME = 'scheme-rf';
const concepts = [
  { id: 'gmbh', term: 'GmbH', codes: ['GES'], aliases: ['Gesellschaft mit beschränkter Haftung'], hiddenAliases: [] },
  { id: 'ag', term: 'Aktiengesellschaft', codes: ['AG'], aliases: [], hiddenAliases: [] },
  { id: 'uebers', term: 'Überschuldung', codes: [], aliases: ['over-indebtedness'], hiddenAliases: [] },
  // Two concepts share the hidden alias "K": ambiguous under ANY.
  { id: 'kg', term: 'Kommanditgesellschaft', codes: ['KG'], aliases: [], hiddenAliases: ['K'] },
  { id: 'kap', term: 'Kapitalgesellschaft', codes: [], aliases: [], hiddenAliases: ['K'] },
  // Same code twice: ambiguous under CODES.
  { id: 'og1', term: 'Offene Gesellschaft', codes: ['OG'], aliases: [], hiddenAliases: [] },
  { id: 'og2', term: 'Offene Gesellschaft (alt)', codes: ['OG'], aliases: [], hiddenAliases: [] },
].map((concept) => ({
  ...concept,
  schemeId: SCHEME,
  matchKeys: matchKeysFor(concept),
}));

const findings: BindingFinding[] = [
  { id: 'f1', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'GES', status: 'OPEN' },
  { id: 'f2', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'AG', status: 'OPEN' },
  { id: 'f3', sourceId: 's2', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'GES, AG', status: 'OPEN' },
  { id: 'f4', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'EU', status: 'OPEN' },
  { id: 'f5', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'ＧＥＳ', status: 'OPEN' },
  { id: 'f6', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'GES', status: 'RESOLVED' },
  { id: 'f7', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'other', findingType: 'tag:legal_form', matchedContent: 'GES', status: 'OPEN' },
  { id: 'f8', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: ' ges ', status: 'OPEN' },
  { id: 'f9', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'K', status: 'OPEN' },
  { id: 'f10', sourceId: 's1', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:legal_form', matchedContent: 'OG', status: 'OPEN' },
  { id: 'f11', sourceId: 's2', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:status', matchedContent: '  ÜBERSCHULDUNG  ', status: 'OPEN' },
  { id: 'f12', sourceId: 's2', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:status', matchedContent: 'in   Liquidation', status: 'OPEN' },
  { id: 'f13', sourceId: 's1', detectorType: 'PII', customDetectorKey: null, findingType: 'IBAN_CODE', matchedContent: 'AT61 1904 3002 3457 3201', status: 'OPEN' },
  { id: 'f14', sourceId: 's2', detectorType: 'PII', customDetectorKey: null, findingType: 'IBAN_CODE', matchedContent: 'DE89 3704 0044 0532 0130 00', status: 'OPEN' },
  { id: 'f15', sourceId: 's1', detectorType: 'PII', customDetectorKey: null, findingType: 'EMAIL_ADDRESS', matchedContent: 'a@b.example', status: 'OPEN' },
  { id: 'f16', sourceId: 's1', detectorType: 'SECRETS', customDetectorKey: null, findingType: 'IBAN_CODE', matchedContent: 'x', status: 'OPEN' },
];

const assets: BindingAsset[] = [
  { id: 'a1', sourceId: 's1', metadata: { doc_type: 'contract' } },
  { id: 'a2', sourceId: 's1', metadata: { doc_type: ['Contract', 'memo'] } },
  { id: 'a3', sourceId: 's2', metadata: { doc_type: 'CONTRACT ' } },
  { id: 'a4', sourceId: 's1', metadata: { address: { country: 'AT' }, legal_form: 'GES' } },
  { id: 'a5', sourceId: 's1', metadata: null },
  { id: 'a6', sourceId: 's2', metadata: { doc_type: 5, legal_form: 'GES|AG' } },
  { id: 'a7', sourceId: 's1', metadata: { doc_type: { nested: 'contract' } } },
  { id: 'a8', sourceId: 's2', metadata: { legal_form: 'K' } },
];

function binding(partial: Partial<CompiledBinding> & Pick<CompiledBinding, 'id' | 'mode'>): CompiledBinding {
  return {
    detectorType: null,
    customDetectorKey: null,
    findingType: null,
    metadataPath: null,
    values: [],
    splitDelimiter: null,
    termId: null,
    lookupSchemeId: null,
    lookupMatch: null,
    noMeaning: false,
    sourceIds: [],
    confidence: 1,
    ...partial,
  };
}

const legalForm = { detectorType: 'CUSTOM' as const, customDetectorKey: 'fb', findingType: 'tag:legal_form' };
const bindings: CompiledBinding[] = [
  binding({ id: 'b-output', mode: 'OUTPUT', detectorType: 'PII', findingType: 'IBAN_CODE', termId: 'bank' }),
  binding({ id: 'b-output-scoped', mode: 'OUTPUT', detectorType: 'PII', findingType: 'IBAN_CODE', termId: 'bank', sourceIds: ['s2'] }),
  binding({ id: 'b-output-custom', mode: 'OUTPUT', ...legalForm, termId: 'company' }),
  binding({ id: 'b-values', mode: 'OUTPUT_VALUES', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:status', values: ['überschuldung', 'in liquidation'].map(glossaryNorm), termId: 'insolvency' }),
  binding({ id: 'b-values-split', mode: 'OUTPUT_VALUES', ...legalForm, values: ['ag'], splitDelimiter: ', ', termId: 'ag' }),
  binding({ id: 'b-lookup-codes', mode: 'OUTPUT_LOOKUP', ...legalForm, lookupSchemeId: SCHEME, lookupMatch: 'CODES' }),
  binding({ id: 'b-lookup-codes-split', mode: 'OUTPUT_LOOKUP', ...legalForm, lookupSchemeId: SCHEME, lookupMatch: 'CODES', splitDelimiter: ', ' }),
  binding({ id: 'b-lookup-any', mode: 'OUTPUT_LOOKUP', ...legalForm, lookupSchemeId: SCHEME, lookupMatch: 'ANY' }),
  binding({ id: 'b-lookup-any-status', mode: 'OUTPUT_LOOKUP', detectorType: 'CUSTOM', customDetectorKey: 'fb', findingType: 'tag:status', lookupSchemeId: SCHEME, lookupMatch: 'ANY', sourceIds: ['s2'] }),
  binding({ id: 'b-no-meaning', mode: 'OUTPUT', detectorType: 'PII', findingType: 'EMAIL_ADDRESS', noMeaning: true }),
  binding({ id: 'b-meta-values', mode: 'METADATA_VALUES', metadataPath: 'doc_type', values: ['contract'], termId: 'contract' }),
  binding({ id: 'b-meta-values-scoped', mode: 'METADATA_VALUES', metadataPath: 'doc_type', values: ['contract'], termId: 'contract', sourceIds: ['s1'] }),
  binding({ id: 'b-meta-nested', mode: 'METADATA_VALUES', metadataPath: 'address.country', values: ['at'], termId: 'austria' }),
  binding({ id: 'b-meta-number', mode: 'METADATA_VALUES', metadataPath: 'doc_type', values: ['5'], termId: 'five' }),
  binding({ id: 'b-meta-lookup', mode: 'METADATA_LOOKUP', metadataPath: 'legal_form', lookupSchemeId: SCHEME, lookupMatch: 'CODES', splitDelimiter: '|' }),
  binding({ id: 'b-meta-lookup-any', mode: 'METADATA_LOOKUP', metadataPath: 'legal_form', lookupSchemeId: SCHEME, lookupMatch: 'ANY' }),
];

const index = buildLookupIndex(concepts);

function pairsInMemory(b: CompiledBinding): string[] {
  const out: string[] = [];
  for (const finding of findings) {
    for (const term of matchFindingTerms(b, finding, index)) out.push(`${finding.id}:${term}`);
  }
  for (const asset of assets) {
    for (const term of matchAssetTerms(b, asset, index)) out.push(`${asset.id}:${term}`);
  }
  return out.sort();
}

describeDb('binding compiler conformance (SQL vs in-memory)', () => {
  const schema = `sl2_conformance_${process.pid}`;
  let pool: Pool;

  const query = async <T>(sql: Prisma.Sql): Promise<T[]> => {
    const result = await pool.query(sql.text, sql.values as unknown[]);
    return result.rows as T[];
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 1, options: `-c search_path=${schema},public` });
    const migration = readFileSync(
      join(__dirname, '../../../prisma/migrations/20261001120000_glossary_model/migration.sql'),
      'utf8',
    );
    const fn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION glossary_norm'),
      migration.indexOf('$$;', migration.indexOf('CREATE OR REPLACE FUNCTION glossary_norm')) + 3,
    );
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}, public`);
    await pool.query(fn);
    await pool.query(`CREATE TYPE "DetectorType" AS ENUM ('SECRETS','PII','YARA','BROKEN_LINKS','CODE_SECURITY','CUSTOM')`);
    await pool.query(`CREATE TABLE findings (
      id text PRIMARY KEY, source_id text, asset_id text, detector_type "DetectorType",
      custom_detector_key text, finding_type text, matched_content text, status text,
      severity text DEFAULT 'LOW', last_detected_at timestamptz DEFAULT now())`);
    await pool.query(`CREATE TABLE assets (id text PRIMARY KEY, source_id text, metadata jsonb)`);
    await pool.query(`CREATE TABLE glossary_terms (
      id text PRIMARY KEY, scheme_id text, kind text, status text,
      codes text[], match_keys text[])`);
    for (const f of findings) {
      await pool.query(
        `INSERT INTO findings (id, source_id, asset_id, detector_type, custom_detector_key, finding_type, matched_content, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [f.id, f.sourceId, `asset-${f.id}`, f.detectorType, f.customDetectorKey, f.findingType, f.matchedContent, f.status],
      );
    }
    for (const a of assets) {
      await pool.query(`INSERT INTO assets (id, source_id, metadata) VALUES ($1,$2,$3)`, [
        a.id,
        a.sourceId,
        a.metadata === null ? null : JSON.stringify(a.metadata),
      ]);
    }
    for (const c of concepts) {
      await pool.query(
        `INSERT INTO glossary_terms (id, scheme_id, kind, status, codes, match_keys) VALUES ($1,$2,'CONCEPT','APPROVED',$3,$4)`,
        [c.id, c.schemeId, c.codes, c.matchKeys],
      );
    }
    // The SQL normaliser and the TypeScript one agree on the fixture values.
    for (const value of [...findings.map((f) => f.matchedContent), 'Überschuldung', 'ＧＥＳ']) {
      const [row] = await query<{ v: string }>(Prisma.sql`SELECT glossary_norm(${value}) AS v`);
      expect(row.v).toBe(glossaryNorm(value));
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  });

  it.each(bindings.map((b) => [b.id, b]))('%s: rows agree', async (_id, b) => {
    const findingSql = findingTermsSql(b);
    const assetSql = assetTermsSql(b);
    const sqlPairs: string[] = [];
    if (findingSql) {
      const rows = await query<{ finding_id: string; term_id: string }>(findingSql);
      sqlPairs.push(...rows.map((row) => `${row.finding_id}:${row.term_id}`));
    }
    if (assetSql) {
      const rows = await query<{ asset_id: string; term_id: string }>(assetSql);
      sqlPairs.push(...rows.map((row) => `${row.asset_id}:${row.term_id}`));
    }
    expect([...new Set(sqlPairs)].sort()).toEqual([...new Set(pairsInMemory(b))].sort());
  });

  it.each(bindings.map((b) => [b.id, b]))('%s: predicate agrees', async (_id, b) => {
    const targets = [...new Set([b.termId, ...concepts.map((c) => c.id)].filter((t): t is string => Boolean(t)))];
    for (const term of targets) {
      const predicate = findingPredicateSql(b, [term]);
      const memory = findings
        .filter((f) => matchFindingTerms(b, f, index).includes(term))
        .map((f) => f.id)
        .sort();
      if (!predicate) {
        expect(memory).toEqual([]);
        continue;
      }
      const rows = await query<{ id: string }>(Prisma.sql`SELECT f.id FROM findings f WHERE ${predicate}`);
      expect(rows.map((row) => row.id).sort()).toEqual(memory);
    }
  });

  it('pins the expected outcomes of the fixture', () => {
    const codes = pairsInMemory(bindings.find((b) => b.id === 'b-lookup-codes')!);
    // GES and AG resolve; EU is unmatched; full-width ＧＥＳ is not a code;
    // OG names two concepts (ambiguous); resolved and other-detector findings never count.
    expect(codes).toEqual(['f1:gmbh', 'f2:ag'].sort());
    const any = pairsInMemory(bindings.find((b) => b.id === 'b-lookup-any')!);
    expect(any).toEqual(['f1:gmbh', 'f2:ag', 'f5:gmbh', 'f8:gmbh'].sort());
    const split = pairsInMemory(bindings.find((b) => b.id === 'b-lookup-codes-split')!);
    expect(split).toEqual(['f1:gmbh', 'f2:ag', 'f3:ag', 'f3:gmbh'].sort());
    expect(pairsInMemory(bindings.find((b) => b.id === 'b-no-meaning')!)).toEqual([]);
    expect(pairsInMemory(bindings.find((b) => b.id === 'b-meta-values')!)).toEqual(
      ['a1:contract', 'a2:contract', 'a3:contract'].sort(),
    );
    expect(pairsInMemory(bindings.find((b) => b.id === 'b-meta-lookup')!)).toEqual(
      ['a4:gmbh', 'a6:ag', 'a6:gmbh'].sort(),
    );
  });
});

describe('binding compiler (in memory)', () => {
  it('treats a hidden alias shared by two concepts as ambiguous', () => {
    const b = bindings.find((x) => x.id === 'b-lookup-any')!;
    expect(matchFindingTerms(b, findings.find((f) => f.id === 'f9')!, index)).toEqual([]);
  });

  it('never links through a "no meaning" binding', () => {
    const b = bindings.find((x) => x.id === 'b-no-meaning')!;
    expect(matchFindingTerms(b, findings.find((f) => f.id === 'f15')!, index)).toEqual([]);
  });

  it('respects source scopes', () => {
    const b = bindings.find((x) => x.id === 'b-output-scoped')!;
    expect(matchFindingTerms(b, findings.find((f) => f.id === 'f13')!, index)).toEqual([]);
    expect(matchFindingTerms(b, findings.find((f) => f.id === 'f14')!, index)).toEqual(['bank']);
  });
});
