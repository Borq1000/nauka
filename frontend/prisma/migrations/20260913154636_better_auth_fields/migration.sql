/*
  Warnings:

  - You are about to drop the column `lastReset` on the `RateLimit` table. All the data in the column will be lost.
  - Added the required column `lastRequest` to the `RateLimit` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "RateLimit_key_idx";

-- AlterTable
ALTER TABLE "RateLimit" DROP COLUMN "lastReset",
ADD COLUMN     "lastRequest" BIGINT NOT NULL;
