import { Component, type ErrorInfo, type ReactNode } from 'react';
type State = { failed: boolean };
export class AppErrorBoundary extends Component<{children: ReactNode}, State> {
  override state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error('Application render error', { message: error.message, componentStack: info.componentStack }); }
  override render() { if (this.state.failed) return <main className="error-boundary"><p className="eyebrow">Something went wrong</p><h1>We couldn’t load this page.</h1><button className="button button-primary" onClick={() => window.location.reload()}>Reload page</button></main>; return this.props.children; }
}
