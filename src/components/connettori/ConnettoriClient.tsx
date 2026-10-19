"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  salvaConnettoreZoo, accendiConnettoreZoo, scollegaConnettoreZoo, provaConnettoreZoo,
  creaChiaveArredo, accendiApiArredo, togliChiaveArredo,
  salvaLetturaArredo, leggiAdessoArredo, accendiLetturaArredo, scollegaLetturaArredo,
  creaChiaveLettura, accendiLettura, togliChiaveLettura,
  creaChiaveFox, accendiFox, togliChiaveFox,
  generaChiaveSso, accendiSso, togliChiaveSso, salvaPvSso,
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
        <span className="hint">Non collegato</span>{" "}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setModifica(true)}>＋ Indirizzo del gestionale</button>
      </div>
    );
  }
  if (modifica) {
    return (
      <form style={{ display: "grid", gap: 6 }}
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fai(() => salvaConnettoreZoo(tipo, id, fd)); }}>
        <input name="nome" defaultValue={nome ?? ""} placeholder="Nome del gestionale (facoltativo)" maxLength={40} />
        <input name="url" type="url" defaultValue={url ?? ""} required placeholder="https://… (indirizzo dato dal vostro tecnico)" style={{ fontFamily: "monospace", fontSize: 12 }} />
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

/** Zoo, il gestionale legge le offerte: la chiave che il gestionale manda in Authorization: Bearer. */
export function ConnettoreLettura({ tipo, id, token, attivo, creataIl }: {
  tipo: TipoAmbito; id: string; token?: string; attivo: boolean; creataIl?: string;
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
  if (!token) {
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <div><span className="hint">Nessuna chiave</span>{" "}
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => creaChiaveLettura(tipo, id))}>＋ Crea chiave</button></div>
        {errore && <span className="errore-inline">{errore}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`pill ${attivo ? "pill-green" : "pill-gray"}`}>{attivo ? "accesa" : "spenta"}</span>
        <code style={{ fontSize: 11.5 }}>{mostra ? token : `${token.slice(0, 6)}${"•".repeat(12)}`}</code>
        <button type="button" className="mini-btn" onClick={() => setMostra((v) => !v)}>{mostra ? "nascondi" : "mostra"}</button>
        <button type="button" className="mini-btn" onClick={() => { navigator.clipboard?.writeText(token).then(() => { setCopiata(true); setTimeout(() => setCopiata(false), 1500); }); }}>
          {copiata ? "copiata ✓" : "copia"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => accendiLettura(tipo, id, !attivo))}>
          {attivo ? "Spegni" : "Accendi"}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending}
          onClick={() => fai(() => creaChiaveLettura(tipo, id), "Rigenerare la chiave? Quella vecchia smette di valere: va aggiornata nel gestionale.")}>
          Rigenera
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} style={{ color: "var(--red, #b42318)" }}
          onClick={() => fai(() => togliChiaveLettura(tipo, id), "Togliere la chiave? Il gestionale non potrà più leggere le offerte Zoo.")}>
          Togli
        </button>
      </div>
      {creataIl && <span className="hint" style={{ fontSize: 12 }}>creata il {quando(creataIl)}</span>}
      {errore && <span className="errore-inline">{errore}</span>}
    </div>
  );
}

/** SSO dell'insegna: la chiave con cui il suo sistema firma i link d'ingresso, e il PV dato ai nuovi. */
export function ConnettoreSso({ tenantId, chiave, attivo, storeId, negozi }: {
  tenantId: string; chiave?: string; attivo: boolean; storeId?: string; negozi: { id: string; nome: string }[];
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

  if (!chiave) {
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <div><span className="hint">Nessuna chiave: i collaboratori entrano con email e password</span>{" "}
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => generaChiaveSso(tenantId))}>＋ Crea chiave SSO</button></div>
        {errore && <span className="errore-inline">{errore}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`pill ${attivo ? "pill-green" : "pill-gray"}`}>{attivo ? "acceso" : "spento"}</span>
        <code style={{ fontSize: 11.5, wordBreak: "break-all" }}>{mostra ? chiave : `${chiave.slice(0, 6)}${"•".repeat(16)}`}</code>
        <button type="button" className="mini-btn" onClick={() => setMostra((v) => !v)}>{mostra ? "nascondi" : "mostra"}</button>
        <button type="button" className="mini-btn" onClick={() => { navigator.clipboard?.writeText(chiave).then(() => { setCopiata(true); setTimeout(() => setCopiata(false), 1500); }); }}>
          {copiata ? "copiata ✓" : "copia"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => accendiSso(tenantId, !attivo))}>
          {attivo ? "Spegni" : "Accendi"}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending}
          onClick={() => fai(() => generaChiaveSso(tenantId), "Rigenerare la chiave? Quella vecchia smette di valere: va aggiornata nel vostro sistema.")}>
          Rigenera
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} style={{ color: "var(--red, #b42318)" }}
          onClick={() => fai(() => togliChiaveSso(tenantId), "Togliere la chiave SSO? I link del vostro sistema non faranno più entrare (gli account creati restano).")}>
          Togli
        </button>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
          PV dei nuovi:
          <select defaultValue={storeId ?? ""} disabled={pending}
            onChange={(e) => { const fd = new FormData(); fd.set("storeId", e.target.value); fai(() => salvaPvSso(tenantId, fd)); }}>
            <option value="">— solo l&apos;insegna —</option>
            {negozi.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
          </select>
        </label>
      </div>
      {errore && <span className="errore-inline">{errore}</span>}
    </div>
  );
}

/**
 * Zoo, «il gestionale invia»: la chiave con cui il gestionale manda giacenze e
 * prezzi (POST /api/connettori/fox). Per chi ha Fox c'è lo script pronto,
 * GTOne-Fox.ps1, che legge la cartella «db» e manda con questa chiave.
 */
