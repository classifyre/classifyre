import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AiProviderConfigService } from '../ai-provider-config.service';
import {
  AiAuthError,
  AiClientService,
  AiConfigError,
  AiModelNotFoundError,
  AiProviderError,
  AiRateLimitError,
} from '../ai';
import {
  AiProviderConfigResponseDto,
  AiProviderConfigTestResultDto,
  CreateAiProviderConfigDto,
  UpdateAiProviderConfigDto,
} from '../dto/ai-provider-config.dto';
import { AssistantCapabilityReportDto } from '../dto/assistant-capability.dto';
import { AssistantCapabilityService } from '../autopilot/capability/assistant-capability.service';
import { EmbeddingProviderService } from '../embedding/embedding-provider.service';
import {
  EmbeddingSettingsService,
  SPACE_DEFINING_FIELDS,
  resolvedFromEnv,
} from '../embedding/embedding-settings.service';
import { EmbeddingRebuildService } from '../embedding/embedding-rebuild.service';
import { EmbeddingConfigService } from '../embedding/embedding-config.service';

const TEST_MESSAGES = [
  {
    role: 'system' as const,
    content:
      'You are a helpful assistant. Always respond with raw valid JSON — no markdown, no explanation.',
  },
  {
    role: 'user' as const,
    content:
      'Reply with exactly this JSON structure: {"status":"ok","square":49,"language":"TypeScript"}',
  },
];

@ApiTags('AI Provider Configs')
@Controller('ai-provider-configs')
export class AiProviderConfigController {
  constructor(
    private readonly service: AiProviderConfigService,
    private readonly aiClient: AiClientService,
    private readonly capability: AssistantCapabilityService,
    private readonly embeddingProvider: EmbeddingProviderService,
    private readonly embeddingDefaults: EmbeddingConfigService,
    private readonly embeddingSettings: EmbeddingSettingsService,
    private readonly embeddingRebuilds: EmbeddingRebuildService,
  ) {}

  /**
   * Runs a change to a credential, keeping the embedding subsystem honest.
   *
   * The resolved embedding configuration is cached per workspace and inherits
   * model, dimensions and pooling from the bound provider, so editing the
   * provider redefined the vector space while every reader kept answering with
   * the old one until the API restarted — and the stored vectors were never
   * rebuilt for the new space. Re-resolving around the write catches both.
   */
  private async withEmbeddingRebind<T>(
    id: string,
    apply: () => Promise<T>,
  ): Promise<T> {
    const overrides = await this.embeddingSettings
      .overrides()
      .catch(() => null);
    if (overrides?.aiProviderConfigId !== id) return apply();

    const before = await this.embeddingSettings.resolve();
    const result = await apply();
    this.embeddingSettings.invalidate();
    const after = await this.embeddingSettings.resolve();
    const changed = SPACE_DEFINING_FIELDS.filter(
      (field) => before[field] !== after[field],
    );
    if (changed.length > 0) {
      this.embeddingRebuilds.start(
        `Embedding provider changed: ${changed.join(', ')}`,
      );
    }
    return result;
  }

