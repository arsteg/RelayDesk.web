import { describe, expect, it } from "vitest";
import { computeTotals, derivePaymentStatus, lineTotal, netPaid } from "@/lib/totals";
import { formatMoney, minorToInput, parseMoneyToMinor, parsePercentToBps, parseQuantityToMilli } from "@/lib/money";
import { zonedLocalToUtc, utcToZonedInput, dayBoundsUtc } from "@/lib/time";

describe("money parsing", () => {
  it("parses decimal strings into integer minor units without float error", () => {
    expect(parseMoneyToMinor("1250.50", "INR")).toBe(125050);
    expect(parseMoneyToMinor("1,250.5", "INR")).toBe(125050);
    expect(parseMoneyToMinor("0.29", "INR")).toBe(29); // 0.29*100 = 28.999... in floats
    expect(parseMoneyToMinor("₹ 99", "INR")).toBe(9900);
    expect(parseMoneyToMinor("1500", "JPY")).toBe(1500);
  });
  it("rejects invalid amounts", () => {
    for (const bad of ["", "-5", "1.234", "abc", "1.2.3"]) expect(parseMoneyToMinor(bad, "INR")).toBeNull();
    expect(parseMoneyToMinor("10.5", "JPY")).toBeNull();
  });
  it("round-trips and formats", () => {
    expect(minorToInput(125050, "INR")).toBe("1250.50");
    expect(formatMoney(125050, "INR")).toBe("₹1,250.50");
  });
  it("parses quantities and percentages exactly", () => {
    expect(parseQuantityToMilli("1.5")).toBe(1500);
    expect(parseQuantityToMilli("0")).toBe(0);
    expect(parseQuantityToMilli("1.2345")).toBeNull();
    expect(parsePercentToBps("18")).toBe(1800);
    expect(parsePercentToBps("2.5")).toBe(250);
    expect(parsePercentToBps("101")).toBeNull();
  });
});

describe("order totals", () => {
  it("computes subtotal, discount, tax after discount, delivery and total", () => {
    const t = computeTotals({
      lines: [
        { quantityMilli: 2000, unitPriceMinor: 50000 }, // 2 x 500.00
        { quantityMilli: 1500, unitPriceMinor: 80000 }, // 1.5 kg x 800.00
      ],
      discountMinor: 10000,
      taxBps: 500,
      deliveryChargeMinor: 15000,
    });
    expect(t.lineTotals).toEqual([100000, 120000]);
    expect(t.subtotalMinor).toBe(220000);
    expect(t.taxMinor).toBe(10500); // 5% of 2100.00
    expect(t.totalMinor).toBe(220000 - 10000 + 10500 + 15000);
  });
  it("rounds line totals and tax half-up to the minor unit", () => {
    expect(lineTotal({ quantityMilli: 333, unitPriceMinor: 1000 })).toBe(333);
    expect(lineTotal({ quantityMilli: 1, unitPriceMinor: 500 })).toBe(1); // 0.5 -> 1
    const t = computeTotals({ lines: [{ quantityMilli: 1000, unitPriceMinor: 1010 }], discountMinor: 0, taxBps: 1250, deliveryChargeMinor: 0 });
    expect(t.taxMinor).toBe(126); // 126.25 -> 126
  });
  it("rejects a discount larger than the subtotal", () => {
    expect(() =>
      computeTotals({ lines: [{ quantityMilli: 1000, unitPriceMinor: 100 }], discountMinor: 101, taxBps: 0, deliveryChargeMinor: 0 }),
    ).toThrow(/Discount/);
  });
});

describe("payment status", () => {
  it("derives status from total, paid and order status", () => {
    expect(derivePaymentStatus(1000, 0, "CONFIRMED")).toBe("UNPAID");
    expect(derivePaymentStatus(1000, 400, "CONFIRMED")).toBe("PARTIAL");
    expect(derivePaymentStatus(1000, 1000, "CONFIRMED")).toBe("PAID");
    expect(derivePaymentStatus(800, 1000, "CONFIRMED")).toBe("OVERPAID");
    expect(derivePaymentStatus(1000, 400, "CANCELLED")).toBe("OVERPAID"); // refund due
  });
  it("nets refunds and ignores voided payments", () => {
    expect(
      netPaid([
        { kind: "DEPOSIT", amountMinor: 500, voidedAt: null },
        { kind: "PAYMENT", amountMinor: 300, voidedAt: null },
        { kind: "REFUND", amountMinor: 200, voidedAt: null },
        { kind: "PAYMENT", amountMinor: 999, voidedAt: new Date() },
      ]),
    ).toBe(600);
  });
});

describe("timezones", () => {
  it("converts Asia/Kolkata wall time to UTC and back", () => {
    const utc = zonedLocalToUtc("2026-10-02T14:30", "Asia/Kolkata")!;
    expect(utc.toISOString()).toBe("2026-10-02T09:00:00.000Z");
    expect(utcToZonedInput(utc, "Asia/Kolkata")).toBe("2026-10-02T14:30");
  });
  it("computes local day bounds", () => {
    const { start, end } = dayBoundsUtc("2026-10-02", "Asia/Kolkata");
    expect(start.toISOString()).toBe("2026-10-01T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-02T18:30:00.000Z");
  });
});
