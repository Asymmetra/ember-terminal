"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { NAV_LINKS, type NavHref } from "@/components/shared/navLinks";

/**
 * Compact nav menu for narrow viewports — a hamburger button that toggles a
 * dropdown of the cross-page links. Reused by PageNav and the terminal's
 * MarketHeader so the terminal isn't a dead-end on phones (the inline link
 * cluster is hidden on mobile in favor of this).
 */
export function MobileNav({ currentPath }: { currentPath?: NavHref }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-7 items-center justify-center border border-ember-border text-text-secondary transition-colors hover:border-ember-orange/60 hover:text-ember-orange"
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[91] mt-1.5 w-36 border border-ember-border bg-surface-l1 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  "block px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors",
                  currentPath === link.href
                    ? "bg-ember-orange/10 text-ember-orange"
                    : "text-text-secondary hover:bg-surface-l2 hover:text-text-primary",
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
