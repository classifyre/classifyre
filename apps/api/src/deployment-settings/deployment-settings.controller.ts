import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessArea } from '../identity/access.decorators';
import { DeploymentSettingsService } from './deployment-settings.service';
import { RunnerLimitsDto, UpdateRunnerLimitsDto } from './runner-limits.dto';

@ApiTags('Settings')
@AccessArea({ view: 'settings.view', change: 'workspace.settings' })
@Controller()
export class DeploymentSettingsController {
  constructor(private readonly settings: DeploymentSettingsService) {}

  @Get('runner-limits')
  @ApiOperation({
    summary:
      'Scan limits of this workspace: what is saved in Settings and what the chart or image sets',
  })
  @ApiOkResponse({ type: RunnerLimitsDto })
  get(): Promise<RunnerLimitsDto> {
    return this.settings.limits();
  }

  @Put('runner-limits')
  @ApiOperation({
    summary:
      'Set scan limits for this workspace; null hands a limit back to the chart or image. Scans at once can only be held below the installation-wide ceiling',
  })
  @ApiOkResponse({ type: RunnerLimitsDto })
  update(@Body() body: UpdateRunnerLimitsDto): Promise<RunnerLimitsDto> {
    return this.settings.update(body ?? {});
  }
}
