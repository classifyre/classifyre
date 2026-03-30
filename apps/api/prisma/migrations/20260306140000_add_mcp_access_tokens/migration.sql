CREATE TABLE IF NOT EXISTS "mcp_access_tokens" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_preview" TEXT NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mcp_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_access_tokens_token_hash_key"
  ON "mcp_access_tokens"("token_hash");

CREATE INDEX IF NOT EXISTS "mcp_access_tokens_revoked_at_idx"
  ON "mcp_access_tokens"("revoked_at");

CREATE INDEX IF NOT EXISTS "mcp_access_tokens_last_used_at_idx"
  ON "mcp_access_tokens"("last_used_at");
