import { Injectable } from '@nestjs/common';
import {
  MCP_CAPABILITY_GROUPS,
  MCP_PROMPTS,
  MCP_TOKEN_PREFIX,
} from './mcp-catalog';
import { McpOverviewResponseDto } from './dto/mcp-settings.dto';

@Injectable()
export class McpOverviewService {
  getOverview(): McpOverviewResponseDto {
    return {
      endpointPath: '/mcp',
      transport: 'Streamable HTTP (JSON response mode)',
      authScheme: 'Bearer token',
      tokenPrefix: MCP_TOKEN_PREFIX,
      authHeaderExample: `Authorization: Bearer ${MCP_TOKEN_PREFIX}_<uuid>.<secret>`,
      bestPractices: [
        'Generate one token per MCP client or workspace.',
        'Store tokens in a secret manager, not in plain text config files.',
        'Rotate by creating a replacement token, then revoke the old one.',
        'Tokens are hashed at rest and shown only once after creation.',
      ],
      capabilityGroups: MCP_CAPABILITY_GROUPS,
      prompts: MCP_PROMPTS,
    };
  }
}
