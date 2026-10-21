import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chooseMatch,
  FIGURE_SEPARATORS,
  type LexicalChunkHit,
} from './chunk-lexical';

describe('chooseMatch', () => {
  const meaning = { score: 0.82, page: 185, text: 'passage by meaning' };
  const words = (over: Partial<LexicalChunkHit> = {}): LexicalChunkHit => ({
    id: 'asset-1',
    score: 9,
    page: 116,
    text: 'passage by words',
    exact: false,
    ...over,
  });

  it('shows nothing for an asset neither half found', () => {
    expect(chooseMatch(undefined, undefined)).toBeUndefined();
  });

  it('keeps the passage meaning chose when the words found nothing', () => {
    expect(chooseMatch(meaning, undefined)).toEqual({
      ...meaning,
      via: 'meaning',
    });
  });

  it('keeps the passage meaning chose over words that hold no exact figure', () => {
    expect(chooseMatch(meaning, words())).toEqual({
      ...meaning,
      via: 'meaning',
    });
  });

  it('shows the passage the words found when meaning has none for the asset', () => {
    expect(chooseMatch(undefined, words())).toEqual({
      score: null,
      page: 116,
      text: 'passage by words',
      via: 'words',
    });
  });

  it('prefers the passage with the exact figures over the one meaning chose', () => {
    expect(chooseMatch(meaning, words({ exact: true }))).toEqual({
      score: null,
      page: 116,
      text: 'passage by words',
      via: 'words',
    });
  });
});

describe('figure squeezing', () => {
  const migration = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20261021120000_asset_chunk_text_tsv/migration.sql',
    ),
    'utf8',
  );

  it('squeezes the question with the very pattern the stored words were squeezed with', () => {
    // The passages are squeezed in the database (a generated column), the
    // question here. If the two drift, "10,114.8" stops finding "10 ,114 . 8".
    expect(migration).toContain(`'${FIGURE_SEPARATORS}', '\\1', 'g'`);
  });

  it('indexes the column the search reads', () => {
    expect(migration).toContain('"text_tsv" tsvector');
    expect(migration).toContain('GENERATED ALWAYS AS');
    expect(migration).toContain('USING GIN ("text_tsv")');
  });

  it('drops a separator between digits and nothing else', () => {
    const squeeze = (text: string) =>
      text.replace(new RegExp(FIGURE_SEPARATORS, 'g'), '$1');
    expect(squeeze('10,114.8')).toBe('101148');
    // a PDF converter's spacing
    expect(squeeze('Total assets 10 ,114 . 8 8 , 821 . 4')).toBe(
      'Total assets 101148 88214',
    );
    // table columns stay apart; sentences keep their punctuation
    expect(squeeze('8 821 9 505')).toBe('8 821 9 505');
    expect(squeeze('net cash, in total. Next')).toBe(
      'net cash, in total. Next',
    );
  });
});
