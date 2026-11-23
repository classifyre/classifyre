import {
  HIDDEN_VALUE,
  hideValuesInText,
  redactFindingContent,
} from './finding-content';

/**
 * Found 2026-11-23 (Kestrel & Finch battle test): a Viewer who could query
 * nothing read every value the scans found — 511 IBANs, card numbers, social
 * insurance numbers, an AWS key — in the findings list, while SQL masked or
 * hid the same columns.
 */
describe('finding content in responses', () => {
  const finding = (assetId: string | null, extra: object = {}) => ({
    id: `f-${assetId}`,
    assetId,
    findingType: 'IBAN_CODE',
    matchedContent: 'AT48 3200 0000 1234 5864',
    redactedContent: 'AT48 **** **** **** 5864',
    contextBefore: 'refund to ',
    contextAfter: ' approved',
    ...extra,
  });

  it('keeps every value for someone who may read finding content', () => {
    const body = { items: [finding('a1')] };
    expect(redactFindingContent(body, () => true)).toEqual({
      changed: 0,
      body,
    });
  });

  it('replaces the value and drops the text around it where the reader may not see it', () => {
    const { body, changed } = redactFindingContent(
      { items: [finding('a1'), finding('a2')] },
      (f) => f.assetId === 'a2',
    );
    expect(changed).toBe(1);
    expect(body.items[0]).toEqual({
      id: 'f-a1',
      assetId: 'a1',
      findingType: 'IBAN_CODE',
      matchedContent: HIDDEN_VALUE,
      redactedContent: HIDDEN_VALUE,
      contentHidden: true,
    });
    expect(body.items[1].matchedContent).toBe('AT48 3200 0000 1234 5864');
  });

  it('finds findings nested anywhere: cases, graphs, search results', () => {
    const { body, changed } = redactFindingContent(
      {
        case: { evidence: [{ finding: finding('a1') }] },
        nodes: [[finding(null)]],
      },
      () => false,
    );
    expect(changed).toBe(2);
    expect(JSON.stringify(body)).not.toContain('5864');
  });

  it('leaves objects without matched content alone, and nulls as they are', () => {
    const input = {
      name: 'crm.contacts',
      matchedContent: null,
      nested: { x: 1 },
    };
    expect(redactFindingContent(input, () => false)).toEqual({
      changed: 0,
      body: input,
    });
  });

  it('does not change the object it was given', () => {
    const input = { items: [finding('a1')] };
    redactFindingContent(input, () => false);
    expect(input.items[0].matchedContent).toBe('AT48 3200 0000 1234 5864');
  });
});

describe('finding values in a tool result cut short', () => {
  it('hides every value, also in the cut-off last one', () => {
    const text =
      '{"items": [{"matchedContent": "AT48 3200 0000 1234 5864", "contextBefore": "pay \\"x\\" to"}, {"matchedContent": "AKIAZ7KESTREL';
    const hidden = hideValuesInText(text);
    expect(hidden).not.toContain('5864');
    expect(hidden).not.toContain('AKIA');
    expect(hidden).not.toContain('pay');
  });
});

describe("extractions (a code detector's fields from a finding)", () => {
  it('hides the extracted fields like a value', () => {
    const extraction = {
      id: 'x1',
      findingId: 'f1',
      assetId: 'a1',
      sourceId: 's1',
      pipelineResult: { iban: 'AT48 3200 0000 1234 5864', total: 1200 },
    };
    const { body, changed } = redactFindingContent(
      { items: [extraction] },
      () => false,
    );
    expect(changed).toBe(1);
    expect(body.items[0]).toEqual({
      id: 'x1',
      findingId: 'f1',
      assetId: 'a1',
      sourceId: 's1',
      pipelineResult: {},
      contentHidden: true,
    });
  });
});
