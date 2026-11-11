import type { ActorKind } from './actor';
import { ApiProperty } from '@nestjs/swagger';
import { CAPABILITY_IDS } from './capabilities';

export class MeActorDto {
  @ApiProperty({
    description: 'Stable principal id; null while identity is self-declared.',
    type: String,
    nullable: true,
  })
  id: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Jordan Reyes' })
  displayName: string | null;

  @ApiProperty({
    enum: ['person', 'agent', 'integration', 'system', 'visitor'],
  })
  kind: ActorKind;

  @ApiProperty({
    enum: ['oidc', 'mcp-token', 'internal-key', 'autopilot', 'none'],
    description: 'How the actor was identified.',
  })
  via: 'oidc' | 'mcp-token' | 'internal-key' | 'autopilot' | 'none';
}

export class MeResponseDto {
  @ApiProperty({ type: MeActorDto })
  actor: MeActorDto;

  @ApiProperty({
    description: 'Capabilities the actor holds in this workspace.',
    enum: CAPABILITY_IDS,
    isArray: true,
  })
  capabilities: string[];
}
