-- Rename the tenant model Bakery -> Business (and bakeryId -> businessId,
-- activeBakeryId -> activeBusinessId) across the whole schema.
--
-- This is a pure, data-preserving rename: no table is dropped and no data is
-- moved. Every object is renamed to the exact name Prisma derives from the new
-- schema so that a subsequent `prisma migrate diff` reports no drift.

-- 1. Table + table-level constraints -----------------------------------------
ALTER TABLE "Bakery" RENAME TO "Business";
ALTER TABLE "Business" RENAME CONSTRAINT "Bakery_pkey" TO "Business_pkey";
ALTER TABLE "Business" RENAME CONSTRAINT "Bakery_tax_range" TO "Business_tax_range";

-- 2. Columns -----------------------------------------------------------------
ALTER TABLE "Session" RENAME COLUMN "activeBakeryId" TO "activeBusinessId";
ALTER TABLE "Membership" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "Invitation" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "Subscription" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "BillingEvent" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "Client" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "Product" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "Category" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "Order" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "OrderItem" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "Payment" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "AuditLog" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "CustomerAccount" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "CustomerInvitation" RENAME COLUMN "bakeryId" TO "businessId";
ALTER TABLE "OrderStatusHistory" RENAME COLUMN "bakeryId" TO "businessId";

-- 3. Foreign-key constraints -------------------------------------------------
ALTER TABLE "Membership" RENAME CONSTRAINT "Membership_bakeryId_fkey" TO "Membership_businessId_fkey";
ALTER TABLE "Invitation" RENAME CONSTRAINT "Invitation_bakeryId_fkey" TO "Invitation_businessId_fkey";
ALTER TABLE "Subscription" RENAME CONSTRAINT "Subscription_bakeryId_fkey" TO "Subscription_businessId_fkey";
ALTER TABLE "Client" RENAME CONSTRAINT "Client_bakeryId_fkey" TO "Client_businessId_fkey";
ALTER TABLE "Product" RENAME CONSTRAINT "Product_bakeryId_fkey" TO "Product_businessId_fkey";
ALTER TABLE "Product" RENAME CONSTRAINT "Product_bakeryId_categoryId_fkey" TO "Product_businessId_categoryId_fkey";
ALTER TABLE "Category" RENAME CONSTRAINT "Category_bakeryId_fkey" TO "Category_businessId_fkey";
ALTER TABLE "Order" RENAME CONSTRAINT "Order_bakeryId_fkey" TO "Order_businessId_fkey";
ALTER TABLE "Order" RENAME CONSTRAINT "Order_bakeryId_clientId_fkey" TO "Order_businessId_clientId_fkey";
ALTER TABLE "OrderItem" RENAME CONSTRAINT "OrderItem_bakeryId_fkey" TO "OrderItem_businessId_fkey";
ALTER TABLE "OrderItem" RENAME CONSTRAINT "OrderItem_bakeryId_orderId_fkey" TO "OrderItem_businessId_orderId_fkey";
ALTER TABLE "Payment" RENAME CONSTRAINT "Payment_bakeryId_fkey" TO "Payment_businessId_fkey";
ALTER TABLE "Payment" RENAME CONSTRAINT "Payment_bakeryId_orderId_fkey" TO "Payment_businessId_orderId_fkey";
ALTER TABLE "AuditLog" RENAME CONSTRAINT "AuditLog_bakeryId_fkey" TO "AuditLog_businessId_fkey";
ALTER TABLE "CustomerAccount" RENAME CONSTRAINT "CustomerAccount_bakeryId_fkey" TO "CustomerAccount_businessId_fkey";
ALTER TABLE "CustomerAccount" RENAME CONSTRAINT "CustomerAccount_bakeryId_clientId_fkey" TO "CustomerAccount_businessId_clientId_fkey";
ALTER TABLE "CustomerInvitation" RENAME CONSTRAINT "CustomerInvitation_bakeryId_fkey" TO "CustomerInvitation_businessId_fkey";
ALTER TABLE "OrderStatusHistory" RENAME CONSTRAINT "OrderStatusHistory_bakeryId_fkey" TO "OrderStatusHistory_businessId_fkey";
ALTER TABLE "OrderStatusHistory" RENAME CONSTRAINT "OrderStatusHistory_bakeryId_orderId_fkey" TO "OrderStatusHistory_businessId_orderId_fkey";

