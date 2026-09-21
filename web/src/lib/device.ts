const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;

export const isAndroid = /android/i.test(ua);
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
/** Celular/tablet: baixa direto. Computador: mostra QR Code para ler com o celular. */
export const isMobile = isAndroid || isIOS || /Mobile/i.test(ua);

export function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
