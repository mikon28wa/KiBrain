import { useState } from 'react';
import { authApi } from './api';
import type { AuthApi } from './types';
import { ForgotPasswordView, HomeView, LoginView, RegisterView, ResetPasswordView } from './views';
import './App.css';

type Route = 'login' | 'register' | 'forgot' | 'reset' | 'home';

function App({ api = authApi }: { api?: AuthApi }) {
  const [route, setRoute] = useState<Route>('login');

  return (
    <div className="app">
      {route === 'login' && (
        <LoginView
          api={api}
          onLoggedIn={() => setRoute('home')}
          onRegister={() => setRoute('register')}
          onForgot={() => setRoute('forgot')}
        />
      )}
      {route === 'register' && (
        <RegisterView api={api} onRegistered={() => setRoute('login')} onLogin={() => setRoute('login')} />
      )}
      {route === 'forgot' && (
        <ForgotPasswordView api={api} onLogin={() => setRoute('login')} onReset={() => setRoute('reset')} />
      )}
      {route === 'reset' && <ResetPasswordView api={api} onLogin={() => setRoute('login')} />}
      {route === 'home' && <HomeView onLogout={() => setRoute('login')} />}
    </div>
  );
}

export default App;

