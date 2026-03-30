-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('SIMPLE', 'RATIO', 'DERIVED', 'TREND');

-- CreateEnum
CREATE TYPE "MetricStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED');

-- CreateTable
CREATE TABLE "glossary_terms" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "filter_mapping" JSONB NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definitions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "type" "MetricType" NOT NULL,
    "status" "MetricStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "allowed_dimensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "glossary_term_id" TEXT,
    "format" TEXT,
    "unit" TEXT,
    "color" TEXT,
    "owner" TEXT,
    "certified_at" TIMESTAMP(3),
    "certified_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_dashboard_placements" (
    "id" TEXT NOT NULL,
    "metric_definition_id" TEXT NOT NULL,
    "dashboard" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "size" TEXT NOT NULL DEFAULT 'md',
    "chart_type" TEXT,
    "pinned_filters" JSONB,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_dashboard_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "glossary_terms_slug_key" ON "glossary_terms"("slug");
CREATE INDEX "glossary_terms_category_idx" ON "glossary_terms"("category");
CREATE INDEX "glossary_terms_is_active_idx" ON "glossary_terms"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "metric_definitions_slug_key" ON "metric_definitions"("slug");
CREATE INDEX "metric_definitions_type_idx" ON "metric_definitions"("type");
CREATE INDEX "metric_definitions_status_idx" ON "metric_definitions"("status");
CREATE INDEX "metric_definitions_glossary_term_id_idx" ON "metric_definitions"("glossary_term_id");
CREATE INDEX "metric_definitions_is_active_idx" ON "metric_definitions"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "metric_dashboard_placements_metric_definition_id_dashboard_key" ON "metric_dashboard_placements"("metric_definition_id", "dashboard");
CREATE INDEX "metric_dashboard_placements_dashboard_idx" ON "metric_dashboard_placements"("dashboard");

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_glossary_term_id_fkey" FOREIGN KEY ("glossary_term_id") REFERENCES "glossary_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_dashboard_placements" ADD CONSTRAINT "metric_dashboard_placements_metric_definition_id_fkey" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
