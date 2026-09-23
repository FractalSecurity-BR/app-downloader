import { useCallback, useEffect, useMemo, useState } from 'react';

import { Hex, initials } from '../components/Hex';
import { QrDialog } from '../components/QrDialog';
import { Shell, Steps } from '../components/Shell';
import { api, ApiError, AppChannel, AppVersion, LoginResult, PortalApp } from '../lib/api';
import { formatDate, formatSize, isIOS, isMobile } from '../lib/device';
import { navigate } from '../lib/router';
import { clearSession, loadSession } from '../lib/session';

interface QrTarget {
  app: PortalApp;
  channel: AppChannel;
  version: AppVersion;
}

export function AppsScreen({ systemId }: { systemId: string }) {
  const [session] = useState<LoginResult | null>(() => loadSession(systemId));
  const [apps, setApps] = useState<PortalApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [qr, setQr] = useState<QrTarget | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        navigate(`/${systemId}/entrar?expirou=1`, true);
        return;
      }
      setError((err as Error).message);
    },
    [systemId],
  );

  useEffect(() => {
    if (!session) {
      navigate(`/${systemId}/entrar`, true);
      return;
    }
    api.apps(session.token).then(setApps, handleError);
  }, [session, systemId, handleError]);

  const requestLink = useMemo(() => {
    if (!qr || !session) return null;
    return () =>
      api.downloadLink(session.token, qr.app.id, qr.version.version).catch((err) => {
        handleError(err);
        throw err;
      });
  }, [qr, session, handleError]);

  if (!session) return null;
  const showEnvironments = session.user.canSeeTestBuilds;

  async function download(app: PortalApp, version: AppVersion) {
    const key = `${app.id}@${version.version}`;
    setBusy(key);
    setError(null);
    try {
      const link = await api.downloadLink(session!.token, app.id, version.version);
      window.location.assign(link.url);
    } catch (err) {
      handleError(err);
    } finally {
      setTimeout(() => setBusy((b) => (b === key ? null : b)), 1500);
    }
  }

  function logout() {
    clearSession();
    navigate('/');
  }

  // Uma ação por dispositivo: no celular baixa direto; no computador só o QR Code,
  // para ninguém baixar um APK que não consegue passar para o celular.
  const action = (app: PortalApp, channel: AppChannel, version: AppVersion, primary: boolean) => {
    const cls = primary ? 'btn btn--primary' : 'btn btn--outline btn--sm';
    if (isMobile) {
      const key = `${app.id}@${version.version}`;
      return (
        <button type="button" className={cls} onClick={() => download(app, version)} disabled={busy === key || isIOS}>
          {busy === key ? <span className="spinner" aria-label="Preparando download" /> : 'Baixar'}
        </button>
      );
    }
    return (
      <button type="button" className={cls} onClick={() => setQr({ app, channel, version })}>
        QR Code
      </button>
    );
  };

  return (
    <Shell
      hero={
        <div className="reveal">
          <Steps current={3} />
          <p className="kicker kicker--light">
            {session.system.name}
            {showEnvironments && <span className="badge">Master · builds de teste visíveis</span>}
          </p>
          <div className="hero__row">
            <h1 className="hero__title">Aplicativos</h1>
            <div className="hero__user">
              {/* perfil visível: a sessão guarda o perfil de quando o login foi feito */}
              <span>
                {session.user.username} · {session.user.profile}
              </span>
              <button type="button" className="btn btn--outline btn--sm" onClick={logout}>
                Sair
              </button>
            </div>
          </div>
        </div>
      }
    >
      {isIOS && (
        <div className="alert alert--info reveal" role="note">
          Os aplicativos são apenas para Android. Abra este portal em um celular Android para baixar.
        </div>
      )}

      {!isMobile && (
        <div className="alert alert--info reveal" role="note">
          Você está no computador: gere o QR Code e leia com a câmera do celular Android onde o app será instalado.
        </div>
      )}

      {error && (
        <div className="alert reveal" role="alert">
          {error}
        </div>
      )}

      {apps === null && !error && (
        <div className="apps">
          {[0, 1].map((i) => (
            <div key={i} className="app app--skeleton" aria-hidden="true" />
          ))}
        </div>
      )}

      {apps?.length === 0 && (
        <div className="empty reveal">
          <Hex label="0" muted />
          <p>Nenhum aplicativo liberado para o seu usuário.</p>
        </div>
      )}

      {apps && apps.length > 0 && (
        <>
          <p className="kicker">{apps.length === 1 ? '1 aplicativo disponível' : `${apps.length} aplicativos disponíveis`}</p>
          <ul className="apps">
            {apps.map((app, i) => (
              <li key={app.id} className="app reveal" style={{ animationDelay: `${80 + i * 70}ms` }}>
                <div className="app__head">
                  <Hex label={initials(app.name)} />
                  <div className="app__info">
                    <h2 className="app__name">{app.name}</h2>
                    {app.description && <p className="app__desc">{app.description}</p>}
                  </div>
                </div>

                {app.channels.map((channel) => {
                  const isTest = channel.environment.id !== 'prod';
                  return (
                    <section key={channel.environment.id} className={`channel${isTest ? ' channel--test' : ''}`}>
                      {showEnvironments && (
                        <p className="channel__tag">
                          {channel.environment.name}
                          {isTest && <span className="channel__hint">build de teste · uso interno</span>}
                        </p>
                      )}
                      <div className="channel__row">
                        <p className="app__meta">
                          <span className="app__version">v{channel.current.version}</span>
                          {channel.current.build !== null && <span>build {channel.current.build}</span>}
                          {channel.current.sizeBytes && <span>{formatSize(channel.current.sizeBytes)}</span>}
                          <span>{formatDate(channel.current.publishedAt)}</span>
                        </p>
                        <div className="app__cta">{action(app, channel, channel.current, true)}</div>
                      </div>

                      {channel.current.releaseNotes && <p className="app__notes">{channel.current.releaseNotes}</p>}

                      {channel.previous.length > 0 && (
                        <details className="history">
                          <summary>Versões anteriores ({channel.previous.length})</summary>
                          <ul>
                            {channel.previous.map((v) => (
                              <li key={v.version} className="history__row">
                                <span>
                                  <strong>v{v.version}</strong> <span className="muted">· {formatDate(v.publishedAt)}</span>
                                </span>
                                {action(app, channel, v, false)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </section>
                  );
                })}
              </li>
            ))}
          </ul>
        </>
      )}

      {qr && requestLink && (
        <QrDialog
          title={qr.app.name}
          version={qr.version.version}
          environmentName={qr.channel.environment.id === 'prod' ? undefined : qr.channel.environment.name}
          requestLink={requestLink}
          onClose={() => setQr(null)}
        />
      )}
    </Shell>
  );
}
