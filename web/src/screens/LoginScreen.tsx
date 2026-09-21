import { FormEvent, useEffect, useState } from 'react';

import { Shell, Steps } from '../components/Shell';
import { api, ApiError, PortalSystem } from '../lib/api';
import { navigate } from '../lib/router';
import { loadSession, saveSession } from '../lib/session';

export function LoginScreen({ systemId }: { systemId: string }) {
  const [system, setSystem] = useState<PortalSystem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).has('expirou') ? 'Sua sessão expirou. Entre novamente.' : null,
  );

  useEffect(() => {
    if (loadSession(systemId)) {
      navigate(`/${systemId}/apps`, true);
      return;
    }
    api.systems().then(
      (systems) => {
        const found = systems.find((s) => s.id === systemId && s.available);
        if (!found) return setNotFound(true);
        setSystem(found);
      },
      (err: Error) => setError(err.message),
    );
  }, [systemId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!system || loading) return;
    setLoading(true);
    setError(null);
    try {
      saveSession(await api.login(system.id, username, password));
      navigate(`/${system.id}/apps`, true);
    } catch (err) {
      const apiError = err as ApiError;
      setError(
        apiError.code === 'SET_NEW_PASSWORD'
          ? 'Sua senha precisa ser trocada. Acesse o sistema, defina a nova senha e volte aqui.'
          : apiError.message,
      );
      setPassword('');
      setLoading(false);
    }
  }

  if (notFound) {
    return (
      <Shell
        hero={
          <div className="reveal">
            <Steps current={2} />
            <p className="kicker kicker--light">Sistema indisponível</p>
            <h1 className="hero__title">Não encontramos esse sistema</h1>
            <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
              Ver sistemas
            </button>
          </div>
        }
      />
    );
  }

  return (
    <Shell
      hero={
        <div className="reveal">
          <Steps current={2} />
          <button type="button" className="back" onClick={() => navigate('/')}>
            « Trocar sistema
          </button>
          <p className="kicker kicker--light">Acessar</p>
          <h1 className="hero__title">{system?.name ?? 'Carregando…'}</h1>
        </div>
      }
    >
      <div className="split reveal" style={{ animationDelay: '80ms' }}>
        <div className="split__text">
          <p className="kicker">Login do sistema</p>
          <h2 className="section-title">Use o mesmo usuário e senha do sistema.</h2>
          <p className="body-text">
            O acesso é validado direto no {system?.name ?? 'sistema'}. Quem não tem cadastro não consegue baixar os
            aplicativos. Sem acesso? Peça ao administrador do sistema para cadastrar seu usuário.
          </p>
        </div>

        <form className="form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="field__label">Usuário ou e-mail</span>
            <input
              className="input"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Senha</span>
            <span className="input-wrap">
              <input
                className="input"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="input-wrap__toggle" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </span>
          </label>

          {error && (
            <p className="form__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={!system || loading || !username.trim() || !password}>
            {loading ? <span className="spinner" aria-label="Entrando" /> : 'Entrar'}
          </button>
        </form>
      </div>
    </Shell>
  );
}
