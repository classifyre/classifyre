import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Actor reference; resolve it with GET /actors/resolve.',
    example: 'mcp:2c7b9260-cc88-45f8-9459-defe4a662708',
  })
  actor: string | null;

  @ApiProperty({ example: 'mcp-token' })
  via: string;

  @ApiProperty({ enum: ['rest', 'mcp'] })
  channel: string;

  @ApiProperty({ example: 'source.manage' })
  capability: string;

  @ApiProperty({ example: 'PUT /sources/:id' })
  operation: string;

  @ApiProperty({ type: String, nullable: true, example: 'sources' })
  entityType: string | null;

  @ApiProperty({ type: String, nullable: true })
  entityId: string | null;

  @ApiProperty({
    type: [String],
    description: 'Top-level input keys of the change, never their values.',
  })
  fields: string[];

  @ApiProperty({ type: Number, nullable: true })
  status: number | null;
}

export class ResolvedActorDto {
  @ApiProperty()
  ref: string;

  @ApiProperty({ enum: ['user', 'mcp', 'agent', 'system', 'name'] })
  kind: string;

  @ApiProperty({ example: 'Jordan Reyes' })
  displayName: string;

  @ApiPropertyOptional({
    description: 'For an action delegated through an MCP token: the token.',
  })
  viaDisplayName?: string;
}
