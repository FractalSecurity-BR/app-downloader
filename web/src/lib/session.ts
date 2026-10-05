import type { LoginResult } from './api';

// Sessão fica só na aba (sessionStorage): fechar o navegador encerra o acesso.
const KEY = 'portal-apps:session';

export function saveSession(session: LoginResult) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // modo privado sem storage: a sessão vale só enquanto a página estiver aberta
  }
}

export function loadSession(systemId: string): LoginResult | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as LoginResult;
    if (session.system.id !== systemId || new Date(session.expiresAt).getTime() <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignorado
  }
}
