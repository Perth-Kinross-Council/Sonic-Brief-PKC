import React from "react";
import { userMessage } from '@/lib/errors';

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

export class ErrorBoundary extends React.Component<{
  children: React.ReactNode;
}, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    // You can log error info here
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const safe = userMessage(this.state.error, 'An unexpected error occurred.');
      return (
        <div className="text-neutral-900 p-8 border border-red-200 bg-white max-w-xl my-10 mx-auto rounded-lg font-sans">
          <h2 className="mb-3 text-xl font-semibold">Application Error</h2>
          <p className="mb-4 leading-relaxed">{safe}</p>
          {import.meta.env.DEV && (
            <details className="whitespace-pre-wrap bg-gray-50 p-3 rounded-md text-xs">
              <summary className="cursor-pointer font-medium">Stack (dev only)</summary>
              {this.state.error?.stack || this.state.error?.toString()}
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

