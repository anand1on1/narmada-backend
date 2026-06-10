import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  hasError: boolean;
  message: string;
}

// Top-level + per-route crash recovery. A render error anywhere below this
// boundary shows a recoverable screen instead of a white page. The error is
// logged to the console (NOT swallowed) so it stays diagnosable in production.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || "Something went wrong" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ""}]`, error, info?.componentStack);
  }

  private goBack = () => {
    this.setState({ hasError: false, message: "" });
    if (window.history.length > 1) window.history.back();
    else window.location.hash = "#/";
  };

  private reload = () => {
    window.location.reload();
  };

  // Escape hatch when a crash leaves the user stuck on an authed page: clear all
  // portal/admin/team tokens and send them to the customer login. Operates on
  // localStorage + hash so it works even if the React tree below is broken.
  private logout = () => {
    ["narmada_customer_token", "narmada_customer_email",
     "narmada_admin_token", "narmada_team_token"].forEach((k) => {
      try { localStorage.removeItem(k); } catch {}
    });
    window.location.hash = "#/portal";
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="bg-card border rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="text-lg font-display font-bold mb-2">Something went wrong</div>
          <p className="text-sm text-muted-foreground mb-1">This page hit an unexpected error. Your data is safe.</p>
          {this.state.message && (
            <p className="text-xs text-muted-foreground/70 font-mono break-words mb-5">{this.state.message}</p>
          )}
          <div className="flex justify-center gap-2 flex-wrap">
            <button onClick={this.goBack} className="px-4 py-2 border rounded-lg text-sm hover:bg-muted">Go back</button>
            <button onClick={this.reload} className="px-5 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Reload</button>
            <button onClick={this.logout} className="px-4 py-2 border rounded-lg text-sm hover:bg-muted">Logout</button>
          </div>
        </div>
      </div>
    );
  }
}
