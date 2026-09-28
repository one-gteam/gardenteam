"use client";

import { useState, type CSSProperties } from "react";
import { urlMiniatura } from "@/lib/miniatura-url";

/**
 * Foto piccola delle tabelle: carica la miniatura (160 px, pochi KB) invece
 * dell'originale ad alta risoluzione. Se la miniatura non c'è ancora (foto
 * appena caricata, generazione non finita) ripiega sull'originale.
 */
export default function FotoMini({ src, style }: { src: string; style?: CSSProperties }) {
  const mini = urlMiniatura(src);
  const [attuale, setAttuale] = useState(mini);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img loading="lazy" decoding="async" src={attuale} alt="" style={style}
      onError={() => { if (attuale !== src) setAttuale(src); }} />
  );
}
