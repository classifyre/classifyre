-- Remove the chat gateway (Telegram / Slack bots).
--
-- The feature is gone from the API and the web app, so everything it owned goes
-- with it: the bots and their encrypted credentials, the conversation history,
-- and the CHAT agent kind that metered each inbound message.
--
-- Replayed once per tenant schema by database-migrations.ts, so every statement
-- is idempotent and unqualified (it must land in whichever ns_<hex32> schema the
-- search_path points at). Prisma wraps migrations in a transaction, so no
-- CREATE INDEX CONCURRENTLY and no transaction control here.

-- ── Tables and enums ─────────────────────────────────────────────────────────
-- Children first. The foreign keys cascade, but dropping in dependency order
-- keeps this independent of what Prisma generated for them.
DROP TABLE IF EXISTS "chat_messages";
DROP TABLE IF EXISTS "chat_sessions";
DROP TABLE IF EXISTS "chat_bots";

DROP TYPE IF EXISTS "ChatMessageRole";
DROP TYPE IF EXISTS "ChatPlatform";

-- ── The CHAT agent kind ──────────────────────────────────────────────────────
-- An MCP server may be scoped to a list of agent kinds (AgentKind strings, in a
-- plain text array — not the enum). Drop the removed kind from it. An empty
-- list means "all agents", so a server scoped to CHAT alone becomes available
-- to every agent; it was a chat-only server and an operator can rescope it.
UPDATE "mcp_server_configs"
   SET "agent_kinds" = array_remove("agent_kinds", 'CHAT')
 WHERE 'CHAT' = ANY("agent_kinds");

-- PostgreSQL enum values cannot be removed in place. Delete everything that
-- still carries the value (CHAT runs cascade to their decisions and logs), then
-- rebuild the type without it. Guarded on the value still being there, so a
-- schema that is replayed, or one that never had it, is left untouched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_enum
     WHERE enumtypid = to_regtype('"AgentKind"')
       AND enumlabel = 'CHAT'
  ) THEN
    DELETE FROM "agent_runs"     WHERE "agent_kind"::text = 'CHAT';
    DELETE FROM "agent_configs"  WHERE "kind"::text = 'CHAT';
    DELETE FROM "agent_memories" WHERE "scope"::text = 'CHAT';

    ALTER TABLE "agent_runs"     ALTER COLUMN "agent_kind" TYPE text USING "agent_kind"::text;
    ALTER TABLE "agent_configs"  ALTER COLUMN "kind"       TYPE text USING "kind"::text;
    ALTER TABLE "agent_memories" ALTER COLUMN "scope"      TYPE text USING "scope"::text;

    DROP TYPE "AgentKind";

    CREATE TYPE "AgentKind" AS ENUM (
      'INQUIRY',
      'CASE',
      'DREAM',
      'DUPLICATES',
      'CONFIG',
      'DETECTOR_AUTHOR',
      'ESCALATION',
      'SUPERVISOR'
    );

    ALTER TABLE "agent_runs"     ALTER COLUMN "agent_kind" TYPE "AgentKind" USING "agent_kind"::"AgentKind";
    ALTER TABLE "agent_configs"  ALTER COLUMN "kind"       TYPE "AgentKind" USING "kind"::"AgentKind";
    ALTER TABLE "agent_memories" ALTER COLUMN "scope"      TYPE "AgentKind" USING "scope"::"AgentKind";
  END IF;
END
$$;
