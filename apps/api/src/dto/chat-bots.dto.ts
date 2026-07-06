import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CHAT_PLATFORM_VALUES = ['TELEGRAM', 'SLACK'] as const;
export type ChatPlatformValue = (typeof CHAT_PLATFORM_VALUES)[number];

/** AgentKinds a bot may steer via autopilot tools (CHAT is never steerable). */
export const CHAT_STEERABLE_AGENT_KIND_VALUES = [
  'INQUIRY',
  'CASE',
  'CONFIG',
  'DETECTOR_AUTHOR',
  'DREAM',
  'DUPLICATES',
] as const;

export class ChatBotResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: CHAT_PLATFORM_VALUES, example: 'TELEGRAM' })
  platform: ChatPlatformValue;

  @ApiProperty({
    description: 'User-friendly label',
    example: 'Ops Telegram bot',
  })
  name: string;

  @ApiProperty({ description: 'Whether the connector is started.' })
  enabled: boolean;

  @ApiProperty({
    description:
      'Masked preview of the stored bot token (never the raw value).',
    example: '8123…kXw',
  })
  botTokenPreview: string;

  @ApiProperty({
    description: 'Masked preview of the Slack app-level token, if stored.',
    nullable: true,
    example: 'xapp…9Qz',
  })
  appTokenPreview: string | null;

  @ApiProperty({
    type: [String],
    description:
      'MCP capability group ids the bot may use (see MCP overview). Empty = all groups.',
  })
  capabilityGroups: string[];

  @ApiProperty({
    type: [String],
    description:
      'Autopilot agent kinds the bot may steer. Empty = all steerable kinds.',
  })
  agentKinds: string[];

  @ApiProperty({
    description:
      'When false, every mutating tool is recorded observe-only and never executed.',
  })
  allowMutations: boolean;

  @ApiProperty({ nullable: true, description: 'Last connector error, if any.' })
  lastError: string | null;

  @ApiProperty({ nullable: true, type: Date })
  lastConnectedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CreateChatBotDto {
  @ApiProperty({ enum: CHAT_PLATFORM_VALUES })
  @IsEnum(CHAT_PLATFORM_VALUES)
  platform: ChatPlatformValue;

  @ApiProperty({ description: 'User-friendly label.' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({
    description:
      'Bot token (Telegram BotFather token, or Slack bot token xoxb-…). Sent once, stored encrypted.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  botToken: string;

  @ApiPropertyOptional({
    description:
      'Slack app-level token (xapp-…) for Socket Mode. Required for Slack bots.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  appToken?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Empty/omitted = all groups.',
  })
  @IsOptional()
  @IsArray()
  capabilityGroups?: string[];

  @ApiPropertyOptional({
    type: [String],
    enum: CHAT_STEERABLE_AGENT_KIND_VALUES,
    description: 'Empty/omitted = all steerable kinds.',
  })
  @IsOptional()
  @IsArray()
  agentKinds?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowMutations?: boolean;
}

export class UpdateChatBotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'New bot token. Omit (or send empty) to keep the stored one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  botToken?: string;

  @ApiPropertyOptional({
    description:
      'New Slack app token. Omit (or send empty) to keep the stored one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  appToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  capabilityGroups?: string[];

  @ApiPropertyOptional({
    type: [String],
    enum: CHAT_STEERABLE_AGENT_KIND_VALUES,
  })
  @IsOptional()
  @IsArray()
  agentKinds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowMutations?: boolean;
}

export const CHAT_ACTIVITY_LEVEL_VALUES = ['INFO', 'ERROR'] as const;
export type ChatActivityLevelValue =
  (typeof CHAT_ACTIVITY_LEVEL_VALUES)[number];

export class ChatBotActivityEntryDto {
  @ApiProperty({ type: Date })
  at: Date;

  @ApiProperty({ enum: CHAT_ACTIVITY_LEVEL_VALUES, example: 'INFO' })
  level: ChatActivityLevelValue;

  @ApiProperty({
    description:
      'Stable event code for client-side translation (e.g. slackMention).',
    example: 'slackMention',
  })
  code: string;

  @ApiProperty({
    description: 'Values to interpolate into the translated event text.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  params: Record<string, string>;

  @ApiProperty({
    description: 'English fallback text, pre-rendered from code + params.',
    example: 'Mention from U0123ABC in C0456DEF.',
  })
  message: string;
}

export class ChatBotDiagnosticsDto {
  @ApiProperty({
    description: 'Whether a live connector currently runs for this bot.',
  })
  running: boolean;

  @ApiProperty({
    description:
      'Whether an agent turn is currently running (a reply is being worked on).',
  })
  processing: boolean;

  @ApiProperty({ nullable: true, type: Date })
  connectedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When the connector last received a platform message.',
  })
  lastEventAt: Date | null;

  @ApiProperty({
    description: 'Messages received since the connector started.',
  })
  eventsReceived: number;

  @ApiProperty({ description: 'Replies posted since the connector started.' })
  repliesSent: number;

  @ApiProperty({ nullable: true, description: 'Last connector error, if any.' })
  lastError: string | null;

  @ApiProperty({
    type: [ChatBotActivityEntryDto],
    description: 'Most recent connector activity, newest first (in-memory).',
  })
  activity: ChatBotActivityEntryDto[];
}

export class ChatBotTestCheckDto {
  @ApiProperty({
    description: 'Stable check id: botToken, appToken or polling.',
    example: 'botToken',
  })
  id: string;

  @ApiProperty()
  ok: boolean;

  @ApiProperty({
    description:
      'Stable result code for client-side translation (e.g. slackAuthenticated).',
    example: 'slackAuthenticated',
  })
  code: string;

  @ApiProperty({
    description: 'Values to interpolate into the translated result text.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  params: Record<string, string>;

  @ApiProperty({
    description: 'English fallback text, pre-rendered from code + params.',
    example: 'Authenticated as @classifyre-bot in workspace Acme.',
  })
  detail: string;
}

export class ChatBotSimulateDto {
  @ApiProperty({
    description: 'The message to send to the bot, as if typed in the chat.',
    example: 'how are my sources?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;
}

export class ChatBotSimulateResultDto {
  @ApiProperty({
    nullable: true,
    description:
      'The bot reply, or null when the message was ignored (duplicate/empty).',
  })
  reply: string | null;
}

export class ChatBotTestResultDto {
  @ApiProperty({ description: 'True when every check passed.' })
  ok: boolean;

  @ApiProperty({ type: [ChatBotTestCheckDto] })
  checks: ChatBotTestCheckDto[];
}
