import { Shell } from '../components/Shell';
import { navigate } from '../lib/router';

export function ExpiredScreen({ reason }: { reason: string | null }) {
  const unavailable = reason === 'indisponivel';
  return (
    <Shell
      hero={
        <div className="reveal expired">
          <h1 className="outline-title outline-title--sm">{unavailable ? 'Retirada' : 'Expirado'}</h1>
          <p className="kicker kicker--light">{unavailable ? 'Versão retirada' : 'Link de download'}</p>
          <h2 className="hero__title">{unavailable ? 'Esta versão não está mais disponível.' : 'Este link de download venceu.'}</h2>
          <p className="lead">
            {unavailable
              ? 'A versão foi retirada do portal. Entre novamente para baixar a versão atual.'
              : 'Por segurança, os links valem só alguns minutos. Entre no portal e gere um novo.'}
          </p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
            Ir para o portal
          </button>
        </div>
      }
    />
  );
}
