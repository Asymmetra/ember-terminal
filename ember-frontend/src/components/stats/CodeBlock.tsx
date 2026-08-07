"use client";

import { useState } from "react";
import clsx from "clsx";
import type { CodeSnippet } from "@/lib/observability/snippets";

interface Props {
  snippets: CodeSnippet[];
  /** Initial language tab to highlight. */
  defaultLanguage?: string;
  /** Persist tab choice across rows. */
  onLanguageChange?: (lang: string) => void;
}

/**
 * Multi-tab code-snippet block with copy-to-clipboard. Used in the
 * source-detail tray so a developer can grab the exact snippet they
 * need to consume a data source from their stack.
 */
export function CodeBlock({ snippets, defaultLanguage, onLanguageChange }: Props) {
  const initial = snippets.find((s) => s.language === defaultLanguage)?.language ?? snippets[0]?.language;
  const [activeLang, setActiveLang] = useState<string | undefined>(initial);
  const [copied, setCopied] = useState(false);

  const active = snippets.find((s) => s.language === activeLang) ?? snippets[0];
  if (!active) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="border border-ember-border bg-surface-l2/40">
      <div className="flex items-center border-b border-ember-border/50">
        {snippets.map((s) => (
          <button
            key={s.language}
            onClick={() => {
              setActiveLang(s.language);
              onLanguageChange?.(s.language);
            }}
            className={clsx(
              "px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors border-r border-ember-border/40",
              s.language === activeLang
                ? "bg-ember-orange/10 text-ember-orange"
                : "text-text-secondary/60 hover:text-text-primary",
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={handleCopy}
          className="ml-auto px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60 hover:text-ember-orange transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[10px] leading-relaxed text-text-primary/90 whitespace-pre">
{active.code}
      </pre>
    </div>
  );
}
