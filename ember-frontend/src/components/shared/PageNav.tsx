"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import clsx from "clsx";
import { WalletButton } from "@/components/shared/WalletButton";
import { MobileNav } from "@/components/shared/MobileNav";
import { NAV_LINKS, type NavHref } from "@/components/shared/navLinks";

// Re-exported for back-compat: MarketHeader imports NAV_LINKS from here.
export { NAV_LINKS };

/**
 * Shared top-of-page navigation for the non-terminal routes
 * (/profile, /stats, /lookup).
 *
 * The terminal page has its own nav baked into MarketHeader because
 * that header carries market-specific info alongside the nav links —
 * but the nav-link cluster on terminal mirrors this same shape so the
 * active-state styling is consistent everywhere.
 */

export interface PageNavProps {
  /**
   * The path of the page rendering this nav, used to highlight the
   * current entry. Typically pulled from the page component itself.
   */
  currentPath: NavHref;
  /**
   * Human-readable label shown after "Ember" in the brand area.
   * E.g. "Wallet Lookup", "Profile", "Stats".
   */
  pageLabel: string;
  /**
   * Optional extra content rendered in the brand cluster after the
   * label (e.g. a "viewing other wallet" address chip).
   */
  extra?: ReactNode;
}

export function PageNav({ currentPath, pageLabel, extra }: PageNavProps) {
  return (
    <div className="flex items-center justify-between border-b border-ember-border bg-surface-l1 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="font-mono text-xs font-medium uppercase tracking-wider text-ember-orange hover:text-ember-orange/80 transition-colors"
        >
          Ember
        </Link>
        <div className="h-4 w-px bg-ember-border" />
        <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-primary">
          {pageLabel}
        </span>
        {extra}
      </div>
      <div className="flex items-center gap-3">
        {/* Inline links on ≥sm; collapse to a hamburger menu on mobile. */}
        <div className="hidden items-center gap-3 sm:flex">
          {NAV_LINKS.map((link) => {
            const active = link.href === currentPath;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "font-mono text-[10px] uppercase tracking-wider transition-colors",
                  active
                    ? "text-ember-orange"
                    : "text-text-secondary/60 hover:text-ember-orange",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <WalletButton />
        <div className="sm:hidden">
          <MobileNav currentPath={currentPath} />
        </div>
      </div>
    </div>
  );
}
