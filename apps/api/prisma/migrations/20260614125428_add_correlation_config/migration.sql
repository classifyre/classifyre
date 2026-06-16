-- CreateTable
CREATE TABLE "correlation_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "label_weights" JSONB NOT NULL DEFAULT '{}',
    "default_weight" INTEGER NOT NULL DEFAULT 1,
    "related_min" DECIMAL(3,2) NOT NULL DEFAULT 0.30,
    "duplicate_min" DECIMAL(3,2) NOT NULL DEFAULT 0.60,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correlation_config_pkey" PRIMARY KEY ("id")
);
