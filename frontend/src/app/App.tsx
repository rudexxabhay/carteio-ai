import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '../routes/AppRoutes';
import { AppErrorBoundary } from '../components/common/AppErrorBoundary';
import { ThemeProvider } from './providers/ThemeProvider';
import { AuthProvider } from './providers/AuthProvider';

export function App() {
  return <ThemeProvider><AuthProvider><AppErrorBoundary><BrowserRouter><AppRoutes /></BrowserRouter></AppErrorBoundary></AuthProvider></ThemeProvider>;
}
