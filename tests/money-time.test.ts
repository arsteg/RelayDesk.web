import { describe, expect, it } from "vitest";
import {
  formatBps, formatQuantity, minorToInput, parseMoneyToMinor, parsePercentToBps, parseQuantityToMilli,
} from "@/lib/money";
import { amountDue, balanceMinor, computeTotals, derivePaymentStatus, lineTotal, netPaid } from "@/lib/totals";
import {
  addDaysYmd, dateOnly, dayBoundsUtc, isValidCurrency, isValidTimeZone, monthBoundsUtc, utcToZonedInput, zoneOffsetMinutes, zonedDateString, zonedLocalToUtc,
} from "@/lib/time";

const KOL = "Asia/Kolkata";

describe("money parsing and formatting", () => {
  it("parses rupee amounts, Indian grouping and bare decimals", () => {
    expect(parseMoneyToMinor("1,250.50", "INR")).toBe(125050);
    expect(parseMoneyToMinor("1,25,050", "INR")).toBe(12505000);
    expect(parseMoneyToMinor(".5", "INR")).toBe(50);
    expect(parseMoneyToMinor("0", "INR")).toBe(0);
    expect(parseMoneyToMinor("12.345", "INR")).toBeNull(); // too many decimals
    expect(parseMoneyToMinor("abc", "INR")).toBeNull();
    expect(parseMoneyToMinor("", "INR")).toBeNull();
    expect(parseMoneyToMinor(null, "INR")).toBeNull();
  });

  it("respects a currency's minor-unit digits (JPY has none)", () => {
    expect(parseMoneyToMinor("100", "JPY")).toBe(100);
    expect(parseMoneyToMinor("100.5", "JPY")).toBeNull();
    expect(minorToInput(100, "JPY")).toBe("100");
  });

  it("renders minor units back to input strings, including negatives", () => {
    expect(minorToInput(125050, "INR")).toBe("1250.50");
    expect(minorToInput(-50, "INR")).toBe("-0.50");
    expect(minorToInput(0, "INR")).toBe("0.00");
  });

  it("parses percentages to basis points with a 100% ceiling", () => {
    expect(parsePercentToBps("5")).toBe(500);
    expect(parsePercentToBps("18.5")).toBe(1850);
    expect(parsePercentToBps("100")).toBe(10000);
    expect(parsePercentToBps("")).toBe(0);
    expect(parsePercentToBps("100.01")).toBeNull();
    expect(parsePercentToBps("-5")).toBeNull();
  });

  it("formats basis points and quantities compactly", () => {
    expect(formatBps(1850)).toBe("18.5");
    expect(formatBps(1805)).toBe("18.05");
    expect(formatBps(500)).toBe("5");
    expect(formatBps(1800)).toBe("18");
    expect(formatQuantity(1500)).toBe("1.5");
    expect(formatQuantity(2000)).toBe("2");
    expect(formatQuantity(1250)).toBe("1.25");
  });

  it("parses quantities to integer thousandths", () => {
    expect(parseQuantityToMilli("1.5")).toBe(1500);
    expect(parseQuantityToMilli("0")).toBe(0);
    expect(parseQuantityToMilli("1.2345")).toBeNull();
    expect(parseQuantityToMilli("x")).toBeNull();
  });
});

