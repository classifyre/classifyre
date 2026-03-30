jest.mock('@workspace/schemas/assistant', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const z = require('zod/v4');

  const assistantOperationSchema = z.enum([
    'create_source',
    'update_source',
    'test_source_connection',
    'create_custom_detector',
    'train_custom_detector',
  ]);

  const assistantFieldPatchSchema = z.object({
    path: z.string(),
    value: z.unknown(),
  });

  const assistantPendingConfirmationSchema = z.object({
    operation: assistantOperationSchema,
    title: z.string(),
    detail: z.string(),
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
      key: z.enum(['source.create', 'source.edit', 'detector.create']),
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
      supportedOperations: z.array(assistantOperationSchema),
    }),
    pendingConfirmation: assistantPendingConfirmationSchema
      .nullable()
      .optional(),
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

  return {
    assistantContexts: {
      'source.create': {
        title: 'Source Setup Assistant',
        summary: 'Create or test a source.',
        supportedOperations: [
          'create_source',
          'update_source',
          'test_source_connection',
        ],
      },
      'source.edit': {
        title: 'Source Edit Assistant',
        summary: 'Update or test a source.',
        supportedOperations: ['update_source', 'test_source_connection'],
      },
      'detector.create': {
        title: 'Detector Studio Assistant',
        summary: 'Create or train a detector.',
        supportedOperations: [
          'create_custom_detector',
          'train_custom_detector',
        ],
      },
    },
    assistantFieldPatchSchema,
    assistantOperationSchema,
    assistantChatRequestSchema,
    assistantChatResponseSchema,
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { AssistantService } from './assistant.service';
import { AiClientService } from './ai';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { BadRequestException } from '@nestjs/common';

describe('AssistantService', () => {
  let service: AssistantService;

  const aiClient = {
    completeJson: jest.fn(),
    completeText: jest.fn(),
  };
  const mcpToolExecutor = {
    createSource: jest.fn(),
    updateSource: jest.fn(),
    testSourceConnection: jest.fn(),
    createCustomDetector: jest.fn(),
    trainCustomDetector: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        {
          provide: AiClientService,
          useValue: aiClient,
        },
        {
          provide: McpToolExecutorService,
          useValue: mcpToolExecutor,
        },
      ],
    }).compile();

    service = module.get(AssistantService);
    jest.clearAllMocks();
    aiClient.completeText.mockResolvedValue({
      content: '',
    });
  });

  it('returns local patches and a pending confirmation for source creation', async () => {
    aiClient.completeJson.mockResolvedValue({
      content: {
        assistantMessage: 'I filled in the workspace details.',
        patches: [
          {
            path: 'required.workspace',
            value: 'acme',
          },
        ],
        requestedOperation: 'create_source',
      },
    });

    const response = await service.respond({
      messages: [
        { role: 'user', content: 'Set up an Acme Slack source and save it' },
      ],
      context: {
        key: 'source.create',
        route: '/sources/new',
        title: 'Source Setup Assistant',
        entityId: null,
        values: {
          name: 'Acme Slack',
          type: 'SLACK',
        },
        schema: {
          type: 'object',
        },
        validation: {
          isValid: true,
          missingFields: [],
          errors: [],
        },
        metadata: {
          sourceType: 'SLACK',
          schedule: {
            enabled: false,
            cron: '',
            timezone: 'UTC',
          },
          detectors: [],
          customDetectorIds: [],
        },
        supportedOperations: ['create_source'],
      },
    });

    expect(response.actions).toEqual([
      {
        type: 'patch_fields',
        patches: [{ path: 'required.workspace', value: 'acme' }],
      },
    ]);
    expect(response.pendingConfirmation).toMatchObject({
      operation: 'create_source',
    });
  });

  it('executes a confirmed source creation through the internal executor', async () => {
    mcpToolExecutor.createSource.mockResolvedValue({
      id: '06903ce7-29c2-44ef-87fa-5fc8e8ef126b',
      name: 'Acme Slack',
      config: {
        type: 'SLACK',
        required: {
          workspace: 'acme',
        },
      },
      scheduleEnabled: false,
    });

    const response = await service.respond({
      messages: [
        { role: 'assistant', content: 'Confirm to create the source.' },
        { role: 'user', content: 'Confirm' },
      ],
      pendingConfirmation: {
        operation: 'create_source',
        title: 'Create source via MCP',
        detail: 'create the source "Acme Slack"',
      },
      context: {
        key: 'source.create',
        route: '/sources/new',
        title: 'Source Setup Assistant',
        entityId: null,
        values: {
          name: 'Acme Slack',
          type: 'SLACK',
          required: {
            workspace: 'acme',
          },
        },
        schema: {
          type: 'object',
        },
        validation: {
          isValid: true,
          missingFields: [],
          errors: [],
        },
        metadata: {
          sourceType: 'SLACK',
          schedule: {
            enabled: false,
            cron: '',
            timezone: 'UTC',
          },
          detectors: [],
          customDetectorIds: [],
        },
        supportedOperations: [
          'create_source',
          'update_source',
          'test_source_connection',
        ],
      },
    });

    expect(mcpToolExecutor.createSource).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SLACK',
        name: 'Acme Slack',
      }),
    );
    expect(response.pendingConfirmation).toBeNull();
    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sync_source',
          sourceId: '06903ce7-29c2-44ef-87fa-5fc8e8ef126b',
        }),
      ]),
    );
    expect(aiClient.completeText).toHaveBeenCalled();
  });

  it('applies inferred name patch and asks for missing fields when user gives partial intent', async () => {
    aiClient.completeJson.mockResolvedValue({
      content: {
        assistantMessage:
          "I've set the name to 'MongoDB Atlas'. What's the connection string for your cluster?",
        patches: [{ path: 'name', value: 'MongoDB Atlas' }],
        requestedOperation: null,
      },
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'create mongodb atlas source' }],
      context: {
        key: 'source.create',
        route: '/sources/new',
        title: 'Source Setup Assistant',
        entityId: null,
        values: { name: '', type: 'MONGODB' },
        schema: { type: 'object' },
        validation: {
          isValid: false,
          missingFields: ['name', 'required.connection_string'],
          errors: [],
        },
        metadata: {
          sourceType: 'MONGODB',
          schedule: { enabled: false, cron: '', timezone: 'UTC' },
          detectors: [],
          customDetectorIds: [],
        },
        supportedOperations: [
          'create_source',
          'update_source',
          'test_source_connection',
        ],
      },
    });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'patch_fields',
          patches: expect.arrayContaining([
            { path: 'name', value: 'MongoDB Atlas' },
          ]),
        }),
      ]),
    );
    expect(response.pendingConfirmation).toBeNull();
    expect(response.reply).toContain('MongoDB Atlas');
  });

  it('returns null requestedOperation when operation is not supported in context', async () => {
    aiClient.completeJson.mockResolvedValue({
      content: {
        assistantMessage: 'I can help you update this detector.',
        patches: [],
        requestedOperation: null,
      },
    });

    const response = await service.respond({
      messages: [{ role: 'user', content: 'create a new source' }],
      context: {
        key: 'detector.create',
        route: '/detectors/new',
        title: 'Detector Studio Assistant',
        entityId: null,
        values: { name: '', method: 'CLASSIFIER' },
        schema: { type: 'object' },
        validation: { isValid: false, missingFields: ['name'], errors: [] },
        metadata: {},
        supportedOperations: [
          'create_custom_detector',
          'train_custom_detector',
        ],
      },
    });

    expect(response.pendingConfirmation).toBeNull();
  });

  it('parses csv upload payload for assistant context', () => {
    const parsed = service.parseUploadedFile(
      Buffer.from('label,text\nrisk,Some risk\nsafe,Some safe', 'utf8'),
      'examples.csv',
    );

    expect(parsed.fileType).toBe('csv');
    expect(parsed.fileName).toBe('examples.csv');
    expect(parsed.summary).toContain('Parsed');
  });

  it('rejects unsupported file extension for assistant uploads', () => {
    expect(() =>
      service.parseUploadedFile(Buffer.from('abc', 'utf8'), 'archive.zip'),
    ).toThrow(BadRequestException);
  });
});
