/**
 * Sample data: two fully isolated businesses plus a platform admin.
 * Everything is created through the same service layer the app uses, so
 * totals, order numbers, payment states and audit entries are realistic.
 *
 * All demo accounts use the password: relaydesk-demo
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/crypto";
import { createBusinessWithOwner } from "../src/server/auth";
import { loadTenantContext, type TenantContext } from "../src/server/context";
import { createClient } from "../src/server/clients";
import { createCategory } from "../src/server/categories";
import { createProduct } from "../src/server/products";
import { changeOrderStatus, createOrder } from "../src/server/orders";
import { recordPayment } from "../src/server/payments";
import { updateSettings } from "../src/server/settings";
import { addDaysYmd, zonedDateString } from "../src/lib/time";

const PASSWORD = "relaydesk-demo";

async function user(email: string, name: string, opts: { platformAdmin?: boolean } = {}) {
  return prisma.user.create({
    data: { email, name, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), isPlatformAdmin: opts.platformAdmin ?? false },
  });
}

async function ctxFor(userId: string, businessId: string): Promise<TenantContext> {
  const c = await loadTenantContext(userId, businessId);
  if (!c) throw new Error("membership missing");
  return c;
}

interface BusinessSpec {
  name: string;
  owner: [string, string];
  admin: [string, string];
  staff: [string, string];
  settings: { phone: string; email: string; address: string; taxId: string; defaultTaxRate: string; invoiceFooter: string; invoicePrefix: string };
  plan: { plan: "STARTER" | "PRO"; status: "ACTIVE" | "TRIALING" };
  products: [name: string, category: string, unit: string, price: string, description?: string][];
  clients: [name: string, phone: string, email: string | null, address: string | null, notes: string | null][];
}

async function seedBusiness(spec: BusinessSpec) {
  const owner = await user(...spec.owner);
  const { businessId } = await createBusinessWithOwner(owner.id, spec.name);
  const admin = await user(...spec.admin);
  const staff = await user(...spec.staff);
  await prisma.membership.createMany({
    data: [
      { userId: admin.id, businessId, role: "ADMIN" },
      { userId: staff.id, businessId, role: "STAFF" },
    ],
  });
  await prisma.subscription.update({
    where: { businessId },
    data: {
      ...spec.plan,
      ...(spec.plan.status === "ACTIVE" ? { currentPeriodEnd: new Date(Date.now() + 20 * 86400_000) } : {}),
    },
  });

  const ownerCtx = await ctxFor(owner.id, businessId);
  await updateSettings(ownerCtx, {
    name: spec.name,
    ...spec.settings,
    website: null,
    currency: "INR",
    timezone: "Asia/Kolkata",
  });
  const ctx = await ctxFor(owner.id, businessId);
  const staffCtx = await ctxFor(staff.id, businessId);

  const categoryByName = new Map<string, string>();
  for (const name of new Set(spec.products.map((p) => p[1]))) {
    categoryByName.set(name, (await createCategory(ctx, { name })).id);
  }
  const products: Awaited<ReturnType<typeof createProduct>>[] = [];
  for (const [name, category, unit, price, description] of spec.products) {
    products.push(await createProduct(ctx, { name, categoryId: categoryByName.get(category) ?? null, unit, price, description, isAvailable: true }));
  }
  const clients: Awaited<ReturnType<typeof createClient>>[] = [];
  for (const [name, phone, email, address, notes] of spec.clients) {
    clients.push(await createClient(staffCtx, { name, phone, email, address, notes }));
  }

  const today = zonedDateString(new Date(), "Asia/Kolkata");
  const item = (i: number, qty = "1") => ({
    productId: products[i].id,
    description: products[i].name,
    unit: products[i].unit,
    quantity: qty,
    unitPrice: (products[i].priceMinor / 100).toFixed(2),
  });

  // 1. Completed and fully paid last week
  const o1 = await createOrder(staffCtx, {
    clientId: clients[0].id, orderDate: addDaysYmd(today, -9), fulfillmentAt: `${addDaysYmd(today, -7)}T17:00`, fulfillmentType: "PICKUP",
    items: [item(0), item(2, "12")], taxRate: spec.settings.defaultTaxRate,
  });
  await recordPayment(staffCtx, o1.id, { kind: "DEPOSIT", amount: (Math.floor(o1.totalMinor / 3) / 100).toFixed(2), paidOn: addDaysYmd(today, -9), method: "UPI", reference: "UPI-4482199" });
  const o1full = await prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
  await recordPayment(staffCtx, o1.id, { kind: "PAYMENT", amount: ((o1full.totalMinor - o1full.paidMinor) / 100).toFixed(2), paidOn: addDaysYmd(today, -7), method: "CASH" });
  for (const s of ["IN_PROGRESS", "READY", "COMPLETED"] as const) await changeOrderStatus(ctx, o1.id, s);

  // 2. Due today, deposit paid, in progress (custom cake)
  const o2 = await createOrder(staffCtx, {
    clientId: clients[1].id, orderDate: addDaysYmd(today, -3), fulfillmentAt: `${today}T18:30`, fulfillmentType: "DELIVERY",
    deliveryAddress: spec.clients[1][3] ?? "Address on file", deliveryCharge: "150", discount: "100",
    notes: "Message on cake: 'Happy 30th Rohan'. Eggless.",
    items: [{ description: "Custom 2-tier fondant cake, chocolate truffle (eggless)", quantity: "1", unitPrice: "3200" }, item(3, "6")],
    taxRate: spec.settings.defaultTaxRate,
  });
  await recordPayment(staffCtx, o2.id, { kind: "DEPOSIT", amount: (Math.floor(o2.totalMinor / 2) / 100).toFixed(2), paidOn: addDaysYmd(today, -3), method: "BANK_TRANSFER", reference: "NEFT-99812" });
  await changeOrderStatus(ctx, o2.id, "IN_PROGRESS");

  // 3. Overdue: was due yesterday, unpaid
  await createOrder(staffCtx, {
    clientId: clients[2].id, orderDate: addDaysYmd(today, -4), fulfillmentAt: `${addDaysYmd(today, -1)}T11:00`, fulfillmentType: "PICKUP",
    items: [item(1, "2"), item(4, "1.5")], taxRate: spec.settings.defaultTaxRate,
  });

  // 4. Upcoming in 3 days, confirmed, unpaid
  await createOrder(staffCtx, {
    clientId: clients[3].id, orderDate: today, fulfillmentAt: `${addDaysYmd(today, 3)}T09:00`, fulfillmentType: "PICKUP",
    items: [item(0, "2"), item(2, "24")], taxRate: spec.settings.defaultTaxRate,
  });

  // 5. Draft quote for next week
  await createOrder(staffCtx, {
    clientId: clients[0].id, orderDate: today, fulfillmentAt: `${addDaysYmd(today, 8)}T16:00`, fulfillmentType: "DELIVERY",
    deliveryAddress: spec.clients[0][3] ?? "TBC", status: "DRAFT",
    items: [{ description: "Dessert table for 40 guests (quote)", quantity: "1", unitPrice: "9500" }],
  });

  // 6. Cancelled with refund of deposit
  const o6 = await createOrder(staffCtx, {
    clientId: clients[4].id, orderDate: addDaysYmd(today, -6), fulfillmentAt: `${addDaysYmd(today, -2)}T15:00`, fulfillmentType: "PICKUP",
    items: [item(0)], taxRate: spec.settings.defaultTaxRate,
  });
  const deposit6 = (Math.floor(o6.totalMinor / 2) / 100).toFixed(2);
  await recordPayment(staffCtx, o6.id, { kind: "DEPOSIT", amount: deposit6, paidOn: addDaysYmd(today, -6), method: "UPI" });
  await changeOrderStatus(ctx, o6.id, "CANCELLED", "Customer cancelled event");
  await recordPayment(ctx, o6.id, { kind: "REFUND", amount: deposit6, paidOn: addDaysYmd(today, -5), method: "UPI", notes: "Full deposit refunded" });

  // 7. Ready for pickup today, fully paid
  const o7 = await createOrder(staffCtx, {
    clientId: clients[2].id, orderDate: addDaysYmd(today, -1), fulfillmentAt: `${today}T12:00`, fulfillmentType: "PICKUP",
    items: [item(1, "4")],
  });
  const o7full = await prisma.order.findUniqueOrThrow({ where: { id: o7.id } });
  await recordPayment(staffCtx, o7.id, { kind: "PAYMENT", amount: (o7full.totalMinor / 100).toFixed(2), paidOn: today, method: "CARD" });
  await changeOrderStatus(ctx, o7.id, "READY");

  return { businessId, owner, admin, staff };
}

/** Ensure the operator-editable pricing plan rows exist (mirrors src/lib/plans.ts defaults). */
async function seedPricingPlans() {
  const plans = [
    { code: "STARTER", name: "Starter", description: "For solo owners and small teams getting started.", priceLabel: "₹999 / month", maxMembers: 3, maxMonthlyOrders: 200, sortOrder: 0 },
    { code: "PRO", name: "Pro", description: "For busy teams that need more seats and unlimited orders.", priceLabel: "₹2,499 / month", maxMembers: 25, maxMonthlyOrders: null, sortOrder: 1 },
  ];
  for (const p of plans) {
    await prisma.pricingPlan.upsert({ where: { code: p.code }, update: {}, create: p });
  }
}

