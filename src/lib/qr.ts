import QRCode from "qrcode";

/*
 * Il QR code si disegna come un tracciato SVG: un quadratino per modulo.
 * Niente immagini raster, così esce nitido in stampa a qualsiasi dimensione
 * e la stessa funzione gira sia sul server (cartello stampato) sia nel
 * browser (anteprima dell'editor).
 */
export function tracciatoQr(testo: string): { n: number; d: string } {
  const qr = QRCode.create(testo || " ", { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const dati = qr.modules.data;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (dati[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { n, d };
}
