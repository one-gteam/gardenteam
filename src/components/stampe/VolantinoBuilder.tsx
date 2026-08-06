"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveVolantinoLayout, updateZooOfferQuick, uploadVolantinoImage } from "@/lib/zoo-actions";
import type { VolPage, VolBlock, VolSection } from "@/lib/zoo";

export interface ArtLite { ean: string; descrizione: string; marca: string }
export interface OffLite {
  id: string; descrizione: string; prezzo: string; prezzoListino?: string; foto: string;
  voti: number; nonTrattati: number; scheda?: string;
  marca: string; fornitore: string; caratts: string[]; label?: string;
  articoli: ArtLite[]; // articoli (gusti/formati) racchiusi dall'offerta
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

/** Pagina vuota: griglia cols × rows con un blocco per ogni cella. */
function pagina(titolo: string, cols = 3, rows = 4): VolPage {
  const blocks: VolBlock[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) blocks.push({ id: uid("vb"), r, c, rs: 1, cs: 1 });
  return { id: uid("vp"), titolo, cols, rows, blocks, sezioni: [] };
}

/** Struttura standard del volantino zoo: copertina + 7 pagine tematiche. */
const PAGINE_DEFAULT = (): VolPage[] => [
  pagina("Copertina", 2, 3),
  pagina("Gatto — pag. 2"), pagina("Gatto — pag. 3"),
  pagina("Cane — pag. 4"), pagina("Cane — pag. 5"),
  pagina("Accessori — pag. 6"),
  pagina("Piccoli animali — pag. 7"),
  pagina("Acquario e rettili — pag. 8"),
];

const vuoto = (b: VolBlock) => !b.offerIds?.length && !b.testo && !b.imageUrl && !b.label;

/** Ogni cella della griglia deve essere coperta da esattamente un blocco. */
function normalizza(page: VolPage): VolPage {
  const occupato = new Map<string, string>();
  const blocks: VolBlock[] = [];
  for (const b of page.blocks) {
    const cs = Math.max(1, Math.min(b.cs, page.cols - b.c));
    const rs = Math.max(1, Math.min(b.rs, page.rows - b.r));
    if (b.r >= page.rows || b.c >= page.cols) continue; // fuori griglia: scartato
    let libero = true;
    for (let r = b.r; r < b.r + rs; r++) for (let c = b.c; c < b.c + cs; c++) if (occupato.has(`${r}_${c}`)) libero = false;
    if (!libero) continue; // sovrapposizione: tiene il primo
    for (let r = b.r; r < b.r + rs; r++) for (let c = b.c; c < b.c + cs; c++) occupato.set(`${r}_${c}`, b.id);
    blocks.push({ ...b, rs, cs });
  }
  for (let r = 0; r < page.rows; r++) {
    for (let c = 0; c < page.cols; c++) {
      if (!occupato.has(`${r}_${c}`)) {
        const nb = { id: uid("vb"), r, c, rs: 1, cs: 1 };
        occupato.set(`${r}_${c}`, nb.id);
        blocks.push(nb);
      }
    }
  }
  const sezioni = (page.sezioni ?? []).filter((s) => s.r < page.rows && s.c < page.cols);
  return { ...page, blocks: blocks.sort((a, b) => a.r - b.r || a.c - b.c), sezioni };
}

export default function VolantinoBuilder({
  campaignId, offers, initialPages, excelHref, animali, caratts, labels, marche, fornitori,
}: {
  campaignId: string; offers: OffLite[]; initialPages: VolPage[]; excelHref: string;
  animali: string[]; caratts: string[]; labels: string[]; marche: string[]; fornitori: string[];
}) {
  const [pages, setPages] = useState<VolPage[]>(() =>
    (initialPages.length ? initialPages : PAGINE_DEFAULT()).map(normalizza)
  );
  const [stato, setStato] = useState<"" | "salvo" | "salvato" | "errore">("");
  const [drag, setDrag] = useState<{ kind: "offer" | "block"; id: string; pi?: number } | null>(null);
  const [clip, setClip] = useState<VolBlock | null>(null);
  const [apri, setApri] = useState<string | null>(null); // blocco con pannello aperto
  const [dettaglio, setDettaglio] = useState<string | null>(null); // offerta con articoli aperti
  const [f, setF] = useState({ animale: "", caratt: "", label: "", minVoti: "", minNon: "", marca: "", fornitore: "" });
  const primoRender = useRef(true);

  const filtered = useMemo(() => offers.filter((o) => {
    if (f.animale && !o.caratts.includes(f.animale)) return false;
    if (f.caratt && !o.caratts.includes(f.caratt)) return false;
    if (f.label && o.label !== f.label) return false;
    if (f.minVoti && o.voti < Number(f.minVoti)) return false;
    if (f.minNon && o.nonTrattati < Number(f.minNon)) return false;
    if (f.marca && o.marca !== f.marca) return false;
    if (f.fornitore && o.fornitore !== f.fornitore) return false;
    return true;
  }), [offers, f]);

  const upd = (fn: (p: VolPage[]) => VolPage[]) => setPages((prev) => fn(structuredClone(prev)).map(normalizza));
  const offer = (id?: string) => offers.find((o) => o.id === id);
  const blockOf = (ps: VolPage[], pi: number, id: string) => ps[pi].blocks.find((b) => b.id === id)!;

  const salva = useCallback(async (silenzioso = false) => {
    if (!silenzioso) setStato("salvo");
    const res = await saveVolantinoLayout(campaignId, JSON.stringify(pages));
    setStato(res.ok ? "salvato" : "errore");
  }, [campaignId, pages]);

  // salvataggio automatico: 1,5 s dopo l'ultima modifica
  useEffect(() => {
    if (primoRender.current) { primoRender.current = false; return; }
    setStato("");
    const t = setTimeout(() => { salva(true); }, 1500);
    return () => clearTimeout(t);
  }, [pages, salva]);

  /** Unione: assorbe le celle adiacenti solo se vuote e larghe/alte una cella. */
  const unisci = (pi: number, id: string, verso: "destra" | "giu") => upd((ps) => {
    const page = ps[pi];
    const b = blockOf(ps, pi, id);
    const target: VolBlock[] = [];
    if (verso === "destra") {
      if (b.c + b.cs >= page.cols) return ps;
      for (let r = b.r; r < b.r + b.rs; r++) {
        const t = page.blocks.find((x) => x.r === r && x.c === b.c + b.cs && x.rs === 1 && x.cs === 1);
        if (!t || !vuoto(t)) return ps;
        target.push(t);
      }
      b.cs += 1;
    } else {
      if (b.r + b.rs >= page.rows) return ps;
      for (let c = b.c; c < b.c + b.cs; c++) {
        const t = page.blocks.find((x) => x.c === c && x.r === b.r + b.rs && x.rs === 1 && x.cs === 1);
        if (!t || !vuoto(t)) return ps;
        target.push(t);
      }
      b.rs += 1;
    }
    page.blocks = page.blocks.filter((x) => !target.includes(x));
    return ps;
  });

  const separa = (pi: number, id: string, verso: "destra" | "giu") => upd((ps) => {
    const b = blockOf(ps, pi, id);
    if (verso === "destra") b.cs = 1; else b.rs = 1;
    return ps; // normalizza() riempie i buchi
  });

  /** Sposta il contenuto di un blocco su un altro (scambio se il bersaglio è pieno). */
  const spostaContenuto = (pi: number, fromId: string, toId: string) => upd((ps) => {
    if (fromId === toId) return ps;
    const a = blockOf(ps, pi, fromId);
    const b = blockOf(ps, pi, toId);
    const contenuto = (x: VolBlock) => ({
      offerIds: x.offerIds, testo: x.testo, imageUrl: x.imageUrl, label: x.label,
      commento: x.commento, descrizione: x.descrizione, prezzo: x.prezzo,
    });
    const ca = contenuto(a);
    const cb = contenuto(b);
    Object.assign(a, { offerIds: undefined, testo: undefined, imageUrl: undefined, label: undefined, commento: undefined, descrizione: undefined, prezzo: undefined }, cb);
    Object.assign(b, { offerIds: undefined, testo: undefined, imageUrl: undefined, label: undefined, commento: undefined, descrizione: undefined, prezzo: undefined }, ca);
    return ps;
  });

  const drop = (pi: number, blockId: string) => {
    if (!drag) return;
    if (drag.kind === "offer") {
      upd((ps) => { const b = blockOf(ps, pi, blockId); b.offerIds = [...(b.offerIds ?? []), drag.id]; return ps; });
    } else if (drag.pi === pi) {
      spostaContenuto(pi, drag.id, blockId);
    }
    setDrag(null);
  };

  const patch = (pi: number, id: string, dati: Partial<VolBlock>) =>
    upd((ps) => { Object.assign(blockOf(ps, pi, id), dati); return ps; });

  const svuota = (pi: number, id: string) => patch(pi, id, {
    offerIds: undefined, testo: undefined, imageUrl: undefined, label: undefined,
    commento: undefined, descrizione: undefined, prezzo: undefined,
  });

  const caricaImmagine = async (pi: number, id: string, file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    const res = await uploadVolantinoImage(fd);
    if (res.ok) patch(pi, id, { imageUrl: res.url });
  };

  /** Crea una sezione sull'area della cella indicata (estendibile con i pulsanti). */
  const aggiungiSezione = (pi: number, b: VolBlock) => upd((ps) => {
    ps[pi].sezioni = [...(ps[pi].sezioni ?? []), { id: uid("vs"), r: b.r, c: b.c, rs: b.rs, cs: b.cs, bg: "#eaf3e2", titolo: "Sezione" }];
    return ps;
  });
  const patchSezione = (pi: number, id: string, dati: Partial<VolSection>) => upd((ps) => {
    const s = (ps[pi].sezioni ?? []).find((x) => x.id === id);
    if (s) Object.assign(s, dati);
    return ps;
  });

  const renderBlock = (page: VolPage, pi: number, b: VolBlock) => {
    const offs = (b.offerIds ?? []).map(offer).filter(Boolean) as OffLite[];
    const primo = offs[0];
    const aperto = apri === b.id;
    const isVuoto = vuoto(b);
    return (
      <div
        key={b.id}
        draggable={!isVuoto}
        onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "block", id: b.id, pi }); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => drop(pi, b.id)}
        className="vol-cell"
        style={{
          gridColumn: `${b.c + 1} / span ${b.cs}`, gridRow: `${b.r + 1} / span ${b.rs}`,
          border: isVuoto ? "1.5px dashed var(--line)" : "1px solid var(--line)",
          background: b.imageUrl ? `center/cover no-repeat url(${b.imageUrl})` : isVuoto ? "rgba(255,255,255,0.45)" : "#fff",
          cursor: isVuoto ? "default" : "grab",
        }}
      >
        {b.label && <span className="vol-label">{b.label}</span>}
        {offs.length > 0 && (
          <div style={{ display: "grid", gap: 2, gridTemplateColumns: offs.length > 1 ? "1fr 1fr" : "1fr", textAlign: "center" }}>
            {offs.map((o, i) => (
              <div key={`${o.id}_${i}`} style={{ minWidth: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.foto} alt="" style={{ maxWidth: "100%", height: b.rs > 1 ? 62 : 34, objectFit: "contain" }} />
                <div style={{ fontWeight: 600, fontSize: 9.5, lineHeight: 1.15 }}>
                  {(i === 0 ? b.descrizione : undefined) ?? o.descrizione}
                </div>
                <div style={{ color: "#c2410c", fontWeight: 800, fontSize: 12.5 }}>
                  € {(i === 0 ? b.prezzo : undefined) ?? o.prezzo}
                </div>
              </div>
            ))}
          </div>
        )}
        {b.testo && <div className="vol-testo">{b.testo}</div>}
        {isVuoto && <span className="vol-hint no-print">trascina qui</span>}
        {b.commento && <span className="vol-nota no-print" title={b.commento}>nota</span>}

        <div className="vol-tools no-print">
          <button className="mini-btn" title="Unisci a destra" onClick={() => unisci(pi, b.id, "destra")}>⇥</button>
          {b.cs > 1 && <button className="mini-btn" title="Separa in orizzontale" onClick={() => separa(pi, b.id, "destra")}>⇤</button>}
          <button className="mini-btn" title="Unisci in basso" onClick={() => unisci(pi, b.id, "giu")}>⇩</button>
          {b.rs > 1 && <button className="mini-btn" title="Separa in verticale" onClick={() => separa(pi, b.id, "giu")}>⇧</button>}
          <button className="mini-btn" title="Contenuto della cella" onClick={() => setApri(aperto ? null : b.id)}>✎</button>
          <button className="mini-btn" title="Copia cella" onClick={() => setClip({ ...b })}>⧉</button>
          {clip && (
            <button className="mini-btn" title="Incolla qui" onClick={() => patch(pi, b.id, {
              offerIds: clip.offerIds, testo: clip.testo, imageUrl: clip.imageUrl,
              label: clip.label, commento: clip.commento, descrizione: clip.descrizione, prezzo: clip.prezzo,
            })}>⇩⧉</button>
          )}
          {!isVuoto && <button className="mini-btn" title="Svuota" onClick={() => svuota(pi, b.id)}>✕</button>}
        </div>

        {aperto && (
          <div className="vol-editor no-print" onDragStart={(e) => e.preventDefault()}>
            <strong style={{ fontSize: 11.5 }}>Contenuto della cella</strong>
            {primo && (
              <>
                <label className="field" style={{ marginBottom: 4 }}>Descrizione (solo volantino)
                  <input defaultValue={b.descrizione ?? primo.descrizione} onBlur={(e) => patch(pi, b.id, { descrizione: e.target.value })} />
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <label className="field" style={{ marginBottom: 4 }}>Prezzo
                    <input defaultValue={b.prezzo ?? primo.prezzo} onBlur={(e) => patch(pi, b.id, { prezzo: e.target.value })} />
                  </label>
                  <button className="btn btn-outline btn-sm" style={{ alignSelf: "end", marginBottom: 4 }}
                    onClick={async () => {
                      await updateZooOfferQuick(primo.id, b.descrizione ?? primo.descrizione, b.prezzo ?? primo.prezzo);
                      patch(pi, b.id, { descrizione: undefined, prezzo: undefined });
                      window.location.reload();
                    }}>Salva anche nel database</button>
                </div>
              </>
            )}
            <label className="field" style={{ marginBottom: 4 }}>Etichetta
              <select defaultValue={b.label ?? ""} onChange={(e) => patch(pi, b.id, { label: e.target.value || undefined })}>
                <option value="">— nessuna —</option>
                {labels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 4 }}>Testo (anche sopra l&apos;immagine)
              <textarea rows={2} defaultValue={b.testo ?? ""} onBlur={(e) => patch(pi, b.id, { testo: e.target.value || undefined })} />
            </label>
            <label className="field" style={{ marginBottom: 4 }}>Commento per il grafico
              <textarea rows={2} defaultValue={b.commento ?? ""} onBlur={(e) => patch(pi, b.id, { commento: e.target.value || undefined })} />
            </label>
            <label className="field" style={{ marginBottom: 4 }}>Immagine di sfondo
              <input type="file" accept="image/*" style={{ fontSize: 11 }}
                onChange={(e) => e.target.files?.[0] && caricaImmagine(pi, b.id, e.target.files[0])} />
            </label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {b.imageUrl && <button className="mini-btn" onClick={() => patch(pi, b.id, { imageUrl: undefined })}>Togli immagine</button>}
              <button className="mini-btn" onClick={() => aggiungiSezione(pi, b)}>Crea sezione qui</button>
              <button className="mini-btn" onClick={() => setApri(null)}>Chiudi</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPage = (page: VolPage, pi: number) => (
    <div key={page.id} className="vol-page-wrap">
      <div className="no-print vol-page-tools">
        <input value={page.titolo ?? ""} onChange={(e) => upd((ps) => { ps[pi].titolo = e.target.value; return ps; })}
          style={{ marginTop: 0, width: 130, fontWeight: 700, fontSize: 12 }} />
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>griglia</span>
        <select value={page.cols} onChange={(e) => upd((ps) => { ps[pi].cols = Number(e.target.value); return ps; })} style={{ marginTop: 0, width: 48, fontSize: 11 }}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ fontSize: 10.5 }}>×</span>
        <select value={page.rows} onChange={(e) => upd((ps) => { ps[pi].rows = Number(e.target.value); return ps; })} style={{ marginTop: 0, width: 48, fontSize: 11 }}>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {pages.length > 1 && (
          <button className="mini-btn" style={{ color: "var(--red)" }} title="Elimina pagina"
            onClick={() => confirm("Eliminare questa pagina?") && upd((ps) => ps.filter((_, i) => i !== pi))}>✕</button>
        )}
      </div>
      <div className="vol-page" style={{ gridTemplateColumns: `repeat(${page.cols}, 1fr)`, gridTemplateRows: `repeat(${page.rows}, 1fr)` }}>
        {(page.sezioni ?? []).map((s) => (
          <div key={s.id} className="vol-sezione"
            style={{ gridColumn: `${s.c + 1} / span ${s.cs}`, gridRow: `${s.r + 1} / span ${s.rs}`, background: s.bg }}>
            <div className="vol-sezione-head no-print">
              <input value={s.titolo ?? ""} onChange={(e) => patchSezione(pi, s.id, { titolo: e.target.value })} placeholder="Titolo sezione" />
              <input type="color" value={s.bg} onChange={(e) => patchSezione(pi, s.id, { bg: e.target.value })} />
              <button className="mini-btn" title="Allarga a destra" onClick={() => patchSezione(pi, s.id, { cs: Math.min(s.cs + 1, page.cols - s.c) })}>⇥</button>
              <button className="mini-btn" title="Allarga in basso" onClick={() => patchSezione(pi, s.id, { rs: Math.min(s.rs + 1, page.rows - s.r) })}>⇩</button>
              <button className="mini-btn" title="Elimina sezione"
                onClick={() => upd((ps) => { ps[pi].sezioni = (ps[pi].sezioni ?? []).filter((x) => x.id !== s.id); return ps; })}>✕</button>
            </div>
            {s.titolo && <div className="vol-sezione-titolo">{s.titolo}</div>}
          </div>
        ))}
        {page.blocks.map((b) => renderBlock(page, pi, b))}
      </div>
    </div>
  );

