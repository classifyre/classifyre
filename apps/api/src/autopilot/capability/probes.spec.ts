import { LLM_PROBES, PROBE_TOOLS } from './probes';
import type { ProbeBuildContext } from './capability.types';
import type { LoopTurn } from '../harness/agent-loop';
import type { Tool } from '../tools/tool.types';
import type { ToolRegistry } from '../tools/tool-registry.service';

/** Minimal stand-ins for the real tools the probes grade arguments against. */
const FAKE_TOOLS: Record<
  string,
  Pick<Tool, 'name' | 'inputSchema' | 'lenientInput'>
> = {
  'findings.ranked': {
    name: 'findings.ranked',
    inputSchema: {
      type: 'object',
      properties: { sourceId: { type: 'string' } },
    },
  },
  'findings.explain': {
    name: 'findings.explain',
    inputSchema: {
      type: 'object',
      properties: { findingId: { type: 'string' } },
      required: ['findingId'],
    },
  },
  'inquiries.create': {
    name: 'inquiries.create',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, detector: { type: 'string' } },
      required: ['title'],
    },
  },
};

const ctx: ProbeBuildContext = {
  registry: {
    get: (name: string) => FAKE_TOOLS[name] as Tool | undefined,
    catalog: () => '### findings.ranked [read]\n…',
  } as unknown as ToolRegistry,
  allowedTools: PROBE_TOOLS,
  catalog: '### findings.ranked [read]\n…',
};

function probe(id: string) {
  const found = LLM_PROBES.find((p) => p.id === id);
  if (!found) throw new Error(`No probe "${id}"`);
  return found;
}

function turn(partial: Partial<LoopTurn>): LoopTurn {
  return { thought: 'thinking', toolCalls: [], ...partial };
}

function call(tool: string, input: unknown = {}) {
  return { tool, input, rationale: 'because' };
}

describe('capability probes', () => {
  it('advertises only tools that exist in the harness missions', () => {
    // Guards against a probe silently testing a tool that was renamed away.
    expect(PROBE_TOOLS).toContain('findings.ranked');
    expect(new Set(PROBE_TOOLS).size).toBe(PROBE_TOOLS.length);
  });

  it('every probe builds a conversation ending in a user turn', () => {
    for (const p of LLM_PROBES) {
      const { messages } = p.build(ctx);
      expect(messages[0]?.role).toBe('system');
      expect(messages.at(-1)?.role).toBe('user');
    }
  });

  describe('react.turn_shape', () => {
    const p = probe('react.turn_shape');

    it('fails a turn with no tool calls', () => {
      expect(p.grade(turn({}), ctx).status).toBe('FAIL');
    });

    it('fails a call whose input is a string rather than an object', () => {
      const grade = p.grade(
        turn({ toolCalls: [call('findings.ranked', 'src-1')] }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
    });

    it('passes a well-formed call', () => {
      const grade = p.grade(
        turn({ toolCalls: [call('findings.ranked', { sourceId: 'src-1' })] }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });
  });

  describe('finish.termination', () => {
    const p = probe('finish.termination');

    it('fails when the model keeps calling tools after being told to stop', () => {
      expect(
        p.grade(turn({ toolCalls: [call('findings.ranked')] }), ctx).status,
      ).toBe('FAIL');
    });

    it('passes on a finish block', () => {
      const grade = p.grade(
        turn({ toolCalls: [], finish: { summary: 'Nothing to do.' } }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });
  });

  describe('tool.args_schema', () => {
    const p = probe('tool.args_schema');

    it('fails arguments the dispatcher would reject', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('inquiries.create', { detector: 'SECRETS' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
      expect(grade.reason).toContain('title');
    });

    it('passes schema-valid arguments', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('inquiries.create', { title: 'Recurring keys' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });

    it('does not mutate the model output while grading leniently', () => {
      // normalizeAgainstSchema strips unknown keys in place — grading must work
      // on a clone, or the raw output shown to the operator would be doctored.
      const input = { title: 'Recurring keys', unexpected: 'keep me' };
      p.grade(turn({ toolCalls: [call('inquiries.create', input)] }), ctx);
      expect(input.unexpected).toBe('keep me');
    });
  });

  describe('tool.no_hallucination', () => {
    const p = probe('tool.no_hallucination');

    it('fails an invented tool name', () => {
      const grade = p.grade(turn({ toolCalls: [call('sources.delete')] }), ctx);
      expect(grade.status).toBe('FAIL');
      expect(grade.reason).toContain('sources.delete');
    });

    it('passes when the model stays inside the catalog', () => {
      expect(
        p.grade(turn({ toolCalls: [call('findings.search')] }), ctx).status,
      ).toBe('PASS');
    });
  });

  describe('chain.two_step', () => {
    const p = probe('chain.two_step');

    it('passes when the id comes from the observation', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('findings.explain', { findingId: 'f-9c41ab7e' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });

    it('fails when it grabs the first (lower-importance) id', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('findings.explain', { findingId: 'f-2b77cc10' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
      expect(grade.reason).toContain('first id it sees');
    });

    it('fails a fabricated id distinctly from a decoy pick', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('findings.explain', { findingId: 'finding-1' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
      expect(grade.reason).toContain('fabricates ids');
    });
  });

  describe('chain.error_recovery', () => {
    const p = probe('chain.error_recovery');

    it('fails a retry that ignores the validator message', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('inquiries.create', { detector: 'SECRETS' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
    });

    it('passes a retry that supplies the missing field', () => {
      const grade = p.grade(
        turn({ toolCalls: [call('inquiries.create', { title: 'AWS keys' })] }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });
  });

  describe('chain.no_thrash', () => {
    const p = probe('chain.no_thrash');

    it('fails an identical re-read', () => {
      const grade = p.grade(
        turn({ toolCalls: [call('findings.ranked', { sourceId: 'src-1' })] }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
    });

    it('passes forward progress', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('findings.explain', { findingId: 'f-9c41ab7e' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });
  });

  describe('judgment.triage', () => {
    const p = probe('judgment.triage');

    it('fails when severity beats evidence importance', () => {
      const grade = p.grade(
        turn({
          toolCalls: [
            call('findings.explain', { findingId: 'f-crit-ocr-001' }),
          ],
        }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
      expect(grade.reason).toContain('severity label');
    });

    it('passes when the recurring MEDIUM finding is chosen', () => {
      const grade = p.grade(
        turn({
          toolCalls: [
            call('findings.explain', { findingId: 'f-med-recur-002' }),
          ],
        }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });
  });

  describe('judgment.negative_constraint', () => {
    const p = probe('judgment.negative_constraint');

    it('fails recreating an operator-archived topic', () => {
      const grade = p.grade(
        turn({ toolCalls: [call('inquiries.create', { title: 'AWS keys' })] }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
    });

    it('fails reactivating it too', () => {
      const grade = p.grade(
        turn({
          toolCalls: [call('inquiries.reactivate', { inquiryId: 'inq-4471' })],
        }),
        ctx,
      );
      expect(grade.status).toBe('FAIL');
    });

    it('passes when it declines and records the precedent instead', () => {
      const grade = p.grade(
        turn({ toolCalls: [call('memory.write', { key: 'precedent' })] }),
        ctx,
      );
      expect(grade.status).toBe('PASS');
    });
  });
});
