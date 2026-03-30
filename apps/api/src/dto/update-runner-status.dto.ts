import { ApiProperty } from '@nestjs/swagger';
import { RunnerStatus } from '@prisma/client';

export class UpdateRunnerStatusDto {
  @ApiProperty({
    enum: RunnerStatus,
    description: 'The new status for the source runner',
    example: 'COMPLETED',
  })
  status: RunnerStatus;
}
