"use client";

import { useEffect, useMemo, useState } from "react";

export interface VoceCatalogo {
  id: string;
  codice: string;
  titolo: string;
  sotto: string;
  marca: string;
  tipologia: string;
  foto: string;
  prezzo: string;
  listino: string;
  novita: boolean;
  prezzoNum?: number;
  /** stato per punto vendita: ok / pochi / esaurito / nd */
  stati: Record<string, "ok" | "pochi" | "esaurito" | "nd">;
  etichette: Record<string, string>;
}

/**
 * Il catalogo come lo usa il cliente: ricerca, categorie, scelta del punto
 * vendita (prezzi e disponibilità di quel negozio), «solo disponibili»,
 * ordinamento. Tutto in pagina: i dati arrivano una volta dal server.
 */
export default function CatalogoCliente({
  voci, tipologie, puntiVendita, pvIniziale, slugInsegna, gestioneQuantita, esauritiNascosti, banner, aggiornato,
}: {
  voci: VoceCatalogo[];
  tipologie: string[];
  puntiVendita: { id: string; nome: string; citta: string }[];
  pvIniziale: string;
  slugInsegna: string;
  gestioneQuantita: boolean;
  esauritiNascosti: boolean;
  banner?: { url?: string; occhiello?: string; testo?: string };
  aggiornato: Record<string, string>;
}) {
  const [pv, setPv] = useState(pvIniziale);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [soloDisp, setSoloDisp] = useState(false);
  const [ordine, setOrdine] = useState<"consigliati" | "prezzo-su" | "prezzo-giu" | "nome">("consigliati");
  useEffect(() => {
    try { const v = localStorage.getItem(`cat-pv-${slugInsegna}`); if (v && puntiVendita.some((p) => p.id === v) && !pvIniziale) setPv(v); } catch { /* niente */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scegliPv = (id: string) => { setPv(id); try { localStorage.setItem(`cat-pv-${slugInsegna}`, id); } catch { /* niente */ } };

  const lista = useMemo(() => {
    const testo = q.trim().toLowerCase();
    let l = voci.filter((v) => (!cat || v.tipologia === cat) && (!testo || `${v.titolo} ${v.sotto} ${v.marca} ${v.codice}`.toLowerCase().includes(testo)));
    if (gestioneQuantita && pv) {
      if (esauritiNascosti) l = l.filter((v) => v.stati[pv] !== "esaurito");
      if (soloDisp) l = l.filter((v) => v.stati[pv] === "ok" || v.stati[pv] === "pochi");
    }
    if (ordine === "prezzo-su") l = [...l].sort((a, b) => (a.prezzoNum ?? 1e9) - (b.prezzoNum ?? 1e9));
    if (ordine === "prezzo-giu") l = [...l].sort((a, b) => (b.prezzoNum ?? -1) - (a.prezzoNum ?? -1));
    if (ordine === "nome") l = [...l].sort((a, b) => a.titolo.localeCompare(b.titolo, "it"));
    return l;
  }, [voci, cat, q, pv, soloDisp, ordine, gestioneQuantita, esauritiNascosti]);
  const disponibili = gestioneQuantita && pv ? lista.filter((v) => v.stati[pv] === "ok" || v.stati[pv] === "pochi").length : undefined;
  const nomePv = puntiVendita.find((p) => p.id === pv)?.nome;
  const hrefScheda = (v: VoceCatalogo) => `/scheda/${pv || slugInsegna}/${encodeURIComponent(v.codice)}`;

  return (
    <div className="cp-corpo">
      <label className="cp-cerca">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5c6660" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per nome, marca o codice…" aria-label="Cerca nel catalogo" />
      </label>
      <div className="cp-categorie">
        <button type="button" className={cat === "" ? "on" : ""} onClick={() => setCat("")}>Tutti</button>
        {tipologie.map((t) => <button key={t} type="button" className={cat === t ? "on" : ""} onClick={() => setCat(t)}>{t}</button>)}
      </div>
      <div className="cp-conto">
        <span><strong style={{ color: "#1d241f" }}>{lista.length}</strong> prodotti{disponibili !== undefined && nomePv ? ` · ${disponibili} disponibili a ${nomePv}` : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {puntiVendita.length > 0 && (
            <label>Negozio
              <select value={pv} onChange={(e) => scegliPv(e.target.value)} aria-label="Punto vendita">
                <option value="">— scegli —</option>
                {puntiVendita.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.citta ? ` · ${p.citta}` : ""}</option>)}
              </select>
            </label>
          )}
          {gestioneQuantita && pv && <label><input type="checkbox" checked={soloDisp} onChange={(e) => setSoloDisp(e.target.checked)} /> solo disponibili</label>}
          <label>Ordina
            <select value={ordine} onChange={(e) => setOrdine(e.target.value as typeof ordine)}>
              <option value="consigliati">consigliati</option><option value="prezzo-su">prezzo crescente</option><option value="prezzo-giu">prezzo decrescente</option><option value="nome">nome</option>
            </select>
          </label>
        </span>
      </div>
      {banner && (banner.url || banner.testo) && (
        <div className="cp-banner" style={banner.url ? { backgroundImage: `url(${banner.url})` } : undefined}>
          {banner.occhiello && <span className="occhiello">{banner.occhiello.toUpperCase()}</span>}
          {banner.testo && <strong>{banner.testo}</strong>}
        </div>
      )}
      {lista.length === 0 ? <p className="cp-vuoto">Nessun prodotto con questi filtri.</p> : (
        <div className="cp-griglia">
          {lista.map((v) => {
            const stato = gestioneQuantita && pv ? v.stati[pv] : "nd";
            const sconto = v.listino && v.prezzoNum ? (() => { const l = parseFloat(v.listino.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".")); return l > v.prezzoNum! ? `-${Math.round(((l - v.prezzoNum!) / l) * 100)}%` : ""; })() : "";
            return (
              <a key={v.id} href={hrefScheda(v)}>
                <span className="foto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.foto} alt="" loading="lazy" />
                  {sconto ? <span className="pill">{sconto}</span> : v.novita ? <span className="pill nero">NOVITÀ</span> : null}
                </span>
                <span className="marca">{v.marca}</span>
                <strong>{v.titolo}</strong>
                {v.prezzo && <span className="prezzo">{v.prezzo.startsWith("€") ? v.prezzo : `€ ${v.prezzo}`}{v.listino && sconto && <s>€ {v.listino.replace(/^€\s*/, "")}</s>}</span>}
                {stato !== "nd" && <span className={`stato ${stato}`}>{stato === "esaurito" ? "○" : "●"} {v.etichette[pv]}</span>}
              </a>
            );
          })}
        </div>
      )}
      <div className="cp-piede">
        {gestioneQuantita && pv && aggiornato[pv] ? `Disponibilità di ${nomePv} aggiornata ${aggiornato[pv]} · ` : ""}
        {nomePv ? `prezzi del punto vendita di ${nomePv}` : "scegli il negozio per vedere prezzi e disponibilità"}
      </div>
    </div>
  );
}
