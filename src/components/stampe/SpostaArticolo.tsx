"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PadreScelta { id: string; nome: string; animale: string; n: number }

/**
 * Il pulsante «Sposta» sulla riga di un articolo, nel dettaglio del padre: apre
 * un riquadro con una casella di ricerca e l'elenco dei padri diviso per
 * animale (prima quello del padre aperto). Il riquadro è in posizione fissa
 * perché la tabella che lo contiene scorre di lato e lo taglierebbe.
 */
export default function SpostaArticolo({
  parentId, animale, padri, disabled, onScegli,
}: {
  parentId: string;
  animale: string;
  padri: PadreScelta[];
  disabled?: boolean;
  /** "" = togli dal padre */
  onScegli: (newParentId: string) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [cerca, setCerca] = useState("");
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
    return () => {
      document.removeEventListener("mousedown", fuori);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", chiudi);
    };
  }, [aperto]);

  const apri = () => {
    const r = bottone.current?.getBoundingClientRect();
    if (r) {
      const largo = 340, alto = 380;
      setPos({
        left: Math.max(8, Math.min(r.right - largo, window.innerWidth - largo - 8)),
        top: r.bottom + alto + 8 > window.innerHeight ? Math.max(8, r.top - alto - 4) : r.bottom + 4,
      });
    }
    setCerca("");
    setAperto(true);
  };

  // padri per animale: quello del padre aperto in cima, "senza animale" in fondo
  const gruppi = useMemo(() => {
    const parole = cerca.toLowerCase().split(/\s+/).filter(Boolean);
    const trovati = padri.filter((p) => p.id !== parentId && parole.every((w) => p.nome.toLowerCase().includes(w)));
    const perAnimale = new Map<string, PadreScelta[]>();
    for (const p of trovati) {
      const k = p.animale || "Senza animale";
      if (!perAnimale.has(k)) perAnimale.set(k, []);
      perAnimale.get(k)!.push(p);
    }
    return [...perAnimale.entries()].sort(([a], [b]) =>
      (a === animale ? -1 : b === animale ? 1 : 0) || (a === "Senza animale" ? 1 : b === "Senza animale" ? -1 : 0) || a.localeCompare(b, "it"));
  }, [padri, parentId, animale, cerca]);
  const totale = gruppi.reduce((s, [, l]) => s + l.length, 0);
  const MASSIMO = 120; // righe per gruppo senza ricerca: con migliaia di padri la tendina diventerebbe lenta

  const scegli = (id: string) => { setAperto(false); onScegli(id); };

  return (
    <>
      <button ref={bottone} type="button" className="btn btn-outline btn-sm" disabled={disabled}
        style={{ padding: "2px 8px", fontSize: 11, whiteSpace: "nowrap" }}
        title="Sposta questo articolo in un altro prodotto padre" onClick={() => (aperto ? setAperto(false) : apri())}>
        ↪ Sposta
      </button>
      {aperto && (
        <div ref={riquadro} style={{
          position: "fixed", top: pos.top, left: pos.left, width: 340, maxHeight: 380, zIndex: 50,
          display: "flex", flexDirection: "column", background: "#fff", border: "1px solid var(--line)",
          borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.18)", fontSize: 12,
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>
            <input autoFocus type="search" value={cerca} onChange={(e) => setCerca(e.target.value)}
              placeholder="Cerca il padre: marca, linea, gusto…" style={{ width: "100%", marginTop: 0, fontSize: 12.5, padding: "6px 8px" }} />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <button type="button" onClick={() => scegli("")}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", borderBottom: "1px solid var(--line)", background: "#fff7f0", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
              ✕ Togli dal padre <span style={{ color: "var(--muted)" }}>(l&apos;articolo resta da solo)</span>
            </button>
            {totale === 0 && <div style={{ padding: 10, color: "var(--muted)" }}>Nessun padre con «{cerca}».</div>}
            {gruppi.map(([gruppo, lista]) => (
              <div key={gruppo}>
                <div style={{ position: "sticky", top: 0, background: "#eef3f9", padding: "4px 10px", fontWeight: 700, fontSize: 11, color: "#274b7a", textTransform: "uppercase", letterSpacing: ".04em" }}>
                  {gruppo} <span style={{ fontWeight: 400, color: "var(--muted)" }}>· {lista.length}</span>
                </div>
                {(cerca ? lista : lista.slice(0, MASSIMO)).map((p) => (
                  <button key={p.id} type="button" onClick={() => scegli(p.id)}
                    style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%", textAlign: "left", padding: "5px 10px", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--green-50, #eef7ee)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>
                    <span>{p.nome}</span>
                    <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{p.n} art.</span>
                  </button>
                ))}
                {!cerca && lista.length > MASSIMO && (
                  <div style={{ padding: "3px 10px 6px", color: "var(--muted)", fontSize: 11 }}>…altri {lista.length - MASSIMO}: scrivi nella ricerca</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
