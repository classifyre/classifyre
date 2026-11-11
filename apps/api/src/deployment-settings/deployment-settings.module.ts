import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DeploymentSettingsController } from './deployment-settings.controller';
import { DeploymentSettingsService } from './deployment-settings.service';

@Global()
@Module({
  controllers: [DeploymentSettingsController],
  providers: [PrismaService, DeploymentSettingsService],
  exports: [DeploymentSettingsService],
})
export class DeploymentSettingsModule {}
