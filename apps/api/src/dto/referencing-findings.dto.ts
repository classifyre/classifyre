import { ApiProperty } from '@nestjs/swagger';
import { FindingStatus, Severity } from '@prisma/client';

/** One finding recorded on an asset that points at the asset being viewed. */
export class ReferencingFindingDto {
  @ApiProperty()
  findingId!: string;

  @ApiProperty({ enum: Severity })
  severity!: Severity;

  @ApiProperty({ enum: FindingStatus })
  status!: FindingStatus;

  @ApiProperty()
  findingType!: string;

  @ApiProperty({ type: String, nullable: true })
  matchedContent!: string | null;

  @ApiProperty()
  detectedAt!: Date;

  @ApiProperty({
    description: 'The asset the finding is actually recorded on.',
  })
  viaAssetId!: string;

  @ApiProperty()
  viaAssetName!: string;

  @ApiProperty({
    description: 'The edge that connects that asset to this one.',
  })
  relationType!: string;
}

/**
 * What other assets say about this one.
 *
 * An integrity check or a derived profile is its own asset that `references()`
 * the thing it is about, so the subject's own Findings tab was empty while a
 * finding pointed straight at it (GENESIS field report P12).
 */
export class ReferencingFindingsResponseDto {
  @ApiProperty()
  assetId!: string;

  @ApiProperty({ description: 'How many assets point at this one.' })
  referencingAssets!: number;

  @ApiProperty({
    description:
      'True when there were more incoming edges or findings than this response carries.',
  })
  truncated!: boolean;

  @ApiProperty({ type: [ReferencingFindingDto] })
  items!: ReferencingFindingDto[];
}
