"use client";

import React from "react";

/**
 * Section-level error boundary for /lookup. Catches render errors in
 * a localized region (e.g. a single subaccount detail) so a bad row
 * doesn't blank the whole page. Renders a compact "section failed"
 * message with the error text + a hint to refresh.
 *
 * Used pervasively on /lookup since the data comes from Phoenix's
 * SDK in shapes that vary by wallet and account state.
 */
interface Props {
  /** Short label for the section (e.g. "Subaccount detail"). */
  label: string;
  children: React.ReactNode;
}

interface State {
  err: Error | null;
}

export class LookupErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    // Log to the console for debugging — Vercel logs don't catch
    // client-side errors so this is our forensic trail.
    // eslint-disable-next-line no-console
    console.error(`[LookupErrorBoundary] ${this.props.label} failed:`, err, info);
  }

  reset = () => { this.setState({ err: null }); };

  render() {
    if (this.state.err) {
      return (
        <div className="border border-ember-red/40 bg-ember-red/10 px-3 py-2 font-mono text-[10px] text-ember-red">
          <div className="font-medium uppercase tracking-wider">{this.props.label} failed to render</div>
          <div className="mt-1 break-all text-text-secondary/80">{this.state.err.message}</div>
          <button
            onClick={this.reset}
            className="mt-2 border border-ember-red/40 px-2 py-0.5 uppercase tracking-wider text-ember-red hover:bg-ember-red/10 transition-colors"
          >
            Retry render
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
