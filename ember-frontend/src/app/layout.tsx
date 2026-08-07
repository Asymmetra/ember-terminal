import type { Metadata, Viewport } from "next";
import "./globals.css";
import { WalletProviderWrapper } from "@/providers/WalletProvider";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { Toasts } from "@/components/shared/Toasts";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Ember Terminal — Perpetuals Trading on Solana",
  description: "Next-generation perpetuals trading terminal powered by Phoenix on Solana. Institutional-grade orderbooks, real-time data, and on-chain execution.",
  applicationName: "Ember Terminal",
  openGraph: {
    title: "Ember Terminal",
    description: "Next-generation perpetuals trading on Solana",
    siteName: "Ember Terminal",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Ember Terminal",
    description: "Next-generation perpetuals trading on Solana",
  },
  other: {
    "theme-color": "#0C0C0E",
    "color-scheme": "dark",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ember-black text-text-primary antialiased">
        <WalletProviderWrapper>
          <OnboardingGate />
          {children}
          {/* Global toast renderer — provisioning/trade feedback must be
              visible on every route, not just /terminal (the pre-warm
              onboarding flow runs wherever a wallet can connect). */}
          <Toasts />
        </WalletProviderWrapper>
      </body>
    </html>
  );
}
