CREATE TABLE "correlation_graph_snapshot" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "requested_version" BIGINT NOT NULL DEFAULT 1,
    "built_version" BIGINT NOT NULL DEFAULT 0,
    "payload" JSONB,
    "built_at" TIMESTAMP(3),
    "build_duration_ms" INTEGER,
    "last_error" TEXT,
    "last_invalidation" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correlation_graph_snapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "correlation_graph_snapshot_singleton" CHECK ("id" = 1)
);

INSERT INTO "correlation_graph_snapshot" (
    "id",
    "requested_version",
    "built_version",
    "updated_at"
) VALUES (1, 1, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
