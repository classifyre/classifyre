import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NotebookDto {
  @ApiProperty({ description: 'Revision number; 0 when nothing is saved yet' })
  revision!: number;

  @ApiProperty({ description: 'Notebook source code' })
  content!: string;

  @ApiProperty({
    description: 'True when the source has no saved notebook yet',
  })
  isStarter!: boolean;
}

export class NotebookRevisionDto {
  @ApiProperty() id!: string;
  @ApiProperty() revision!: number;
  @ApiProperty() contentHash!: string;
  @ApiPropertyOptional({ nullable: true }) message?: string | null;
  @ApiProperty() createdAt!: Date;
}

export class SaveNotebookDto {
  @ApiProperty({ description: 'Full notebook source code' })
  content!: string;

  @ApiPropertyOptional({ description: 'Short note describing the change' })
  message?: string;
}

export class SaveNotebookResponseDto {
  @ApiProperty() revision!: number;

  @ApiProperty({
    description:
      'True when the content matched the current revision and no new one was written',
  })
  unchanged!: boolean;
}

export class NotebookSessionDto {
  @ApiProperty() id!: string;

  @ApiProperty({ description: 'STARTING, READY or FAILED' })
  status!: string;

  @ApiProperty({
    description:
      'API path the editor is served under. Load it in an iframe; it is proxied to the session.',
  })
  path!: string;

  @ApiPropertyOptional({ description: 'Why the session failed to start' })
  error?: string;

  @ApiProperty() startedAt!: Date;
}
