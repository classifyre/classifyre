import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiProviderConfigService } from '../ai-provider-config.service';
import {
  AiProviderConfigResponseDto,
  UpdateAiProviderConfigDto,
} from '../dto/ai-provider-config.dto';

@ApiTags('Instance Settings')
@Controller('instance-settings/ai-provider')
export class AiProviderConfigController {
  constructor(private readonly service: AiProviderConfigService) {}

  @Get()
  @ApiOperation({
    summary: 'Get AI provider configuration',
    description:
      'Returns the current AI provider, model, base URL, and a masked API key preview.',
  })
  @ApiResponse({ status: 200, type: AiProviderConfigResponseDto })
  async getConfig(): Promise<AiProviderConfigResponseDto> {
    return this.service.getConfig();
  }

  @Put()
  @ApiOperation({
    summary: 'Update AI provider configuration',
    description:
      'Update any combination of provider, model, API key (plaintext — stored encrypted), and base URL. ' +
      'Pass apiKey as an empty string to clear a stored key.',
  })
  @ApiBody({ type: UpdateAiProviderConfigDto })
  @ApiResponse({ status: 200, type: AiProviderConfigResponseDto })
  async updateConfig(
    @Body() body: UpdateAiProviderConfigDto,
  ): Promise<AiProviderConfigResponseDto> {
    return this.service.updateConfig(body);
  }
}
