"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useToastStore, Toast } from "@/stores/toastStore";
import clsx from "clsx";

const EXPLORER_URL = "https://orbmarkets.io/tx";
const DISMISS_MS = 6000;

function getTxUrl(txid: string): string {
  return `${EXPLORER_URL}/${txid}`;
}

function ToastIcon({ type }: { type: Toast["type"] }) {
  const size = "h-4 w-4 shrink-0";
  if (type === "loading") {
    return (
      <svg className={clsx(size, "animate-spin")} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
        <path d="M8 2a6 6 0 014.9 9.4" />
      </svg>
    );
  }
  if (type === "success") {
    return (
      <svg className={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 8.5l3.5 3.5L13 4" />
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg className={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
      </svg>
    );
  }
  return (
    <svg className={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 5v.5" />
    </svg>
  );
}

function ActionButton({ onClick, title, children }: { onClick?: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded p-1 text-white/50 transition-colors hover:text-white hover:bg-white/10"
      title={title}
    >
      {children}
    </button>
  );
}

function CopyButton({ toast }: { toast: Toast }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    let text = toast.detail ? `${toast.title}\n${toast.detail}` : toast.title;
    if (toast.txid) {
      text += `\n${getTxUrl(toast.txid)}`;
    }
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ActionButton onClick={handleCopy} title="Copy to clipboard">
      {copied ? (
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8.5l3.5 3.5L13 4" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="5" width="8" height="8" rx="1" />
          <path d="M3 11V3h8" />
        </svg>
      )}
    </ActionButton>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const hoveredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDismiss = useCallback(() => {
    if (toast.type === "loading") return;
    timerRef.current = setTimeout(() => {
      if (!hoveredRef.current) {
        removeToast(toast.id);
      }
    }, DISMISS_MS);
  }, [toast.id, toast.type, removeToast]);

  // Start dismiss timer on mount (or when type changes from loading)
  useEffect(() => {
    if (toast.type !== "loading") {
      scheduleDismiss();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.type, scheduleDismiss]);

  const handleMouseEnter = () => {
    hoveredRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    if (toast.type !== "loading") {
      scheduleDismiss();
    }
  };

  const bgColor = {
    success: "bg-[#0F1F18] border-ember-green/30 border-l-ember-green",
    error: "bg-[#1F0F12] border-ember-red/30 border-l-ember-red",
    info: "bg-[#1A1B20] border-ember-border border-l-ember-orange",
    loading: "bg-[#1A1B20] border-ember-border border-l-ember-orange",
  }[toast.type];

  const textColor = {
    success: "text-ember-green",
    error: "text-ember-red",
    info: "text-text-secondary",
    loading: "text-ember-orange",
  }[toast.type];

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={clsx(
        "flex items-start gap-3 border-l-[3px] border rounded px-4 py-3 font-mono toast-slide-in",
        "shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-sm",
        bgColor
      )}
    >
      <div className={clsx("mt-0.5", textColor)}>
        <ToastIcon type={toast.type} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={clsx("text-[13px] font-semibold leading-snug", textColor)}>
          {toast.title}
        </span>
        {toast.detail && (
          <p className="text-[11px] text-white/60 break-words mt-1 leading-relaxed">
            {toast.detail}
          </p>
        )}
        {toast.txid && (
          <a
            href={getTxUrl(toast.txid)}
            target="_blank"
            rel="noopener noreferrer"
            className={clsx(
              "mt-1.5 inline-flex items-center gap-1 text-[11px] transition-opacity hover:opacity-100",
              toast.type === "success" ? "text-ember-green/70" : "text-ember-red/70"
            )}
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 3H3v10h10v-3" />
              <path d="M9 2h5v5" />
              <path d="M14 2L7 9" />
            </svg>
            View on Explorer
          </a>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
        {toast.txid && (
          <a
            href={getTxUrl(toast.txid)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded p-1 text-white/50 transition-colors hover:text-white hover:bg-white/10"
            title="View on explorer"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 3H3v10h10v-3" />
              <path d="M9 2h5v5" />
              <path d="M14 2L7 9" />
            </svg>
          </a>
        )}
        <CopyButton toast={toast} />
        <ActionButton onClick={() => removeToast(toast.id)} title="Dismiss">
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </ActionButton>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-3 right-3 z-[200] flex flex-col-reverse gap-2 w-[440px]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
