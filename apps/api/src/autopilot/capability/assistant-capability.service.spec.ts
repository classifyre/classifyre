import { AgentKind } from '@prisma/client';
import { AiSchemaError } from '../../ai';
import { AssistantCapabilityService } from './assistant-capability.service';
import type { CapabilityProgressEvent } from './capability.types';
import type { LoopTurn } from '../harness/agent-loop';
import type { Tool } from '../tools/tool.types';

const TOOLS: Record<string, Pick<Tool, 'name' | 'inputSchema'>> = {
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
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
  'memory.write': {
    name: 'memory.write',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } } },
  },
};

/**
 * A model that answers every probe correctly. Keyed on distinctive text in the
 * conversation so one mock serves the whole suite.
 */
function perfectAnswer(conversation: string): LoopTurn {
  const call = (tool: string, input: unknown): LoopTurn => ({
    thought: 'Reasoning about the next step.',
    toolCalls: [{ tool, input, rationale: 'because' }],
  });

  if (conversation.includes('Conclude this run.')) {
    return {
      thought: 'Nothing to do.',
      toolCalls: [],
      finish: { summary: 'Done.' },
    };
  }
  if (conversation.includes('deleted outright')) {
    return {
      thought: 'No tool can delete a source or send email.',
      toolCalls: [],
      finish: { summary: 'No available tool covers this request.' },
    };
  }
  if (conversation.includes("must have required property 'title'")) {
    return call('inquiries.create', { title: 'Recurring AWS access keys' });
  }
  if (conversation.includes('f-crit-ocr-001')) {
    return call('findings.explain', { findingId: 'f-med-recur-002' });
  }
  if (conversation.includes('inq-4471')) {
    return call('memory.write', { key: 'precedent:aws-sandbox-keys' });
  }
  if (conversation.includes('f-2b77cc10')) {
    return call('findings.explain', { findingId: 'f-9c41ab7e' });
  }
  if (conversation.includes('f-9c41ab7e')) {
    return call('findings.explain', { findingId: 'f-9c41ab7e' });
  }
  if (conversation.includes('Create one inquiry')) {
    return call('inquiries.create', {
      title: 'Recurring AWS access keys in CSV exports',
    });
  }
  return call('findings.ranked', { sourceId: 'src-1' });
}

interface Deps {
  contextSize?: number | null;
  answer?: (conversation: string) => LoopTurn;
  /** Probe ids (matched on conversation text) that should throw a schema error. */
  schemaFailFor?: (conversation: string) => boolean;
}

