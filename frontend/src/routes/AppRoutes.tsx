import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../layouts/PublicLayout/PublicLayout';
import { AuthLayout } from '../layouts/AuthLayout/AuthLayout';
import { DashboardLayout } from '../layouts/DashboardLayout/DashboardLayout';
import { LandingPage } from '../pages/landing/LandingPage';
import { InfoPage } from '../pages/documentation/InfoPage';
import { AuthPage } from '../pages/auth/AuthPages';
import { RequireAuth } from './RequireAuth';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { NotFoundPage } from '../pages/errors/NotFoundPage';

export function AppRoutes() {
  return <Routes>
    <Route element={<PublicLayout />}>
      <Route path="/" element={<LandingPage />} />
      <Route path="/features" element={<InfoPage title="Features" description="A thoughtful foundation for business AI: clear answers, useful tools, and owner-controlled boundaries." />} />
      <Route path="/integrations" element={<InfoPage title="Integrations" description="Plan how Carteio AI can connect with your website and business systems. Integrations are not available yet." />} />
      <Route path="/how-it-works" element={<InfoPage title="How it works" description="Bring your business knowledge, choose what an assistant may do, then give customers a helpful place to ask." />} />
      <Route path="/docs" element={<InfoPage title="Documentation" description="Implementation guides and product documentation are being prepared for the first release." />} />
      <Route path="/help" element={<InfoPage title="Help center" description="Find guidance for getting started with Carteio AI. Support resources are coming soon." />} />
    </Route>
    <Route element={<AuthLayout />}><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/signup" element={<AuthPage mode="signup" />} /><Route path="/forgot-password" element={<AuthPage mode="forgot" />} /><Route path="/reset-password" element={<AuthPage mode="reset" />} /><Route path="/verify-email" element={<AuthPage mode="verify" />} /></Route>
    <Route element={<RequireAuth />}><Route path="/dashboard" element={<DashboardLayout />}><Route index element={<DashboardPage />} /><Route path="*" element={<InfoPage title="Dashboard" description="Your Carteio AI workspace." path="/dashboard" noIndex />} /></Route></Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
