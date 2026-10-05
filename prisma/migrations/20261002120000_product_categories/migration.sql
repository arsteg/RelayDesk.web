-- Managed product categories: replace the free-text Product.category column
-- with a tenant-scoped Category entity, preserving existing values.

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "bakeryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_bakeryId_name_idx" ON "Category"("bakeryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_bakeryId_id_key" ON "Category"("bakeryId", "id");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add the new relation column (nullable; category stays optional)
ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;

-- Data migration: create one Category per distinct trimmed, non-empty
-- category name within each bakery, then link products to it.
INSERT INTO "Category" ("id", "bakeryId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."bakeryId", d."name", now(), now()
FROM (
    SELECT DISTINCT "bakeryId", btrim("category") AS "name"
    FROM "Product"
    WHERE "category" IS NOT NULL AND btrim("category") <> ''
) AS d;

UPDATE "Product" p
SET "categoryId" = c."id"
FROM "Category" c
WHERE c."bakeryId" = p."bakeryId"
  AND c."name" = btrim(p."category")
  AND p."category" IS NOT NULL
  AND btrim(p."category") <> '';

-- CreateIndex
CREATE INDEX "Product_bakeryId_categoryId_idx" ON "Product"("bakeryId", "categoryId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_bakeryId_categoryId_fkey" FOREIGN KEY ("bakeryId", "categoryId") REFERENCES "Category"("bakeryId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop the old free-text column now that data is migrated.
ALTER TABLE "Product" DROP COLUMN "category";
