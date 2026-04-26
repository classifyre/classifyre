export class CustomDetectorExtractionDto {
  id!: string;
  findingId!: string;
  customDetectorId!: string | null;
  customDetectorKey!: string;
  sourceId!: string;
  assetId!: string;
  runnerId!: string | null;
  detectorVersion!: number;
  pipelineResult!: Record<string, unknown>;
  extractedAt!: Date;
  createdAt!: Date;
}

export class SearchExtractionsQueryDto {
  customDetectorKey?: string;
  customDetectorId?: string;
  sourceId?: string;
  assetId?: string;
  take?: number;
  skip?: number;
}
