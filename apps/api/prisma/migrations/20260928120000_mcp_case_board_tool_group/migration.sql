-- The case board's MCP tools moved out of the "cases" capability group into a
-- group of their own, "case_board" (token scopes, Settings -> MCP Server).
-- A token scoped to "cases" could read and change boards before this; keep it
-- that way by granting it "case_board" as well. Unrestricted tokens (NULL)
-- see every group and are left alone.
UPDATE "mcp_access_tokens"
   SET "tool_group_ids" = "tool_group_ids" || '["case_board"]'::jsonb,
       "updated_at" = now()
 WHERE jsonb_typeof("tool_group_ids") = 'array'
   AND "tool_group_ids" ? 'cases'
   AND NOT ("tool_group_ids" ? 'case_board');
