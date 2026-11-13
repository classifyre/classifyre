import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CONNECTION_STATUSES = [
  'active',
  'pending',
  'expired',
  'revoked',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export class DataConnectionScopeItemDto {
  @ApiProperty({ enum: ['source', 'asset'] })
  type: 'source' | 'asset';

  @ApiProperty()
  id: string;

  @ApiProperty({
    description: 'The source or table name, as the app shows it.',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'For a table: its SQL name (`source.schema.table`).',
  })
  sqlName?: string;
}

export class DataConnectionBlockDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['source', 'asset'] })
  type: 'source' | 'asset';

  @ApiProperty()
  scopeId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  blockedBy: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class DataConnectionReadsDto {
  @ApiProperty({
    description: 'Table reads through the connection, last 90 days.',
  })
  count: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastAt: Date | null;
}

export class DataConnectionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'The person it belongs to (`user:<sub>`).' })
  personRef: string;

  @ApiProperty({ description: 'What the tool signs in as.' })
  username: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Last characters of the password.',
  })
  secretPreview: string | null;

  @ApiProperty({ enum: CONNECTION_STATUSES })
  status: ConnectionStatus;

  @ApiProperty({
    type: [DataConnectionScopeItemDto],
    description: 'Empty: everything its person may query.',
  })
  scope: DataConnectionScopeItemDto[];

  @ApiProperty({ type: [DataConnectionBlockDto] })
  blocks: DataConnectionBlockDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who gave it, when not its person.',
  })
  issuedBy: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastUsedAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  lastUsedIp: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  revokedBy: string | null;

  @ApiProperty({ type: String, nullable: true })
  revokeReason: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({
    description: 'The caller may revoke it (its person, or a manager).',
  })
  canRevoke: boolean;

  @ApiPropertyOptional({
    type: DataConnectionReadsDto,
    description: 'On an asset or source listing: its reads there.',
  })
  reads?: DataConnectionReadsDto;
}

export class DataConnectionListDto {
  @ApiProperty({ type: [DataConnectionDto] })
  items: DataConnectionDto[];

  @ApiProperty({
    description: 'The caller may create connections of their own.',
  })
  canCreate: boolean;

  @ApiProperty({ description: 'The caller sees and manages everyone’s.' })
  canManage: boolean;

  @ApiPropertyOptional({
    description:
      'On an asset or source listing: the caller may issue and block here.',
  })
  canGovern?: boolean;
}

export class DataConnectionSecretDto {
  @ApiProperty({ type: DataConnectionDto })
  connection: DataConnectionDto;

  @ApiProperty({ description: 'Shown once; only a verifier is kept.' })
  password: string;
}

export class DataConnectionEndpointDto {
  @ApiProperty({ description: 'The SQL gateway runs in this deployment.' })
  enabled: boolean;

  @ApiProperty({ type: String, nullable: true })
  host: string | null;

  @ApiProperty()
  port: number;

  @ApiProperty({ description: 'The PostgreSQL database: this workspace.' })
  database: string;

  @ApiProperty({ enum: ['verify-full', 'verify-ca', 'require'] })
  sslMode: 'verify-full' | 'verify-ca' | 'require';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'PEM of the CA that signed the gateway certificate, when it is not a public one.',
  })
  caCertificate: string | null;
}

const SCOPE_ITEM = /^(source|asset):[0-9a-f-]{36}$/i;

export class CreateDataConnectionDto {
  @ApiProperty({ example: 'Power BI' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      '`source:<id>` / `asset:<id>` to narrow it to; empty = everything you may query.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(SCOPE_ITEM, { each: true })
  scope?: string[];
}

export class IssueDataConnectionDto extends CreateDataConnectionDto {
  @ApiProperty({ description: 'The person to give it to (`user:<sub>`).' })
  @IsString()
  @Matches(/^user:[A-Za-z0-9._:-]+$/)
  personRef: string;
}

export class RevokeDataConnectionDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class BlockDataConnectionDto {
  @ApiProperty({ enum: ['source', 'asset'] })
  @IsIn(['source', 'asset'])
  type: 'source' | 'asset';

  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
