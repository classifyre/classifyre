import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SITEMAP_ENTITY_TYPES,
  type SitemapEntityType,
} from './sitemap.entities';

export class SitemapChunkDto {
  @ApiProperty({
    description: 'Zero-based chunk number within its section.',
    example: 0,
  })
  index: number;

  @ApiProperty({ description: 'URLs in this chunk.', example: 10000 })
  count: number;

  @ApiPropertyOptional({
    description:
      'Newest last-modified instant across the chunk, for the sitemap index <lastmod>. Null when unknown, in which case <lastmod> is omitted.',
    example: '2026-08-04T10:00:00.000Z',
    nullable: true,
  })
  lastModified: string | null;
}

export class SitemapSectionDto {
  @ApiProperty({ enum: SITEMAP_ENTITY_TYPES })
  type: SitemapEntityType;

  @ApiProperty({ description: 'Total detail pages of this type.' })
  total: number;

  @ApiPropertyOptional({
    description:
      'Newest last-modified instant across the section, null when empty.',
    nullable: true,
  })
  lastModified: string | null;

  @ApiProperty({ type: [SitemapChunkDto] })
  chunks: SitemapChunkDto[];
}

export class SitemapIndexDto {
  @ApiProperty({ example: '2026-08-04T10:00:00.000Z' })
  generatedAt: string;

  @ApiProperty({ description: 'URLs per chunk this index was computed with.' })
  chunkSize: number;

  @ApiProperty({ type: [SitemapSectionDto] })
  sections: SitemapSectionDto[];
}

export class SitemapEntryDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({
    example: '2026-08-04T10:00:00.000Z',
    nullable: true,
    description: 'Null when unknown; the rendered <lastmod> is then omitted.',
  })
  lastModified: string | null;
}

export class SitemapEntriesDto {
  @ApiProperty({ enum: SITEMAP_ENTITY_TYPES })
  type: SitemapEntityType;

  @ApiProperty()
  chunk: number;

  @ApiProperty()
  chunkSize: number;

  @ApiProperty({ type: [SitemapEntryDto] })
  entries: SitemapEntryDto[];
}
