import { useEffect, useState } from 'react';

// Roteamento mínimo por pathname (o portal tem 4 telas):
//   /                      seleção de sistema
//   /<sistema>/entrar      login
//   /<sistema>/apps        lista de apps
//   /link-expirado         destino de links de download vencidos

export type Route =
  | { name: 'systems' }
  | { name: 'login'; system: string }
  | { name: 'apps'; system: string }
  | { name: 'expired'; reason: string | null };

export function parse(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'link-expirado') return { name: 'expired', reason: new URLSearchParams(search).get('motivo') };
  if (parts.length === 2 && parts[1] === 'entrar') return { name: 'login', system: parts[0] };
  if (parts.length === 2 && parts[1] === 'apps') return { name: 'apps', system: parts[0] };
  return { name: 'systems' };
}

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname, location.search));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.pathname, location.search));
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return route;
}