  const copertina = pages[0];
  const resto = pages.slice(1);
  const terzine: VolPage[][] = [];
  for (let i = 0; i < resto.length; i += 3) terzine.push(resto.slice(i, i + 3));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "268px 1fr", gap: 16, alignItems: "start" }}>
      {/* filtro + offerte */}
      <div className="card no-print vol-filtro">
        <h3 style={{ margin: "0 0 10px" }}>Filtra le offerte</h3>
        <div className="vol-filtro-grid">
          <label className="field">Tipologia di animale
            <select value={f.animale} onChange={(e) => setF({ ...f, animale: e.target.value })}>
              <option value="">Tutte</option>
              {animali.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="field">Caratteristica prodotto
            <select value={f.caratt} onChange={(e) => setF({ ...f, caratt: e.target.value })}>
              <option value="">Tutte</option>
              {caratts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">Tipologia di offerta
            <select value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}>
              <option value="">Tutte</option>
              {labels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="field" style={{ flex: 1 }}>Voti da
              <input type="number" min={0} value={f.minVoti} onChange={(e) => setF({ ...f, minVoti: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>Non trattato da
              <input type="number" min={0} value={f.minNon} onChange={(e) => setF({ ...f, minNon: e.target.value })} />
            </label>
          </div>
          <label className="field">Marca
            <select value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })}>
              <option value="">Tutte</option>
              {marche.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="field">Fornitore
            <select value={f.fornitore} onChange={(e) => setF({ ...f, fornitore: e.target.value })}>
              <option value="">Tutti</option>
              {fornitori.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <button className="btn btn-outline btn-sm" type="button"
            onClick={() => setF({ animale: "", caratt: "", label: "", minVoti: "", minNon: "", marca: "", fornitore: "" })}>
            Azzera filtri
          </button>
        </div>

        <h3 style={{ margin: "16px 0 8px" }}>Offerte ({filtered.length})</h3>
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          {filtered.map((o) => (
            <div key={o.id} className="vol-off" draggable onDragStart={() => setDrag({ kind: "offer", id: o.id })}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.foto} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.descrizione}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                    € {o.prezzo}
                    {o.voti > 0 && <span className="pill pill-green">{o.voti} voti</span>}
                    {o.nonTrattati > 0 && <span className="pill pill-red">{o.nonTrattati} n.t.</span>}
                    {o.label && <span className="pill pill-blue">{o.label}</span>}
                  </div>
                </div>
              </div>
              {o.articoli.length > 0 && (
                <button type="button" className="mini-btn" style={{ marginTop: 4 }}
                  onClick={() => setDettaglio(dettaglio === o.id ? null : o.id)}>
                  {dettaglio === o.id ? "Nascondi" : `Vedi i ${o.articoli.length} articoli`}
                </button>
              )}
              {dettaglio === o.id && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 10.5, color: "var(--muted)" }}>
                  {o.articoli.map((a) => <li key={a.ean}>{a.descrizione} <span style={{ opacity: 0.7 }}>· {a.ean}</span></li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* pagine */}
      <div>
        <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-sm" onClick={() => salva()}>Salva volantino</button>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>Esporta PDF (stampa)</button>
          <a className="btn btn-outline btn-sm" href={excelHref}>Esporta Excel per il grafico</a>
          <button className="btn btn-outline btn-sm" onClick={() => upd((ps) => [...ps, pagina(`Pagina ${ps.length + 1}`)])}>+ Pagina</button>
          <span className={`pill ${stato === "errore" ? "pill-red" : "pill-green"}`} style={{ opacity: stato ? 1 : 0.35 }}>
            {stato === "salvo" ? "Salvataggio…" : stato === "salvato" ? "Salvato" : stato === "errore" ? "Errore" : "Salvataggio automatico attivo"}
          </span>
          {clip && <span className="pill pill-amber">Cella copiata — usa ⇩⧉ per incollarla</span>}
        </div>

        {copertina && <div className="vol-riga" style={{ justifyContent: "center" }}>{renderPage(copertina, 0)}</div>}
        {terzine.map((gruppo, gi) => (
          <div key={gi} className="vol-riga">{gruppo.map((p, i) => renderPage(p, 1 + gi * 3 + i))}</div>
        ))}
      </div>
    </div>
  );
}
