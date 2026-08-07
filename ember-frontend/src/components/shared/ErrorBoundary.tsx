"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  name: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
          <div className="text-center">
            <div className="font-mono text-[11px] font-medium text-text-primary">
              Something went wrong
            </div>
            <div className="mt-1 font-mono text-[10px] text-text-secondary/60">
              {this.props.name} failed to render
            </div>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="border border-ember-border bg-surface-l2 px-3 py-1.5 font-mono text-[10px] text-text-secondary hover:border-ember-orange/40 hover:text-ember-orange transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
