import { ApiProperty } from '@nestjs/swagger';

export class SearchFindingsCustomDetectorOptionDto {
  @ApiProperty({ description: 'Custom detector key' })
  key: string;

  @ApiProperty({ description: 'Custom detector display name' })
  name: string;

  @ApiProperty({ description: 'Number of findings for this custom detector' })
  count: number;
}
