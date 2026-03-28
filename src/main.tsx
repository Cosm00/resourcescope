import React, { Component, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// ─── Error Boundary ────────────────────────────────────────────────────────────
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ResourceScope] Uncaught render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "#0d0f14",
            color: "#e8ecf3",
            fontFamily: "system-ui, sans-serif",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "32px" }}>⚠️</div>
          <div style={{ fontSize: "16px", fontWeight: 600 }}>ResourceScope encountered an error</div>
          <div
            style={{
              fontSize: "12px",
              color: "#8892a4",
              maxWidth: "500px",
              textAlign: "center",
              fontFamily: "monospace",
              background: "#181c27",
              padding: "12px",
              borderRadius: "8px",
            }}
          >
            {this.state.error?.message ?? "Unknown error"}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
