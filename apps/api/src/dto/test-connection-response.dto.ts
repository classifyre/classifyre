import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TestConnectionResponseDto {
  @ApiProperty({
    enum: ['SUCCESS', 'FAILURE'],
    example: 'SUCCESS',
    description: 'Outcome of the connection test.',
  })
  status!: 'SUCCESS' | 'FAILURE';

  @ApiPropertyOptional({
    example: 'Successfully connected to Slack workspace acme.',
    description: 'Human-friendly message about the test result.',
  })
  message?: string;

  @ApiPropertyOptional({
    example: '2026-02-04T14:22:11.123Z',
    description: 'Timestamp emitted by the CLI test result.',
  })
  timestamp?: string;

  @ApiPropertyOptional({
    example: 'SLACK',
    description: 'Source type reported by the CLI test result.',
  })
  source_type?: string;
}
