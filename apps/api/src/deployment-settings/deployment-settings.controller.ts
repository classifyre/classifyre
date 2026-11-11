import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Requires } from '../identity/access.decorators';
import { DeploymentSettingsService } from './deployment-settings.service';
import { RunnerLimitsDto, UpdateRunnerLimitsDto } from './runner-limits.dto';

@ApiTags('Settings')
@Controller()
export class DeploymentSettingsController {
  constructor(private readonly settings: DeploymentSettingsService) {}

  @Get('runner-limits')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'Scan limits of this deployment: what is saved in Settings and what the chart or image sets',
  })
  @ApiOkResponse({ type: RunnerLimitsDto })
  get(): Promise<RunnerLimitsDto> {
    return this.settings.limits();
  }

  @Put('runner-limits')
  @Requires('workspace.settings')
  @ApiOperation({
    summary:
      'Set scan limits for the whole deployment; null hands a limit back to the chart or image',
  })
  @ApiOkResponse({ type: RunnerLimitsDto })
  update(@Body() body: UpdateRunnerLimitsDto): Promise<RunnerLimitsDto> {
    return this.settings.update(body ?? {});
  }
}
