import type { Role } from "@/generated/prisma/enums";

/**
 * Business role permissions. Platform-admin privileges are separate
 * (User.isPlatformAdmin) and never implied by a business role.
 */
export const PERMISSIONS = {
  // Daily operations - everyone in the business
  "clients.manage": ["OWNER", "ADMIN", "STAFF"],
  "orders.manage": ["OWNER", "ADMIN", "STAFF"],
  "payments.record": ["OWNER", "ADMIN", "STAFF"],
  "products.view": ["OWNER", "ADMIN", "STAFF"],
  // Operations - preparation/weighing is a daily staff task
  "prep.record": ["OWNER", "ADMIN", "STAFF"],
  // Catalogue & money corrections
  "products.manage": ["OWNER", "ADMIN"],
  "pricing.manage": ["OWNER", "ADMIN"],
  "orders.adjust": ["OWNER", "ADMIN"],
  "payments.void": ["OWNER", "ADMIN"],
  "payments.refund": ["OWNER", "ADMIN"],
  // People
  "members.view": ["OWNER", "ADMIN"],
  "members.manage": ["OWNER", "ADMIN"], // admins may only manage STAFF, see canManageRole
  "audit.view": ["OWNER", "ADMIN"],
  "data.export": ["OWNER", "ADMIN"],
  // Owner-only
  "settings.manage": ["OWNER"],
  "billing.manage": ["OWNER"],
  "ownership.transfer": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Owners manage admins and staff; admins manage staff only. Nobody assigns OWNER this way. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (target === "OWNER") return false;
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target === "STAFF";
  return false;
}

export const ROLE_LABELS: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff" };
