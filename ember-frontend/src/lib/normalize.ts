/**
 * Defensive normalization helpers for the Phoenix Rise SDK / Ember
 * backend payload shapes. Different endpoints return numeric values
 * in several shapes:
 *
 *   - bare number              → e.g. `slot: 421471103`
 *   - string                   → e.g. `baseLotsDelta: "-0.16"` (used
 *                                 to avoid JS number precision loss
 *                                 on large BigInt-sized values)
 *   - { value, decimals, ui }  → Phoenix's UiAmount shape, where
 *                                 `value` is a raw integer and
 *                                 `ui` is the human-readable string
 *
 * `toNum` accepts any of these and returns a plain JS number, falling
 * back to 0 for unrecognized shapes. Used pervasively on /lookup so a
 * row that contains an unexpected shape doesn't crash the whole page.
 */

export function toNum(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  if (x && typeof x === "object") {
    const obj = x as { ui?: unknown; value?: unknown; decimals?: unknown };
    // Prefer the pre-formatted `ui` string when present — it's what
    // Phoenix considers the human-readable rendering.
    if (typeof obj.ui === "string") {
      const n = Number(obj.ui);
      if (Number.isFinite(n)) return n;
    }
    if (typeof obj.value === "number" && typeof obj.decimals === "number") {
      return obj.value / Math.pow(10, obj.decimals);
    }
    if (typeof obj.value === "number") return obj.value;
    if (typeof obj.value === "string") {
      const n = Number(obj.value);
      if (Number.isFinite(n) && typeof obj.decimals === "number") {
        return n / Math.pow(10, obj.decimals);
      }
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/**
 * Convert raw USDC micro-units (6-decimal integer) to dollars.
 * Used for collateral-history events where `amount` and
 * `collateralAfter` come in as raw u64 micros.
 */
export function rawMicroToUsd(raw: unknown): number {
  return toNum(raw) / 1_000_000;
}

/**
 * Coerce something that might be an array, an object map, or
 * null/undefined into an array. Phoenix's SDK returns `limitOrders`
 * as `{}` (empty object) when there are no orders and as an object
 * keyed by order id when there are orders — `.map` blows up on an
 * object. This helper normalizes both shapes.
 */
export function asArray<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === "object") return Object.values(x) as T[];
  return [];
}