async function main() {
  // The demo accounts share a published password: never create them in production by accident.
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    console.error("Refusing to seed demo data with NODE_ENV=production (set SEED_ALLOW_PRODUCTION=1 to override on a staging database).");
    process.exitCode = 1;
    return;
  }
  if (await prisma.user.findUnique({ where: { email: "owner@sweetcrumbs.test" } })) {
    console.log("Seed data already present - skipping. Run `npm run db:reset` for a clean database.");
    return;
  }
  // A database that already has accounts holds real data (possibly production
  // reached from a developer machine, where NODE_ENV is not "production").
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    console.error(`Refusing to seed demo data: this database already has ${existingUsers} account(s). Seed only an empty development database.`);
    process.exitCode = 1;
    return;
  }

  await seedPricingPlans();

  const a = await seedBusiness({
    name: "Sweet Crumbs",
    owner: ["owner@sweetcrumbs.test", "Ananya Rao"],
    admin: ["admin@sweetcrumbs.test", "Vikram Shah"],
    staff: ["staff@sweetcrumbs.test", "Meera Iyer"],
    settings: {
      phone: "+91 98450 12345", email: "hello@sweetcrumbs.test", address: "14, 4th Cross, Indiranagar\nBengaluru 560038",
      taxId: "29ABCDE1234F1Z5", defaultTaxRate: "5", invoicePrefix: "SC-",
      invoiceFooter: "Thank you for choosing Sweet Crumbs!\nUPI: sweetcrumbs@okbank · Cakes are best enjoyed within 24 hours.",
    },
    plan: { plan: "PRO", status: "ACTIVE" },
    products: [
      ["Black Forest Cake (1 kg)", "Cakes", "piece", "950", "Classic cherry and chocolate sponge"],
      ["Sourdough Loaf", "Breads", "piece", "220"],
      ["Butter Croissant", "Viennoiserie", "piece", "85"],
      ["Red Velvet Cupcake", "Cupcakes", "piece", "110"],
      ["Rum & Raisin Plum Cake", "Cakes", "kg", "1100"],
    ],
    clients: [
      ["Priya Menon", "+91 98860 11111", "priya.menon@example.test", "22 Lavelle Road, Bengaluru", "Prefers less sugar"],
      ["Rohan Kapoor", "+91 99000 22222", "rohan@example.test", "8 Koramangala 5th Block, Bengaluru", null],
      ["Café Monsoon", "+91 80 4123 4567", "orders@cafemonsoon.test", "MG Road, Bengaluru", "Wholesale - invoice monthly"],
      ["Divya Nair", "+91 97400 33333", null, null, "Nut allergy!"],
      ["Arjun Reddy", "+91 96320 44444", "arjun.r@example.test", null, null],
    ],
  });

  const b = await seedBusiness({
    name: "Mumbai Oven Co.",
    owner: ["owner@mumbaioven.test", "Farhan Qureshi"],
    admin: ["admin@mumbaioven.test", "Sneha Patil"],
    staff: ["staff@mumbaioven.test", "Kunal Desai"],
    settings: {
      phone: "+91 22 2649 0000", email: "orders@mumbaioven.test", address: "Hill Road, Bandra West\nMumbai 400050",
      taxId: "27PQRSX6789K1Z2", defaultTaxRate: "18", invoicePrefix: "MO/",
      invoiceFooter: "Mumbai Oven Co. · Bank: HDFC 0000123456 IFSC HDFC0000001",
    },
    plan: { plan: "STARTER", status: "TRIALING" },
    products: [
      ["Pav (dozen)", "Breads", "dozen", "60"],
      ["Mawa Cake", "Cakes", "piece", "45"],
      ["Nankhatai (250 g)", "Cookies", "box", "180"],
      ["Chocolate Truffle Pastry", "Pastries", "piece", "120"],
      ["Fruit Cake", "Cakes", "kg", "800"],
    ],
    clients: [
      ["Irani Café Bandra", "+91 22 2640 1111", "cafe@irani.test", "Linking Road, Bandra", "Daily pav order"],
      ["Neha Joshi", "+91 98200 55555", "neha.j@example.test", "Pali Hill, Bandra West", null],
      ["Aditya Kulkarni", "+91 98190 66666", null, "Khar West", null],
      ["Sana Sheikh", "+91 98330 77777", "sana@example.test", null, "Birthday on 12 Dec"],
      ["Hotel Seabreeze", "+91 22 2655 8888", "fnb@seabreeze.test", "Carter Road", null],
    ],
  });

  // Mumbai Oven is mid-way through a Starter trial.
  await prisma.subscription.update({ where: { businessId: b.businessId }, data: { trialEndsAt: new Date(Date.now() + 10 * 86400_000) } });

  // A user who belongs to both businesses (workspace switching demo)
  const consultant = await user("consultant@relaydesk.test", "Kavya Consultant");
  await prisma.membership.createMany({
    data: [
      { userId: consultant.id, businessId: a.businessId, role: "STAFF" },
      { userId: consultant.id, businessId: b.businessId, role: "ADMIN" },
    ],
  });

  // Platform admin(s) - not members of any business
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "admin@relaydesk.local").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of adminEmails) await user(email, "Platform Admin", { platformAdmin: true });

  console.log(`
Seeded two businesses. Password for every account: ${PASSWORD}

  Sweet Crumbs    (Pro, active)          owner@sweetcrumbs.test / admin@sweetcrumbs.test / staff@sweetcrumbs.test
  Mumbai Oven Co. (trial)                owner@mumbaioven.test  / admin@mumbaioven.test  / staff@mumbaioven.test
  Member of both businesses              consultant@relaydesk.test
  Platform admin                         ${adminEmails.join(", ")}
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
