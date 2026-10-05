/**
 * Money and quantity columns are Postgres INTEGER (int4). Keep every stored
 * value comfortably inside that range so oversized input becomes a clear
 * validation error instead of a database exception.
 */
export const MAX_MINOR = 1_000_000_000; // e.g. ₹1,00,00,000.00 (10 million rupees)
export const MAX_QUANTITY_MILLI = 1_000_000_000; // 1,000,000 units
export const MAX_ITEMS_PER_ORDER = 100;
