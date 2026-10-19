"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { urlMiniatura } from "@/lib/miniatura-url";

/**
 * Foto piccola delle tabelle: carica la miniatura (160 px, pochi KB) invece
 * dell'originale ad alta risoluzione. Se la miniatura non c'è ancora (foto
 * appena caricata, generazione non finita) ripiega sull'originale.
 *
 * L'errore della miniatura può arrivare prima che React sia attivo nella
 * pagina (la tabella arriva già disegnata dal server): allora onError non
 * scatta, e al montaggio si guarda se l'immagine è finita «rotta».
 */
export default function FotoMini({ src, style }: { src: string; style?: CSSProperties }) {
  const mini = urlMiniatura(src);
  const [attuale, setAttuale] = useState(mini);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { setAttuale(mini); }, [mini]);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && attuale !== src) setAttuale(src);
  }, [attuale, src]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} loading="lazy" decoding="async" src={attuale} alt="" style={style}
      onError={() => { if (attuale !== src) setAttuale(src); }} />
  );
}
