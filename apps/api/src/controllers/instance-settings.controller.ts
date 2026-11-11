import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InstanceSettingsService } from '../instance-settings.service';
import {
  DisplaySettingsDto,
  InstanceSettingsResponseDto,
} from '../dto/instance-settings-response.dto';
import { UpdateInstanceSettingsDto } from '../dto/update-instance-settings.dto';
import { AccessArea, Requires } from '../identity/access.decorators';

@ApiTags('Instance Settings')
@AccessArea({ view: 'settings.view', change: 'workspace.settings' })
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

  @Get('display')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'How dates and language are shown',
    description:
      'Language, time zone and time format: what every page needs to display dates, for anyone who can open the workspace. The rest of the settings need settings.view.',
  })
  @ApiResponse({ status: 200, type: DisplaySettingsDto })
  async getDisplaySettings(): Promise<DisplaySettingsDto> {
    const { language, timezone, timeFormat } =
      await this.instanceSettingsService.getSettings();
    return { language, timezone, timeFormat };
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
