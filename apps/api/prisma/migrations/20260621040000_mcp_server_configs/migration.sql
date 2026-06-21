-- CreateTable: external MCP servers the harness can connect to
CREATE TABLE "mcp_server_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "command" TEXT,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" TEXT,
    "headers_enc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "agent_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tool_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discovered_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_error" TEXT,
    "last_connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_configs_slug_key" ON "mcp_server_configs"("slug");
