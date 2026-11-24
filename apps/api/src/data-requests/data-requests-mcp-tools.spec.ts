import { NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import {
  DATA_REQUEST_MCP_TOOL_NAMES,
  registerDataRequestMcpTools,
} from './data-requests-mcp-tools';
import type { DataRequestsService } from './data-requests.service';

type RegisteredTool = {
  schema: z.ZodTypeAny;
  readOnly: boolean;
  run: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
};

function register(
  service?: Partial<
    Pick<DataRequestsService, 'list' | 'get' | 'create' | 'submit'>
  >,
) {
  const tools = new Map<string, RegisteredTool>();
  const requirePerson = jest.fn();
  const jsonResult = jest.fn((payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  }));

  registerDataRequestMcpTools(
    {
      registerTool: (name, config, cb) => {
        tools.set(name, {
          schema: config.inputSchema as z.ZodTypeAny,
          readOnly: config.annotations?.readOnlyHint === true,
          run: cb,
        });
      },
    },
    service as DataRequestsService | undefined,
    { requirePerson, jsonResult },
  );

  return { tools, requirePerson, jsonResult };
}

describe('data-requests MCP tools', () => {
  it('registers exactly DATA_REQUEST_MCP_TOOL_NAMES', () => {
    const { tools } = register({});
    expect([...tools.keys()].sort()).toEqual(
      [...DATA_REQUEST_MCP_TOOL_NAMES].sort(),
    );
  });

  it('uses z.strictObject so unknown keys are rejected instead of stripped', () => {
    const { tools } = register({});

    expect(
      tools.get('list_data_requests')!.schema.safeParse({
        scope: 'mine',
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      tools.get('get_data_request')!.schema.safeParse({
        id: 'case-1',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      tools.get('create_data_request')!.schema.safeParse({
        title: 'Revenue',
        routeGroupId: 'grp-data',
        audienceGroupId: 'grp-fin',
        unknownField: 'nope',
      }).success,
    ).toBe(false);
    expect(
      tools.get('submit_data_request')!.schema.safeParse({
        id: 'case-1',
        bogus: 'x',
      }).success,
    ).toBe(false);
  });

  it('calls requirePerson and delegates each handler to DataRequestsService', async () => {
    const list = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const get = jest.fn().mockResolvedValue({ id: 'case-1' });
    const create = jest.fn().mockResolvedValue({ id: 'case-2' });
    const submit = jest.fn().mockResolvedValue({ id: 'case-2', state: 'SUBMITTED' });

    const { tools, requirePerson, jsonResult } = register({
      list,
      get,
      create,
      submit,
    });

    await tools.get('list_data_requests')!.run({});
    expect(list).toHaveBeenCalledWith('mine');

    await tools.get('list_data_requests')!.run({ scope: 'team' });
    expect(list).toHaveBeenCalledWith('team');

    await tools.get('get_data_request')!.run({ id: 'case-1' });
    expect(get).toHaveBeenCalledWith('case-1');

    await tools.get('create_data_request')!.run({
      title: 'Revenue dataset',
      description: 'Monthly totals',
      priority: 'HIGH',
      routeGroupId: 'grp-data',
      audienceGroupId: 'grp-finance',
    });
    expect(create).toHaveBeenCalledWith({
      title: 'Revenue dataset',
      description: 'Monthly totals',
      priority: 'HIGH',
      routeGroupId: 'grp-data',
      audienceGroupId: 'grp-finance',
      spec: undefined,
    });

    await tools.get('submit_data_request')!.run({ id: 'case-2' });
    expect(submit).toHaveBeenCalledWith('case-2');

    expect(requirePerson).toHaveBeenCalledTimes(5);
    expect(jsonResult).toHaveBeenCalledTimes(5);
  });

  it('throws NotFoundException when DataRequestsService is unavailable', async () => {
    const { tools, requirePerson } = register(undefined);

    await expect(
      tools.get('get_data_request')!.run({ id: 'case-1' }),
    ).rejects.toThrow(NotFoundException);
    expect(requirePerson).toHaveBeenCalledTimes(1);
  });
});
