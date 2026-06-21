import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { McpServersService } from './mcp-servers.service';
import {
  CreateMcpServerDto,
  McpServerResponseDto,
  McpServerTestResultDto,
  UpdateMcpServerDto,
} from './mcp-server.dto';

@ApiTags('autopilot')
@Controller('autopilot/mcp-servers')
export class McpServersController {
  constructor(private readonly servers: McpServersService) {}

  @Get()
  @ApiOperation({ summary: 'List configured external MCP servers' })
  @ApiResponse({ status: 200, type: [McpServerResponseDto] })
  list(): Promise<McpServerResponseDto[]> {
    return this.servers.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an external MCP server' })
  @ApiResponse({ status: 201, type: McpServerResponseDto })
  create(@Body() dto: CreateMcpServerDto): Promise<McpServerResponseDto> {
    return this.servers.create(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reconnect all enabled servers and rediscover tools',
  })
  @ApiResponse({ status: 200, type: [McpServerResponseDto] })
  refresh(): Promise<McpServerResponseDto[]> {
    return this.servers.refresh();
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probe a server: connect and list its tools' })
  @ApiResponse({ status: 200, type: McpServerTestResultDto })
  test(@Param('id') id: string): Promise<McpServerTestResultDto> {
    return this.servers.test(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an MCP server' })
  @ApiResponse({ status: 200, type: McpServerResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMcpServerDto,
  ): Promise<McpServerResponseDto> {
    return this.servers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an MCP server' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.servers.remove(id);
  }
}
