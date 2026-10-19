/*
 * Prima di «fotografare» una parte di pagina con html2canvas: le immagini
 * che vengono da un altro indirizzo (le foto nel bucket Supabase) il browser
 * le ha già caricate senza il permesso CORS, e html2canvas le scarta — il PDF
 * usciva senza foto e senza testata, sembrava un layout diverso. Qui ogni
 * immagine si riscarica col permesso e si mette nella pagina come dati
 * (data:), così il disegno le vede tutte.
 */
const giaFatte = new Map<string, Promise<string | null>>();

function comeDati(url: string): Promise<string | null> {
  let p = giaFatte.get(url);
  if (!p) {
    p = fetch(url, { mode: "cors", cache: "no-store" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && new Promise<string | null>((ok) => {
        const fr = new FileReader();
        fr.onload = () => ok(typeof fr.result === "string" ? fr.result : null);
        fr.onerror = () => ok(null);
        fr.readAsDataURL(b);
      }))
      .catch(() => null);
    giaFatte.set(url, p);
  }
  return p;
}

export async function immaginiInLinea(radice: HTMLElement | null): Promise<void> {
  if (!radice) return;
  const imgs = Array.from(radice.querySelectorAll("img"));
  await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) return;
    const dati = await comeDati(src);
    if (!dati) return;
    img.removeAttribute("srcset");
    img.src = dati;
    try { await img.decode(); } catch { /* resta com'è */ }
  }));
}
