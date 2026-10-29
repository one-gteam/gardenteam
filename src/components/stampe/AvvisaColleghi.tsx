"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { avvisaColleghi } from "@/lib/zoo-actions";

/**
 * Avvisa i colleghi che c'è qualcosa da guardare — le offerte da scegliere o la
 * bozza del volantino — con una data entro cui rispondere. I destinatari sono
 * già spuntati (chi ha accesso all'area Zoo) e se ne possono aggiungere altri a
 * mano, perché non tutti quelli da coinvolgere hanno per forza un account.
 */
export default function AvvisaColleghi({
  tipo, scopeParam, colleghi, squadre = [], spuntatiDiSerie = true, etichetta, sempreAperto = false,
}: {
  tipo: "offerte" | "bozza";
  scopeParam: string;
  colleghi: { email: string; nome: string; ambito: string }[];
  /** Squadre (gruppi «Squadra …»): un clic spunta tutti i loro membri. */
  squadre?: { nome: string; email: string[] }[];
  /** Tutti già spuntati (di serie) o nessuno, da scegliere a mano. */
  spuntatiDiSerie?: boolean;
  /** Testo del pulsante, se diverso da quello di serie. */
  etichetta?: string;
  /** Il modulo è già dentro un altro elenco (il menu Strumenti): niente pulsante né pannello sopra. */
  sempreAperto?: boolean;
}) {
  const [apertoQui, setAperto] = useState(false);
  const aperto = sempreAperto || apertoQui;
  const contenitore = useRef<HTMLSpanElement>(null);

  // il pannello sopra la pagina si chiude con un clic fuori o con Esc
  useEffect(() => {
    if (!apertoQui || sempreAperto) return;
    const fuori = (e: MouseEvent) => { if (!contenitore.current?.contains(e.target as Node)) setAperto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAperto(false); };
    document.addEventListener("mousedown", fuori);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuori); document.removeEventListener("keydown", esc); };
  }, [apertoQui, sempreAperto]);
  const [esito, setEsito] = useState("");
  const [errore, setErrore] = useState("");
  const [pending, startTransition] = useTransition();

  const invia = (formData: FormData) =>
    startTransition(async () => {
      setEsito("");
      setErrore("");
      const res = await avvisaColleghi(tipo, scopeParam, formData);
      if (res.ok) {
        setEsito(`Avviso inviato a ${res.inviate} ${res.inviate === 1 ? "collega" : "colleghi"}.`);
        setAperto(false);
      } else {
        setErrore(res.error ?? "Invio non riuscito");
      }
    });

  const testo = tipo === "offerte"
    ? { titolo: "Avvisa i colleghi che le offerte sono caricate", bottone: etichetta ?? "✉ Avvisa i colleghi" }
    : { titolo: "Avvisa i colleghi che la bozza è pronta", bottone: etichetta ?? "✉ Avvisa i colleghi" };
  /* spunta (o toglie, se erano già tutte spuntate) le caselle di queste email */
  const spunta = (bottone: HTMLElement, email: string[] | "tutti" | "nessuno") => {
    const caselle = Array.from(bottone.closest("form")?.querySelectorAll<HTMLInputElement>('input[name="destinatari"]') ?? []);
    if (email === "tutti" || email === "nessuno") { for (const c of caselle) c.checked = email === "tutti"; return; }
    const sue = caselle.filter((c) => email.includes(c.value.toLowerCase()));
    const tutteGia = sue.length > 0 && sue.every((c) => c.checked);
    for (const c of sue) c.checked = !tutteGia;
  };

  // fra una settimana: una scadenza proposta è meglio di un campo vuoto che resta vuoto
  const traUnaSettimana = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return (
    <span className="avvisa-colleghi" ref={contenitore}>
      {!sempreAperto && (
        <button type="button" className={`btn btn-sm ${aperto ? "" : "btn-outline"}`} onClick={() => setAperto(!aperto)} aria-expanded={aperto}>
          {testo.bottone}
        </button>
      )}
      {esito && <span className="pill pill-green">✓ {esito}</span>}
      {aperto && (
    <div className={sempreAperto ? "avvisa-pannello" : "card avvisa-pannello"} style={{ padding: sempreAperto ? 0 : 14 }}>
      {!sempreAperto && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <strong>{testo.titolo}</strong>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => setAperto(false)}>✕ Chiudi</button>
        </div>
      )}
      {errore && <div className="alert alert-amber">{errore}</div>}
      <form action={invia}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            Rispondere entro il
            <input type="date" name="entro" defaultValue={traUnaSettimana} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            Altri indirizzi (separati da virgola)
            <input type="text" name="altri" placeholder="mario@insegna.it, lucia@insegna.it" />
          </label>
          <label className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
            Nota per i colleghi (facoltativa)
            <input type="text" name="nota" placeholder="es. Guardate soprattutto la parte gatto" />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 12.5 }}>Chi avvisare</strong>
          <span className="hint" style={{ marginLeft: 8 }}>{spuntatiDiSerie ? "già spuntati: chi ha accesso alle Offerte Zoo" : "scegli le squadre o le persone"}</span>
          <div className="chips" style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {squadre.filter((q) => q.email.length).map((q) => (
              <button key={q.nome} type="button" className="chip" title={`Spunta (o togli) i ${q.email.length} della ${q.nome}`}
                onClick={(e) => spunta(e.currentTarget, q.email.map((x) => x.toLowerCase()))}>
                {q.nome} <span className="pill pill-gray" style={{ marginLeft: 4 }}>{q.email.length}</span>
              </button>
            ))}
            <button type="button" className="chip chip-azione" onClick={(e) => spunta(e.currentTarget, "tutti")}>✓ tutti</button>
            <button type="button" className="chip chip-azione" onClick={(e) => spunta(e.currentTarget, "nessuno")}>✕ nessuno</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 4, marginTop: 6, maxHeight: 190, overflowY: "auto" }}>
            {colleghi.length === 0 && <span className="hint">Nessun collega con accesso all&apos;area.</span>}
            {colleghi.map((c) => (
              <label key={c.email} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" name="destinatari" value={c.email} defaultChecked={spuntatiDiSerie} />
                <span>{c.nome} <span style={{ color: "var(--muted)" }}>· {c.ambito}</span></span>
              </label>
            ))}
          </div>
        </div>
        <button className="btn btn-sm" type="submit" disabled={pending} style={{ marginTop: 10 }}>
          {pending ? "Invio…" : "Invia avviso"}
        </button>
      </form>
    </div>
      )}
    </span>
  );
}
