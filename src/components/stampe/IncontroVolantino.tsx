"use client";

import { useEffect, useRef, useState } from "react";
import { avviaIncontro, battitoIncontro, terminaIncontro, partecipantiIncontro, iniziaDaOra, type StatoIncontro } from "@/lib/zoo-incontri";

/**
 * Il cronometro dell'incontro, in testa a Crea Volantino: «Avvia» / «Termina»
 * a mano, e da solo: al primo gesto sulla pagina parte (se non c'è già un
 * incontro aperto), dopo i minuti di inattività si chiude all'ultimo gesto.
 * Chi c'è si spunta dall'elenco dei colleghi.
 */
export default function IncontroVolantino({
  campaignId, iniziale, colleghi,
}: {
  campaignId: string;
  iniziale: StatoIncontro;
  colleghi: { id: string; nome: string }[];
}) {
  const [st, setSt] = useState<StatoIncontro>(iniziale);
  const [ora, setOra] = useState(0);
  const [aperto, setAperto] = useState(false);
  const ultimoGesto = useRef(0);
  const ultimoBattito = useRef(0);
  const inVolo = useRef(false);

  // orologio per il tempo trascorso (dopo il primo disegno: il server non ha l'ora del browser)
  useEffect(() => { setOra(Date.now()); const t = setInterval(() => setOra(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const gesto = () => {
      ultimoGesto.current = Date.now();
      // primo gesto senza incontro aperto, o un minuto dall'ultimo battito: avvisa il server
      if (inVolo.current) return;
      if (!st.aperto || Date.now() - ultimoBattito.current > 60_000) {
        inVolo.current = true;
        ultimoBattito.current = Date.now();
        battitoIncontro(campaignId).then(setSt).catch(() => undefined).finally(() => { inVolo.current = false; });
      }
    };
    const eventi = ["pointerdown", "keydown", "wheel", "dragstart"] as const;
    eventi.forEach((ev) => document.addEventListener(ev, gesto, { passive: true }));
    // inattività: chiude all'ultimo gesto
    const controllo = setInterval(() => {
      if (st.aperto && ultimoGesto.current && Date.now() - ultimoGesto.current > st.minutiInattivita * 60_000) {
        terminaIncontro(campaignId, true).then(setSt).catch(() => undefined);
        ultimoGesto.current = 0;
      }
    }, 30_000);
    return () => { eventi.forEach((ev) => document.removeEventListener(ev, gesto)); clearInterval(controllo); };
  }, [campaignId, st.aperto, st.minutiInattivita]);

  const durata = (() => {
    if (!st.aperto || !ora) return "";
    const s = Math.max(0, Math.floor((ora - Date.parse(st.aperto.inizio)) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
  })();
  const partecipanti = st.aperto?.partecipanti ?? [];
  const alterna = async (id: string) => {
    if (!st.aperto) return;
    const nuovi = partecipanti.includes(id) ? partecipanti.filter((x) => x !== id) : [...partecipanti, id];
    setSt({ ...st, aperto: { ...st.aperto, partecipanti: nuovi } });
    await partecipantiIncontro(st.aperto.id, nuovi).catch(() => undefined);
  };

  return (
    <span className="incontro" style={{ position: "relative" }}>
      {st.aperto ? (
        <>
          <span className="incontro-punto" title={st.aperto.auto ? "Avviato da solo al primo gesto" : "Avviato col pulsante"} />
          <strong style={{ fontSize: 12.5 }}>Incontro in corso · {durata}</strong>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAperto(!aperto)}
            title="Chi partecipa all'incontro">{partecipanti.length} {partecipanti.length === 1 ? "persona" : "persone"} ▾</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => iniziaDaOra(campaignId).then(setSt)}
            title="Fai partire il tempo da adesso (es. se l'incontro era partito da solo prima di cominciare davvero)">Inizio</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => terminaIncontro(campaignId).then(setSt)}>Termina</button>
        </>
      ) : (
        <>
          <span className="hint" style={{ fontSize: 12 }}>Nessun incontro aperto</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => avviaIncontro(campaignId).then(setSt)}
            title={`Parte anche da solo al primo gesto sulla pagina; si chiude dopo ${st.minutiInattivita} minuti senza gesti`}>Avvia incontro</button>
        </>
      )}
      {aperto && st.aperto && (
        <span className="incontro-menu">
          <span className="hint" style={{ fontSize: 11 }}>Chi c&apos;è (chi lavora sulla pagina si aggiunge da solo)</span>
          {colleghi.map((c) => (
            <label key={c.id}><input type="checkbox" checked={partecipanti.includes(c.id)} onChange={() => alterna(c.id)} /> {c.nome}</label>
          ))}
        </span>
      )}
    </span>
  );
}
