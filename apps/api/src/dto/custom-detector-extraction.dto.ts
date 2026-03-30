export class ExtractionFieldCoverageDto {
  field!: string;
  populated!: number;
  total!: number;
  rate!: number;
}

export class ExtractionCoverageDto {
  customDetectorId!: string;
  customDetectorKey!: string;
  totalFindings!: number;
  findingsWithExtraction!: number;
  coverageRate!: number;
  fieldCoverage!: ExtractionFieldCoverageDto[];
}

export class CustomDetectorExtractionDto {
  id!: string;
  findingId!: string;
  customDetectorId!: string | null;
  customDetectorKey!: string;
  sourceId!: string;
  assetId!: string;
  runnerId!: string | null;
  extractionMethod!: string;
  detectorVersion!: number;
  fieldCount!: number;
  populatedFields!: string[];
  extractedData!: Record<string, unknown>;
  extractedAt!: Date;
  createdAt!: Date;
}

export class SearchExtractionsQueryDto {
  customDetectorKey?: string;
  customDetectorId?: string;
  sourceId?: string;
  assetId?: string;
  populatedField?: string;
  fieldFilter?: Record<string, unknown>;
  take?: number;
  skip?: number;
}
