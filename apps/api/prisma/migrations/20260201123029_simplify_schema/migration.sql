/*
  Warnings:

  - You are about to drop the column `detector_findings` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `run_id` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `detector_id` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `detector_run_id` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `document_id` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `document_title` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `document_url` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `resolution_reason` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `resolved_at` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `resolved_by` on the `findings` table. All the data in the column will be lost.
  - You are about to drop the column `detectors` on the `runners` table. All the data in the column will be lost.
  - You are about to drop the column `recipe` on the `runners` table. All the data in the column will be lost.
  - You are about to drop the column `triggered_by` on the `runners` table. All the data in the column will be lost.
  - You are about to drop the column `current_run_id` on the `sources` table. All the data in the column will be lost.
  - You are about to drop the `detector_runs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `detectors` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `false_positive_patterns` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `source_detectors` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `detector_type` to the `findings` table without a default value. This is not possible if the table is not empty.
  - Made the column `asset_id` on table `findings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `category` on table `findings` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "detector_runs" DROP CONSTRAINT "detector_runs_detector_id_fkey";

-- DropForeignKey
ALTER TABLE "detector_runs" DROP CONSTRAINT "detector_runs_runner_id_fkey";

-- DropForeignKey
ALTER TABLE "detector_runs" DROP CONSTRAINT "detector_runs_source_id_fkey";

-- DropForeignKey
ALTER TABLE "false_positive_patterns" DROP CONSTRAINT "false_positive_patterns_detector_id_fkey";

-- DropForeignKey
ALTER TABLE "false_positive_patterns" DROP CONSTRAINT "false_positive_patterns_source_id_fkey";

-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_detector_id_fkey";

-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_detector_run_id_fkey";

-- DropForeignKey
ALTER TABLE "source_detectors" DROP CONSTRAINT "source_detectors_source_id_fkey";

-- DropIndex
DROP INDEX "assets_run_id_idx";

-- DropIndex
DROP INDEX "findings_detector_id_idx";

-- DropIndex
DROP INDEX "findings_detector_id_source_id_document_id_matched_content__key";

-- DropIndex
DROP INDEX "findings_finding_type_status_idx";

-- AlterTable
ALTER TABLE "assets" DROP COLUMN "detector_findings",
DROP COLUMN "metadata",
DROP COLUMN "run_id";

-- AlterTable
ALTER TABLE "findings" DROP COLUMN "detector_id",
DROP COLUMN "detector_run_id",
DROP COLUMN "document_id",
DROP COLUMN "document_title",
DROP COLUMN "document_url",
DROP COLUMN "resolution_reason",
DROP COLUMN "resolved_at",
DROP COLUMN "resolved_by",
ADD COLUMN     "detector_type" "DetectorType" NOT NULL,
ADD COLUMN     "runner_id" TEXT,
ALTER COLUMN "asset_id" SET NOT NULL,
ALTER COLUMN "category" SET NOT NULL,
ALTER COLUMN "metadata" DROP NOT NULL,
ALTER COLUMN "metadata" DROP DEFAULT,
ALTER COLUMN "detected_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "runners" DROP COLUMN "detectors",
DROP COLUMN "recipe",
DROP COLUMN "triggered_by";

-- AlterTable
ALTER TABLE "sources" DROP COLUMN "current_run_id";

-- DropTable
DROP TABLE "detector_runs";

-- DropTable
DROP TABLE "detectors";

-- DropTable
DROP TABLE "false_positive_patterns";

-- DropTable
DROP TABLE "source_detectors";

-- DropEnum
DROP TYPE "DetectorCategory";

-- CreateIndex
CREATE INDEX "assets_source_id_idx" ON "assets"("source_id");

-- CreateIndex
CREATE INDEX "findings_runner_id_idx" ON "findings"("runner_id");

-- CreateIndex
CREATE INDEX "findings_detector_type_idx" ON "findings"("detector_type");

-- CreateIndex
CREATE INDEX "findings_asset_id_detector_type_idx" ON "findings"("asset_id", "detector_type");
