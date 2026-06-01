-- Link child assets (e.g. an image embedded in a parquet/office file) to their
-- parent asset. Null for top-level assets. Cascade so children are removed when
-- the parent is deleted.

-- AlterTable
ALTER TABLE "assets" ADD COLUMN "parent_id" TEXT;

-- CreateIndex
CREATE INDEX "assets_parent_id_idx" ON "assets"("parent_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
