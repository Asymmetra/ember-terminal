// Single source of truth for the cross-page nav links. Kept in its own leaf
// module (no imports) so PageNav, the terminal's MarketHeader, and the shared
// MobileNav menu can all import it without circular dependencies.

export type NavHref = "/terminal" | "/profile" | "/stats" | "/lookup";

export const NAV_LINKS: Array<{ href: NavHref; label: string }> = [
  { href: "/terminal", label: "Terminal" },
  { href: "/profile", label: "Profile" },
  { href: "/stats", label: "Stats" },
  { href: "/lookup", label: "Lookup" },
];
