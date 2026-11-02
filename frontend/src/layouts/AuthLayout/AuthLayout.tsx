import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { RouteLoading } from '../../components/common/RouteLoading';
import './auth-layout-polish.css';
export function AuthLayout() { return <main className="auth-shell auth-shell-polished"><Suspense fallback={<RouteLoading/>}><Outlet /></Suspense></main>; }
