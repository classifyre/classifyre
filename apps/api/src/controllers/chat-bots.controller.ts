import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChatBotsService } from '../chat-gateway/chat-bots.service';
import {
  ChatBotDiagnosticsDto,
  ChatBotResponseDto,
  ChatBotSimulateDto,
  ChatBotSimulateResultDto,
  ChatBotTestResultDto,
  CreateChatBotDto,
  UpdateChatBotDto,
} from '../dto/chat-bots.dto';

@ApiTags('Chat Bots')
@Controller('instance-settings/chat/bots')
export class ChatBotsController {
  constructor(private readonly service: ChatBotsService) {}

  @Get()
  @ApiOperation({
    summary: 'List chat bots',
    description:
      'Returns every configured Telegram/Slack bot with masked token previews, permissions and connection status.',
  })
  @ApiResponse({ status: 200, type: [ChatBotResponseDto] })
  async list(): Promise<ChatBotResponseDto[]> {
    return this.service.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a chat bot',
    description:
      'Stores the bot credentials encrypted and (when enabled) connects it: Telegram via long-polling, Slack via Socket Mode.',
  })
  @ApiBody({ type: CreateChatBotDto })
  @ApiResponse({ status: 201, type: ChatBotResponseDto })
  async create(@Body() body: CreateChatBotDto): Promise<ChatBotResponseDto> {
    return this.service.create(body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a chat bot',
    description:
      'Updates settings/permissions and reconnects the bot. Omitted or empty token fields keep the stored values.',
  })
  @ApiBody({ type: UpdateChatBotDto })
  @ApiResponse({ status: 200, type: ChatBotResponseDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateChatBotDto,
  ): Promise<ChatBotResponseDto> {
    return this.service.update(id, body);
  }

  @Get(':id/diagnostics')
  @ApiOperation({
    summary: 'Chat bot diagnostics',
    description:
      'Runtime connector telemetry: whether the connector runs, message/reply counters and the recent in-memory activity log (newest first).',
  })
  @ApiResponse({ status: 200, type: ChatBotDiagnosticsDto })
  async diagnostics(@Param('id') id: string): Promise<ChatBotDiagnosticsDto> {
    return this.service.diagnostics(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Test chat bot connection',
    description:
      'Runs live checks with the stored credentials: Telegram getMe + webhook conflict detection, Slack auth.test (bot token) + apps.connections.open (app token).',
  })
  @ApiResponse({ status: 200, type: ChatBotTestResultDto })
  async test(@Param('id') id: string): Promise<ChatBotTestResultDto> {
    return this.service.test(id);
  }

  @Post(':id/simulate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a test message to a chat bot',
    description:
      'Runs one real agent turn (tools, audit, history in a dedicated simulator session) without going through Telegram/Slack, and returns the reply. Slow — the turn runs synchronously.',
  })
  @ApiBody({ type: ChatBotSimulateDto })
  @ApiResponse({ status: 200, type: ChatBotSimulateResultDto })
  async simulate(
    @Param('id') id: string,
    @Body() body: ChatBotSimulateDto,
  ): Promise<ChatBotSimulateResultDto> {
    return this.service.simulate(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a chat bot',
    description:
      'Disconnects the bot and deletes it with all its sessions and messages.',
  })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}
