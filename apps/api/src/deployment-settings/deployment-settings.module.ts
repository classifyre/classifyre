import { Global, Module } from '@nestjs/common';
import { DeploymentSettingsController } from './deployment-settings.controller';
import { DeploymentSettingsService } from './deployment-settings.service';

@Global()
@Module({
  controllers: [DeploymentSettingsController],
  providers: [DeploymentSettingsService],
  exports: [DeploymentSettingsService],
})
export class DeploymentSettingsModule {}
