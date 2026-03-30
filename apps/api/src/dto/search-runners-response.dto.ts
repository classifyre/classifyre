import { ApiProperty, OmitType } from '@nestjs/swagger';
import { RunnerDto } from '../cli-runner/dto';

export class SearchRunnerItemDto extends OmitType(RunnerDto, [
  'recipe',
  'detectors',
] as const) {}

export class SearchRunnersResponseDto {
  @ApiProperty({ type: [SearchRunnerItemDto] })
  items: SearchRunnerItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}
