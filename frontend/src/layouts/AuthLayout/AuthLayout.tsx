import { Suspense } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { RouteLoading } from '../../components/common/RouteLoading';
import './auth-layout-polish.css';
export function AuthLayout() { return <main className="auth-shell auth-shell-polished"><Link className="brand auth-wordmark" to="/" aria-label="Carteio AI home">Carteio AI</Link><Suspense fallback={<RouteLoading/>}><Outlet /></Suspense></main>; }
