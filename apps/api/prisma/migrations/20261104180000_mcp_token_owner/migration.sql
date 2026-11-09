-- MCP tokens act for the person who created them once sign-in is on.
ALTER TABLE "mcp_access_tokens" ADD COLUMN IF NOT EXISTS "owner_sub" TEXT;
CREATE INDEX IF NOT EXISTS "mcp_access_tokens_owner_sub_idx" ON "mcp_access_tokens" ("owner_sub");
