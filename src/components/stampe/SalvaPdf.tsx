"use client";

import { useEffect } from "react";

/**
 * Salva in PDF: il browser propone come nome del file il titolo della pagina.
 * Qui si mette il nome scelto e, appena le immagini sono caricate, si apre la
 * finestra di stampa: lì basta scegliere «Salva come PDF».
 */
export default function SalvaPdf({ nome, soloStampa = false }: { nome: string; soloStampa?: boolean }) {
  useEffect(() => {
    const prima = document.title;
    document.title = nome;
    let fatto = false;
    const apri = () => { if (!fatto) { fatto = true; window.print(); } };
    const pronte = () => Array.from(document.images).every((i) => i.complete);
    const t0 = Date.now();
    const giro = window.setInterval(() => { if (pronte() || Date.now() - t0 > 6000) { window.clearInterval(giro); apri(); } }, 200);
    return () => { window.clearInterval(giro); document.title = prima; };
  }, [nome]);
  return (
    <span className="pill pill-green" style={{ fontSize: 12.5 }}>
      {soloStampa ? <>{nome}: si apre da sola la finestra di stampa</> : <>PDF «{nome}»: nella finestra di stampa scegli <strong>Salva come PDF</strong></>}
    </span>
  );
}
