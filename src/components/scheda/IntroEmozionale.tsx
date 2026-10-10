"use client";

import { useEffect, useRef, useState } from "react";

/**
 * L'apertura a tutto schermo della scheda: una o più foto d'ambiente, o un
 * video, con l'occhiello e la frase scelti per il prodotto. Si vede una volta
 * per visita (chi torna indietro non la rivede); «Salta» e «Scopri» la chiudono.
 */
export default function IntroEmozionale({
  media, occhiello, frase, titolo, insegna,
}: {
  media: { url: string; tipo: "foto" | "video" }[];
  occhiello: string;
  frase: string;
  titolo: string;
  insegna: string;
}) {
  const [stato, setStato] = useState<"pronta" | "aperta" | "chiusa">("pronta");
  const [i, setI] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DURATA = 3500;

  useEffect(() => {
    let vista = false;
    try { vista = sessionStorage.getItem(`intro-${location.pathname}`) === "1"; } catch { /* niente */ }
    setStato(vista ? "chiusa" : "aperta");
  }, []);

  const chiudi = () => {
    if (timer.current) clearTimeout(timer.current);
    setStato("chiusa");
    try { sessionStorage.setItem(`intro-${location.pathname}`, "1"); } catch { /* niente */ }
  };

  useEffect(() => {
    if (stato !== "aperta" || media[i]?.tipo === "video") return;
    timer.current = setTimeout(() => { if (i + 1 >= media.length) chiudi(); else setI(i + 1); }, DURATA);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stato, i]);

  useEffect(() => {
    if (stato === "aperta") document.body.style.overflow = "hidden"; else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [stato]);

  if (stato !== "aperta" || media.length === 0) return null;
  const m = media[i];
  return (
    <div className="sp-intro" role="dialog" aria-label="Presentazione del prodotto">
      {m.tipo === "video"
        ? <video key={m.url} className="sp-intro-media" src={m.url} autoPlay muted playsInline onEnded={() => (i + 1 >= media.length ? chiudi() : setI(i + 1))} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img key={m.url} className="sp-intro-media sp-kb" src={m.url} alt="" />}
      <div className="sp-intro-velo" />
      <span className="sp-intro-insegna">{insegna.toUpperCase()}</span>
      <button type="button" className="sp-intro-salta" onClick={chiudi}>Salta</button>
      <div className="sp-intro-testo">
        {occhiello && <span className="sp-intro-occhiello">{occhiello.toUpperCase()}</span>}
        <h1>{titolo}</h1>
        {frase && <p>{frase}</p>}
        <button type="button" className="sp-intro-btn" onClick={chiudi}>
          Scopri il prodotto
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14m0 0-6-6m6 6 6-6" /></svg>
        </button>
        {media.length > 1 && (
          <div className="sp-intro-barre">
            {media.map((x, k) => <span key={x.url} className={k < i ? "fatta" : k === i ? "on" : ""}><i style={k === i && x.tipo !== "video" ? { animationDuration: `${DURATA}ms` } : undefined} /></span>)}
          </div>
        )}
      </div>
    </div>
  );
}
