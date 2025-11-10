import type { ReactNode } from "react";
import React from "react";

export class UserManagementErrorBoundary extends React.Component<{ children: ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    // Log error to monitoring service if needed
    console.error("UserManagementErrorBoundary:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return <div className="text-red-600 p-4">An error occurred: {String(this.state.error)}</div>;
    }
    return this.props.children;
  }
}
