import clsx from "clsx";
import { formatPrice } from "@/lib/format";

interface PriceDisplayProps {
  price: number;
  previousPrice?: number;
  decimals?: number;
  className?: string;
}

export function PriceDisplay({ price, previousPrice, decimals = 2, className }: PriceDisplayProps) {
  const direction =
    previousPrice !== undefined
      ? price > previousPrice
        ? "up"
        : price < previousPrice
        ? "down"
        : "neutral"
      : "neutral";

  return (
    <span
      className={clsx(
        "font-mono transition-colors duration-200",
        direction === "up" && "text-ember-green",
        direction === "down" && "text-ember-red",
        direction === "neutral" && "text-text-primary",
        className
      )}
    >
      {formatPrice(price, decimals)}
    </span>
  );
}
