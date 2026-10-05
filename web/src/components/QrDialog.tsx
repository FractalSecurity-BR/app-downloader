import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DownloadLink } from '../lib/api';

interface Props {
  title: string;
  version: string;
  /** Preenchido só para builds de teste (homologação/staging). */
  environmentName?: string;
  requestLink: () => Promise<DownloadLink>;
  onClose: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; link: DownloadLink; image: string }
  | { status: 'error'; message: string };

function remaining(expiresAt: string) {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function QrDialog({ title, version, environmentName, requestLink, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [seconds, setSeconds] = useState(0);

  const generate = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const link = await requestLink();
      const image = await QRCode.toDataURL(link.url, { margin: 1, width: 560, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      setState({ status: 'ready', link, image });
      setSeconds(remaining(link.expiresAt));
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [requestLink]);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    void generate();
  }, [generate]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const timer = setInterval(() => setSeconds(remaining(state.link.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [state]);

  const expired = state.status === 'ready' && seconds === 0;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <dialog ref={dialog} className="qr" onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
      <div className="qr__panel">
        <div className="qr__head">
          <div>
            <p className="kicker">Baixar no celular</p>
            <h2 className="qr__title">
              {title} <span className="qr__version">v{version}</span>
            </h2>
            {environmentName && <p className="qr__env">Build de teste · {environmentName}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={() => dialog.current?.close()} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className={`qr__code${expired ? ' is-expired' : ''}`}>
          {state.status === 'loading' && <span className="spinner" aria-label="Gerando QR Code" />}
          {state.status === 'error' && <p className="qr__error">{state.message}</p>}
          {state.status === 'ready' && <img src={state.image} alt={`QR Code para baixar ${title} ${version}`} />}
          {expired && (
            <button type="button" className="btn btn--primary qr__renew" onClick={generate}>
              Gerar novo QR Code
            </button>
          )}
        </div>

        <ol className="qr__howto">
          <li>Abra a câmera do celular Android e aponte para o código.</li>
          <li>Toque no link que aparecer para baixar o APK.</li>
          <li>Se o Android pedir, permita instalar apps desta fonte.</li>
        </ol>

        <div className="qr__foot">
          {state.status === 'ready' && !expired && (
            <span className="qr__timer">
              expira em <strong>{mm}:{ss}</strong>
            </span>
          )}
          {state.status === 'error' && (
            <button type="button" className="btn btn--outline" onClick={generate}>
              Tentar de novo
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
