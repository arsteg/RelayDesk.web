import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/server/context";
import { categoryOptions, createCategory, getCategory, listCategories, setCategoryArchived, updateCategory } from "@/server/categories";
import { createProduct, getProduct, listProducts } from "@/server/products";
import { resetDb, setupBusiness } from "./helpers";

let owner: TenantContext;

beforeEach(async () => {
  await resetDb();
  const b = await setupBusiness("Cat Bakehouse", "owner@cat.test");
  owner = await b.ownerCtx();
});

describe("category CRUD", () => {
  it("creates a category, audits it, and lists it with a product count", async () => {
    const cat = await createCategory(owner, { name: "Cakes" });
    expect(cat.name).toBe("Cakes");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "category.created", entityId: cat.id } });
    expect(log.metadata).toMatchObject({ name: "Cakes" });

    await createProduct(owner, { name: "Vanilla", categoryId: cat.id, unit: "piece", price: "500", isAvailable: true });
    const [listed] = await listCategories(owner);
    expect(listed).toMatchObject({ id: cat.id, productCount: 1 });
  });

  it("rejects a duplicate name case-insensitively among active categories", async () => {
    await createCategory(owner, { name: "Cakes" });
    await expect(createCategory(owner, { name: "cakes" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCategory(owner, { name: "  CAKES " })).rejects.toBeInstanceOf(ValidationError);
  });

  it("renames a category and blocks renaming onto an existing name", async () => {
    const a = await createCategory(owner, { name: "Breads" });
    await createCategory(owner, { name: "Cookies" });
    const renamed = await updateCategory(owner, a.id, { name: "Artisan Breads" });
    expect(renamed.name).toBe("Artisan Breads");
    await expect(updateCategory(owner, a.id, { name: "Cookies" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("only owners/admins may manage categories", async () => {
    const b = await setupBusiness("Staffed", "owner2@cat.test");
    const staff = await b.addMember("staff@cat.test", "STAFF");
    await expect(createCategory(await staff.ctx(), { name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("category archival", () => {
  it("hides archived categories from pickers but keeps them on existing products", async () => {
    const cat = await createCategory(owner, { name: "Seasonal" });
    const product = await createProduct(owner, { name: "Mango Cake", categoryId: cat.id, unit: "piece", price: "700", isAvailable: true });

    await setCategoryArchived(owner, cat.id, true);
    expect((await categoryOptions(owner)).map((c) => c.id)).not.toContain(cat.id);
    expect((await listCategories(owner, { includeArchived: true })).some((c) => c.id === cat.id)).toBe(true);

    const after = await getProduct(owner, product.id);
    expect(after.categoryId).toBe(cat.id);
    expect(after.category?.name).toBe("Seasonal");

    await setCategoryArchived(owner, cat.id, false);
    expect((await categoryOptions(owner)).map((c) => c.id)).toContain(cat.id);
  });
});

describe("products referencing categories", () => {
  it("filters products by category and searches by category name", async () => {
    const cakes = await createCategory(owner, { name: "Cakes" });
    await createProduct(owner, { name: "Vanilla Sponge", categoryId: cakes.id, unit: "piece", price: "500", isAvailable: true });
    await createProduct(owner, { name: "Sourdough", categoryId: null, unit: "piece", price: "200", isAvailable: true });

    const inCakes = await listProducts(owner, { categoryId: cakes.id });
    expect(inCakes.map((p) => p.name)).toEqual(["Vanilla Sponge"]);

    const byCategoryName = await listProducts(owner, { q: "Cak" });
    expect(byCategoryName.map((p) => p.name)).toEqual(["Vanilla Sponge"]);
  });

  it("rejects a product that points at a category from another business", async () => {
    const other = await setupBusiness("Other Bakehouse", "owner@other.test");
    const foreignCat = await createCategory(await other.ownerCtx(), { name: "Foreign" });
    await expect(
      createProduct(owner, { name: "Sneaky", categoryId: foreignCat.id, unit: "piece", price: "100", isAvailable: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a product with a non-existent category id", async () => {
    await expect(
      createProduct(owner, { name: "Ghost", categoryId: "does-not-exist", unit: "piece", price: "100", isAvailable: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("isolates categories between tenants in getCategory", async () => {
    const other = await setupBusiness("Other2", "owner@other2.test");
    const foreignCat = await createCategory(await other.ownerCtx(), { name: "Theirs" });
    await expect(getCategory(owner, foreignCat.id)).rejects.toThrow();
  });
});