  @Get()
  @ApiOperation({
    summary: 'List AI provider configurations',
    description:
      'Returns all stored AI provider credentials with masked API key previews.',
  })
  @ApiResponse({ status: 200, type: [AiProviderConfigResponseDto] })
  async list(): Promise<AiProviderConfigResponseDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single AI provider configuration' })
  @ApiResponse({ status: 200, type: AiProviderConfigResponseDto })
  async get(@Param('id') id: string): Promise<AiProviderConfigResponseDto> {
    return this.service.get(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an AI provider configuration',
    description:
      'Create a reusable credential. The API key is sent in plaintext and stored encrypted.',
  })
  @ApiBody({ type: CreateAiProviderConfigDto })
  @ApiResponse({ status: 201, type: AiProviderConfigResponseDto })
  async create(
    @Body() body: CreateAiProviderConfigDto,
  ): Promise<AiProviderConfigResponseDto> {
    return this.service.create(body);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update an AI provider configuration',
    description:
      'Update any combination of name, provider, model, API key (plaintext — stored encrypted), ' +
      'base URL, and context size. Pass apiKey as an empty string to clear a stored key.',
  })
  @ApiBody({ type: UpdateAiProviderConfigDto })
  @ApiResponse({ status: 200, type: AiProviderConfigResponseDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAiProviderConfigDto,
  ): Promise<AiProviderConfigResponseDto> {
    return this.withEmbeddingRebind(id, () => this.service.update(id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an AI provider configuration' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }

  @Post(':id/test')
  @ApiOperation({
    summary: 'Test an AI provider configuration',
    description:
      'Runs a small structured-JSON round-trip against the given credential to ' +
      'verify the provider, model, and API key work. Expected configuration and ' +
      'provider failures are returned as structured diagnostics.',
  })
  @ApiResponse({ status: 200, type: AiProviderConfigTestResultDto })
  @HttpCode(200)
  async test(@Param('id') id: string): Promise<AiProviderConfigTestResultDto> {
    const startedAt = Date.now();
    const config = await this.service.get(id);
    // An embeddings endpoint cannot answer a chat completion, so testing one
    // with the generic probe reports a working credential as broken.
    if (config.supportsEmbedding) {
      return this.testEmbedding(id, startedAt);
    }
    try {
      const result = await this.aiClient.completeText(TEST_MESSAGES, {
        configId: id,
      });
      return {
        status: 'PASS',
        category: 'CONNECTION',
        provider: result.provider,
        model: result.model,
        message: `${config.name} connected successfully and ${result.model} returned a response.`,
        details: [
          'The stored credential was decrypted successfully.',
          'The provider accepted a real completion request.',
          'The configured model returned content before the timeout.',
        ],
        durationMs: Date.now() - startedAt,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        responsePreview: preview(result.content),
      };
    } catch (err) {
      const diagnostic = connectionFailure(err);
      if (diagnostic) {
        return {
          status: 'FAIL',
          category: diagnostic.category,
          provider: config.provider,
          model: config.model,
          message: diagnostic.message,
          details: diagnostic.details,
          durationMs: Date.now() - startedAt,
          inputTokens: null,
          outputTokens: null,
          responsePreview: null,
        };
      }
      throw err;
    }
  }

  /**
   * Connection test for a provider that serves embeddings.
   *
   * Passing means three separate things worked: the key decrypted, the
   * endpoint accepted an embeddings request for this model, and the returned
   * vector is the width the provider claims. The third is the one worth
   * checking — a dimension mismatch does not fail here, it fails on the first
   * batch of a rebuild, hours later, with the corpus already deleted.
   */
  private async testEmbedding(
    id: string,
    startedAt: number,
  ): Promise<AiProviderConfigTestResultDto> {
    const config = await this.service.get(id);
    try {
      const runtime = await this.service.getRuntimeConfig(id);
      const declared = config.embeddingDimensions ?? null;
      const result = await this.embeddingProvider.testConnection(
        {
          ...resolvedFromEnv(this.embeddingDefaults),
          provider: 'openai-compatible',
          model: config.model,
          baseUrl: runtime.baseUrl ?? undefined,
          apiKey: runtime.apiKey,
          dimensions: declared ?? this.embeddingDefaults.dimensions,
          // The probe must not be rejected for the width it came back with —
          // testConnection reports the mismatch, embedMany would throw on it.
          normalize: false,
        },
        // Declared width only: a provider *told* to produce 384 dimensions
        // produces them, and the check meant to catch a misconfiguration
        // passes on a vector the deployment default asked for.
        { declaredDimensions: declared },
      );

      const mismatch =
        declared != null && result.dimensions !== result.expectedDimensions;
      // Nothing else can learn this width, and leaving it unset is what makes
      // the first rebuild fail hours later. Record what the model actually
      // returned so the vector space is built for it.
      const learned =
        declared == null
          ? await this.withEmbeddingRebind(id, () =>
              this.service.update(id, {
                embeddingDimensions: result.dimensions,
              }),
            )
              .then(() => true)
              .catch(() => false)
          : false;
      return {
        status: mismatch ? 'FAIL' : 'PASS',
        category: mismatch ? 'CONFIGURATION' : 'CONNECTION',
        provider: config.provider,
        model: config.model,
        message: mismatch
          ? `${config.name} embedded the probe text, but ${config.model} returned ` +
            `${result.dimensions} dimensions while this provider is configured for ` +
            `${result.expectedDimensions}. Set dimensions to ${result.dimensions}.`
          : `${config.name} connected successfully and ${config.model} returned a ` +
            `${result.dimensions}-dimension vector.`,
        details: [
          'The stored credential was decrypted successfully.',
          'The provider accepted a real embeddings request.',
          mismatch
            ? `Returned ${result.dimensions} dimensions, expected ${result.expectedDimensions}.`
            : declared != null
              ? `The returned vector width matches the configured ${result.expectedDimensions} dimensions.`
              : learned
                ? `Dimensions were not set; saved the ${result.dimensions} this model returned.`
                : `This model returns ${result.dimensions} dimensions.`,
        ],
        durationMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        responsePreview: null,
      };
    } catch (err) {
      const diagnostic = connectionFailure(err);
      return {
        status: 'FAIL',
        category: diagnostic?.category ?? 'CONNECTION',
        provider: config.provider,
        model: config.model,
        message:
          diagnostic?.message ??
          `The embeddings request failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        details: diagnostic?.details ?? [
          'The provider was reachable but did not return a usable vector.',
          'Check that the model name is an embeddings model for this endpoint.',
        ],
        durationMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        responsePreview: null,
      };
    }
  }

  @Post(':id/capability-test-stream')
  @ApiOperation({
    summary:
      'Stream Harness capability-test progress as newline-delimited JSON',
  })
  @ApiProduces('application/x-ndjson')
  @ApiResponse({
    status: 200,
    description:
      'Progress events followed by a complete event containing the capability report.',
    schema: { type: 'string' },
  })
  @HttpCode(200)
  async capabilityTestStream(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.raw.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.hijack();

    const send = (event: unknown) => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      }
    };

    try {
      const report = await this.capability.run(id, send);
      send({ type: 'complete', report });
    } catch (err) {
      send({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'The Harness capability test could not complete.',
      });
    } finally {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  }

  @Post(':id/capability-test')
  @ApiOperation({
    summary: 'Grade a credential against what the agent harness requires',
    description:
      'Runs a graded probe suite against the model using the real harness turn ' +
      'contract, the real tool catalog and the real mission prompts, then reports ' +
      'per-agent readiness and context headroom. Unlike /test (which proves the key ' +
      'and model id work), this measures whether the model can actually drive the ' +
      'agent loop: strict JSON, tool selection, schema-valid arguments, and chaining ' +
      'a tool observation into a dependent call.\n\n' +
      'No tool handler is invoked — every observation fed to the model is a fixture, ' +
      'so the run has no side effects. Selection is never gated on the result.',
  })
  @ApiResponse({ status: 200, type: AssistantCapabilityReportDto })
  @ApiResponse({
    status: 503,
    description: 'AI provider not configured or rate limit hit',
  })
  @ApiResponse({ status: 502, description: 'AI provider returned an error' })
  @HttpCode(200)
  async capabilityTest(
    @Param('id') id: string,
  ): Promise<AssistantCapabilityReportDto> {
    try {
      return await this.capability.run(id);
    } catch (err) {
      // Individual probe failures are graded, not thrown — reaching here means
      // the suite could not run at all (bad credential, provider down).
      if (err instanceof AiConfigError || err instanceof AiRateLimitError) {
        throw new ServiceUnavailableException(err.message);
      }
      if (
        err instanceof AiAuthError ||
        err instanceof AiModelNotFoundError ||
        err instanceof AiProviderError
      ) {
        throw new BadGatewayException(err.message);
      }
      throw err;
    }
  }
}

function preview(content: string): string | null {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 280) : null;
}

function connectionFailure(error: unknown): {
  category: Exclude<AiProviderConfigTestResultDto['category'], 'CONNECTION'>;
  message: string;
  details: string[];
} | null {
  if (error instanceof AiConfigError) {
    return {
      category: 'CONFIGURATION',
      message: error.message,
      details: [
        'The request was not sent because the saved provider configuration is incomplete.',
        'Check the API key, model identifier, and base URL.',
      ],
    };
  }
  if (error instanceof AiAuthError) {
    return {
      category: 'AUTHENTICATION',
      message: error.message,
      details: [
        'The provider rejected the saved credential.',
        'Replace the API key and verify that it has permission to use this model.',
      ],
    };
  }
  if (error instanceof AiModelNotFoundError) {
    return {
      category: 'MODEL',
      message: error.message,
      details: [
        'The provider was reached, but the configured model was not available.',
        'Check the exact model identifier and whether this account can access it.',
      ],
    };
  }
  if (error instanceof AiRateLimitError) {
    return {
      category: 'RATE_LIMIT',
      message: error.message,
      details: [
        'The provider was reached but refused the request because of a usage limit.',
        'Check provider quota and billing, then retry later.',
      ],
    };
  }
  if (error instanceof AiProviderError) {
    return {
      category: 'PROVIDER',
      message: error.message,
      details: [
        'The provider request failed before a usable response was returned.',
        'Check the base URL and provider availability, then retry.',
      ],
    };
  }
  return null;
}
