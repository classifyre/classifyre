import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSourceScheduleDto {
  @ApiProperty({
    description: 'Whether the schedule is enabled',
    example: true,
  })
  enabled: boolean;

  @ApiPropertyOptional({
    description:
      'Cron expression (5-field) for the schedule. Required when enabled is true.',
    example: '0 2 * * *',
  })
  scheduleCron?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone for the schedule',
    example: 'UTC',
    default: 'UTC',
  })
  scheduleTimezone?: string;
}
