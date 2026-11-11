-- Sign-in is always on: a chat message has no signed-in person behind it, so
-- every chat bot only reads. The per-bot switch is gone.
ALTER TABLE "chat_bots" DROP COLUMN IF EXISTS "allow_mutations";
