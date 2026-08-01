import {
  elideOldObservations,
  renderObservations,
  type Observation,
} from './agent-loop';
import type { AiMessage } from '../../ai';

/** A result whose JSON is comfortably larger than any per-call budget. */
function fatResult(chars: number): Observation {
  return {
    tool: 'findings.search',
    outcome: 'READ_OK',
    result: { findings: 'x'.repeat(chars) },
  };
}

function parse(rendered: string): Array<Record<string, unknown>> {
  const body = rendered.slice(rendered.indexOf('\n') + 1);
  return JSON.parse(body) as Array<Record<string, unknown>>;
}

describe('agent loop transcript budget', () => {
  describe('renderObservations', () => {
    it('leads with a header naming every call and its outcome', () => {
      const rendered = renderObservations(4, [
        { tool: 'findings.ranked', outcome: 'READ_OK', result: { a: 1 } },
        { tool: 'inquiries.create', outcome: 'APPLIED', result: { id: 'q1' } },
      ]);

      const header = rendered.split('\n')[0];
      expect(header).toContain('iteration 4');
      expect(header).toContain('findings.ranked → READ_OK');
      expect(header).toContain('inquiries.create → APPLIED');
    });

    it('passes small results through untouched', () => {
      const result = { findings: [{ id: 'f1' }], total: 1 };
      const parsed = parse(
        renderObservations(1, [
          { tool: 'findings.search', outcome: 'READ_OK', result },
        ]),
      );

      expect(parsed[0].result).toEqual(result);
    });

    it('caps a single oversized result and says so, rather than truncating silently', () => {
      const parsed = parse(renderObservations(1, [fatResult(200_000)]));

      const result = parsed[0].result as Record<string, unknown>;
      expect(result.truncated).toBe(true);
      expect(result.originalChars).toBeGreaterThan(200_000);
      // The model must be able to tell a cut-off list from a complete one.
      expect(String(result.note)).toMatch(/narrow the query/i);
      expect((result.preview as string).length).toBeLessThanOrEqual(8_000);
    });

    it('bounds the whole turn, not just each call', () => {
      const rendered = renderObservations(
        1,
        Array.from({ length: 10 }, () => fatResult(100_000)),
      );

      // Ten unbounded results would be a megabyte; the turn budget plus a small
      // per-call envelope is the real ceiling.
      expect(rendered.length).toBeLessThan(30_000);
    });

    it('gives every call a share, so one huge read does not starve the rest', () => {
      const parsed = parse(
        renderObservations(1, [
          fatResult(500_000),
          { tool: 'inquiries.list', outcome: 'READ_OK', result: { ok: true } },
        ]),
      );

      expect(parsed).toHaveLength(2);
      // The small one is still there in full.
      expect(parsed[1].result).toEqual({ ok: true });
      expect((parsed[0].result as Record<string, unknown>).truncated).toBe(
        true,
      );
    });

    it('survives a result that cannot be serialized', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      expect(() =>
        renderObservations(1, [
          { tool: 'x.y', outcome: 'READ_OK', result: cyclic },
        ]),
      ).not.toThrow();
    });
  });

  describe('elideOldObservations', () => {
    const turn = (i: number, payload: string): AiMessage[] => [
      { role: 'assistant', content: `{"thought":"turn ${i}"}` },
      {
        role: 'user',
        content: renderObservations(i, [
          { tool: 'findings.search', outcome: 'READ_OK', result: { payload } },
        ]),
      },
    ];

    const transcript = (turns: number): AiMessage[] => [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Mission: INQUIRY.' },
      ...Array.from({ length: turns }, (_, i) =>
        turn(i + 1, `payload-${i + 1}`),
      ).flat(),
    ];

    it('keeps the most recent turns verbatim', () => {
      const messages = transcript(6);
      elideOldObservations(messages);

      const observations = messages.filter(
        (m) => m.role === 'user' && m.content.startsWith('Tool results'),
      );
      const kept = observations.filter((m) => m.content.includes('payload-'));
      expect(kept.map((m) => m.content)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('payload-4'),
          expect.stringContaining('payload-5'),
          expect.stringContaining('payload-6'),
        ]),
      );
      expect(kept).toHaveLength(3);
    });

    it('leaves the header of an elided turn, so the model still knows what it called', () => {
      const messages = transcript(6);
      elideOldObservations(messages);

      const first = messages.find(
        (m) =>
          m.role === 'user' &&
          m.content.startsWith('Tool results (iteration 1)'),
      )!;
      expect(first.content).toContain('findings.search → READ_OK');
      expect(first.content).not.toContain('payload-1');
      expect(first.content).toMatch(/elided/i);
    });

    it('never touches the system prompt, the mission prompt or the model’s reasoning', () => {
      const messages = transcript(6);
      const before = messages
        .filter(
          (m) => m.role !== 'user' || !m.content.startsWith('Tool results'),
        )
        .map((m) => m.content);

      elideOldObservations(messages);

      const after = messages
        .filter(
          (m) => m.role !== 'user' || !m.content.startsWith('Tool results'),
        )
        .map((m) => m.content);
      expect(after).toEqual(before);
    });

    it('is idempotent, so repeated persists do not re-rewrite the transcript', () => {
      const messages = transcript(6);
      elideOldObservations(messages);
      const once = messages.map((m) => m.content);
      elideOldObservations(messages);

      expect(messages.map((m) => m.content)).toEqual(once);
    });

    it('does nothing while the run is still short', () => {
      const messages = transcript(2);
      const before = messages.map((m) => m.content);
      elideOldObservations(messages);

      expect(messages.map((m) => m.content)).toEqual(before);
    });

    it('bounds a long run: growth is linear in headers, not in payloads', () => {
      const messages = transcript(16);
      elideOldObservations(messages);

      const observationChars = messages
        .filter(
          (m) => m.role === 'user' && m.content.startsWith('Tool results'),
        )
        .reduce((sum, m) => sum + m.content.length, 0);
      // 13 header-only turns plus 3 verbatim ones.
      expect(observationChars).toBeLessThan(5_000);
    });
  });
});
