import { Module } from '@nestjs/common';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { PrismaService } from '../prisma.service';
import { CustomSourceNotebookService } from './custom-source-notebook.service';
import { CustomSourceSessionService } from './custom-source-session.service';
import { CustomSourcesController } from './custom-sources.controller';

@Module({
  imports: [CliRunnerModule],
  controllers: [CustomSourcesController],
  providers: [
    CustomSourceNotebookService,
    CustomSourceSessionService,
    PrismaService,
    MaskedConfigCryptoService,
  ],
  exports: [CustomSourceNotebookService, CustomSourceSessionService],
})
export class CustomSourcesModule {}
