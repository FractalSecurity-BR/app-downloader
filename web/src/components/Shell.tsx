import type { ReactNode } from 'react';

const SITE_URL = 'https://fractal-security.com/';

interface Props {
  /** Faixa escura do topo (título da página), no estilo das seções pretas do site. */
  hero: ReactNode;
  /** Tom da área de conteúdo: escura (cards sobre preto) ou clara (seção branca do site). */
  tone?: 'dark' | 'light';
  children?: ReactNode;
}

export function Shell({ hero, tone = 'light', children }: Props) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar__inner">
          <a href="/" className="topbar__brand" aria-label="Fractal — Portal de Aplicativos">
            <img src="/fractal.png" alt="Fractal intelligent security" />
          </a>
          <nav className="topbar__nav" aria-label="Navegação">
            <span className="topbar__restricted">
              <LockIcon />
              Área restrita
            </span>
            <a className="btn btn--dark topbar__site" href={SITE_URL}>
              Ir para o site
            </a>
          </nav>
        </div>
      </header>

      <section className="band band--dark hero">
        <div className="container">{hero}</div>
      </section>

      {children && (
        <main className={`band band--${tone}`}>
          <div className="container">{children}</div>
        </main>
      )}

      <footer className="footer">
        <div className="container footer__inner">
          <div className="footer__brand">
            <img src="/fractal.png" alt="Fractal intelligent security" />
            <p>Segurança avançada e rastreabilidade para cadeias de custódia eficientes.</p>
          </div>
          <div className="footer__col">
            <h2 className="footer__title">Portal de Aplicativos</h2>
            <p>Acesso restrito a usuários cadastrados nos sistemas da Fractal.</p>
          </div>
          <div className="footer__col">
            <h2 className="footer__title">Canais</h2>
            <p>
              <a href="mailto:contact@fractal-security.com">contact@fractal-security.com</a>
            </p>
          </div>
        </div>
        <div className="container footer__legal">© Fractal – Intelligent Security</div>
      </footer>
    </div>
  );
}

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const labels = ['Sistema', 'Acesso', 'Aplicativos'];
  return (
    <ol className="steps" aria-label="Etapas">
      {labels.map((label, i) => (
        <li key={label} className={i + 1 === current ? 'is-current' : i + 1 < current ? 'is-done' : ''} aria-current={i + 1 === current ? 'step' : undefined}>
          <span className="steps__n">{String(i + 1).padStart(2, '0')}</span>
          <span className="steps__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
      <path fill="currentColor" d="M10 6V4a4 4 0 1 0-8 0v2H1v8h10V6h-1ZM4 4a2 2 0 1 1 4 0v2H4V4Z" />
    </svg>
  );
}
