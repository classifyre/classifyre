-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('TABULAR', 'UNSTRUCTURED');

-- AlterTable
ALTER TABLE "sources" ADD COLUMN "source_category" "SourceCategory" NOT NULL DEFAULT 'UNSTRUCTURED';
