import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { McpOverviewService } from '../mcp-overview.service';
import { McpTokenService, type TokenScope } from '../mcp-token.service';
import { McpToolsCatalogService } from '../mcp-tools-catalog.service';
import {
  CreateMcpTokenDto,
  McpTokenCreatedResponseDto,
  McpOverviewResponseDto,
  McpToolSummaryDto,
  McpTokenResponseDto,
  UpdateMcpTokenDto,
} from '../dto/mcp-settings.dto';
import { AccessArea, Requires } from '../identity/access.decorators';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { ActorContextService } from '../identity/actor-context.service';

@ApiTags('Instance Settings')
@AccessArea({ view: 'settings.view', change: 'mcp.token.own' })
@Controller('instance-settings/mcp')
export class McpSettingsController {
  constructor(
    private readonly mcpOverviewService: McpOverviewService,
    private readonly mcpTokenService: McpTokenService,
    private readonly mcpToolsCatalogService: McpToolsCatalogService,
    private readonly actors: ActorContextService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  /** The signed-in person's subject id: tokens always belong to a person. */
  private signedInSub(): string {
    const actor = this.actors.current();
    if (actor.via !== 'oidc' || !actor.id?.startsWith('user:')) {
      throw new ForbiddenException(
        'MCP tokens belong to a signed-in person; sign in to manage them.',
      );
    }
    return actor.id.slice('user:'.length);
  }

  /**
   * A person sees and changes their own tokens only, unless they hold
   * `mcp.token.admin` for the workspace (docs/prd §8.3).
   */
  private async scope(): Promise<TokenScope> {
    const sub = this.signedInSub();
    const capabilities = await this.policy.capabilities(this.actors.current());
    return capabilities.has('mcp.token.admin') ? {} : { ownerSub: sub };
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Get MCP server overview',
    description:
      'Returns MCP endpoint details, authentication guidance, prompts, and capability groups for the settings UI.',
  })
  @ApiResponse({
    status: 200,
    type: McpOverviewResponseDto,
  })
  getOverview(): McpOverviewResponseDto {
    return this.mcpOverviewService.getOverview();
  }

  @Get('tools')
  @ApiOperation({
    summary: 'List MCP tools',
    description:
      'Returns every tool exposed by the MCP server — name, description, input parameters, and annotations — introspected directly from the registered tool definitions.',
  })
  @ApiResponse({
    status: 200,
    type: [McpToolSummaryDto],
  })
  getTools(): McpToolSummaryDto[] {
    return this.mcpToolsCatalogService.getTools();
  }

  @Requires('mcp.token.own')
  @Get('tokens')
  @ApiOperation({
    summary: 'List MCP access tokens',
    description:
      'Lists stored MCP tokens as masked previews. Raw token values are never returned.',
  })
  @ApiResponse({
    status: 200,
    type: [McpTokenResponseDto],
  })
  async listTokens(): Promise<McpTokenResponseDto[]> {
    return this.mcpTokenService.listTokens(await this.scope());
  }

  @Post('tokens')
  @ApiOperation({
    summary: 'Create MCP access token',
    description:
      'Generates a new MCP bearer token, stores only its hash, and returns the plaintext token once.',
  })
  @ApiBody({ type: CreateMcpTokenDto })
  @ApiResponse({
    status: 201,
    type: McpTokenCreatedResponseDto,
  })
  async createToken(
    @Body() body: CreateMcpTokenDto,
  ): Promise<McpTokenCreatedResponseDto> {
    return this.mcpTokenService.createToken(body, this.signedInSub());
  }

  @Patch('tokens/:id')
  @ApiOperation({
    summary: 'Update MCP access token',
    description:
      'Rename a token or toggle whether it can authorize MCP requests.',
  })
  @ApiBody({ type: UpdateMcpTokenDto })
  @ApiResponse({
    status: 200,
    type: McpTokenResponseDto,
  })
  async updateToken(
    @Param('id') id: string,
    @Body() body: UpdateMcpTokenDto,
  ): Promise<McpTokenResponseDto> {
    return this.mcpTokenService.updateToken(id, body, await this.scope());
  }

  @Delete('tokens/:id')
  @ApiOperation({
    summary: 'Delete MCP access token',
    description:
      'Deletes the stored token metadata and hash. This permanently invalidates the token.',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { deleted: true } },
  })
  async deleteToken(@Param('id') id: string): Promise<{ deleted: true }> {
    return this.mcpTokenService.deleteToken(id, await this.scope());
  }
}
