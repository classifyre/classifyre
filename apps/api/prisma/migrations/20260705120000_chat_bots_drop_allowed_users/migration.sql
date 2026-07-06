-- Chat bots no longer use a per-user allowlist: platform access control
-- (which workspace/chat the bot is in) is the boundary instead.
ALTER TABLE "chat_bots" DROP COLUMN IF EXISTS "allowed_users";
