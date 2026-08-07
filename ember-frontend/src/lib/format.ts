export function formatPrice(price: number, decimals = 2): string {
  if (price == null || isNaN(price)) return "0.00";
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a price with magnitude-adaptive decimal precision. Used by
 * the observability page so BTC (~$79,000) and PUMP / SKR (~$0.005) can
 * share a single renderer without one of them collapsing to "0.00".
 *
 * Bands chosen so the rendered value carries ~5 significant figures
 * regardless of scale:
 *   ≥ 1000        →  79,295.00
 *   ≥ 1           →  91.190 / 38.940
 *   ≥ 0.1         →  0.2225
 *   ≥ 0.01        →  0.04123
 *   ≥ 0.001       →  0.006543
 *   else          →  0.00012345
 */
export function formatPriceAuto(price: number): string {
  if (price == null || isNaN(price)) return "0.00";
  const abs = Math.abs(price);
  let decimals: number;
  if (abs >= 1000) decimals = 2;
  else if (abs >= 1) decimals = 3;
  else if (abs >= 0.1) decimals = 4;
  else if (abs >= 0.01) decimals = 5;
  else if (abs >= 0.001) decimals = 6;
  else decimals = 8;
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatSize(size: number, decimals = 4): string {
  if (size == null || isNaN(size)) return "0.0000";
  return size.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatUsd(amount: number): string {
  return `$${formatPrice(amount)}`;
}

// Like formatUsd but uses extra precision for sub-dollar amounts so pennies
// and fractions-of-cent don't all render as $0.00 / $-0.00. Use for per-fill
// PnL or fee displays where small trades are common.
export function formatUsdPrecise(amount: number): string {
  if (amount == null || isNaN(amount) || amount === 0) return "$0.00";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(3)}`;
  if (abs >= 0.0001) return `${sign}$${abs.toFixed(4)}`;
  return `${sign}<$0.0001`;
}

export function formatPercent(pct: number): string {
  if (pct == null || isNaN(pct)) return "0.0000%";
  return `${(pct * 100).toFixed(4)}%`;
}

// Abbreviated USD for dense tables/tiles: $1.23M / $4.56K / $7.89.
export function compactUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return formatUsd(n);
}

export function abbreviateNumber(num: number): string {
  if (num == null || isNaN(num)) return "0.00";
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}
