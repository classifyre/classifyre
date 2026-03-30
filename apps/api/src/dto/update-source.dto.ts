import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { SOURCE_TYPE_ENUM, type SourceType } from './source-type-schema';

export class UpdateSourceDto {
  @ApiProperty({
    enum: SOURCE_TYPE_ENUM,
    description: 'The type of the source',
    example: 'WORDPRESS',
    required: false,
  })
  @IsOptional()
  @IsIn(SOURCE_TYPE_ENUM)
  type?: SourceType;

  @ApiProperty({
    description: 'The name of the source',
    example: 'Production WordPress',
    required: false,
  })
  name?: string;

  @ApiProperty({
    description: 'Configuration for the source (depends on type)',
    example: {
      type: 'WORDPRESS',
      required: {
        url: 'https://blog.example.com',
      },
      masked: {
        username: 'admin',
        application_password: 'your-application-password',
      },
      optional: {
        content: {
          fetch_posts: true,
          fetch_pages: true,
        },
      },
    },
    required: false,
  })
  config?: Record<string, any>;

  @ApiProperty({
    description: 'Whether to enable a recurring schedule for this source',
    example: true,
    required: false,
  })
  scheduleEnabled?: boolean;

  @ApiProperty({
    description:
      '5-field cron expression (required when scheduleEnabled is true)',
    example: '30 1 * * *',
    required: false,
  })
  scheduleCron?: string;

  @ApiProperty({
    description: 'IANA timezone for the cron schedule',
    example: 'UTC',
    required: false,
  })
  scheduleTimezone?: string;
}
