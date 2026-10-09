import { Outlet } from 'react-router-dom';
import { SiteHeader } from '../../components/common/SiteHeader';
import { SiteFooter } from '../../components/common/SiteFooter';
export function PublicLayout() { return <><SiteHeader /><main><Outlet /></main><SiteFooter /></>; }
