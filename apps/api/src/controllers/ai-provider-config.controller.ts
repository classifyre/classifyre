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
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  ) {}

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
    return this.service.update(id, body);
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
      'verify the provider, model, and API key work.',
  })
  @ApiResponse({ status: 200, type: AiProviderConfigTestResultDto })
  @ApiResponse({
    status: 503,
    description: 'AI provider not configured or rate limit hit',
  })
  @ApiResponse({ status: 502, description: 'AI provider returned an error' })
  @HttpCode(200)
  async test(@Param('id') id: string): Promise<AiProviderConfigTestResultDto> {
    try {
      const result = await this.aiClient.completeText(TEST_MESSAGES, {
        configId: id,
      });
      return { provider: result.provider, model: result.model };
    } catch (err) {
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
