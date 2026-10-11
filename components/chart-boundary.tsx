"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey?: string; label?: string };
type State = { failed: boolean; resetKey?: string; attempt: number };

/** A plot failure must not take down account controls or the surrounding chat. */
export class ChartBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey, attempt: 0 } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    void fetch("/api/error-logs", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ entries: [{
        level: "error", source: "frontend", message: "Chart render failed: " + error.message,
        stack: error.stack, context: { chart: this.props.label || "chart", componentStack: info.componentStack },
      }] }),
    }).catch(() => {});
  }
  render() {
    if (this.state.failed) return <div role="alert" className="flex h-full min-h-32 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
      <p>This chart could not be displayed.</p>
      <button type="button" className="min-h-10 rounded-md border border-border px-4 text-foreground hover:bg-muted" onClick={() => this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))}>Retry chart</button>
    </div>;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
