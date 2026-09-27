import { tracciatoQr } from "@/lib/qr";

/** QR code vettoriale, con la zona di rispetto intorno che la lettura richiede. */
export default function QrSvg({ testo, colore = "#111", style }: { testo: string; colore?: string; style?: React.CSSProperties }) {
  const { n, d } = tracciatoQr(testo);
  const q = 2; // moduli di bordo bianco
  return (
    <svg viewBox={`${-q} ${-q} ${n + 2 * q} ${n + 2 * q}`} shapeRendering="crispEdges" style={{ display: "block", ...style }}>
      <rect x={-q} y={-q} width={n + 2 * q} height={n + 2 * q} fill="#fff" />
      <path d={d} fill={colore} />
    </svg>
  );
}
