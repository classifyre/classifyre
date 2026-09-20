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

/**
 * The stored outcome of an asynchronous connection test.
 *
 * `POST /sources/{id}/test/async` starts one and returns this with status
 * RUNNING; `GET /sources/{id}/test` returns the same record until it reaches a
 * terminal status. The synchronous endpoint stays for connectors that answer
 * in a second — this one exists because a Kubernetes test pod can wait minutes
 * to be scheduled, and a request held open that long fails behind any ingress
 * with a 60 s timeout (GENESIS field report P2).
 */
export class ConnectionTestStatusDto {
  @ApiProperty({
    enum: ['RUNNING', 'SUCCESS', 'FAILURE'],
    description:
      'RUNNING until the test answers. A test with no result after 15 minutes is reported FAILURE rather than left spinning.',
  })
  status!: 'RUNNING' | 'SUCCESS' | 'FAILURE';

  @ApiPropertyOptional({ type: String, nullable: true })
  startedAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  finishedAt?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "The connector's own message, once it has one.",
  })
  message?: string | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description:
      'The full CLI test result, in the shape the synchronous endpoint returns.',
  })
  result?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  triggeredBy?: string | null;
}
