-- Chat gateway: Telegram/Slack bots driving the AI harness.
-- NOTE: the new enum value is only added here — never used in this migration
-- (PostgreSQL forbids using an enum value inside the transaction that adds it).
ALTER TYPE "AgentKind" ADD VALUE IF NOT EXISTS 'CHAT';

-- CreateEnum
CREATE TYPE "ChatPlatform" AS ENUM ('TELEGRAM', 'SLACK');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable: configured chat bots (credentials encrypted at rest)
CREATE TABLE "chat_bots" (
    "id" TEXT NOT NULL,
    "platform" "ChatPlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "bot_token_enc" TEXT NOT NULL,
    "app_token_enc" TEXT,
    "capability_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allow_mutations" BOOLEAN NOT NULL DEFAULT true,
    "allowed_users" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_error" TEXT,
    "last_connected_at" TIMESTAMP(3),
    "telegram_last_update_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one session per Telegram chat / Slack thread
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "external_chat_key" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "summarized_up_to_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: session transcript
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "agent_run_id" TEXT,
    "external_message_id" TEXT,
    "external_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- Session lookup is a single unique-index hit per inbound message.
CREATE UNIQUE INDEX "chat_sessions_bot_id_external_chat_key_key" ON "chat_sessions"("bot_id", "external_chat_key");

-- Recent-sessions listing per bot.
CREATE INDEX "chat_sessions_bot_id_last_message_at_idx" ON "chat_sessions"("bot_id", "last_message_at" DESC);

-- History load is an index range scan (last N messages of a session).
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "chat_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
