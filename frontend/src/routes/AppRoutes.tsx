import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../layouts/PublicLayout/PublicLayout';
import { AuthLayout } from '../layouts/AuthLayout/AuthLayout';
import { DashboardLayout } from '../layouts/DashboardLayout/DashboardLayout';
import { LandingPage } from '../pages/landing/LandingPage';
import { InfoPage } from '../pages/documentation/InfoPage';
import { AuthPage } from '../pages/auth/AuthPages';
import { RequireAuth } from './RequireAuth';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { WorkspaceEntry } from '../pages/workspaces/WorkspaceEntry';
import { WorkspaceSelectorPage } from '../pages/workspaces/WorkspaceSelectorPage';
import { OnboardingPage } from '../pages/workspaces/OnboardingPage';
import { WorkspaceSettingsPage } from '../pages/workspaces/WorkspaceSettingsPage';
import { WorkspaceTeamPage } from '../pages/workspaces/WorkspaceTeamPage';
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
    <Route element={<RequireAuth />}>
      <Route path="/onboarding" element={<OnboardingPage/>}/>
      <Route path="/workspaces" element={<WorkspaceSelectorPage/>}/>
      <Route path="/dashboard" element={<WorkspaceEntry/>}/>
      <Route path="/workspace/:slug" element={<DashboardLayout/>}>
        <Route index element={<DashboardPage/>}/>
        <Route path="team" element={<WorkspaceTeamPage/>}/>
        <Route path="settings" element={<WorkspaceSettingsPage/>}/>
        <Route path="*" element={<InfoPage title="Workspace page" description="This workspace page is not available." noIndex/>}/>
      </Route>
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
