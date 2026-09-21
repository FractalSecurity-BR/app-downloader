// Hexágono do logo Fractal (contorno verde, como nas imagens do site), usado como ícone de sistemas e apps.
export function Hex({ label, muted = false, size = 56 }: { label: string; muted?: boolean; size?: number }) {
  return (
    <span className={`hex${muted ? ' hex--muted' : ''}`} style={{ width: size, height: size, ['--hex-size' as string]: `${size}px` }} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <polygon className="hex__outer" points="50,4 90,27 90,73 50,96 10,73 10,27" />
      </svg>
      <span className="hex__label">{label}</span>
    </span>
  );
}

export function initials(name: string): string {
  const words = name
    .replace(/^i-?monitor\s*/i, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return 'iM';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
