import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  MCP_CAPABILITY_GROUPS,
  MCP_PROMPTS,
  MCP_TOKEN_PREFIX,
} from './mcp-catalog';
import { CLS_SLUG } from './namespace/namespace.constants';
import { McpOverviewResponseDto } from './dto/mcp-settings.dto';

@Injectable()
export class McpOverviewService {
  constructor(private readonly cls: ClsService) {}

  getOverview(): McpOverviewResponseDto {
    // MCP is served per tenant: `POST /<namespace>/mcp`. A bare `/mcp` has no
    // tenant to serve and is rejected in main.ts, so the path advertised to
    // clients must carry the namespace this request was resolved to.
    const slug = this.cls.get<string>(CLS_SLUG);
    return {
      endpointPath: slug ? `/${slug}/mcp` : '/mcp',
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
