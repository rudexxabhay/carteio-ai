import { Outlet, Link } from 'react-router-dom';
import { BrandLogo } from '../../components/common/BrandLogo';
export function AuthLayout() { return <main className="auth-shell"><Link className="brand" to="/" aria-label="Carteio AI home"><BrandLogo /></Link><Outlet /></main>; }
