import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { api, apiUrl, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    'Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured in backend/.env yet.',
  GOOGLE_OAUTH_NOT_CONFIGURED:
    'Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured in backend/.env yet.',
  INVALID_OAUTH_STATE: 'Google OAuth session expired or invalid state. Please try signing in again.',
  access_denied: 'Google sign-in was cancelled.',
  missing_oauth_params: 'Missing Google OAuth callback parameters.',
  oauth_callback_failed: 'Google OAuth login failed. Check backend configuration and redirect URI.',
};

export function LoginPage() {
  const { user, setUser, authConfig, refreshSlackStatus } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const oauthErrorParam = searchParams.get('error');

  useEffect(() => {
    if (user) {
      const next = searchParams.get('redirect') || '/';
      navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    }
  }, [user, navigate, searchParams]);

  useEffect(() => {
    if (oauthErrorParam) {
      setErrorMsg(
        OAUTH_ERROR_MESSAGES[oauthErrorParam] || `Google sign-in error: ${oauthErrorParam}`
      );
    }
  }, [oauthErrorParam]);

  const handleGoogleLogin = () => {
    const redirect = searchParams.get('redirect') || '/';
    const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';
    window.location.href = apiUrl(`/api/auth/google?redirect=${encodeURIComponent(safeRedirect)}`);
  };

  const handleGuestLogin = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await api.loginAsGuest();
      setUser(res.user);
      await refreshSlackStatus();
      showToast('Entered as Guest with an isolated Ethereal workspace!', 'success');
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Guest login failed';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const res =
        mode === 'login'
          ? await api.loginWithEmail({ email, password })
          : await api.registerWithEmail({ name, email, password });

      setUser(res.user);
      await refreshSlackStatus();
      showToast(mode === 'login' ? 'Welcome back!' : 'Account created successfully!', 'success');
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Authentication failed';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-[400px] rounded-2xl border border-[#EAECEF] bg-white px-8 py-10 shadow-[0_2px_16px_rgba(17,24,39,0.03)]">
        <h1 className="text-[26px] font-bold text-[#111827] text-center mb-7">
          {mode === 'login' ? 'Login' : 'Sign Up'}
        </h1>

        {errorMsg && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Google OAuth CTA matching Figma Login Screen */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="w-full h-[44px] rounded-lg bg-[#E6F6EB] hover:bg-[#d8f1e0] transition-colors flex items-center justify-center gap-2.5 text-[14px] font-medium text-[#111827] cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          Login with Google
        </button>

        {/* Divider */}
        <div className="relative my-6 flex items-center justify-center">
          <div className="w-full border-t border-[#ECEEF2]" />
          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === 'login' ? 'register' : 'login'));
              setErrorMsg(null);
            }}
            className="absolute bg-white px-3 text-[12px] text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer"
          >
            {mode === 'login' ? 'or sign up through email' : 'or login with existing email'}
          </button>
        </div>

        {/* Email / Password Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          {mode === 'register' && (
            <input
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full Name"
              className="w-full h-[44px] rounded-lg bg-[#F3F4F6] px-4 text-[13.5px] text-[#111827] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#08A842]/30"
            />
          )}

          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email ID"
            className="w-full h-[44px] rounded-lg bg-[#F3F4F6] px-4 text-[13.5px] text-[#111827] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#08A842]/30"
          />

          <input
            type="password"
            required
            minLength={mode === 'register' ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full h-[44px] rounded-lg bg-[#F3F4F6] px-4 text-[13.5px] text-[#111827] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#08A842]/30"
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-[44px] mt-1 rounded-lg bg-[#08A842] hover:bg-[#069439] text-white text-[14px] font-semibold transition-colors disabled:opacity-60 cursor-pointer"
          >
            {submitting ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </form>

        {authConfig.guestLoginEnabled !== false && (
          <div className="mt-4 pt-4 border-t border-[#ECEEF2] text-center">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleGuestLogin()}
              className="w-full h-[40px] rounded-lg border border-[#08A842]/40 bg-white hover:bg-[#E8F5EC]/60 text-[#08A842] text-[13.5px] font-semibold transition-colors disabled:opacity-60 cursor-pointer"
            >
              Continue as Guest
            </button>
            <p className="text-[11px] text-[#9CA3AF] mt-2">
              Instant isolated demo workspace without Google OAuth
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
