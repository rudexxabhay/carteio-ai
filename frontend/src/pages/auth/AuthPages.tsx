import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react';
import { Meta } from '../../components/common/Meta';
import { BrandLogo } from '../../components/common/BrandLogo';
import { apiPost, ApiError } from '../../services/api/client';
import { useAuth } from '../../app/providers/AuthProvider';
import { safeInternalDestination } from '../../services/auth/safe-redirect';

type Mode = 'login' | 'signup' | 'forgot' | 'reset' | 'verify';
type GoogleIdentityApi = { initialize: (options: { client_id: string; callback: (response: { credential: string }) => void; auto_select?: boolean }) => void; prompt: (callback?: (notification: { isDismissedMoment: () => boolean; isSkippedMoment: () => boolean; isNotDisplayed: () => boolean }) => void) => void; renderButton: (element: HTMLElement, options: { theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'circle'; width: number }) => void };
declare global { interface Window { google?: { accounts?: { id?: GoogleIdentityApi } }; __carteioOneTapAttempted?: boolean } }
function errorText(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = { ACCOUNT_NOT_FOUND: 'Account does not exist. Please sign up first.', INVALID_CREDENTIALS: 'Email or password is incorrect.', EMAIL_NOT_VERIFIED: 'Verify your email before signing in.', EMAIL_SERVICE_UNAVAILABLE: 'Email delivery is temporarily unavailable. Please try again later.', OTP_COOLDOWN_ACTIVE: 'Please wait before requesting another code.', RATE_LIMITED: 'Too many attempts. Please wait a little before trying again.', OTP_EXPIRED: 'This code has expired. Request a new code.', OTP_INVALID: 'That code is not valid. Check it and try again.', OTP_ATTEMPTS_EXCEEDED: 'Too many incorrect codes. Request a new code to continue.', AUTH_SERVICE_UNAVAILABLE: 'Sign-in is temporarily unavailable. Please try again shortly.', CSRF_REJECTED: 'This request could not be verified. Refresh the page and try again.' };
    if (error.kind === 'timeout') return 'The request took too long. Check your connection and try again.';
    return error.code ? messages[error.code] ?? error.message : error.message;
  }
  return error instanceof Error ? error.message : 'We could not complete that request. Please try again.';
}
function otpErrorText(error: unknown) {
  if (error instanceof ApiError && error.status === 401 && error.code !== 'ACCOUNT_NOT_FOUND') return 'We could not complete sign-in for this email. Please contact support.';
  return errorText(error);
}
function loginErrorText(error: unknown) {
  if (error instanceof ApiError && error.status === 401 && !['ACCOUNT_NOT_FOUND', 'INVALID_CREDENTIALS', 'EMAIL_NOT_VERIFIED'].includes(error.code ?? '')) return 'We could not sign you in. Check your details or contact support.';
  return errorText(error);
}
function GoogleSignIn({ onCredential, onError, onDismiss, disabled }: { onCredential: (credential: string) => Promise<void>; onError: (message: string) => void; onDismiss: () => void; disabled: boolean }) {
  const button = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCredential, onError, onDismiss }); callbacks.current = { onCredential, onError, onDismiss };
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  const [loaded, setLoaded] = useState(!clientId);
  useEffect(() => {
    if (!clientId || !button.current) return;
    let active = true;
    const initialize = () => {
      const api = window.google?.accounts?.id;
      if (!active || !button.current) return;
      if (!api) { setLoaded(true); callbacks.current.onError('Google sign-in is unavailable. You can continue with email or password.'); return; }
      setLoaded(true);
      api.initialize({ client_id: clientId, callback: (response) => { if (response.credential) void callbacks.current.onCredential(response.credential).catch((error) => callbacks.current.onError(errorText(error))); }, auto_select: false });
      api.renderButton(button.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'circle', width: 44 });
      let attempted = Boolean(window.__carteioOneTapAttempted);
      try { attempted = attempted || window.sessionStorage.getItem('carteio_google_onetap_attempted') === '1'; } catch { /* Session storage may be unavailable. */ }
      if (!attempted) {
        window.__carteioOneTapAttempted = true;
        try { window.sessionStorage.setItem('carteio_google_onetap_attempted', '1'); } catch { /* Session storage may be unavailable. */ }
        api.prompt((notice) => {
        if (!active) return;
        if (notice.isDismissedMoment() || notice.isSkippedMoment()) {
          try { window.sessionStorage.setItem('carteio_google_onetap_attempted', '1'); } catch { /* Session storage may be unavailable. */ }
          callbacks.current.onDismiss();
        }
        });
      }
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-carteio-google-gsi]');
    if (window.google?.accounts?.id) initialize();
    else if (existing && (existing.dataset.loadFailed === 'true' || existing.dataset.loaded === 'true')) {
      setLoaded(true); callbacks.current.onError('Google sign-in is unavailable. You can continue with email or password.');
    } else if (existing) {
      existing.addEventListener('load', initialize, { once: true });
      existing.addEventListener('error', () => { if (active) { setLoaded(true); callbacks.current.onError('Google sign-in is unavailable. You can continue with email or password.'); } }, { once: true });
    } else {
      const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true; script.dataset.carteioGoogleGsi = 'true'; script.onload = () => { script.dataset.loaded = 'true'; initialize(); }; script.onerror = () => { script.dataset.loadFailed = 'true'; setLoaded(true); callbacks.current.onError('Google sign-in is unavailable. You can continue with email or password.'); }; document.head.appendChild(script);
    }
    return () => { active = false; };
  }, [clientId]);
  const googleMark = <svg className="auth-google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 17.9l6.8-5.2Z"/><path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6.1 29.5 4 24 4A20 20 0 0 0 5.8 15l6.8 5.3c1.6-4.8 6.1-8.2 11.4-8.2Z"/></svg>;
  if (!clientId) return <button aria-label="Continue with Google" title="Google sign-in is not configured" className="auth-social-button auth-social-disabled" type="button" disabled>{googleMark}</button>;
  return <><span className="google-loading" role="status" hidden={loaded}>Loading Google sign-in…</span><div className={`auth-social-button auth-social-google ${disabled ? 'is-disabled' : ''}`} aria-label="Continue with Google"><div ref={button} className="google-signin" role="group" aria-label="Continue with Google" /></div></>;
}
export function AuthPage({ mode }: { mode: Mode }) {
  const { user, loading, login, googleLogin, requestOtp, verifyOtp, signup, googleAuthState, setGoogleAuthState } = useAuth(); const location = useLocation(); const navigate = useNavigate();
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const [authMethod, setAuthMethod] = useState<'password' | 'otp'>('password'); const [challengeId, setChallengeId] = useState(''); const [otp, setOtp] = useState(''); const [resendSeconds, setResendSeconds] = useState(0);
  useEffect(() => { if (resendSeconds <= 0) return; const timer = window.setTimeout(() => setResendSeconds(seconds => seconds - 1), 1000); return () => window.clearTimeout(timer); }, [resendSeconds]);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const sessionNotice = mode === 'login' && Boolean((location.state as { sessionExpired?: boolean } | null)?.sessionExpired);
  useEffect(() => { if (mode === 'verify' && token) { setBusy(true); apiPost('/auth/verify-email', { token }).then(() => setMessage('Your email is verified. You can now sign in.')).catch((e) => setError(errorText(e))).finally(() => setBusy(false)); } }, [mode, token]);
  useEffect(() => { if ((mode === 'verify' || mode === 'reset') && token) window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}`); }, [mode, token, location.pathname, location.search]);
  if ((mode === 'login' || mode === 'signup') && loading) return <main className="auth-loading" role="status" aria-live="polite" aria-busy="true">Checking your Carteio AI session…</main>;
  if ((mode === 'login' || mode === 'signup') && user && !['GOOGLE_AUTHENTICATING', 'SESSION_VERIFYING', 'DASHBOARD_NAVIGATING'].includes(googleAuthState)) return <Navigate to={safeInternalDestination((location.state as { from?: unknown } | null)?.from)} replace/>;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return; setError(''); setMessage('');
    const fields: Record<string, string> = {};
    if (mode === 'signup' && !name.trim()) fields.name = 'Enter your full name.';
    if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fields.email = 'Enter a valid email address.';
    if (mode === 'login' && !password) fields.password = 'Enter your password.';
    if ((mode === 'signup' || mode === 'reset') && password.length < 12) fields.password = 'Use at least 12 characters.';
    if ((mode === 'signup' || mode === 'reset') && password !== confirm) fields.confirm = 'Passwords do not match.';
    setFieldErrors(fields);
    if (Object.keys(fields).length) return;
    inFlight.current = true; setBusy(true);
    try {
      if (mode === 'login') { await login(email.trim(), password); const from = (location.state as { from?: unknown } | null)?.from; navigate(safeInternalDestination(from), { replace: true }); }
      else if (mode === 'signup') { await signup(name.trim(), email.trim(), password); setMessage('If registration can be completed for this address, verification instructions have been sent. If you already have an account, log in to continue.'); }
      else if (mode === 'forgot') { const result = await apiPost<{ deliveryAvailable?: boolean }>('/auth/forgot-password', { email: email.trim() }); setMessage(result.deliveryAvailable === false ? 'Password recovery email is not configured yet. Contact support for help.' : 'If an account exists and delivery succeeds, you’ll receive a password reset link.'); }
      else if (mode === 'reset') { await apiPost('/auth/reset-password', { token, password }); setMessage('Your password has been changed. All previous sessions have been signed out.'); }
    } catch (e) { setError(mode === 'login' ? loginErrorText(e) : errorText(e)); } finally { setBusy(false); inFlight.current = false; }
  };
  const handleGoogle = async (credential: string) => { if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); setMessage(''); try { await googleLogin(credential); setGoogleAuthState('DASHBOARD_NAVIGATING'); navigate(safeInternalDestination((location.state as { from?: unknown } | null)?.from), { replace: true }); } catch (e) { setError(loginErrorText(e)); } finally { setBusy(false); inFlight.current = false; } };
  const requestCode = async () => {
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { setFieldErrors({ email: 'Enter a valid email address.' }); return; }
    if (mode === 'signup' && !name.trim()) { setFieldErrors({ name: 'Enter your full name to create an account.' }); return; }
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); setMessage(''); setFieldErrors({});
    try {
      const result = await requestOtp(normalized);
      if (result.deliveryAccepted && result.challengeId) { setChallengeId(result.challengeId); setResendSeconds(result.retryAfterSeconds ?? 60); setMessage('If this address can receive a sign-in code, it has been sent. Check your inbox.'); }
      else if (result.retryAfterSeconds) { setResendSeconds(result.retryAfterSeconds); setMessage(`Please wait ${result.retryAfterSeconds} seconds before requesting another code.`); }
      else setMessage('We could not confirm email delivery. Please try again shortly.');
    } catch (e) { setError(otpErrorText(e)); } finally { setBusy(false); inFlight.current = false; }
  };
  const submitOtp = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return;
    if (!/^\d{6}$/.test(otp)) { setFieldErrors({ otp: 'Enter the six-digit code from your email.' }); return; }
    inFlight.current = true; setBusy(true); setError(''); setFieldErrors({});
    try {
      const result = await verifyOtp(email.trim(), challengeId, otp, mode === 'signup' ? 'signup' : 'login', mode === 'signup' ? name.trim() : undefined);
      if (result === 'account_exists') { setError('An account already uses this email. Log in to continue.'); return; }
      navigate(safeInternalDestination((location.state as { from?: unknown } | null)?.from), { replace: true });
    }
    catch (e) { setError(otpErrorText(e)); } finally { setBusy(false); inFlight.current = false; }
  };
  const title = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Email verification';
  if ((mode === 'login' || mode === 'signup') && ['GOOGLE_AUTHENTICATING', 'SESSION_VERIFYING', 'DASHBOARD_NAVIGATING'].includes(googleAuthState)) return <main className="auth-progress" role="status" aria-live="polite"><span className="auth-progress-wordmark" aria-hidden="true">Carteio AI</span><span className="auth-progress-spinner" aria-hidden="true"/><h1>{googleAuthState === 'DASHBOARD_NAVIGATING' ? 'Opening your workspace…' : 'Signing you in…'}</h1><p>{googleAuthState === 'GOOGLE_AUTHENTICATING' ? 'Securely creating your session.' : googleAuthState === 'SESSION_VERIFYING' ? 'Your account is verified. Preparing your workspace.' : 'Loading your Carteio AI workspace.'}</p></main>;
  return <><Meta title={title} description="Secure access to your Carteio AI account." path={`/${mode === 'verify' ? 'verify-email' : mode === 'reset' ? 'reset-password' : mode === 'forgot' ? 'forgot-password' : mode}`} noIndex/><section className={`auth-card auth-card-polished ${mode === 'login' ? 'auth-login-card' : ''}`}>
    <Link className="brand auth-card-brand" to="/" aria-label="Carteio AI home"><BrandLogo/></Link>{mode !== 'login' && <Link className="back-link" to="/"><ArrowLeft size={15}/> Back to Carteio AI</Link>}<div className="simple-icon"><ShieldCheck size={22}/></div><span className="eyebrow">{mode === 'signup' ? 'YOUR CARTEIO AI ACCOUNT' : mode === 'login' ? 'SECURE ACCOUNT ACCESS' : 'ACCOUNT SECURITY'}</span><h1>{title}</h1>
    <p>{mode === 'login' ? 'Please enter your details to sign in.' : mode === 'signup' ? 'One account for your business AI workspace.' : mode === 'forgot' ? 'Enter your email address and we’ll guide you through recovery.' : mode === 'reset' ? 'Use a strong passphrase with at least 12 characters.' : 'We’ll confirm when your email address is ready.'}</p>
    {sessionNotice && <div role="status" className="auth-alert">Your session may have ended. Sign in to continue.</div>}
    {(mode === 'login' || mode === 'signup') && <div className="auth-methods">
      <div className="auth-social-row">
        <GoogleSignIn onCredential={handleGoogle} onError={setError} onDismiss={() => { if (!inFlight.current) { setGoogleAuthState('CANCELLED'); setMessage('Google sign-in was closed. Continue with email or password.'); } }} disabled={busy}/>
        <button className="auth-social-button auth-social-disabled" type="button" disabled aria-label="Apple sign-in unavailable" title="Apple sign-in is not available"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.7 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.6.9s-1.9-.9-3.1-.9c-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.3 2.9 2.2 1.1 0 1.6-.7 3.1-.7s2 .7 3.2.7c1.3 0 2-1.2 2.8-2.4a10 10 0 0 0 1.3-2.6c-.1 0-2.4-.9-2.4-3.8ZM14.3 6c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-1 2.6 1 .1 2-.5 2.7-1.2Z"/></svg></button>
        <button className="auth-social-button auth-social-disabled" type="button" disabled aria-label="X sign-in unavailable" title="X sign-in is not available"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.9 5.8 22H2.7l7.3-8.4L2.2 2h6.5l4.5 6.7L18.9 2Zm-1.1 18h1.7L7.7 3.9H5.9L17.8 20Z"/></svg></button>
      </div>
      <div className="auth-divider"><span>OR</span></div>
      <div className="auth-method-switch"><button type="button" aria-label={mode === 'signup' ? 'Create account with Email OTP' : 'Continue with Email OTP'} className={authMethod === 'otp' ? 'is-selected' : ''} onClick={() => { setAuthMethod('otp'); setError(''); setMessage(''); }}>Email OTP</button><button type="button" aria-label={mode === 'signup' ? 'Create account with password' : 'Sign in with Password'} className={authMethod === 'password' ? 'is-selected' : ''} onClick={() => { setAuthMethod('password'); setError(''); setMessage(''); }}>Email + Password</button></div>
    </div>}
    {(mode === 'login' || mode === 'signup') && authMethod === 'otp' && <form className="auth-form" onSubmit={submitOtp} noValidate>
      {mode === 'signup' && <label>Full name<input aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'otp-name-error' : undefined} autoComplete="name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} />{fieldErrors.name && <small id="otp-name-error" className="field-error">{fieldErrors.name}</small>}</label>}
      <label>Email address<span className="auth-input-wrap"><Mail size={16}/><input aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'otp-email-error' : undefined} type="email" autoComplete="email" required maxLength={320} value={email} onChange={e => { setEmail(e.target.value); setChallengeId(''); setOtp(''); }} /></span>{fieldErrors.email && <small id="otp-email-error" className="field-error">{fieldErrors.email}</small>}</label>
      {!challengeId ? <button className="button button-primary auth-button" type="button" aria-busy={busy} disabled={busy} onClick={() => void requestCode()}>{busy ? <><span className="auth-button-spinner" aria-hidden="true"/>Sending code…</> : mode === 'signup' ? 'Send signup code' : 'Send email code'}</button> : <>
        {mode === 'signup' && <p className="otp-email-note">Create an account for <strong>{email.trim()}</strong></p>}
        <label className="otp-label">Six-digit verification code<div className={`otp-code-entry ${fieldErrors.otp || (error && /code/i.test(error)) ? 'has-error' : ''}`}><input className="otp-code-input" autoFocus inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" aria-label="Six-digit code" aria-invalid={Boolean(fieldErrors.otp || (error && /code/i.test(error)))} aria-describedby={fieldErrors.otp ? 'otp-code-error' : 'otp-code-help'} maxLength={6} value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} onKeyDown={e => { if (e.key === 'Backspace' && !otp) e.preventDefault(); }} onPaste={e => { const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (pasted) { e.preventDefault(); setOtp(pasted); } }} /><span className="otp-slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i className={index === otp.length ? 'is-current' : ''} key={index}>{otp[index] ?? ''}</i>)}</span></div>{fieldErrors.otp && <small id="otp-code-error" className="field-error">{fieldErrors.otp}</small>}<small id="otp-code-help">Enter the code we sent to your email address.</small></label>
        {message && <div role="status" className="auth-alert">{message}</div>}{error && <div role="alert" className="auth-alert auth-alert-error">{error}</div>}
        <button className="button button-primary auth-button" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
        <div className="otp-actions"><button type="button" className="auth-inline-link" onClick={() => { setChallengeId(''); setOtp(''); setMessage(''); setError(''); }}>Edit email</button><button type="button" className="auth-inline-link" onClick={() => void requestCode()} disabled={busy || resendSeconds > 0}>{resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend code'}</button></div>
        {error.includes('An account already uses') && <Link className="auth-inline-link otp-login-link" to="/login">Go to log in</Link>}
      </>}
      {error && !challengeId && <div role="alert" className="auth-alert auth-alert-error">{error}</div>}{message && !challengeId && <div role="status" className="auth-alert">{message}</div>}
    </form>}
    {(mode === 'login' || mode === 'signup' || mode === 'forgot' || mode === 'reset') && ((mode !== 'login' && mode !== 'signup') || authMethod === 'password') && <form className={`auth-form ${mode === 'login' ? 'auth-login-form' : ''}`} onSubmit={submit} noValidate>
      {mode === 'signup' && <label>Full name<input aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name?'name-error':undefined} autoComplete="name" required maxLength={200} value={name} onChange={e=>setName(e.target.value)} />{fieldErrors.name&&<small id="name-error" className="field-error">{fieldErrors.name}</small>}</label>}
      {mode !== 'reset' && <label>Email address<span className="auth-input-wrap"><Mail size={16}/><input placeholder="Enter your email" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email?'email-error':undefined} type="email" autoComplete="email" required maxLength={320} value={email} onChange={e=>{setEmail(e.target.value);setError('');}} /></span>{fieldErrors.email&&<small id="email-error" className="field-error">{fieldErrors.email}</small>}</label>}
      {(mode === 'login' || mode === 'signup' || mode === 'reset') && <label>Password<span className="auth-input-wrap"><input placeholder={mode === 'login' ? 'Enter your password' : undefined} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password?'password-error':undefined} type={show ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} value={password} onChange={e=>{setPassword(e.target.value);setError('');}} /><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={()=>setShow(x=>!x)}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span>{mode !== 'login' && <small>At least 12 characters. Passphrases work well.</small>}{fieldErrors.password&&<small id="password-error" className="field-error">{fieldErrors.password}</small>}</label>}
      {(mode === 'signup' || mode === 'reset') && <label>Confirm password<input aria-invalid={Boolean(fieldErrors.confirm)} aria-describedby={fieldErrors.confirm?'confirm-error':undefined} type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)} />{fieldErrors.confirm&&<small id="confirm-error" className="field-error">{fieldErrors.confirm}</small>}</label>}
      {mode === 'login' && <div className="auth-login-options"><label className="auth-remember"><input type="checkbox" defaultChecked disabled aria-describedby="remember-device-note"/><span>Remember me</span></label><Link className="auth-inline-link" to="/forgot-password">Forgot password?</Link><span id="remember-device-note" className="sr-only">Your secure sign-in session is remembered on this device.</span></div>}
      {error && <div role="alert" className="auth-alert auth-alert-error">{error}</div>}{message && <div role="status" className="auth-alert">{message}</div>}
      <button className="button button-primary auth-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Request reset link' : 'Save new password'}</button>
    </form>}
    {mode === 'verify' && <div className="auth-form">{busy && <div role="status">Checking your verification link…</div>}{error && <div role="alert" className="auth-alert auth-alert-error">{error}</div>}{message && <div role="status" className="auth-alert">{message}</div>}{!token && <><p>Open the verification link sent to your email. If it expired, request a new link.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await apiPost('/auth/resend-verification',{email:email.trim()});setMessage('If the account needs verification, a new email will be sent when delivery is available.');}catch(x){setError(errorText(x));}finally{setBusy(false);}}}><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="button button-primary auth-button" disabled={busy}>Resend verification</button></form></>}</div>}
    <div className="auth-switch">{mode === 'login' ? <>New to Carteio AI? <Link to="/signup">Create an account</Link></> : mode === 'signup' ? <>Already have an account? <Link to="/login">Log in</Link></> : <Link to="/login">Return to log in</Link>}</div>
  </section></>;
}
