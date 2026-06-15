/*
  Warnings:

  - You are about to drop the column `source_category` on the `sources` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sources" DROP COLUMN "source_category";

-- DropEnum
DROP TYPE "SourceCategory";
