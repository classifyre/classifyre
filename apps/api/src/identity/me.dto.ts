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

  @ApiProperty({ enum: ['person', 'agent', 'integration', 'system'] })
  kind: 'person' | 'agent' | 'integration' | 'system';

  @ApiProperty({
    enum: ['header', 'oidc', 'mcp-token', 'internal-key', 'autopilot', 'none'],
    description: 'How the actor was identified.',
  })
  via: 'header' | 'oidc' | 'mcp-token' | 'internal-key' | 'autopilot' | 'none';
}

export class MeResponseDto {
  @ApiProperty({ type: MeActorDto })
  actor: MeActorDto;

  @ApiProperty({
    description:
      'True when sign-in and access management are on. Without it every visitor holds every capability.',
  })
  iamEnabled: boolean;

  @ApiProperty({
    description: 'Capabilities the actor holds in this workspace.',
    enum: CAPABILITY_IDS,
    isArray: true,
  })
  capabilities: string[];
}
