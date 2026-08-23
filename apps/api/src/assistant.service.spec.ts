jest.mock('@workspace/schemas/assistant', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const z = require('zod/v4');

  const assistantContextKeySchema = z.enum([
    'source.create',
    'source.edit',
    'detector.create',
    'detector.edit',
    'fingerprints.tune',
    'inquiry.create',
    'inquiry.manage',
    'case.create',
    'case.manage',
    'app.global',
  ]);

  const assistantFieldPatchSchema = z.object({
    path: z.string(),
    value: z.unknown(),
  });

  const assistantPendingConfirmationSchema = z.object({
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    title: z.string(),
    detail: z.string(),
    runtime: z.enum(['mcp', 'client']).default('mcp'),
  });

  const assistantUiActionSchema = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('show_toast'),
      tone: z.enum(['info', 'success', 'error']).optional(),
      title: z.string(),
      description: z.string().optional(),
    }),
    z.object({
      type: z.literal('patch_fields'),
      patches: z.array(assistantFieldPatchSchema),
    }),
    z.object({
      type: z.literal('navigate'),
      route: z.string(),
    }),
    z.object({
      type: z.literal('sync_source'),
      sourceId: z.string(),
      values: z.record(z.string(), z.unknown()),
      schedule: z
        .object({
          enabled: z.boolean(),
          cron: z.string().optional(),
          timezone: z.string().optional(),
        })
        .optional(),
    }),
    z.object({
      type: z.literal('sync_detector'),
      detectorId: z.string(),
      values: z.record(z.string(), z.unknown()),
    }),
    z.object({
      type: z.literal('notebook_edit'),
      operations: z.array(
        z.discriminatedUnion('op', [
          z.object({
            op: z.literal('set_cell'),
            cellId: z.string(),
            source: z.string(),
          }),
          z.object({
            op: z.literal('insert_cell'),
            cellType: z.enum(['code', 'markdown']).default('code'),
            source: z.string().default(''),
            afterCellId: z.string().nullable().optional(),
          }),
          z.object({ op: z.literal('delete_cell'), cellId: z.string() }),
        ]),
      ),
      summary: z.string().optional(),
    }),
    z.object({
      type: z.literal('set_detectors'),
      detectors: z.array(
        z.object({
          type: z.string(),
          enabled: z.boolean().default(true),
          config: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
    z.object({
      type: z.literal('attach_result'),
      kind: z.enum(['source_test', 'detector_train', 'operation']),
      title: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ]);

  const assistantChatRequestSchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    ),
    context: z.object({
      key: assistantContextKeySchema,
      route: z.string(),
      title: z.string(),
      entityId: z.string().nullable().optional(),
      values: z.record(z.string(), z.unknown()),
      schema: z.record(z.string(), z.unknown()).nullable().optional(),
      validation: z.object({
        isValid: z.boolean(),
        missingFields: z.array(z.string()),
        errors: z.array(z.string()),
      }),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    pendingConfirmation: assistantPendingConfirmationSchema
      .nullable()
      .optional(),
    confirmationDecision: z.enum(['confirm', 'cancel']).nullable().optional(),
  });

  const assistantChatResponseSchema = z.object({
    reply: z.string(),
    actions: z.array(assistantUiActionSchema),
    pendingConfirmation: assistantPendingConfirmationSchema.nullable(),
    toolCalls: z.array(
      z.object({
        name: z.string(),
        status: z.enum(['success', 'error']),
        detail: z.string(),
      }),
    ),
  });

  const contexts: Record<string, { title: string; summary: string }> = {};
  for (const key of assistantContextKeySchema.options) {
    contexts[key] = { title: `Assistant ${key}`, summary: `Summary ${key}` };
  }

  return {
    RUN_NOTEBOOK_TOOL: 'run_notebook',
    assistantContexts: contexts,
    assistantContextKeySchema,
    assistantFieldPatchSchema,
    assistantUiActionSchema,
    assistantChatRequestSchema,
    assistantChatResponseSchema,
    assistantPendingConfirmationSchema,
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import {
  AssistantService,
  summarizeSchemaForPrompt,
} from './assistant.service';
import { AiClientService } from './ai';
import { AssistantMcpService } from './assistant/assistant-mcp.service';
import { BadRequestException } from '@nestjs/common';

describe('summarizeSchemaForPrompt', () => {
  it('flattens nested objects, arrays of objects, enums, required and secrets', () => {
    const summary = summarizeSchemaForPrompt({
      type: 'object',
      required: ['host'],
      properties: {
        host: { type: 'string', description: 'Server host' },
        auth: {
          type: 'object',
          required: ['auth_mode'],
          properties: {
            auth_mode: { type: 'string', enum: ['basic', 'oauth'] },
            password: { type: 'string' },
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });

    expect(summary).toContain('host : string (required) — Server host');
    expect(summary).toContain('auth.auth_mode : enum[basic|oauth] (required)');
    expect(summary).toContain('auth.password : string (secret)');
    expect(summary).toContain('tags : array<string>');
  });

  it('returns an empty string when there is no schema or no properties', () => {
    expect(summarizeSchemaForPrompt(null)).toBe('');
    expect(summarizeSchemaForPrompt({})).toBe('');
  });
});

describe('AssistantService', () => {
  const listSourceTypesTool = {
    name: 'list_source_types',
    description: 'List source types',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    destructive: false,
  };
  const validateSourceConfigTool = {
    name: 'validate_source_config',
    description: 'Validate a source config',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    destructive: false,
  };
  const createSourceTool = {
    name: 'create_source',
    description: 'Create a source',
    inputSchema: { type: 'object', properties: {} },
    readOnly: false,
    destructive: false,
  };

  const allTools = [
    listSourceTypesTool,
    validateSourceConfigTool,
    createSourceTool,
  ];

  let service: AssistantService;
  let completeJson: jest.Mock;
  let callTool: jest.Mock;

  const baseContext = {
    key: 'source.create' as const,
    route: '/sources/new',
    title: 'New source',
    entityId: null,
    values: { name: 'Jira Prod' },
    schema: null,
    validation: { isValid: false, missingFields: ['host'], errors: [] },
    metadata: {},
  };

  beforeEach(async () => {
    completeJson = jest.fn();
    callTool = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        {
          provide: AiClientService,
          useValue: { completeJson },
        },
        {
          provide: AssistantMcpService,
          useValue: {
            listTools: jest.fn().mockResolvedValue(allTools),
            getTool: jest
              .fn()
              .mockImplementation((name: string) =>
                Promise.resolve(allTools.find((tool) => tool.name === name)),
              ),
            callTool,
          },
        },
      ],
    }).compile();

    service = module.get(AssistantService);
  });

  it('executes read tools in the loop and returns the final reply', async () => {
    completeJson
      .mockResolvedValueOnce({
        content: {
          toolCalls: [{ tool: 'list_source_types', input: {} }],
        },
        raw: '{"toolCalls":[{"tool":"list_source_types","input":{}}]}',
      })
      .mockResolvedValueOnce({
        content: {
          reply: 'You can create a JIRA or SHAREPOINT source.',
          uiActions: [],
          proposeOperation: null,
        },
        raw: '{"reply":"…"}',
      });
    callTool.mockResolvedValue({ ok: true, result: { types: ['JIRA'] } });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'What sources can I create?' }],
      context: baseContext,
    });

    expect(callTool).toHaveBeenCalledWith('list_source_types', {});
    expect(response.reply).toContain('JIRA');
    expect(response.pendingConfirmation).toBeNull();
    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'list_source_types', status: 'success' }),
    ]);
  });

  it('rejects mutating tools inside the loop without executing them', async () => {
    completeJson
      .mockResolvedValueOnce({
        content: {
          toolCalls: [{ tool: 'create_source', input: { name: 'x' } }],
        },
        raw: '{}',
      })
      .mockResolvedValueOnce({
        content: {
          reply: 'I will propose it instead.',
          proposeOperation: {
            tool: 'create_source',
            input: { name: 'x' },
            title: 'Create source',
            detail: 'create the source "x"',
          },
        },
        raw: '{}',
      });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'create it' }],
      context: baseContext,
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(response.pendingConfirmation).toEqual(
      expect.objectContaining({
        tool: 'create_source',
        input: { name: 'x' },
      }),
    );
    // The observation fed back to the model must explain the confirmation path.
    const transcript = completeJson.mock.calls[1][0] as Array<{
      content: string;
    }>;
    expect(
      transcript.some((message) =>
        message.content.includes('proposeOperation'),
      ),
    ).toBe(true);
  });

  it('collects allowed UI actions and drops disallowed ones', async () => {
    completeJson.mockResolvedValueOnce({
      content: {
        reply: 'Patched the host and set up the rest.',
        uiActions: [
          {
            type: 'patch_fields',
            patches: [{ path: 'required.host', value: 'jira.example.com' }],
          },
          // sync_source is server-built only; the model may not emit it.
          {
            type: 'sync_source',
            sourceId: '3f0c2a4e-8f9f-4a5f-9d3c-2f6a9d8e1b2c',
            values: {},
          },
        ],
        proposeOperation: null,
      },
      raw: '{}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'fix the host' }],
      context: baseContext,
    });

    expect(response.actions).toEqual([
      expect.objectContaining({ type: 'patch_fields' }),
    ]);
  });

  it('passes a notebook edit through and narrates it when the model wrote no prose', async () => {
    // The model spends its output budget on the code, so a turn that rewrites
    // four cells and says nothing is the common case. "Done" would hide it.
    completeJson.mockResolvedValueOnce({
      content: {
        uiActions: [
          {
            type: 'notebook_edit',
            summary: 'Wrote the REST connector',
            operations: [
              {
                op: 'set_cell',
                cellId: 'extract',
                source: 'def extract():\n    yield',
              },
              {
                op: 'insert_cell',
                cellType: 'markdown',
                source: '## What this does',
                afterCellId: 'extract',
              },
            ],
          },
        ],
        proposeOperation: null,
      },
      raw: '{}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'write the connector' }],
      context: {
        ...baseContext,
        values: { type: 'CUSTOM' },
        metadata: { sourceType: 'CUSTOM' },
      },
    });

    expect(response.actions).toEqual([
      expect.objectContaining({ type: 'notebook_edit' }),
    ]);
    expect(response.reply).toContain('Wrote the REST connector');
    expect(response.reply).toContain('rewrote 1 cell(s)');
    expect(response.reply).toContain('added 1 cell(s)');
  });

  it('drops a notebook edit in a context that cannot apply one', async () => {
    completeJson.mockResolvedValueOnce({
      content: {
        reply: 'Here you go.',
        uiActions: [
          {
            type: 'notebook_edit',
            operations: [{ op: 'delete_cell', cellId: 'extract' }],
          },
        ],
        proposeOperation: null,
      },
      raw: '{}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'delete it' }],
      context: { ...baseContext, key: 'case.manage' as const },
    });

    expect(response.actions).toEqual([]);
  });

  it('renders the notebook and the @ references as their own prompt sections', async () => {
    completeJson.mockResolvedValueOnce({
      content: { reply: 'ok', uiActions: [], proposeOperation: null },
      raw: '{}',
    });

    await service.respond({
      messages: [{ role: 'user', content: 'rewrite @cell:2' }],
      context: {
        ...baseContext,
        values: {
          type: 'CUSTOM',
          required: {
            notebook: {
              revision: 3,
              cells: [
                { id: 'imports', type: 'code', source: 'import httpx' },
                { id: 'extract', type: 'code', source: 'def extract():' },
              ],
            },
          },
        },
        metadata: {
          sourceType: 'CUSTOM',
          mentions: [
            { token: '@cell:2', label: 'extract', body: 'def extract():' },
          ],
        },
      },
    });

    const [messages] = completeJson.mock.calls[0] as [
      Array<{ role: string; content: string }>,
    ];
    const system = messages[0].content;
    const user = messages[1].content;

    // The notebook contract only belongs on a CUSTOM page.
    expect(system).toContain('CUSTOM source = a Python notebook connector');
    expect(system).toContain('notebook_edit');
    // Cells are pulled out of the truncated value dump and addressed by id.
    expect(user).toContain('The notebook right now (revision 3, 2 cell(s))');
    expect(user).toContain('id="extract"');
    expect(user).toContain('Referenced by the user');
    expect(user).toContain('@cell:2');
  });

  it('leaves the notebook contract out of a non-CUSTOM source page', async () => {
    completeJson.mockResolvedValueOnce({
      content: { reply: 'ok', uiActions: [], proposeOperation: null },
      raw: '{}',
    });

    await service.respond({
      messages: [{ role: 'user', content: 'hello' }],
      context: { ...baseContext, metadata: { sourceType: 'JIRA' } },
    });

    const [messages] = completeJson.mock.calls[0] as [
      Array<{ role: string; content: string }>,
    ];
    expect(messages[0].content).not.toContain(
      'CUSTOM source = a Python notebook connector',
    );
  });

  it('proposes a notebook run as a client-executed confirmation', async () => {
    // The notebook lives in the browser and running it means saving the page
    // first, so this one proposal is executed by the client — which is what
    // lets the assistant watch its own code fail and fix it.
    completeJson.mockResolvedValueOnce({
      content: {
        reply: 'Rewrote extract(); let us check it.',
        uiActions: [],
        proposeOperation: {
          tool: 'run_notebook',
          input: { mode: 'cell', cellId: 'extract' },
          title: 'Run cell extract',
          detail: 'save the source and run that cell',
        },
      },
      raw: '{}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'write extract()' }],
      context: {
        ...baseContext,
        values: { type: 'CUSTOM' },
        metadata: { sourceType: 'CUSTOM' },
      },
    });

    expect(response.pendingConfirmation).toEqual(
      expect.objectContaining({
        tool: 'run_notebook',
        runtime: 'client',
        input: { mode: 'cell', cellId: 'extract' },
      }),
    );
    // It never touches MCP — there is no such tool there.
    expect(callTool).not.toHaveBeenCalled();
  });

  it('falls back to a whole-notebook run when the model names no valid mode', async () => {
    completeJson.mockResolvedValueOnce({
      content: {
        reply: 'Checking.',
        uiActions: [],
        proposeOperation: {
          tool: 'run_notebook',
          input: { mode: 'sideways' },
        },
      },
      raw: '{}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'check it' }],
      context: {
        ...baseContext,
        metadata: { sourceType: 'CUSTOM' },
      },
    });

    expect(response.pendingConfirmation?.input).toEqual({ mode: 'all' });
  });

  it('refuses to execute a client-run confirmation on the server', async () => {
    await expect(
      service.respond({
        messages: [{ role: 'user', content: 'Confirm' }],
        context: baseContext,
        confirmationDecision: 'confirm',
        pendingConfirmation: {
          tool: 'run_notebook',
          input: { mode: 'all' },
          title: 'Run',
          detail: 'run',
          runtime: 'client',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('names the attached files so the model cannot invent one', async () => {
    completeJson.mockResolvedValueOnce({
      content: { reply: 'ok', uiActions: [], proposeOperation: null },
      raw: '{}',
    });

    await service.respond({
      messages: [{ role: 'user', content: 'read the spreadsheet' }],
      context: {
        ...baseContext,
        metadata: {
          sourceType: 'CUSTOM',
          attachedFiles: ['audit.xlsx'],
          notebookConfig: {
            localFolders: [{ name: 'dumps', path: '/mnt/corpora/dumps' }],
          },
        },
      },
    });

    const [messages] = completeJson.mock.calls[0] as [
      Array<{ role: string; content: string }>,
    ];
    const system = messages[0].content;
    const user = messages[1].content;

    expect(user).toContain('"audit.xlsx"');
    expect(user).toContain('dumps -> /mnt/corpora/dumps');
    // The SDK surface is what stops ctx.files["name"], the mistake models make.
    expect(system).toContain('ctx.file(');
    expect(system).toContain('ctx.files is a LIST');
    // The package list is what stops it importing something nobody declared.
    expect(system).toContain('DECLARE EVERY OTHER IMPORT');
    expect(system).toContain('also openpyxl');
  });

  it('says plainly when a source has nothing attached', async () => {
    completeJson.mockResolvedValueOnce({
      content: { reply: 'ok', uiActions: [], proposeOperation: null },
      raw: '{}',
    });

    await service.respond({
      messages: [{ role: 'user', content: 'read my file' }],
      context: { ...baseContext, metadata: { sourceType: 'CUSTOM' } },
    });

    const [messages] = completeJson.mock.calls[0] as [
      Array<{ role: string; content: string }>,
    ];
    expect(messages[1].content).toContain('NO uploaded files');
  });

  it('asks again when a turn comes back completely empty', async () => {
    // A model that produced no structured output has not finished; replying
    // "Done" for it would claim the request was handled when nothing was.
    completeJson
      .mockResolvedValueOnce({ content: {}, raw: '{}' })
      .mockResolvedValueOnce({
        content: {
          reply: 'Here you go.',
          uiActions: [],
          proposeOperation: null,
        },
        raw: '{}',
      });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'write it' }],
      context: baseContext,
    });

    expect(response.reply).toBe('Here you go.');
    expect(completeJson).toHaveBeenCalledTimes(2);
  });

  it('executes a confirmed operation and appends server-built sync actions', async () => {
    callTool.mockResolvedValue({
      ok: true,
      result: {
        id: '3f0c2a4e-8f9f-4a5f-9d3c-2f6a9d8e1b2c',
        name: 'Jira Prod',
        config: { type: 'JIRA', required: { host: 'jira.example.com' } },
        scheduleEnabled: false,
      },
    });
    completeJson.mockResolvedValueOnce({
      content: { reply: 'Created the source. Run a connection test next?' },
      raw: '{}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'Confirm' }],
      context: baseContext,
      pendingConfirmation: {
        tool: 'create_source',
        input: { type: 'JIRA', name: 'Jira Prod', config: {} },
        title: 'Create source via MCP',
        detail: 'create the source "Jira Prod"',
      },
      confirmationDecision: 'confirm',
    });

    expect(callTool).toHaveBeenCalledWith('create_source', {
      type: 'JIRA',
      name: 'Jira Prod',
      config: {},
    });
    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'sync_source' }),
        expect.objectContaining({ type: 'show_toast', tone: 'success' }),
      ]),
    );
    expect(response.reply).toContain('Created the source');
  });

  it('feeds execution failures back into the loop for self-correction', async () => {
    callTool.mockResolvedValue({
      ok: false,
      result: 'required.auth_mode: must be equal to one of the allowed values',
    });
    completeJson.mockResolvedValueOnce({
      content: {
        reply:
          'The auth mode was invalid — I switched it to "basic". Please confirm again.',
        uiActions: [
          {
            type: 'patch_fields',
            patches: [{ path: 'required.auth_mode', value: 'basic' }],
          },
        ],
        proposeOperation: {
          tool: 'create_source',
          input: { type: 'JIRA', config: { auth_mode: 'basic' } },
          title: 'Create source via MCP',
          detail: 'create the source with corrected auth',
        },
      },
      raw: '{}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'Confirm' }],
      context: baseContext,
      pendingConfirmation: {
        tool: 'create_source',
        input: { type: 'JIRA', config: { auth_mode: 'wrong' } },
        title: 'Create source via MCP',
        detail: 'create the source',
      },
      confirmationDecision: 'confirm',
    });

    // The error must reach the model verbatim so it can self-correct.
    const transcript = completeJson.mock.calls[0][0] as Array<{
      content: string;
    }>;
    expect(
      transcript.some((message) => message.content.includes('auth_mode')),
    ).toBe(true);
    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'patch_fields' }),
      ]),
    );
    expect(response.pendingConfirmation).toEqual(
      expect.objectContaining({ tool: 'create_source' }),
    );
    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'create_source', status: 'error' }),
    ]);
  });

  it('cancels a pending operation without executing anything', async () => {
    const response = await service.respond({
      messages: [{ role: 'user', content: 'Cancel' }],
      context: baseContext,
      pendingConfirmation: {
        tool: 'create_source',
        input: {},
        title: 'Create source via MCP',
        detail: 'create the source',
      },
      confirmationDecision: 'cancel',
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(completeJson).not.toHaveBeenCalled();
    expect(response.pendingConfirmation).toBeNull();
    expect(response.reply).toContain('Cancelled');
  });

  it('confirms a mutating tool from any context (full MCP catalog)', async () => {
    // The catalog is exposed 1:1 in every context, so a mutation the page does
    // not "focus" (create_source in app.global) is still confirmable.
    callTool.mockResolvedValueOnce({ ok: true, result: { id: 'src-1' } });
    completeJson.mockResolvedValueOnce({
      content: { reply: 'Created the source.', proposeOperation: null },
      raw: '{"reply":"Created the source."}',
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'Confirm' }],
      context: { ...baseContext, key: 'app.global' as const },
      pendingConfirmation: {
        tool: 'create_source',
        input: { type: 'JIRA', config: {} },
        title: 'Create source via MCP',
        detail: 'create the source',
      },
      confirmationDecision: 'confirm',
    });

    expect(callTool).toHaveBeenCalledWith('create_source', {
      type: 'JIRA',
      config: {},
    });
    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'create_source', status: 'success' }),
    ]);
  });

  it('refuses to confirm an unknown or read-only tool', async () => {
    await expect(
      service.respond({
        messages: [{ role: 'user', content: 'Confirm' }],
        context: baseContext,
        pendingConfirmation: {
          tool: 'list_source_types', // read-only — must never route through confirm
          input: {},
          title: 'Run read tool',
          detail: 'run it',
        },
        confirmationDecision: 'confirm',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('reports gracefully when the iteration budget is exhausted', async () => {
    completeJson.mockResolvedValue({
      content: {
        toolCalls: [{ tool: 'list_source_types', input: {} }],
      },
      raw: '{}',
    });
    callTool.mockResolvedValue({ ok: true, result: { types: [] } });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'loop forever' }],
      context: baseContext,
    });

    expect(response.reply).toContain('ran out of steps');
    expect(response.pendingConfirmation).toBeNull();
  });

  it('parses csv upload payload for assistant context', () => {
    const parsed = service.parseUploadedFile(
      Buffer.from('name,email\nOstap,o@example.com\n', 'utf8'),
      'people.csv',
    );
    expect(parsed.fileType).toBe('csv');
    expect(parsed.rowCount).toBe(1);
    expect(parsed.columns).toEqual(['name', 'email']);
  });

  it('rejects unsupported file extension for assistant uploads', () => {
    expect(() =>
      service.parseUploadedFile(Buffer.from('data', 'utf8'), 'evil.exe'),
    ).toThrow(BadRequestException);
  });
});
