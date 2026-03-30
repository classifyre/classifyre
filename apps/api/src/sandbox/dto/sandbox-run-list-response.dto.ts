import { ApiProperty } from '@nestjs/swagger';
import { SandboxRunDto } from './sandbox-run.dto';

export class SandboxRunListResponseDto {
  @ApiProperty({ type: [SandboxRunDto] })
  items: SandboxRunDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}
