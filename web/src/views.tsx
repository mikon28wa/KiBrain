import { useState, type FormEvent } from 'react';
import { AiNotice } from './AiNotice';
import { ApiError } from './api';
import type { AuthApi, ViewState } from './types';

interface FieldProps {
  label: string;
  type: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

function Field({ label, type, value, placeholder, onChange }: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

interface BaseProps {
  api: AuthApi;
  /** Override the visual state (for tests/demo). */
  initialState?: ViewState;
  initialError?: string;
}

function stateOf(inputsFilled: boolean, status: 'idle' | 'loading' | 'error'): ViewState {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  return inputsFilled ? 'filled' : 'empty';
}

interface LoginViewProps extends BaseProps {
  onLoggedIn: () => void;
  onRegister: () => void;
  onForgot: () => void;
}

export function LoginView({ api, onLoggedIn, onRegister, onForgot, initialState, initialError }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  const viewState = initialState ?? stateOf(Boolean(email || password), status);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    try {
      await api.login(email, password);
      onLoggedIn();
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <form className="auth-view" data-state={viewState} onSubmit={submit} aria-label="Log in">
      <h1>Log in</h1>
      <AiNotice />
      <Field label="Email" type="email" value={email} placeholder="you@example.com" onChange={setEmail} />
      <Field label="Password" type="password" value={password} placeholder="••••••••" onChange={setPassword} />
      {viewState === 'error' && (
        <p className="error" role="alert">
          {initialError ?? error}
        </p>
      )}
      <button type="submit" disabled={viewState === 'loading'}>
        {viewState === 'loading' ? 'Loading…' : 'Log in'}
      </button>
      <div className="row">
        <button type="button" onClick={onRegister}>
          Create account
        </button>
        <button type="button" onClick={onForgot}>
          Forgot password?
        </button>
      </div>
    </form>
  );
}

interface ForgotPasswordViewProps extends BaseProps {
  onLogin: () => void;
  onReset: () => void;
}

export function ForgotPasswordView({ api, onLogin, onReset, initialState, initialError }: ForgotPasswordViewProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const viewState = initialState ?? stateOf(Boolean(email), status);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    try {
      await api.requestPasswordReset(email);
      setSent(true);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <form className="auth-view" data-state={viewState} onSubmit={submit} aria-label="Forgot password">
      <h1>Reset password</h1>
      <Field label="Email" type="email" value={email} placeholder="you@example.com" onChange={setEmail} />
      {viewState === 'error' && (
        <p className="error" role="alert">
          {initialError ?? error}
        </p>
      )}
      {sent && <p className="success">If an account exists, a reset link was sent.</p>}
      <button type="submit" disabled={viewState === 'loading'}>
        {viewState === 'loading' ? 'Loading…' : 'Send reset link'}
      </button>
      <div className="row">
        <button type="button" onClick={onLogin}>
          Back to login
        </button>
        <button type="button" onClick={onReset}>
          Have a reset token?
        </button>
      </div>
    </form>
  );
}

interface ResetPasswordViewProps extends BaseProps {
  onLogin: () => void;
}

export function ResetPasswordView({ api, onLogin, initialState, initialError }: ResetPasswordViewProps) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const viewState = initialState ?? stateOf(Boolean(token || password), status);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <form className="auth-view" data-state={viewState} onSubmit={submit} aria-label="Reset password">
      <h1>Set new password</h1>
      <Field label="Reset token" type="text" value={token} placeholder="Paste the token from the email" onChange={setToken} />
      <Field label="New password" type="password" value={password} placeholder="Min. 8 characters" onChange={setPassword} />
      {viewState === 'error' && (
        <p className="error" role="alert">
          {initialError ?? error}
        </p>
      )}
      {done && <p className="success">Password updated. You can now log in.</p>}
      <button type="submit" disabled={viewState === 'loading'}>
        {viewState === 'loading' ? 'Loading…' : 'Set new password'}
      </button>
      <div className="row">
        <button type="button" onClick={onLogin}>
          Back to login
        </button>
      </div>
    </form>
  );
}

export function HomeView({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="auth-view" data-state="filled">
      <h1>Welcome</h1>
      <p>You are logged in to Brain.</p>
      <button type="button" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}


interface RegisterViewProps extends BaseProps {
  onRegistered: () => void;
  onLogin: () => void;
}

export function RegisterView({ api, onRegistered, onLogin, initialState, initialError }: RegisterViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  const viewState = initialState ?? stateOf(Boolean(email || password), status);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    try {
      await api.register(email, password);
      onRegistered();
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <form className="auth-view" data-state={viewState} onSubmit={submit} aria-label="Register">
      <h1>Create account</h1>
      <AiNotice />
      <Field label="Email" type="email" value={email} placeholder="you@example.com" onChange={setEmail} />
      <Field label="Password" type="password" value={password} placeholder="Min. 8 characters" onChange={setPassword} />
      {viewState === 'error' && (
        <p className="error" role="alert">
          {initialError ?? error}
        </p>
      )}
      <button type="submit" disabled={viewState === 'loading'}>
        {viewState === 'loading' ? 'Loading…' : 'Register'}
      </button>
      <div className="row">
        <button type="button" onClick={onLogin}>
          Back to login
        </button>
      </div>
    </form>
  );
}
