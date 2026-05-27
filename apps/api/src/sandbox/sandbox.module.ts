import { Module } from '@nestjs/common';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';
import { SandboxFileStorageService } from './sandbox-file-storage.service';
import { PrismaService } from '../prisma.service';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';

@Module({
  imports: [CliRunnerModule],
  controllers: [SandboxController],
  providers: [SandboxService, SandboxFileStorageService, PrismaService],
})
export class SandboxModule {}
