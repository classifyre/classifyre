import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InstanceSettingsService } from '../instance-settings.service';
import { InstanceSettingsResponseDto } from '../dto/instance-settings-response.dto';
import { UpdateInstanceSettingsDto } from '../dto/update-instance-settings.dto';

@ApiTags('Instance Settings')
@Controller('instance-settings')
export class InstanceSettingsController {
  constructor(
    private readonly instanceSettingsService: InstanceSettingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get instance settings',
    description:
      'Retrieve global instance-level settings used across the entire application.',
  })
  @ApiResponse({
    status: 200,
    description: 'Instance settings payload',
    type: InstanceSettingsResponseDto,
  })
  async getSettings(): Promise<InstanceSettingsResponseDto> {
    return this.instanceSettingsService.getSettings();
  }

  @Put()
  @ApiOperation({
    summary: 'Update instance settings',
    description:
      'Update global instance-level settings used across the entire application.',
  })
  @ApiBody({ type: UpdateInstanceSettingsDto })
  @ApiResponse({
    status: 200,
    description: 'Updated instance settings payload',
    type: InstanceSettingsResponseDto,
  })
  async updateSettings(
    @Body() body: UpdateInstanceSettingsDto,
  ): Promise<InstanceSettingsResponseDto> {
    return this.instanceSettingsService.updateSettings(body);
  }
}
