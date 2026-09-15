import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FindingBulkOperationKind,
  FindingBulkOperationStatus,
} from '@prisma/client';

export class FindingBulkOperationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: FindingBulkOperationKind })
  kind: FindingBulkOperationKind;

  @ApiProperty({ enum: FindingBulkOperationStatus })
  status: FindingBulkOperationStatus;

  @ApiProperty({
    description:
      'Findings matched when the operation was created. The corpus can move under a running operation, so treat it as an estimate.',
  })
  totalEstimate: number;

  @ApiProperty({ description: 'Findings the walk has examined so far.' })
  processed: number;

  @ApiProperty({ description: 'Findings actually changed so far.' })
  changed: number;

  @ApiProperty({
    description:
      'Findings deliberately left alone (e.g. cited by a case). Always 0 for a plain status change.',
  })
  exempted: number;

  @ApiProperty({ description: '0-100; 100 only once COMPLETED.' })
  percent: number;

  @ApiProperty({
    type: Object,
    description:
      'Operation-specific tallies. A retire dry run reports byReason, exempt, wouldRetire and notProvable here.',
  })
  counts: Record<string, unknown>;

  @ApiProperty({ type: [String] })
  warnings: string[];

  @ApiProperty({ type: Object })
  filters: Record<string, unknown>;

  @ApiProperty({ type: Object })
  target: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true, type: String })
  errorMessage: string | null;

  @ApiProperty()
  cancelRequested: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  createdBy: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  startedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  finishedAt: Date | null;
}