describe("order totals", () => {
  it("rounds line totals half away from zero", () => {
    expect(lineTotal({ quantityMilli: 1500, unitPriceMinor: 1 })).toBe(2); // 1.5 -> 2
    expect(lineTotal({ quantityMilli: 500, unitPriceMinor: 1 })).toBe(1); // 0.5 -> 1
    expect(lineTotal({ quantityMilli: 2500, unitPriceMinor: 1 })).toBe(3); // 2.5 -> 3
  });

  it("applies tax after discount and not on delivery", () => {
    const t = computeTotals({ lines: [{ quantityMilli: 1000, unitPriceMinor: 100000 }], discountMinor: 20000, taxBps: 500, deliveryChargeMinor: 5000 });
    // subtotal 100000; taxable 80000; tax 4000; total 80000 + 4000 + 5000
    expect(t.subtotalMinor).toBe(100000);
    expect(t.taxMinor).toBe(4000);
    expect(t.totalMinor).toBe(89000);
  });

  it("allows a discount equal to the subtotal but rejects more", () => {
    expect(() => computeTotals({ lines: [{ quantityMilli: 1000, unitPriceMinor: 1000 }], discountMinor: 1000, taxBps: 0, deliveryChargeMinor: 0 }).totalMinor).not.toThrow();
    expect(() => computeTotals({ lines: [{ quantityMilli: 1000, unitPriceMinor: 1000 }], discountMinor: 1001, taxBps: 0, deliveryChargeMinor: 0 })).toThrow(RangeError);
  });

  it("handles 100% tax, zero-price lines and out-of-range inputs", () => {
    expect(computeTotals({ lines: [{ quantityMilli: 1000, unitPriceMinor: 1000 }], discountMinor: 0, taxBps: 10000, deliveryChargeMinor: 0 }).totalMinor).toBe(2000);
    expect(computeTotals({ lines: [{ quantityMilli: 1000, unitPriceMinor: 0 }], discountMinor: 0, taxBps: 0, deliveryChargeMinor: 0 }).totalMinor).toBe(0);
    expect(() => computeTotals({ lines: [], discountMinor: -1, taxBps: 0, deliveryChargeMinor: 0 })).toThrow(RangeError);
    expect(() => computeTotals({ lines: [], discountMinor: 0, taxBps: 10001, deliveryChargeMinor: 0 })).toThrow(RangeError);
    expect(() => computeTotals({ lines: [], discountMinor: 0, taxBps: 0, deliveryChargeMinor: -1 })).toThrow(RangeError);
  });

  it("derives payment status including zero-total and cancelled orders", () => {
    expect(derivePaymentStatus(0, 0, "CONFIRMED")).toBe("PAID"); // nothing owed
    expect(derivePaymentStatus(1000, 0, "CONFIRMED")).toBe("UNPAID");
    expect(derivePaymentStatus(1000, 500, "CONFIRMED")).toBe("PARTIAL");
    expect(derivePaymentStatus(1000, 1000, "CONFIRMED")).toBe("PAID");
    expect(derivePaymentStatus(1000, 1500, "CONFIRMED")).toBe("OVERPAID");
    expect(derivePaymentStatus(1000, 0, "CANCELLED")).toBe("PAID"); // nothing owed, nothing held
    expect(derivePaymentStatus(1000, 400, "CANCELLED")).toBe("OVERPAID"); // refund due
  });

  it("computes amount due and balance, treating cancelled as nothing owed", () => {
    expect(amountDue(1000, "CONFIRMED")).toBe(1000);
    expect(amountDue(1000, "CANCELLED")).toBe(0);
    expect(balanceMinor(1000, 300, "CONFIRMED")).toBe(700);
    expect(balanceMinor(1000, 300, "CANCELLED")).toBe(-300); // overpaid: refund owed
  });

  it("nets payments and ignores voided rows", () => {
    expect(
      netPaid([
        { kind: "DEPOSIT", amountMinor: 300, voidedAt: null },
        { kind: "PAYMENT", amountMinor: 700, voidedAt: null },
        { kind: "REFUND", amountMinor: 200, voidedAt: null },
        { kind: "PAYMENT", amountMinor: 999, voidedAt: new Date() },
      ]),
    ).toBe(800);
  });
});

describe("timezone and date helpers", () => {
  it("converts local wall-clock to UTC and back for a +5:30 zone", () => {
    expect(zonedLocalToUtc("2026-10-02T10:00", KOL)!.toISOString()).toBe("2026-10-02T04:30:00.000Z");
    expect(utcToZonedInput(new Date("2026-10-02T04:30:00.000Z"), KOL)).toBe("2026-10-02T10:00");
    expect(zoneOffsetMinutes(new Date("2026-10-02T04:30:00.000Z"), KOL)).toBe(330);
  });

  it("derives the local calendar day even across the UTC midnight boundary", () => {
    expect(zonedDateString(new Date("2026-10-02T04:30:00.000Z"), KOL)).toBe("2026-10-02");
    expect(zonedDateString(new Date("2026-10-01T20:00:00.000Z"), KOL)).toBe("2026-10-02"); // 01:30 local next day
  });

  it("validates and shifts YMD dates", () => {
    expect(dateOnly("2026-10-02")!.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(dateOnly("2026-02-30")).toBeNull();
    expect(dateOnly("2026-13-01")).toBeNull();
    expect(dateOnly("nope")).toBeNull();
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("computes day and month bounds in the business timezone", () => {
    const day = dayBoundsUtc("2026-10-02", KOL);
    expect(day.start.toISOString()).toBe("2026-10-01T18:30:00.000Z");
    expect(day.end.toISOString()).toBe("2026-10-02T18:30:00.000Z");
    const month = monthBoundsUtc(new Date("2026-10-15T12:00:00.000Z"), KOL);
    expect(month.startYmd).toBe("2026-10-01");
    expect(month.endYmd).toBe("2026-11-01");
    expect(month.start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  it("recognises valid timezones and currency codes", () => {
    expect(isValidTimeZone(KOL)).toBe(true);
    expect(isValidTimeZone("Nowhere/Nope")).toBe(false);
    expect(isValidCurrency("INR")).toBe(true);
    expect(isValidCurrency("USD")).toBe(true);
    expect(isValidCurrency("usd")).toBe(false);
    expect(isValidCurrency("us")).toBe(false);
  });
});