-- 4. Unique indexes ----------------------------------------------------------
ALTER INDEX "Membership_userId_bakeryId_key" RENAME TO "Membership_userId_businessId_key";
ALTER INDEX "Subscription_bakeryId_key" RENAME TO "Subscription_businessId_key";
ALTER INDEX "Client_bakeryId_id_key" RENAME TO "Client_businessId_id_key";
ALTER INDEX "Product_bakeryId_id_key" RENAME TO "Product_businessId_id_key";
ALTER INDEX "Category_bakeryId_id_key" RENAME TO "Category_businessId_id_key";
ALTER INDEX "Order_bakeryId_number_key" RENAME TO "Order_businessId_number_key";
ALTER INDEX "Order_bakeryId_id_key" RENAME TO "Order_businessId_id_key";
ALTER INDEX "CustomerAccount_bakeryId_id_key" RENAME TO "CustomerAccount_businessId_id_key";
ALTER INDEX "CustomerAccount_bakeryId_email_key" RENAME TO "CustomerAccount_businessId_email_key";

-- 5. Secondary indexes -------------------------------------------------------
ALTER INDEX "Membership_bakeryId_idx" RENAME TO "Membership_businessId_idx";
ALTER INDEX "Invitation_bakeryId_email_idx" RENAME TO "Invitation_businessId_email_idx";
ALTER INDEX "Client_bakeryId_name_idx" RENAME TO "Client_businessId_name_idx";
ALTER INDEX "Product_bakeryId_name_idx" RENAME TO "Product_businessId_name_idx";
ALTER INDEX "Product_bakeryId_categoryId_idx" RENAME TO "Product_businessId_categoryId_idx";
ALTER INDEX "Category_bakeryId_name_idx" RENAME TO "Category_businessId_name_idx";
ALTER INDEX "Order_bakeryId_status_idx" RENAME TO "Order_businessId_status_idx";
ALTER INDEX "Order_bakeryId_fulfillmentAt_idx" RENAME TO "Order_businessId_fulfillmentAt_idx";
ALTER INDEX "Order_bakeryId_clientId_idx" RENAME TO "Order_businessId_clientId_idx";
ALTER INDEX "Order_bakeryId_createdAt_idx" RENAME TO "Order_businessId_createdAt_idx";
ALTER INDEX "Order_bakeryId_placedByCustomerId_idx" RENAME TO "Order_businessId_placedByCustomerId_idx";
ALTER INDEX "OrderItem_bakeryId_orderId_idx" RENAME TO "OrderItem_businessId_orderId_idx";
ALTER INDEX "Payment_bakeryId_orderId_idx" RENAME TO "Payment_businessId_orderId_idx";
ALTER INDEX "Payment_bakeryId_paidOn_idx" RENAME TO "Payment_businessId_paidOn_idx";
ALTER INDEX "AuditLog_bakeryId_createdAt_idx" RENAME TO "AuditLog_businessId_createdAt_idx";
ALTER INDEX "CustomerAccount_bakeryId_clientId_idx" RENAME TO "CustomerAccount_businessId_clientId_idx";
ALTER INDEX "CustomerInvitation_bakeryId_email_idx" RENAME TO "CustomerInvitation_businessId_email_idx";
ALTER INDEX "OrderStatusHistory_bakeryId_orderId_idx" RENAME TO "OrderStatusHistory_businessId_orderId_idx";

-- Manual (non-Prisma) expression index from the integrity_checks migration.
ALTER INDEX "Client_bakeryId_lower_name_idx" RENAME TO "Client_businessId_lower_name_idx";

-- 6. AuditLog.scope: rebrand the default and existing data value -------------
ALTER TABLE "AuditLog" ALTER COLUMN "scope" SET DEFAULT 'business';
UPDATE "AuditLog" SET "scope" = 'business' WHERE "scope" = 'bakery';
