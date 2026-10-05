/**
 * Create (or reset the password of) a set of user accounts and make them
 * members of a business, creating the business if needed. Nothing is hardcoded:
 * the password, business name and the account list all come from the environment.
 *
 *   ACCOUNT_PASSWORD='…' \
 *   BUSINESS_NAME='My Business' \
 *   ACCOUNTS='[{"email":"owner@example.com","role":"OWNER","name":"Owner"},
 *              {"email":"admin@example.com","role":"ADMIN"}]' \
 *   npm run accounts:create
 *
 * ACCOUNTS is a JSON array. Each entry needs `email` and `role`
 * (OWNER | ADMIN | STAFF); `name` is optional (defaults to the email's local
 * part). Exactly one account must be the OWNER - the business is created with
 * them as owner. Existing accounts get the password reset and all their
 * sessions signed out; existing memberships keep their role.
 */
import "dotenv/config";
import { z } from "zod";
import { prisma } from "../src/lib/db";
import { audit } from "../src/lib/audit";
import { hashPassword } from "../src/lib/auth/crypto";
import { createBusinessWithOwner, emailSchema, nameSchema, passwordSchema } from "../src/server/auth";

const accountSchema = z.object({
  email: emailSchema,
  name: nameSchema.optional(),
  role: z.enum(["OWNER", "ADMIN", "STAFF"]),
});
const accountsSchema = z
  .array(accountSchema)
  .min(1, "Provide at least one account")
  .refine((a) => a.filter((x) => x.role === "OWNER").length === 1, "Exactly one account must have role OWNER");

/** Read and validate configuration from the environment. Returns null on error. */
function loadConfig() {
  const password = passwordSchema.safeParse(process.env.ACCOUNT_PASSWORD ?? "");
  if (!password.success) {
    console.error(`Set ACCOUNT_PASSWORD: ${password.error.issues[0]?.message ?? "invalid password"}.`);
    return null;
  }
  const businessName = nameSchema.safeParse(process.env.BUSINESS_NAME ?? "");
  if (!businessName.success) {
    console.error("Set BUSINESS_NAME to the workspace name.");
    return null;
  }
  if (!process.env.ACCOUNTS) {
    console.error('Set ACCOUNTS to a JSON array, e.g. ACCOUNTS=\'[{"email":"owner@example.com","role":"OWNER"}]\'.');
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(process.env.ACCOUNTS);
  } catch {
    console.error("ACCOUNTS must be valid JSON.");
    return null;
  }
  const accounts = accountsSchema.safeParse(raw);
  if (!accounts.success) {
    console.error(`Invalid ACCOUNTS: ${accounts.error.issues[0]?.message ?? "check the format"}.`);
    return null;
  }
  return {
    password: password.data,
    businessName: businessName.data,
    accounts: accounts.data.map((a) => ({ email: a.email, name: a.name ?? a.email.split("@")[0], role: a.role })),
  };
}

async function main() {
  const config = loadConfig();
  if (!config) {
    process.exitCode = 1;
    return;
  }
  const { businessName, accounts } = config;
  const passwordHash = await hashPassword(config.password);
  const userIds = new Map<string, string>();
  for (const { email, name } of accounts) {
    const existing = await prisma.user.findUnique({ where: { email } });
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } })
      : await prisma.user.create({ data: { email, name, passwordHash, emailVerifiedAt: new Date() } });
    if (existing) await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit(prisma, {
      businessId: null,
      actor: null,
      scope: "platform",
      action: existing ? "user.password_reset" : "user.registered",
      entityType: "User",
      entityId: user.id,
      metadata: { email, via: "cli" },
    });
    userIds.set(email, user.id);
    console.log(`${existing ? "Updated" : "Created"} ${email}`);
  }

  const owner = accounts.find((a) => a.role === "OWNER")!;
  const found = await prisma.business.findMany({ where: { name: businessName }, select: { id: true } });
  if (found.length > 1) throw new Error(`More than one business is named ${businessName}; fix that by hand first.`);
  const businessId = found[0]?.id ?? (await createBusinessWithOwner(userIds.get(owner.email)!, businessName)).businessId;
  if (!found.length) console.log(`Created business ${businessName} owned by ${owner.email}`);
  for (const { email, role } of accounts) {
    const userId = userIds.get(email)!;
    const member = await prisma.membership.findUnique({ where: { userId_businessId: { userId, businessId } } });
    if (member) continue;
    const membership = await prisma.membership.create({ data: { userId, businessId, role } });
    await audit(prisma, {
      businessId,
      actor: null,
      scope: "platform",
      action: "member.added",
      entityType: "Membership",
      entityId: membership.id,
      metadata: { email, role, via: "cli" },
    });
    console.log(`Added ${email} to ${businessName} as ${role}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
