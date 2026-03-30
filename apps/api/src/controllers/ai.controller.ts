import {
  BadGatewayException,
  Body,
  Controller,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AiAuthError,
  AiClientService,
  AiConfigError,
  AiModelNotFoundError,
  AiProviderError,
  AiRateLimitError,
} from '../ai';
import {
  AiCompleteRequestDto,
  AiCompleteResponseDto,
} from '../dto/ai-complete.dto';

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly aiClient: AiClientService) {}

  @Post('complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Generate a text completion',
    description:
      'Sends messages to the configured AI provider and returns a plain-text response.',
  })
  @ApiBody({ type: AiCompleteRequestDto })
  @ApiResponse({ status: 200, type: AiCompleteResponseDto })
  @ApiResponse({
    status: 503,
    description: 'AI provider not configured or rate limit hit',
  })
  @ApiResponse({ status: 502, description: 'AI provider returned an error' })
  async complete(
    @Body() body: AiCompleteRequestDto,
  ): Promise<AiCompleteResponseDto> {
    try {
      const result = await this.aiClient.completeText(body.messages);
      return {
        content: result.content,
        model: result.model,
        provider: result.provider,
      };
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
}
