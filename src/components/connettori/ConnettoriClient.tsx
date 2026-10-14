"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  salvaConnettoreZoo, accendiConnettoreZoo, scollegaConnettoreZoo, provaConnettoreZoo,
  creaChiaveArredo, accendiApiArredo, togliChiaveArredo,
} from "@/lib/connettori-actions";

type TipoAmbito = "tenant" | "store";
const quando = (iso?: string) => iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }) : "";

/** Zoo: GT One interroga il gestionale per giacenze e prezzi. Una riga per insegna o PV. */
export function ConnettoreZoo({ tipo, id, url, nome, attivo, provatoIl, esito }: {
  tipo: TipoAmbito; id: string; url?: string; nome?: string; attivo: boolean; provatoIl?: string; esito?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modifica, setModifica] = useState(false);
  const [errore, setErrore] = useState("");
  const [ultimaProva, setUltimaProva] = useState("");

  const fai = (azione: () => Promise<{ ok: boolean; error?: string; esito?: string }>, conferma?: string) => {
    if (conferma && !confirm(conferma)) return;
    setErrore("");
    startTransition(async () => {
      const r = await azione().catch(() => ({ ok: false, error: "Non riuscito: riprova." }));
      if ("esito" in r && r.esito) setUltimaProva(r.esito);
      if (!r.ok) setErrore(r.error ?? "Non riuscito");
      else { setModifica(false); router.refresh(); }
    });
  };

  if (!url && !modifica) {
    return (
      <div>
        <span className="hint">Nessun collegamento</span>{" "}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setModifica(true)}>＋ Collega gestionale</button>
      </div>
    );
  }
  if (modifica) {
    return (
      <form style={{ display: "grid", gap: 6 }}
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fai(() => salvaConnettoreZoo(tipo, id, fd)); }}>
        <input name="nome" defaultValue={nome ?? ""} placeholder="Nome (es. Linfa, Danea, Passepartout)" maxLength={40} />
        <input name="url" type="url" defaultValue={url ?? ""} required placeholder="https://…/api/pub/giacenze/CHIAVE" style={{ fontFamily: "monospace", fontSize: 12 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" type="submit" disabled={pending}>Salva</button>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => setModifica(false)}>Annulla</button>
        </div>
        {errore && <span className="errore-inline">{errore}</span>}
      </form>
    );
  }
  const host = (() => { try { return new URL(url!).host; } catch { return url; } })();
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`pill ${attivo ? "pill-green" : "pill-gray"}`}>{attivo ? "acceso" : "spento"}</span>
        <strong>{nome || "Gestionale"}</strong>
        <span className="hint" title={url} style={{ fontFamily: "monospace", fontSize: 11.5 }}>{host}/…</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => accendiConnettoreZoo(tipo, id, !attivo))}>
          {attivo ? "Spegni" : "Accendi"}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => provaConnettoreZoo(tipo, id))} title="Chiede al gestionale qualche EAN del volantino in corso">
          {pending ? "…" : "Prova"}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => setModifica(true)}>Modifica</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} style={{ color: "var(--red, #b42318)" }}
          onClick={() => fai(() => scollegaConnettoreZoo(tipo, id), "Scollegare il gestionale? Cartelli e Bozza torneranno ai prezzi del Consorzio e senza giacenze.")}>
          Scollega
        </button>
      </div>
      {(ultimaProva || esito) && (
        <span className="hint" style={{ fontSize: 12, color: (ultimaProva || esito)!.startsWith("OK") ? "#15803d" : "#b42318" }}>
          {ultimaProva || esito}{!ultimaProva && provatoIl ? ` (provato il ${quando(provatoIl)})` : ""}
        </span>
      )}
      {errore && <span className="errore-inline">{errore}</span>}
    </div>
  );
}

/** Arredo: il gestionale del PV manda le quantità del catalogo online con una chiave. */
export function ConnettoreArredo({ storeId, token, apiAttiva, aggiornatoIl, fonte, nQuantita }: {
  storeId: string; token?: string; apiAttiva: boolean; aggiornatoIl?: string; fonte?: string; nQuantita: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mostra, setMostra] = useState(false);
  const [errore, setErrore] = useState("");
  const [copiata, setCopiata] = useState(false);

  const fai = (azione: () => Promise<{ ok: boolean; error?: string }>, conferma?: string) => {
    if (conferma && !confirm(conferma)) return;
    setErrore("");
    startTransition(async () => {
      const r = await azione().catch(() => ({ ok: false, error: "Non riuscito: riprova." }));
      if (!r.ok) setErrore(r.error ?? "Non riuscito");
      else router.refresh();
    });
  };
  const fonteTesto = { api: "dal gestionale", excel: "da Excel", mano: "a mano" }[fonte ?? ""] ?? "";
  const ultimo = aggiornatoIl ? `${nQuantita} quantità ${fonteTesto}, ${quando(aggiornatoIl)}` : "nessuna quantità ancora";

  if (!token) {
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <div><span className="hint">Nessuna chiave</span>{" "}
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => creaChiaveArredo(storeId))}>＋ Crea chiave</button></div>
        <span className="hint" style={{ fontSize: 12 }}>{ultimo}</span>
        {errore && <span className="errore-inline">{errore}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`pill ${apiAttiva ? "pill-green" : "pill-gray"}`}>{apiAttiva ? "accesa" : "spenta"}</span>
        <code style={{ fontSize: 11.5 }}>{mostra ? token : `${token.slice(0, 6)}${"•".repeat(12)}`}</code>
        <button type="button" className="mini-btn" onClick={() => setMostra((v) => !v)}>{mostra ? "nascondi" : "mostra"}</button>
        <button type="button" className="mini-btn" onClick={() => { navigator.clipboard?.writeText(token).then(() => { setCopiata(true); setTimeout(() => setCopiata(false), 1500); }); }}>
          {copiata ? "copiata ✓" : "copia"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => accendiApiArredo(storeId, !apiAttiva))}>
          {apiAttiva ? "Spegni" : "Accendi"}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending}
          onClick={() => fai(() => creaChiaveArredo(storeId), "Rigenerare la chiave? Quella vecchia smette di valere: va aggiornata nel gestionale.")}>
          Rigenera
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} style={{ color: "var(--red, #b42318)" }}
          onClick={() => fai(() => togliChiaveArredo(storeId), "Togliere la chiave? Il gestionale non potrà più mandare le quantità (quelle già ricevute restano).")}>
          Togli
        </button>
      </div>
      <span className="hint" style={{ fontSize: 12 }}>{ultimo}</span>
      {errore && <span className="errore-inline">{errore}</span>}
    </div>
  );
}
