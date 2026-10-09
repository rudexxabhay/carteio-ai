import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiGet, apiPost } from '../../services/api/client';

export interface AuthUser { id: string; name: string | null; email: string; emailVerified: boolean; status: string; }
export type GoogleAuthState = 'IDLE' | 'GOOGLE_AUTHENTICATING' | 'SESSION_VERIFYING' | 'DASHBOARD_NAVIGATING' | 'READY' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
type AuthValue = { user: AuthUser | null; loading: boolean; error: string | null; googleAuthState: GoogleAuthState; setGoogleAuthState: (state: GoogleAuthState) => void; login: (email: string, password: string) => Promise<void>; googleLogin: (credential: string) => Promise<void>; requestOtp: (email: string) => Promise<{ deliveryAccepted: boolean; challengeId?: string; retryAfterSeconds?: number }>; verifyOtp: (email: string, challengeId: string, code: string, flow?: 'login' | 'signup', name?: string) => Promise<'authenticated' | 'account_exists'>; signup: (name: string, email: string, password: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void>; };
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [googleAuthState, setGoogleAuthState] = useState<GoogleAuthState>('IDLE');
  const bootstrapRequest = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => { setLoading(true); try { const result = await apiGet<{ user: AuthUser }>('/auth/me'); setUser(result.user); setError(null); } catch (err) { setUser(null); setError(err instanceof ApiError && err.status === 401 ? null : 'We could not check your account session.'); } finally { setLoading(false); } }, []);
  useEffect(() => { if (!bootstrapRequest.current) bootstrapRequest.current = refresh(); }, [refresh]);
  const login = useCallback(async (email: string, password: string) => { setError(null); const result = await apiPost<{ user: AuthUser }>('/auth/login', { email, password }); setUser(result.user); }, []);
  const googleLogin = useCallback(async (credential: string) => { setError(null); setGoogleAuthState('GOOGLE_AUTHENTICATING'); try { const result = await apiPost<{ user: AuthUser }>('/auth/google', { credential }); setGoogleAuthState('SESSION_VERIFYING'); setUser(result.user); } catch (cause) { setGoogleAuthState(cause instanceof ApiError && cause.kind === 'timeout' ? 'TIMED_OUT' : 'FAILED'); throw cause; } }, []);
  const requestOtp = useCallback((email: string) => apiPost<{ deliveryAccepted: boolean; challengeId?: string; retryAfterSeconds?: number }>('/auth/otp/request', { email }), []);
  const verifyOtp = useCallback(async (email: string, challengeId: string, code: string, flow: 'login' | 'signup' = 'login', name?: string) => { setError(null); const result = await apiPost<{ user?: AuthUser; status?: string }>('/auth/otp/verify', { email, challengeId, code, flow, ...(name ? { name } : {}) }); if (result.status === 'account_exists') return 'account_exists'; if (!result.user) throw new Error('We could not confirm your sign-in. Please try again.'); setUser(result.user); return 'authenticated'; }, []);
  const signup = useCallback(async (name: string, email: string, password: string) => { setError(null); await apiPost('/auth/signup', { name, email, password }); }, []);
  const logout = useCallback(async () => { await apiPost('/auth/logout'); setUser(null); }, []);
  const value = useMemo(() => ({ user, loading, error, googleAuthState, setGoogleAuthState, login, googleLogin, requestOtp, verifyOtp, signup, logout, refresh }), [user, loading, error, googleAuthState, login, googleLogin, requestOtp, verifyOtp, signup, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used within AuthProvider'); return value; }
