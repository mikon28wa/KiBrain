import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { ForgotPasswordView, LoginView, RegisterView, ResetPasswordView } from './views';
import { AI_NOTICE } from './AiNotice';
import type { AuthApi } from './types';

function fakeApi() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const api: AuthApi = {
    register: async (email, password) => {
      calls.push({ method: 'register', args: [email, password] });
      return {};
    },
    login: async (email, password) => {
      calls.push({ method: 'login', args: [email, password] });
      return {};
    },
    requestPasswordReset: async (email) => {
      calls.push({ method: 'requestPasswordReset', args: [email] });
      return {};
    },
    resetPassword: async (token, password) => {
      calls.push({ method: 'resetPassword', args: [token, password] });
      return {};
    },
  };
  return { api, calls };
}

describe('AI notice', () => {
  it('is visible on the login view', () => {
    render(<App api={fakeApi().api} />);
    expect(screen.getByTestId('ai-notice')).toHaveTextContent(AI_NOTICE);
  });

  it('is visible on the registration view', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByTestId('ai-notice')).toHaveTextContent(AI_NOTICE);
  });
});

describe('auth flows', () => {
  it('registers through the UI', async () => {
    const user = userEvent.setup();
    const { api, calls } = fakeApi();
    render(<App api={api} />);

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(calls).toEqual([{ method: 'register', args: ['a@example.com', 'password123'] }]);
  });

  it('logs in through the UI', async () => {
    const user = userEvent.setup();
    const { api, calls } = fakeApi();
    render(<App api={api} />);

    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(calls).toEqual([{ method: 'login', args: ['a@example.com', 'password123'] }]);
  });

  it('requests a password reset through the UI', async () => {
    const user = userEvent.setup();
    const { api, calls } = fakeApi();
    render(<App api={api} />);

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(calls).toEqual([{ method: 'requestPasswordReset', args: ['a@example.com'] }]);
  });

  it('resets the password through the UI', async () => {
    const user = userEvent.setup();
    const { api, calls } = fakeApi();
    render(<App api={api} />);

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.click(screen.getByRole('button', { name: 'Have a reset token?' }));
    await user.type(screen.getByLabelText('Reset token'), 'token-123');
    await user.type(screen.getByLabelText('New password'), 'newpassword123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(calls).toEqual([{ method: 'resetPassword', args: ['token-123', 'newpassword123'] }]);
  });
});

describe('view states', () => {
  const noop = () => {};

  it('LoginView exposes empty, filled, loading and error states', () => {
    const api = fakeApi().api;
    const { rerender } = render(<LoginView api={api} onLoggedIn={noop} onRegister={noop} onForgot={noop} />);
    expect(screen.getByRole('form', { name: 'Log in' })).toHaveAttribute('data-state', 'empty');

    rerender(<LoginView api={api} onLoggedIn={noop} onRegister={noop} onForgot={noop} initialState="filled" />);
    expect(screen.getByRole('form', { name: 'Log in' })).toHaveAttribute('data-state', 'filled');

    rerender(<LoginView api={api} onLoggedIn={noop} onRegister={noop} onForgot={noop} initialState="loading" />);
    expect(screen.getByRole('form', { name: 'Log in' })).toHaveAttribute('data-state', 'loading');

    rerender(<LoginView api={api} onLoggedIn={noop} onRegister={noop} onForgot={noop} initialState="error" initialError="Invalid credentials" />);
    expect(screen.getByRole('form', { name: 'Log in' })).toHaveAttribute('data-state', 'error');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('RegisterView exposes all four states', () => {
    const api = fakeApi().api;
    const { rerender } = render(<RegisterView api={api} onRegistered={noop} onLogin={noop} />);
    expect(screen.getByRole('form', { name: 'Register' })).toHaveAttribute('data-state', 'empty');

    rerender(<RegisterView api={api} onRegistered={noop} onLogin={noop} initialState="filled" />);
    expect(screen.getByRole('form', { name: 'Register' })).toHaveAttribute('data-state', 'filled');

    rerender(<RegisterView api={api} onRegistered={noop} onLogin={noop} initialState="loading" />);
    expect(screen.getByRole('form', { name: 'Register' })).toHaveAttribute('data-state', 'loading');

    rerender(<RegisterView api={api} onRegistered={noop} onLogin={noop} initialState="error" initialError="Email already in use" />);
    expect(screen.getByRole('form', { name: 'Register' })).toHaveAttribute('data-state', 'error');
  });

  it('ForgotPasswordView exposes all four states', () => {
    const api = fakeApi().api;
    const { rerender } = render(<ForgotPasswordView api={api} onLogin={noop} onReset={noop} />);
    expect(screen.getByRole('form', { name: 'Forgot password' })).toHaveAttribute('data-state', 'empty');

    rerender(<ForgotPasswordView api={api} onLogin={noop} onReset={noop} initialState="filled" />);
    expect(screen.getByRole('form', { name: 'Forgot password' })).toHaveAttribute('data-state', 'filled');

    rerender(<ForgotPasswordView api={api} onLogin={noop} onReset={noop} initialState="loading" />);
    expect(screen.getByRole('form', { name: 'Forgot password' })).toHaveAttribute('data-state', 'loading');

    rerender(<ForgotPasswordView api={api} onLogin={noop} onReset={noop} initialState="error" initialError="Request failed" />);
    expect(screen.getByRole('form', { name: 'Forgot password' })).toHaveAttribute('data-state', 'error');
  });

  it('ResetPasswordView exposes all four states', () => {
    const api = fakeApi().api;
    const { rerender } = render(<ResetPasswordView api={api} onLogin={noop} />);
    expect(screen.getByRole('form', { name: 'Reset password' })).toHaveAttribute('data-state', 'empty');

    rerender(<ResetPasswordView api={api} onLogin={noop} initialState="filled" />);
    expect(screen.getByRole('form', { name: 'Reset password' })).toHaveAttribute('data-state', 'filled');

    rerender(<ResetPasswordView api={api} onLogin={noop} initialState="loading" />);
    expect(screen.getByRole('form', { name: 'Reset password' })).toHaveAttribute('data-state', 'loading');

    rerender(<ResetPasswordView api={api} onLogin={noop} initialState="error" initialError="Invalid token" />);
    expect(screen.getByRole('form', { name: 'Reset password' })).toHaveAttribute('data-state', 'error');
  });

  it('typing transitions a view from empty to filled', async () => {
    const user = userEvent.setup();
    const api = fakeApi().api;
    render(<LoginView api={api} onLoggedIn={noop} onRegister={noop} onForgot={noop} />);

    expect(screen.getByRole('form', { name: 'Log in' })).toHaveAttribute('data-state', 'empty');
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    expect(screen.getByRole('form', { name: 'Log in' })).toHaveAttribute('data-state', 'filled');
  });
});