function buildService(deps: Deps = {}) {
  const answer = deps.answer ?? perfectAnswer;
  const completeJson = jest.fn((messages: Array<{ content: string }>) => {
    const conversation = messages.map((m) => m.content).join('\n');
    if (deps.schemaFailFor?.(conversation)) {
      return Promise.reject(
        new AiSchemaError(
          'not JSON',
          undefined,
          [{ raw: 'Sure! ```json', error: 'x' }],
          { inputTokens: 10, outputTokens: 5 },
        ),
      );
    }
    const content = answer(conversation);
    return Promise.resolve({
      content,
      raw: JSON.stringify(content),
      model: 'test-model',
      provider: 'CLAUDE' as const,
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  const service = new AssistantCapabilityService(
    { completeJson } as never,
    {
      get: () =>
        Promise.resolve({
          id: 'cfg-1',
          name: 'Test credential',
          provider: 'CLAUDE',
          model: 'test-model',
          contextSize:
            deps.contextSize === undefined ? 200_000 : deps.contextSize,
          inputCostPerMTok: 3,
          outputCostPerMTok: 15,
        }),
    } as never,
    {
      get: (name: string) => TOOLS[name] as Tool | undefined,
      catalog: (allowed?: string[]) =>
        (allowed ?? []).map((n) => `### ${n} [read]`).join('\n'),
    } as never,
    {
      list: () =>
        Promise.resolve([
          {
            kind: AgentKind.INQUIRY,
            goal: 'goal '.repeat(100),
            maxIterations: 12,
            toolNames: ['findings.ranked', 'findings.explain'],
          },
          {
            kind: AgentKind.DETECTOR_AUTHOR,
            goal: 'goal '.repeat(100),
            maxIterations: 16,
            toolNames: ['findings.ranked'],
          },
        ]),
    } as never,
    { compose: () => Promise.resolve({}), render: () => 'brief' } as never,
    { toolNamesForKind: () => [] } as never,
    { buildTypeRegistry: () => 'registry' } as never,
  );

  return { service, completeJson };
}

describe('AssistantCapabilityService', () => {
  it('emits real progress for every probe and the capacity analysis', async () => {
    const { service } = buildService();
    const events: CapabilityProgressEvent[] = [];

    const report = await service.run('cfg-1', (event) => {
      events.push(event);
    });

    expect(events[0]).toMatchObject({
      type: 'started',
      configId: 'cfg-1',
      totalProbes: report.probes.length,
    });
    expect(
      events.filter((event) => event.type === 'probe_started'),
    ).toHaveLength(report.probes.length);
    expect(
      events.filter((event) => event.type === 'probe_completed'),
    ).toHaveLength(report.probes.length);
    expect(events.at(-2)).toEqual({ type: 'capacity_started' });
    expect(events.at(-1)).toMatchObject({
      type: 'capacity_completed',
      agents: report.agents,
    });
  });

  it('reports READY and skips the recovery probe when the model is compliant', async () => {
    const { service } = buildService();
    const report = await service.run('cfg-1');

    expect(report.verdict).toBe('READY');
    expect(report.abortedEarly).toBe(false);

    const recovery = report.probes.find((p) => p.id === 'json.recovery');
    // Not exercised when first-shot JSON works — it would only burn tokens.
    expect(recovery?.status).toBe('SKIPPED');
    expect(report.probes.filter((p) => p.status === 'FAIL')).toHaveLength(0);
  });

  it('never invokes a tool handler', async () => {
    // The safety property of the whole suite: the registry serves schemas for
    // grading, but nothing the model "calls" is ever executed.
    const handler = jest.fn();
    for (const tool of Object.values(TOOLS)) {
      (tool as Tool).handler = handler;
    }
    try {
      const { service } = buildService();
      await service.run('cfg-1');
      expect(handler).not.toHaveBeenCalled();
    } finally {
      for (const tool of Object.values(TOOLS)) {
        delete (tool as Partial<Tool>).handler;
      }
    }
  });

  it('records provider token usage per probe and in the total', async () => {
    const { service } = buildService();
    const report = await service.run('cfg-1');

    const exercised = report.probes.filter((p) => p.status !== 'SKIPPED');
    expect(exercised.every((p) => p.inputTokens === 100)).toBe(true);
    expect(report.totalInputTokens).toBe(exercised.length * 100);
    expect(report.totalOutputTokens).toBe(exercised.length * 20);
  });

  it('degrades — not aborts — when only first-shot JSON fails', async () => {
    const { service } = buildService({
      // json.strict is the only probe whose conversation lacks a scripted turn
      // and asks to "take the minimal correct actions".
      schemaFailFor: (c) => c.includes('take the minimal correct actions'),
    });
    const report = await service.run('cfg-1');

    expect(report.probes.find((p) => p.id === 'json.strict')?.status).toBe(
      'FAIL',
    );
    // Recovery now earns its tokens, and the suite continues.
    expect(report.probes.find((p) => p.id === 'json.recovery')?.status).toBe(
      'PASS',
    );
    expect(report.abortedEarly).toBe(false);
    expect(report.verdict).toBe('DEGRADED');
  });

  it('aborts the suite and reports UNUSABLE when the turn contract fails outright', async () => {
    const { service, completeJson } = buildService({
      answer: () => ({ thought: '', toolCalls: [] }),
    });
    const report = await service.run('cfg-1');

    expect(report.probes.find((p) => p.id === 'react.turn_shape')?.status).toBe(
      'FAIL',
    );
    expect(report.abortedEarly).toBe(true);
    expect(report.verdict).toBe('UNUSABLE');

    // Everything after the abort is skipped rather than charged for.
    const chaining = report.probes.filter((p) => p.tier === 'CHAINING');
    expect(chaining.every((p) => p.status === 'SKIPPED')).toBe(true);
    expect(completeJson.mock.calls.length).toBeLessThan(report.probes.length);
  });

  it('flags an agent whose projected transcript exceeds the context window', async () => {
    const { service } = buildService({ contextSize: 4000 });
    const report = await service.run('cfg-1');

    const detectorAuthor = report.agents.find(
      (a) => a.kind === AgentKind.DETECTOR_AUTHOR,
    );
    expect(detectorAuthor?.readiness).toBe('WILL_FAIL');
    expect(report.verdict).toBe('DEGRADED');
  });

  it('reports UNKNOWN readiness rather than guessing when no context size is set', async () => {
    const { service } = buildService({ contextSize: null });
    const report = await service.run('cfg-1');

    expect(report.agents.every((a) => a.readiness === 'UNKNOWN')).toBe(true);
    expect(report.agents.every((a) => a.headroomPct === null)).toBe(true);
  });

  it('prices a run from the heaviest agent, not an average', async () => {
    const { service } = buildService();
    const report = await service.run('cfg-1');

    expect(report.cost.basedOnAgent).toBe(AgentKind.DETECTOR_AUTHOR);
    expect(report.cost.estimatedCostPerRunUsd).toBeGreaterThan(0);
  });

  it('surfaces the assumptions behind the capacity numbers', async () => {
    const { service } = buildService();
    const report = await service.run('cfg-1');
    expect(report.assumptions.length).toBeGreaterThan(0);
    expect(report.assumptions.join(' ')).toContain(
      'No tool handler is executed',
    );
  });
});
