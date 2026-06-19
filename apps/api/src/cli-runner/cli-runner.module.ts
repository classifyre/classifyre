import { Module } from '@nestjs/common';
import { CliRunnerService } from './cli-runner.service';
import {
  CliRunnerController,
  SearchRunnersController,
} from './cli-runner.controller';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications.service';
import { KubernetesCliJobService } from './kubernetes-cli-job.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { RunnerLogStorageService } from './runner-log-storage.service';
import { CustomDetectorsService } from '../custom-detectors.service';
import { AiProviderConfigService } from '../ai-provider-config.service';
import { InstanceSettingsService } from '../instance-settings.service';
import { DemoModeService } from '../demo-mode.service';
import { ExportModule } from '../export/export.module';

@Module({
  imports: [ExportModule],
  providers: [
    CliRunnerService,
    PrismaService,
    NotificationsService,
    KubernetesCliJobService,
    MaskedConfigCryptoService,
    CustomDetectorsService,
    AiProviderConfigService,
    InstanceSettingsService,
    DemoModeService,
    RunnerLogStorageService,
  ],
  controllers: [CliRunnerController, SearchRunnersController],
  exports: [
    CliRunnerService,
    RunnerLogStorageService,
    KubernetesCliJobService,
    AiProviderConfigService,
  ],
})
export class CliRunnerModule {}
