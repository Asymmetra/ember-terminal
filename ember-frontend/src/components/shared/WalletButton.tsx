"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import clsx from "clsx";
import { shortAddr } from "@/lib/explorer";

export function WalletButton() {
  const { publicKey, disconnect, connected, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleCopy = async () => {
    if (!publicKey) return;
    await navigator.clipboard.writeText(publicKey.toBase58());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Not connected — show connect button
  if (!connected || !publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="flex items-center gap-2 border border-ember-orange/50 bg-transparent px-4 py-1.5 font-mono text-[11px] tracking-wider text-ember-orange transition-all duration-150 hover:border-ember-orange hover:bg-ember-orange/10"
      >
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="4" width="12" height="9" rx="0" />
          <path d="M10 8.5a.5.5 0 100-1 .5.5 0 000 1z" fill="currentColor" />
          <path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1" />
        </svg>
        CONNECT
      </button>
    );
  }

  // Connected — show address with dropdown
  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className={clsx(
          "flex items-center gap-2 border bg-surface-l2 px-3 py-1.5 transition-colors",
          menuOpen
            ? "border-ember-orange/40 text-text-primary"
            : "border-ember-border text-text-secondary hover:border-ember-border hover:text-text-primary"
        )}
      >
        {/* Wallet icon indicator */}
        <div className="h-1.5 w-1.5 bg-ember-green" />
        <span className="font-mono text-[11px]">
          {shortAddr(publicKey.toBase58())}
        </span>
        <svg
          className={clsx("h-2.5 w-2.5 text-text-secondary/70 transition-transform", menuOpen && "rotate-180")}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 top-full z-50 mt-px min-w-[180px] border border-ember-border bg-surface-l1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          {/* Full address */}
          <div className="border-b border-ember-border/50 px-3 py-2">
            <span className="font-mono text-[10px] text-text-secondary/60 break-all leading-relaxed">
              {publicKey.toBase58()}
            </span>
          </div>

          {/* Actions */}
          <button
            onClick={() => { handleCopy(); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] tracking-wider text-text-secondary transition-colors hover:bg-surface-l2 hover:text-text-primary"
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="5" width="8" height="8" />
              <path d="M3 11V3h8" />
            </svg>
            {copied ? "COPIED" : "COPY ADDRESS"}
          </button>

          <button
            onClick={() => { setVisible(true); setMenuOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] tracking-wider text-text-secondary transition-colors hover:bg-surface-l2 hover:text-text-primary"
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2v12M2 8h12" />
            </svg>
            CHANGE WALLET
          </button>

          <button
            onClick={() => { disconnect(); setMenuOpen(false); }}
            className="flex w-full items-center gap-2 border-t border-ember-border/50 px-3 py-2 text-left font-mono text-[10px] tracking-wider text-ember-red/70 transition-colors hover:bg-surface-l2 hover:text-ember-red"
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2H3v12h3M10 4l4 4-4 4M7 8h7" />
            </svg>
            DISCONNECT
          </button>
        </div>
      )}
    </div>
  );
}
