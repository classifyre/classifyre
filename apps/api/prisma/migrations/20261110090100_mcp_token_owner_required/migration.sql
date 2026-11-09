-- Sign-in is always on: a token acts for the person who made it. Tokens made
-- without sign-in have no owner and are refused on every call, so they go.
DELETE FROM "mcp_access_tokens" WHERE "owner_sub" IS NULL;
ALTER TABLE "mcp_access_tokens" ALTER COLUMN "owner_sub" SET NOT NULL;
