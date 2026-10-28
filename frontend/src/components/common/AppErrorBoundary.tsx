import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FullPageError, SectionError } from './ErrorStates';
type Props = { children: ReactNode; mode?: 'page' | 'section' };
type State = { failed: boolean };
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    const name = /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(error.name) ? error.name : 'Error';
    if (import.meta.env.DEV) {
      const message = typeof error.message === 'string' ? error.message.slice(0, 500) : 'Unspecified render error';
      console.error('Application render error', { errorName: name, message, componentStack: info.componentStack });
    }
  }
  override render() {
    if (this.state.failed) return this.props.mode === 'section'
      ? <SectionError title="This dashboard section couldn’t load" message="A rendering error interrupted this page. Try again, or choose another dashboard section." action={{ label: 'Try again', onClick: () => this.setState({ failed: false }) }}/>
      : <FullPageError onReload={() => window.location.reload()}/>;
    return this.props.children;
  }
}
