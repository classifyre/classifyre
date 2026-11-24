import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Severity } from '@prisma/client';
import { DataRequestSpecSchema } from '@workspace/schemas/data-request';
import type { DataRequestsService } from './data-requests.service';

export const DATA_REQUEST_MCP_TOOL_NAMES = [
  'list_data_requests',
  'get_data_request',
  'create_data_request',
  'submit_data_request',
] as const;

export interface DataRequestsMcpServer {
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodTypeAny | Record<string, z.ZodTypeAny>;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
    },
    cb: (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    }>,
  ): unknown;
}

export interface DataRequestsMcpHelpers {
  requirePerson: () => void;
  jsonResult: (payload: unknown) => {
    content: Array<{ type: 'text'; text: string }>;
  };
}

export function registerDataRequestMcpTools(
  server: DataRequestsMcpServer,
  dataRequests: DataRequestsService | undefined,
  helpers: DataRequestsMcpHelpers,
): void {
  const requireService = (): DataRequestsService => {
    if (!dataRequests) {
      throw new NotFoundException('Data requests are unavailable.');
    }
    return dataRequests;
  };
  server.registerTool(
    'list_data_requests',
    {
      title: 'List data requests',
      description:
        'List dataset requests in the current workspace. Use scope "mine" for requests you created, "team" for requests routed to your data-team groups, or "all" (requires case.view).',
      inputSchema: z.strictObject({
        scope: z.enum(['mine', 'team', 'all']).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      helpers.requirePerson();
      const scope = (args.scope as 'mine' | 'team' | 'all' | undefined) ?? 'mine';
      const result = await requireService().list(scope);
      return helpers.jsonResult(result);
    },
  );

  server.registerTool(
    'get_data_request',
    {
      title: 'Get data request',
      description:
        'Read one data request by its case id, including its visual join spec, generated or hand-edited SQL, delivery history, and live dataset status.',
      inputSchema: z.strictObject({
        id: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      helpers.requirePerson();
      const result = await requireService().get(String(args.id));
      return helpers.jsonResult(result);
    },
  );

  server.registerTool(
    'create_data_request',
    {
      title: 'Create data request',
      description:
        'Create a new draft data request asking a data-team group for a governed shared dataset. Provide a title, routeGroupId (group with dataset.publish), audienceGroupId (group that should read the dataset), and optionally a canvas spec (tables, joins, filters).',
      inputSchema: z.strictObject({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(4000).optional(),
        priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
        routeGroupId: z.string().min(1),
        audienceGroupId: z.string().min(1),
        spec: DataRequestSpecSchema.optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      helpers.requirePerson();
      const result = await requireService().create({
        title: String(args.title),
        description:
          typeof args.description === 'string' ? args.description : undefined,
        priority: args.priority as Severity | undefined,
        routeGroupId: String(args.routeGroupId),
        audienceGroupId: String(args.audienceGroupId),
        spec: args.spec as Record<string, unknown> | undefined,
      });
      return helpers.jsonResult(result);
    },
  );

  server.registerTool(
    'submit_data_request',
    {
      title: 'Submit data request',
      description:
        'Submit a draft data request to its routed data-team group so the team is notified and can claim and deliver a shared dataset.',
      inputSchema: z.strictObject({
        id: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      helpers.requirePerson();
      const result = await requireService().submit(String(args.id));
      return helpers.jsonResult(result);
    },
  );
}
