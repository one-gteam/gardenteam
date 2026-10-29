"use client";

import { useEffect, useRef, useState } from "react";

/**
 * «N articoli» nella colonna Articoli: apre un riquadro sopra la tabella con
 * descrizione ed EAN su una riga ciascuno. Prima era un <details> dentro la
 * cella stretta: si allungava la riga e il testo andava a capo ogni parola.
 */
export default function ElencoArticoli({ articoli }: { articoli: { id: string; descrizione: string; ean: string }[] }) {
  const [aperto, setAperto] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const bottone = useRef<HTMLButtonElement>(null);
  const riquadro = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (!riquadro.current?.contains(e.target as Node) && !bottone.current?.contains(e.target as Node)) setAperto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAperto(false); };
    const chiudi = () => setAperto(false);
    document.addEventListener("mousedown", fuori);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", chiudi);
    window.addEventListener("scroll", chiudi, true);
    return () => {
      document.removeEventListener("mousedown", fuori);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", chiudi);
      window.removeEventListener("scroll", chiudi, true);
    };
  }, [aperto]);

  const apri = () => {
    const r = bottone.current?.getBoundingClientRect();
    if (r) {
      const largo = 440, alto = Math.min(320, 40 + articoli.length * 30);
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - largo - 8)),
        top: r.bottom + alto + 8 > window.innerHeight ? Math.max(8, r.top - alto - 4) : r.bottom + 4,
      });
    }
    setAperto(true);
  };

  return (
    <>
      <button ref={bottone} type="button" onClick={() => (aperto ? setAperto(false) : apri())}
        style={{ cursor: "pointer", color: "#274b7a", background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 12, whiteSpace: "nowrap" }}>
        {aperto ? "▾" : "▸"} {articoli.length} articoli
      </button>
      {aperto && (
        <div ref={riquadro} style={{
          position: "fixed", top: pos.top, left: pos.left, width: 440, maxHeight: 320, overflowY: "auto", zIndex: 50,
          background: "#fff", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.18)", fontSize: 12,
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#eef3f9", color: "#274b7a", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={{ textAlign: "left", padding: "5px 10px" }}>Articolo</th>
                <th style={{ textAlign: "left", padding: "5px 10px" }}>EAN</th>
              </tr>
            </thead>
            <tbody>
              {articoli.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 10px" }}>{a.descrizione}</td>
                  <td style={{ padding: "5px 10px", whiteSpace: "nowrap", color: "var(--muted)" }}>{a.ean}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
