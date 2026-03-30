import { Module } from '@nestjs/common';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';
import { PrismaService } from '../prisma.service';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';

@Module({
  imports: [CliRunnerModule],
  controllers: [SandboxController],
  providers: [SandboxService, PrismaService],
})
export class SandboxModule {}
