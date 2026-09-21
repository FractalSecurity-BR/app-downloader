import { useEffect, useState } from 'react';

import { Hex } from '../components/Hex';
import { Shell, Steps } from '../components/Shell';
import { api, PortalSystem } from '../lib/api';
import { navigate } from '../lib/router';

const CODES: Record<string, string> = {
  concursos: 'CO',
  'containers-exportacao': 'EX',
  'containers-importacao': 'IM',
  dta: 'DT',
};

export function SystemsScreen() {
  const [systems, setSystems] = useState<PortalSystem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.systems().then(setSystems, (err: Error) => setError(err.message));
  };
  useEffect(load, []);

  return (
    <Shell
      tone="dark"
      hero={
        <div className="reveal">
          <Steps current={1} />
          <h1 className="outline-title">Aplicativos</h1>
          <div className="hero__split">
            <p className="kicker">Portal de aplicativos</p>
            <p className="lead">
              Escolha o sistema e entre com o mesmo usuário e senha que você já usa nele. Você verá apenas os aplicativos
              liberados para o seu perfil.
            </p>
          </div>
        </div>
      }
    >
      {error && (
        <div className="alert alert--dark reveal" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--outline" onClick={load}>
            Tentar de novo
          </button>
        </div>
      )}

      <ul className="systems">
        {(systems ?? Array.from({ length: 4 }, () => null)).map((s, i) => (
          <li key={s?.id ?? i} className="reveal" style={{ animationDelay: `${100 + i * 70}ms` }}>
            {s === null ? (
              <div className="system system--skeleton" aria-hidden="true" />
            ) : (
              <button
                type="button"
                className="system"
                disabled={!s.available}
                onClick={() => navigate(`/${s.id}/entrar`)}
                aria-label={s.available ? `Acessar ${s.name}` : `${s.name} — em breve`}
              >
                <Hex label={CODES[s.id] ?? s.name.slice(0, 2).toUpperCase()} muted={!s.available} size={52} />
                <span className="system__name">{s.name}</span>
                <span className="system__desc">{s.description}</span>
                <span className="system__go">{s.available ? 'Acessar »' : 'Em breve'}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </Shell>
  );
}