export function ConnettoreFox({ tipo, id, chiave, attivo, ultimoInvio, righe, fileAl }: {
  tipo: TipoAmbito; id: string; chiave?: string; attivo: boolean; ultimoInvio?: string; righe?: number; fileAl?: string;
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
  if (!chiave) {
    return (
      <div>
        <span className="hint">Nessuna chiave</span>{" "}
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => creaChiaveFox(tipo, id))}>＋ Crea chiave</button>
        {errore && <span className="errore-inline">{errore}</span>}
      </div>
    );
  }
  const vecchio = ultimoInvio ? Date.now() - new Date(ultimoInvio).getTime() > 2 * 864e5 : false;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`pill ${attivo ? "pill-green" : "pill-gray"}`}>{attivo ? "accesa" : "spenta"}</span>
        <code style={{ fontSize: 11 }}>{mostra ? chiave : `${chiave.slice(0, 8)}${"•".repeat(10)}`}</code>
        <button type="button" className="mini-btn" onClick={() => setMostra((v) => !v)}>{mostra ? "nascondi" : "mostra"}</button>
        <button type="button" className="mini-btn" onClick={() => { navigator.clipboard?.writeText(chiave).then(() => { setCopiata(true); setTimeout(() => setCopiata(false), 1500); }); }}>
          {copiata ? "copiata ✓" : "copia chiave"}
        </button>
      </div>
      <span className="hint" style={{ fontSize: 12, color: vecchio ? "#b42318" : undefined }}>
        {ultimoInvio
          ? `Ultimo invio ${quando(ultimoInvio)}: ${righe ?? 0} articoli dello Zoo${fileAl ? ` (dati del ${quando(fileAl)})` : ""}${vecchio ? " — da più di 2 giorni non arriva niente" : ""}`
          : "Nessun invio ancora: date la chiave al gestionale (con Fox: allo script GTOne-Fox.ps1)."}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => accendiFox(tipo, id, !attivo))}>{attivo ? "Spegni" : "Accendi"}</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending}
          onClick={() => fai(() => creaChiaveFox(tipo, id), "Rigenerare la chiave? Quella vecchia smette di valere: va data di nuovo al gestionale.")}>Rigenera</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} style={{ color: "var(--red, #b42318)" }}
          onClick={() => fai(() => togliChiaveFox(tipo, id), "Togliere la chiave? Gli invii verranno rifiutati e giacenze e prezzi tornano quelli del Consorzio.")}>Togli</button>
      </div>
      {errore && <span className="errore-inline">{errore}</span>}
    </div>
  );
}

/** Arredo, «GT One legge»: l'indirizzo del gestionale del PV con le quantità, letto ogni mattina. */
export function ConnettoreLetturaArredo({ storeId, url, attivo, provatoIl, esito }: {
  storeId: string; url?: string; attivo: boolean; provatoIl?: string; esito?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modifica, setModifica] = useState(false);
  const [errore, setErrore] = useState("");
  const [ultima, setUltima] = useState("");
  const fai = (azione: () => Promise<{ ok: boolean; error?: string; esito?: string }>, conferma?: string, chiudi = true) => {
    if (conferma && !confirm(conferma)) return;
    setErrore("");
    startTransition(async () => {
      const r = await azione().catch(() => ({ ok: false, error: "Non riuscito: riprova." }));
      if ("esito" in r && r.esito) setUltima(r.esito);
      if (!r.ok && !("esito" in r && r.esito)) setErrore(r.error ?? "Non riuscito");
      else { if (chiudi) setModifica(false); router.refresh(); }
    });
  };
  if (!url && !modifica) {
    return (
      <div>
        <span className="hint">Non collegato</span>{" "}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setModifica(true)}>＋ Indirizzo del gestionale</button>
      </div>
    );
  }
  if (modifica) {
    return (
      <form style={{ display: "grid", gap: 6 }}
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fai(() => salvaLetturaArredo(storeId, fd)); }}>
        <input name="url" type="url" defaultValue={url ?? ""} required placeholder="https://… (indirizzo dato dal vostro tecnico)" style={{ fontFamily: "monospace", fontSize: 12 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" type="submit" disabled={pending}>{pending ? "Leggo…" : "Salva e prova"}</button>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => setModifica(false)}>Annulla</button>
        </div>
        {errore && <span className="errore-inline">{errore}</span>}
      </form>
    );
  }
  const host = (() => { try { return new URL(url!).host; } catch { return url; } })();
  const testo = ultima || esito;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`pill ${attivo ? "pill-green" : "pill-gray"}`}>{attivo ? "acceso" : "spento"}</span>
        <span className="hint" title={url} style={{ fontFamily: "monospace", fontSize: 11.5 }}>{host}/…</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => leggiAdessoArredo(storeId), undefined, false)}>{pending ? "…" : "Leggi adesso"}</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => fai(() => accendiLetturaArredo(storeId, !attivo))}>{attivo ? "Spegni" : "Accendi"}</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => setModifica(true)}>Modifica</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} style={{ color: "var(--red, #b42318)" }}
          onClick={() => fai(() => scollegaLetturaArredo(storeId), "Scollegare? GT One smette di leggere le quantità (quelle già lette restano).")}>Scollega</button>
      </div>
      {testo && (
        <span className="hint" style={{ fontSize: 12, color: testo.startsWith("OK") ? "#15803d" : "#b42318" }}>
          {testo}{!ultima && provatoIl ? ` (${quando(provatoIl)})` : ""}
        </span>
      )}
      {errore && <span className="errore-inline">{errore}</span>}
    </div>
  );
}
