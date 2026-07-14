import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateMcpTokenDto {
  @ApiProperty({
    description: 'Human-readable label for this MCP access token.',
    example: 'Cursor local agent',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class UpdateMcpTokenDto {
  @ApiPropertyOptional({
    description: 'Updated display name for the token.',
    example: 'Cursor staging workspace',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description:
      'When false, the token is revoked and can no longer authorize MCP requests.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class McpTokenResponseDto {
  @ApiProperty({
    description: 'Stable public token identifier embedded in the token value.',
    example: '6c0ae0a4-2740-4c37-aa29-c9c69522e053',
  })
  @IsUUID()
  id: string;

  @ApiProperty({ example: 'Cursor local agent' })
  name: string;

  @ApiProperty({
    description: 'Masked token preview shown in settings after creation.',
    example: 'inmcp_6c0ae0a4...VC-TM',
  })
  tokenPreview: string;

  @ApiProperty({
    description: 'Whether the token can currently authorize MCP requests.',
    example: true,
  })
  isActive: boolean;

  @ApiPropertyOptional({
    description: 'Most recent successful authorization timestamp.',
  })
  lastUsedAt: Date | null;

  @ApiPropertyOptional({
    description: 'Revocation timestamp, if the token has been disabled.',
  })
  revokedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class McpTokenCreatedResponseDto extends McpTokenResponseDto {
  @ApiProperty({
    description:
      'Full plaintext bearer token returned once at creation time. It is never returned again.',
    example:
      'inmcp_6c0ae0a4-2740-4c37-aa29-c9c69522e053.qxMSu7K1aK0pgr1Z4vPqIYFJ3ijS2n2OQq8v3hVC-TM',
  })
  @IsString()
  plainTextToken: string;
}

export class McpCapabilityGroupDto {
  @ApiProperty({ example: 'sources' })
  id: string;

  @ApiProperty({ example: 'Sources' })
  title: string;

  @ApiProperty({
    example:
      'Create, validate, update, delete, and run ingestion sources from MCP.',
  })
  description: string;

  @ApiProperty({
    type: [String],
    example: [
      'search_sources',
      'get_source',
      'create_source',
      'update_source',
      'delete_source',
    ],
  })
  toolNames: string[];

  @ApiProperty({
    type: [String],
    example: [
      'Search and filter sources',
      'Validate source configs against JSON Schema',
      'Trigger connection tests and runs',
    ],
  })
  operations: string[];
}

export class McpToolParameterDto {
  @ApiProperty({
    description: 'Parameter name as sent in the tool call arguments.',
    example: 'sourceId',
  })
  name: string;

  @ApiProperty({
    description: 'JSON Schema type of the parameter (e.g. string, integer).',
    example: 'string',
  })
  type: string;

  @ApiProperty({
    description: 'Whether the parameter is required by the tool.',
    example: true,
  })
  required: boolean;

  @ApiPropertyOptional({
    description: 'Human-readable description sourced from the tool schema.',
    example: 'Source type id from list_source_types, e.g. POSTGRESQL',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Format hint from the schema, when present.',
    example: 'uuid',
  })
  format?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Allowed enum values, when the parameter is an enum.',
    example: ['PENDING', 'RUNNING', 'COMPLETED', 'ERROR'],
  })
  enumValues?: string[];
}

export class McpToolSummaryDto {
  @ApiProperty({
    description: 'Programmatic tool name used in MCP tools/call requests.',
    example: 'list_source_runs',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Human-friendly title registered with the tool.',
    example: 'List Source Runs',
  })
  title?: string;

  @ApiPropertyOptional({
    description: 'Tool description registered with the MCP server.',
    example: 'List runs for a single source.',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Capability group id this tool belongs to.',
    example: 'runs',
  })
  groupId?: string;

  @ApiPropertyOptional({
    description: 'Capability group title this tool belongs to.',
    example: 'Runs',
  })
  groupTitle?: string;

  @ApiProperty({
    description: 'Tool reads state only and never mutates data.',
    example: true,
  })
  readOnly: boolean;

  @ApiProperty({
    description: 'Tool may perform destructive changes (delete/stop).',
    example: false,
  })
  destructive: boolean;

  @ApiProperty({
    description: 'Tool is idempotent — repeat calls have the same effect.',
    example: true,
  })
  idempotent: boolean;

  @ApiProperty({
    type: [McpToolParameterDto],
    description: 'Flattened top-level input parameters, from the real schema.',
  })
  parameters: McpToolParameterDto[];

  @ApiProperty({
    description:
      'Whether the tool returns a JSON result payload. All Classifyre tools return structured JSON.',
    example: true,
  })
  returnsJson: boolean;
}

export class McpPromptSummaryDto {
  @ApiProperty({ example: 'brainstorm_custom_detector' })
  name: string;

  @ApiProperty({ example: 'Brainstorm Custom Detector' })
  title: string;

  @ApiProperty({
    example:
      'Guide an MCP client to propose regex, classifier, or entity detector configs before training.',
  })
  description: string;
}

export class McpOverviewResponseDto {
  @ApiProperty({
    description: 'Relative MCP endpoint path exposed by the API server.',
    example: '/mcp',
  })
  endpointPath: string;

  @ApiProperty({
    description: 'Transport mode exposed by the endpoint.',
    example: 'Streamable HTTP (JSON response mode)',
  })
  transport: string;

  @ApiProperty({
    description: 'Authorization scheme expected by the MCP endpoint.',
    example: 'Bearer token',
  })
  authScheme: string;

  @ApiProperty({
    description: 'Static token prefix generated by the API.',
    example: 'inmcp',
  })
  tokenPrefix: string;

  @ApiProperty({
    description: 'Authorization header example for MCP clients.',
    example:
      'Authorization: Bearer inmcp_6c0ae0a4-2740-4c37-aa29-c9c69522e053.qxMSu7K1aK0pgr1Z4vPqIYFJ3ijS2n2OQq8v3hVC-TM',
  })
  authHeaderExample: string;

  @ApiProperty({
    type: [String],
    example: [
      'Generate one token per MCP client or workspace.',
      'Store tokens in a secret manager, not in plain text config files.',
      'Rotate by creating a replacement token, then revoke the old one.',
      'Tokens are hashed at rest and shown only once after creation.',
    ],
  })
  bestPractices: string[];

  @ApiProperty({ type: [McpCapabilityGroupDto] })
  capabilityGroups: McpCapabilityGroupDto[];

  @ApiProperty({ type: [McpPromptSummaryDto] })
  prompts: McpPromptSummaryDto[];
}
