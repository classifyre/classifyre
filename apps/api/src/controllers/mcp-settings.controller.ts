import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { McpOverviewService } from '../mcp-overview.service';
import { McpTokenService } from '../mcp-token.service';
import { McpToolsCatalogService } from '../mcp-tools-catalog.service';
import {
  CreateMcpTokenDto,
  McpTokenCreatedResponseDto,
  McpOverviewResponseDto,
  McpToolSummaryDto,
  McpTokenResponseDto,
  UpdateMcpTokenDto,
} from '../dto/mcp-settings.dto';

@ApiTags('Instance Settings')
@Controller('instance-settings/mcp')
export class McpSettingsController {
  constructor(
    private readonly mcpOverviewService: McpOverviewService,
    private readonly mcpTokenService: McpTokenService,
    private readonly mcpToolsCatalogService: McpToolsCatalogService,
  ) {}

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
    return this.mcpTokenService.listTokens();
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
    return this.mcpTokenService.createToken(body);
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
    return this.mcpTokenService.updateToken(id, body);
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
    return this.mcpTokenService.deleteToken(id);
  }
}
