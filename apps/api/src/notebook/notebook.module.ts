import { Module } from '@nestjs/common';
import { NotebookController } from './notebook.controller';
import { NotebookService } from './notebook.service';
import { NotebookExecutionService } from './notebook-execution.service';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { PrismaService } from '../prisma.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';

@Module({
  imports: [CliRunnerModule],
  controllers: [NotebookController],
  providers: [
    NotebookService,
    NotebookExecutionService,
    PrismaService,
    MaskedConfigCryptoService,
  ],
  exports: [NotebookService, NotebookExecutionService],
})
export class NotebookModule {}
