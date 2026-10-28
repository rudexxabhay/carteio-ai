import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../layouts/PublicLayout/PublicLayout';
import { AuthLayout } from '../layouts/AuthLayout/AuthLayout';
import { DashboardLayout, WorkspaceLoading } from '../layouts/DashboardLayout/DashboardLayout';
import { RequireAuth } from './RequireAuth';
import { RouteLoading } from '../components/common/RouteLoading';

const LandingPage = lazy(() => import('../pages/landing/LandingPage').then(module => ({ default: module.LandingPage })));
const InfoPage = lazy(() => import('../pages/documentation/InfoPage').then(module => ({ default: module.InfoPage })));
const AuthPage = lazy(() => import('../pages/auth/AuthPages').then(module => ({ default: module.AuthPage })));
const WorkspaceEntry = lazy(() => import('../pages/workspaces/WorkspaceEntry').then(module => ({ default: module.WorkspaceEntry })));
const WorkspaceSelectorPage = lazy(() => import('../pages/workspaces/WorkspaceSelectorPage').then(module => ({ default: module.WorkspaceSelectorPage })));
const OnboardingPage = lazy(() => import('../pages/workspaces/OnboardingPage').then(module => ({ default: module.OnboardingPage })));
const NotFoundPage = lazy(() => import('../pages/errors/NotFoundPage').then(module => ({ default: module.NotFoundPage })));
const PlatformAdminPage = lazy(() => import('../pages/saas/SaasPages').then(module => ({ default: module.PlatformAdminPage })));

export function AppRoutes() {
  return <Suspense fallback={<RouteLoading/>}><Routes>
    <Route element={<PublicLayout/>}>
      <Route path="/" element={<LandingPage/>}/>
      <Route path="/features" element={<Navigate to="/#features" replace/>}/>
      <Route path="/integrations" element={<Navigate to="/#integrations" replace/>}/>
      <Route path="/how-it-works" element={<Navigate to="/#how-it-works" replace/>}/>
      <Route path="/docs" element={<InfoPage title="Documentation" description="Implementation guides and product documentation are being prepared for the first release."/>}/>
      <Route path="/help" element={<InfoPage title="Help center" description="Find guidance for getting started with Carteio AI. Support resources are coming soon."/>}/>
    </Route>
    <Route element={<AuthLayout/>}>
      <Route path="/login" element={<AuthPage mode="login"/>}/>
      <Route path="/signup" element={<AuthPage mode="signup"/>}/>
      <Route path="/forgot-password" element={<AuthPage mode="forgot"/>}/>
      <Route path="/reset-password" element={<AuthPage mode="reset"/>}/>
      <Route path="/verify-email" element={<AuthPage mode="verify"/>}/>
    </Route>
    <Route element={<RequireAuth/>}>
      <Route path="/platform-admin" element={<PlatformAdminPage/>}/>
      <Route path="/onboarding" element={<OnboardingPage/>}/>
      <Route path="/workspaces" element={<Suspense fallback={<WorkspaceLoading/>}><WorkspaceSelectorPage/></Suspense>}/>
      <Route path="/dashboard" element={<Suspense fallback={<WorkspaceLoading/>}><WorkspaceEntry/></Suspense>}/>
      <Route path="/workspace/:slug/*" element={<DashboardLayout/>}/>
    </Route>
    <Route path="*" element={<NotFoundPage/>}/>
  </Routes></Suspense>;
}
