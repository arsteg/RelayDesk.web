-- Defence-in-depth integrity rules that Prisma cannot express in the schema.
ALTER TABLE "Product"   ADD CONSTRAINT "Product_price_nonneg"      CHECK ("priceMinor" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qty_positive"    CHECK ("quantityMilli" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_nonneg"  CHECK ("unitPriceMinor" >= 0 AND "lineTotalMinor" >= 0);
ALTER TABLE "Order"     ADD CONSTRAINT "Order_amounts_nonneg"      CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "deliveryChargeMinor" >= 0 AND "totalMinor" >= 0 AND "paidMinor" >= 0);
ALTER TABLE "Order"     ADD CONSTRAINT "Order_discount_le_subtotal" CHECK ("discountMinor" <= "subtotalMinor");
ALTER TABLE "Order"     ADD CONSTRAINT "Order_number_positive"     CHECK ("number" > 0);
ALTER TABLE "Payment"   ADD CONSTRAINT "Payment_amount_positive"   CHECK ("amountMinor" > 0);
ALTER TABLE "Bakery"    ADD CONSTRAINT "Bakery_tax_range"          CHECK ("defaultTaxBps" >= 0 AND "defaultTaxBps" <= 10000);

-- Case-insensitive client search
CREATE INDEX "Client_bakeryId_lower_name_idx" ON "Client" ("bakeryId", lower("name"));
