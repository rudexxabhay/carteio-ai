import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { SiteHeader } from '../../components/common/SiteHeader';
import { SiteFooter } from '../../components/common/SiteFooter';
import { RouteLoading } from '../../components/common/RouteLoading';
export function PublicLayout() {
  const isLanding = useLocation().pathname === '/';
  return <div className="public-layout">{!isLanding && <SiteHeader />}<main><Suspense fallback={<RouteLoading/>}><Outlet /></Suspense></main>{!isLanding && <SiteFooter />}</div>;
}
