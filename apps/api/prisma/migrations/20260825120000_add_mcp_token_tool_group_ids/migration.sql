-- AlterTable
-- JSONB array of group ids, not a native text[]: NULL means unrestricted
-- (every MCP tool group), so every existing token keeps working exactly as
-- before this column existed.
ALTER TABLE "mcp_access_tokens" ADD COLUMN "tool_group_ids" JSONB;
