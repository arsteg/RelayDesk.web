import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import { parsePercentToBps } from "@/lib/money";
import { isValidCurrency, isValidTimeZone } from "@/lib/time";
import { actorOf, assertCan, assertNotSuspended, type TenantContext } from "@/server/context";
import { optionalEmail, optionalPhone, optionalText, parseOrThrow } from "@/server/validation";

export const settingsSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120).regex(/^[^\n\r\t\u0000]*$/, "Use a single line"),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(500),
  website: optionalText(200),
  taxId: optionalText(40),
  currency: z.string().trim().toUpperCase().refine(isValidCurrency, "Enter a valid ISO currency code, e.g. INR"),
  timezone: z.string().trim().refine(isValidTimeZone, "Enter a valid IANA timezone, e.g. Asia/Kolkata"),
  defaultTaxRate: z.string().optional().default(""),
  invoiceFooter: optionalText(1000),
  invoicePrefix: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Za-z0-9#/_-]*$/, "Use letters, numbers, - _ / or #"),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export async function getSettings(ctx: TenantContext) {
  return prisma.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    omit: { logoData: true },
  });
}

export async function updateSettings(ctx: TenantContext, input: SettingsInput) {
  assertCan(ctx, "settings.manage");
  assertNotSuspended(ctx);
  const data = parseOrThrow(settingsSchema, input);
  const defaultTaxBps = parsePercentToBps(data.defaultTaxRate);
  if (defaultTaxBps === null) throw new ValidationError("Please fix the highlighted fields.", { defaultTaxRate: "Enter a percentage between 0 and 100" });

  return prisma.$transaction(async (tx) => {
    const before = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId }, omit: { logoData: true } });
    // Stored amounts have no currency of their own, so changing the currency
    // after prices or orders exist would silently relabel (and possibly
    // rescale) historical money. Only allow it on an empty workspace.
    if (before.currency !== data.currency) {
      const used = (await tx.order.count({ where: { businessId: ctx.businessId } })) + (await tx.product.count({ where: { businessId: ctx.businessId } }));
      if (used > 0) {
        throw new ValidationError("Please fix the highlighted fields.", {
          currency: "The currency can't be changed once products or orders exist, because existing amounts would be relabelled.",
        });
      }
    }
    const { defaultTaxRate: _ignored, ...rest } = data;
    const business = await tx.business.update({
      where: { id: ctx.businessId },
      data: { ...rest, invoicePrefix: data.invoicePrefix, defaultTaxBps },
      omit: { logoData: true },
    });
    const changed = Object.keys(rest).filter((k) => (before as Record<string, unknown>)[k] !== (business as Record<string, unknown>)[k]);
    if (before.defaultTaxBps !== defaultTaxBps) changed.push("defaultTaxBps");
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "settings.updated",
      entityType: "Business",
      entityId: ctx.businessId,
      metadata: { changed },
    });
    return business;
  });
}

const LOGO_MAX_BYTES = 512 * 1024;

/** Accept PNG, JPEG or WebP only (no SVG - it can carry script). Checked by magic bytes. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function updateLogo(ctx: TenantContext, bytes: Uint8Array | null) {
  assertCan(ctx, "settings.manage");
  assertNotSuspended(ctx);
  if (bytes && bytes.length > LOGO_MAX_BYTES) throw new ValidationError("Logo must be 512 KB or smaller.", { logo: "File too large" });
  const mime = bytes ? sniffImageType(bytes) : null;
  if (bytes && !mime) throw new ValidationError("Logo must be a PNG, JPEG or WebP image.", { logo: "Unsupported file type" });
  await prisma.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: ctx.businessId },
      data: { logoData: bytes ? Buffer.from(bytes) : null, logoMimeType: mime },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: bytes ? "settings.logo_updated" : "settings.logo_removed",
      entityType: "Business",
      entityId: ctx.businessId,
    });
  });
}

export async function getLogo(ctx: TenantContext) {
  return prisma.business.findUnique({
    where: { id: ctx.businessId },
    select: { logoData: true, logoMimeType: true, updatedAt: true },
  });
}
