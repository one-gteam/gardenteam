"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save, FileDown, Sheet, Plus, ImageDown, ChevronDown, ChevronUp } from "lucide-react";
import { saveVolantinoLayout, updateZooOfferQuick, uploadVolantinoImage } from "@/lib/zoo-actions";
import type { VolPage, VolBlock, VolSection } from "@/lib/zoo";

export interface ArtLite { ean: string; descrizione: string; marca: string }
/**
 * Voce della lista di sinistra: un PRODOTTO PADRE (che raccoglie le offerte dei
 * suoi gusti/formati) oppure una singola offerta senza padre. `articoli` elenca
 * i prodotti contenuti, apribile dalla lista per sapere cosa c'è dentro.
 */
export interface OffLite {
  id: string; descrizione: string; prezzo: string; prezzoListino?: string; foto: string;
  voti: number; nonTrattati: number; scheda?: string;
  marca: string; fornitore: string; caratts: string[]; label?: string;
  padre?: string; // nome del prodotto padre, se la voce ne rappresenta uno
  offerIds?: string[]; // offerte racchiuse dalla voce (assente = solo `id`)
  articoli: ArtLite[]; // articoli (gusti/formati) racchiusi dalla voce
  paginaId?: string; // pagina decisa in Import offerte (NO_VOLANTINO = scartata)
  focus?: string;
  gruppoGrafico?: string; // stesso valore = da impaginare vicine
}

/** Deve combaciare con NO_VOLANTINO di lib/zoo (qui è un client component). */
const NO_VOLANTINO = "__no__";

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

function pagina(titolo: string, cols = 3, rows = 4): VolPage {
  const blocks: VolBlock[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) blocks.push({ id: uid("vb"), r, c, rs: 1, cs: 1 });
  return { id: uid("vp"), titolo, cols, rows, blocks, sezioni: [] };
}

/** Struttura standard: copertina + 7 pagine tematiche (la numerazione è automatica). */
const PAGINE_DEFAULT = (): VolPage[] => [
  pagina("Copertina", 2, 3),
  pagina("Gatto"), pagina("Gatto"),
  pagina("Cane"), pagina("Cane"),
  pagina("Accessori"),
  pagina("Piccoli animali"),
  pagina("Acquario e rettili"),
];

const vuoto = (b: VolBlock) => !b.offerIds?.length && !b.testo && !b.imageUrl && !b.label;

/** Ogni cella della griglia deve essere coperta da esattamente un blocco. */
function normalizza(page: VolPage): VolPage {
  const occupato = new Map<string, string>();
  const blocks: VolBlock[] = [];
  for (const b of page.blocks) {
    if (b.r >= page.rows || b.c >= page.cols) continue;
    const cs = Math.max(1, Math.min(b.cs, page.cols - b.c));
    const rs = Math.max(1, Math.min(b.rs, page.rows - b.r));
    let libero = true;
    for (let r = b.r; r < b.r + rs; r++) for (let c = b.c; c < b.c + cs; c++) if (occupato.has(`${r}_${c}`)) libero = false;
    if (!libero) continue;
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
  return {
    ...page,
    blocks: blocks.sort((a, b) => a.r - b.r || a.c - b.c),
    sezioni: (page.sezioni ?? []).filter((s) => s.r < page.rows && s.c < page.cols),
  };
}

export default function VolantinoBuilder({
  campaignId, offers, initialPages, excelHref, fotoZipHref, animali, caratts, labels, marche, fornitori,
}: {
  campaignId: string; offers: OffLite[]; initialPages: VolPage[]; excelHref: string; fotoZipHref: string;
  animali: string[]; caratts: string[]; labels: string[]; marche: string[]; fornitori: string[];
}) {
  const [pages, setPages] = useState<VolPage[]>(() =>
    (initialPages.length ? initialPages : PAGINE_DEFAULT()).map(normalizza)
  );
  const [stato, setStato] = useState<"" | "salvo" | "salvato" | "errore">("");
  const [drag, setDrag] = useState<{ kind: "offer" | "block"; id: string; pi?: number } | null>(null);
  const [clip, setClip] = useState<VolBlock | null>(null);
  const [sel, setSel] = useState<{ pi: number; id: string } | null>(null);
  const [dettaglio, setDettaglio] = useState<string | null>(null);
  const [spread, setSpread] = useState(0);
  const [avviso, setAvviso] = useState("");
  const [f, setF] = useState({ animale: "", caratt: "", label: "", minVoti: "", minNon: "", marca: "", fornitore: "" });
  const [filtroChiuso, setFiltroChiuso] = useState(false);
  const [mostraScartate, setMostraScartate] = useState(false);
  const primoRender = useRef(true);

  /* --- offerte già collocate: spariscono dall'elenco a sinistra --- */
  const inserite = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) for (const b of p.blocks) for (const id of b.offerIds ?? []) s.add(id);
    return s;
  }, [pages]);

  /*
   * L'elenco mostra TUTTE le offerte che passano il filtro, comprese quelle già
   * collocate in una cella (in grigio, "già usata"): sparirle del tutto rendeva
   * difficile capire cosa fosse già stato piazzato. Restano trascinabili, utile
   * per rimetterne una in una seconda cella (es. la stessa offerta su due pagine).
   */
  const disponibili = useMemo(() => offers.filter((o) => {
    // le offerte marcate "no volantino" restano fuori, salvo richiesta esplicita
    if (o.paginaId === NO_VOLANTINO && !mostraScartate) return false;
    if (f.animale && !o.caratts.includes(f.animale)) return false;
    if (f.caratt && !o.caratts.includes(f.caratt)) return false;
    if (f.label && o.label !== f.label) return false;
    if (f.minVoti && o.voti < Number(f.minVoti)) return false;
    if (f.minNon && o.nonTrattati < Number(f.minNon)) return false;
    if (f.marca && o.marca !== f.marca) return false;
    if (f.fornitore && o.fornitore !== f.fornitore) return false;
    return true;
  }).sort((a, b) => Number(inserite.has(a.id)) - Number(inserite.has(b.id))), [offers, f, inserite, mostraScartate]);
  const daCollocare = disponibili.filter((o) => !inserite.has(o.id)).length;

  /*
   * Offerte con una pagina assegnata da Import offerte ma non ancora collocate:
   * "Disponi per pagina" le mette nelle celle libere della loro pagina; quelle
   * che non ci stanno restano qui e vengono segnalate, perché è una scelta di
   * chi impagina (allargare la griglia, unire celle, spostarne altre).
   */
  const daDisporre = useMemo(
    () => offers.filter((o) => o.paginaId && o.paginaId !== NO_VOLANTINO && !inserite.has(o.id)),
    [offers, inserite]
  );
  const eccedenze = useMemo(() => {
    const libere = new Map<string, number>();
    for (const p of pages) libere.set(p.id, p.blocks.filter(vuoto).length);
    const fuori: OffLite[] = [];
    for (const o of daDisporre) {
      const n = libere.get(o.paginaId!) ?? 0;
      if (n > 0) libere.set(o.paginaId!, n - 1);
      else fuori.push(o);
    }
    return fuori;
  }, [daDisporre, pages]);

  const upd = (fn: (p: VolPage[]) => VolPage[]) => setPages((prev) => fn(structuredClone(prev)).map(normalizza));
  const offer = (id?: string) => offers.find((o) => o.id === id);
  const blockOf = (ps: VolPage[], pi: number, id: string) => ps[pi].blocks.find((b) => b.id === id);

  const salva = useCallback(async (silenzioso = false) => {
    if (!silenzioso) setStato("salvo");
    try {
      const res = await saveVolantinoLayout(campaignId, JSON.stringify(pages));
      setStato(res.ok ? "salvato" : "errore");
    } catch {
      setStato("errore"); // rete assente o server non raggiungibile
    }
  }, [campaignId, pages]);

  useEffect(() => {
    if (primoRender.current) { primoRender.current = false; return; }
    setStato("");
    const t = setTimeout(() => { salva(true); }, 1500);
    return () => clearTimeout(t);
  }, [pages, salva]);

  const flash = (m: string) => { setAvviso(m); setTimeout(() => setAvviso(""), 3500); };

  /**
   * Ordina le offerte da collocare tenendo insieme quelle che vanno impaginate
   * vicine: prima il "raggruppamento grafico" indicato nel file di selezione,
   * poi l'etichetta e il focus in comune.
   */
  const chiaveVicinanza = (o: OffLite) => `${o.gruppoGrafico ?? ""}|${o.label ?? ""}|${o.focus ?? ""}`;
  const ordinaPerVicinanza = (lista: OffLite[]) => {
    const ordineChiavi: string[] = [];
    for (const o of lista) {
      const k = chiaveVicinanza(o);
      if (!ordineChiavi.includes(k)) ordineChiavi.push(k);
    }
    return [...lista].sort((a, b) => {
      const ka = ordineChiavi.indexOf(chiaveVicinanza(a));
      const kb = ordineChiavi.indexOf(chiaveVicinanza(b));
      return ka - kb;
    });
  };

  /** Riempie le celle libere di ogni pagina con le offerte assegnate a quella pagina. */
  const disponiPerPagina = () => {
    if (daDisporre.length === 0) return flash("Nessuna offerta con una pagina assegnata da collocare.");
    let messe = 0;
    upd((ps) => {
      for (const page of ps) {
        const perQuesta = ordinaPerVicinanza(daDisporre.filter((o) => o.paginaId === page.id));
        if (perQuesta.length === 0) continue;
        // celle libere in ordine di lettura, così i gruppi restano adiacenti
        const libere = page.blocks
          .filter((b) => !b.offerIds?.length && !b.testo && !b.imageUrl && !b.label)
          .sort((a, b) => a.r - b.r || a.c - b.c);
        for (let i = 0; i < Math.min(libere.length, perQuesta.length); i++) {
          libere[i].offerIds = [perQuesta[i].id];
          messe++;
        }
      }
      return ps;
    });
    const fuori = daDisporre.length - messe;
    flash(fuori > 0
      ? `Collocate ${messe} offerte. ${fuori} non ci stanno nelle pagine assegnate: restano nell'elenco a sinistra.`
      : `Collocate ${messe} offerte nelle pagine assegnate.`);
  };

  /**
   * Riordina le offerte GIÀ collocate in ciascuna pagina in modo che quelle con
   * stessa etichetta o stesso focus finiscano in celle adiacenti, mantenendo
   * ogni offerta nella sua pagina e senza toccare testi, immagini e sezioni.
   */
  const avvicinaSimili = () => {
    let toccate = 0;
    upd((ps) => {
      for (const page of ps) {
        const conOfferta = page.blocks
          .filter((b) => b.offerIds?.length)
          .sort((a, b) => a.r - b.r || a.c - b.c);
        if (conOfferta.length < 2) continue;
        const contenuti = conOfferta.map((b) => ({
          offerIds: b.offerIds, descrizione: b.descrizione, prezzo: b.prezzo, label: b.label, commento: b.commento,
        }));
        const ordinati = contenuti
          .map((c) => ({ c, o: offers.find((x) => x.id === (c.offerIds ?? [])[0]) }))
          .sort((a, b) => {
            const ka = a.o ? chiaveVicinanza(a.o) : "";
            const kb = b.o ? chiaveVicinanza(b.o) : "";
            return ka.localeCompare(kb, "it");
          })
          .map((x) => x.c);
        conOfferta.forEach((b, i) => {
          Object.assign(b, { offerIds: undefined, descrizione: undefined, prezzo: undefined, label: undefined, commento: undefined }, ordinati[i]);
        });
        toccate += conOfferta.length;
      }
      return ps;
    });
    flash(toccate > 0
      ? `Riordinate ${toccate} celle: le offerte con stessa etichetta o focus sono ora vicine.`
      : "Non ci sono ancora offerte collocate da avvicinare.");
  };

  /**
   * Le barre in alto restano visibili una sotto l'altra mentre si scorre: qui
   * misuriamo l'altezza reale di intestazione e strumenti (cambia con la
   * larghezza della finestra) e la passiamo al CSS.
   */
  useEffect(() => {
    const head = document.querySelector<HTMLElement>(".vol-head");
    const toolbar = document.querySelector<HTMLElement>(".vol-toolbar");
    const misura = () => {
      const h1 = head?.offsetHeight ?? 0;
      const h2 = toolbar?.offsetHeight ?? 0;
      document.documentElement.style.setProperty("--vol-top1", `${h1}px`);
      document.documentElement.style.setProperty("--vol-top2", `${h1 + h2}px`);
    };
    misura();
    const ro = new ResizeObserver(misura);
    if (head) ro.observe(head);
    if (toolbar) ro.observe(toolbar);
    window.addEventListener("resize", misura);
    return () => { ro.disconnect(); window.removeEventListener("resize", misura); };
  }, []);

  /* --- operazioni sulla griglia --- */
  const unisci = (pi: number, id: string, verso: "destra" | "giu") => {
    const page = pages[pi];
    const b = page.blocks.find((x) => x.id === id);
    if (!b) return;
    const target: VolBlock[] = [];
    if (verso === "destra") {
      if (b.c + b.cs >= page.cols) return flash("Non c'è spazio a destra: la cella tocca già il bordo della pagina.");
      for (let r = b.r; r < b.r + b.rs; r++) {
        const t = page.blocks.find((x) => x.r === r && x.c === b.c + b.cs);
        if (!t || t.rs > 1 || t.cs > 1) return flash("A destra c'è una cella già unita: separala prima.");
        target.push(t);
      }
    } else {
      if (b.r + b.rs >= page.rows) return flash("Non c'è spazio sotto: la cella tocca già il fondo della pagina.");
      for (let c = b.c; c < b.c + b.cs; c++) {
        const t = page.blocks.find((x) => x.c === c && x.r === b.r + b.rs);
        if (!t || t.rs > 1 || t.cs > 1) return flash("Sotto c'è una cella già unita: separala prima.");
        target.push(t);
      }
    }
    const pieni = target.filter((t) => !vuoto(t));
    if (pieni.length > 0 && !confirm(`Unendo, il contenuto di ${pieni.length} cella/e verrà eliminato. Procedere?`)) return;
    upd((ps) => {
      const bb = blockOf(ps, pi, id)!;
      if (verso === "destra") bb.cs += 1; else bb.rs += 1;
      ps[pi].blocks = ps[pi].blocks.filter((x) => !target.some((t) => t.id === x.id));
      return ps;
    });
  };

  const separa = (pi: number, id: string, verso: "destra" | "giu") =>
    upd((ps) => { const b = blockOf(ps, pi, id)!; if (verso === "destra") b.cs = 1; else b.rs = 1; return ps; });

  const contenutoDi = (x: VolBlock) => ({
    offerIds: x.offerIds, testo: x.testo, imageUrl: x.imageUrl, label: x.label,
    commento: x.commento, descrizione: x.descrizione, prezzo: x.prezzo,
  });
  const VUOTO = { offerIds: undefined, testo: undefined, imageUrl: undefined, label: undefined, commento: undefined, descrizione: undefined, prezzo: undefined };

  const spostaContenuto = (pi: number, fromId: string, toId: string) => upd((ps) => {
    if (fromId === toId) return ps;
    const a = blockOf(ps, pi, fromId)!;
    const b = blockOf(ps, pi, toId)!;
    const ca = contenutoDi(a);
    const cb = contenutoDi(b);
    Object.assign(a, VUOTO, cb);
    Object.assign(b, VUOTO, ca);
    return ps;
  });

  const patch = (pi: number, id: string, dati: Partial<VolBlock>) =>
    upd((ps) => { const b = blockOf(ps, pi, id); if (b) Object.assign(b, dati); return ps; });

  const svuota = (pi: number, id: string) => patch(pi, id, VUOTO);

  const drop = (pi: number, blockId: string) => {
    if (!drag) return;
    if (drag.kind === "offer") {
      upd((ps) => { const b = blockOf(ps, pi, blockId)!; b.offerIds = [...(b.offerIds ?? []), drag.id]; return ps; });
    } else if (drag.pi === pi) {
      spostaContenuto(pi, drag.id, blockId);
    } else {
      flash("Per ora si sposta solo all'interno della stessa pagina: usa copia e incolla fra pagine diverse.");
    }
    setDrag(null);
  };

  /** Trascinando una cella sull'elenco a sinistra, le offerte tornano disponibili. */
  const dropSuElenco = () => {
    if (drag?.kind === "block" && drag.pi !== undefined) {
      svuota(drag.pi, drag.id);
      if (sel?.id === drag.id) setSel(null);
    }
    setDrag(null);
  };

  const caricaImmagine = async (pi: number, id: string, file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    const res = await uploadVolantinoImage(fd);
    if (res.ok) patch(pi, id, { imageUrl: res.url });
    else flash("Caricamento immagine non riuscito.");
  };

  const aggiungiSezione = (pi: number, b: VolBlock) => upd((ps) => {
    ps[pi].sezioni = [...(ps[pi].sezioni ?? []), { id: uid("vs"), r: b.r, c: b.c, rs: b.rs, cs: b.cs, bg: "#eaf3e2", titolo: "Sezione" }];
    return ps;
  });
  const patchSezione = (pi: number, id: string, dati: Partial<VolSection>) => upd((ps) => {
    const s = (ps[pi].sezioni ?? []).find((x) => x.id === id);
    if (s) Object.assign(s, dati);
    return ps;
  });

  /* --- schede: copertina da sola, poi coppie 2-3, 4-5, 6-7… --- */
  const spreads = useMemo(() => {
    const out: number[][] = [[0]];
    for (let i = 1; i < pages.length; i += 2) out.push(pages[i + 1] ? [i, i + 1] : [i]);
    return out;
  }, [pages]);
  const spreadCorrente = spreads[Math.min(spread, spreads.length - 1)] ?? [0];
  const etichettaSpread = (g: number[]) =>
    g[0] === 0 ? "Copertina" : g.length > 1 ? `Pag. ${g[0] + 1}-${g[1] + 1}` : `Pag. ${g[0] + 1}`;

  /* --- riferimento cella: numeroPagina-progressivo (es. 3-4) --- */
  const riferimento = (pi: number, b: VolBlock) => `${pi + 1}-${pages[pi].blocks.findIndex((x) => x.id === b.id) + 1}`;

  const selBlock = sel ? pages[sel.pi]?.blocks.find((b) => b.id === sel.id) : undefined;
  const selPage = sel ? pages[sel.pi] : undefined;
  const selOffs = ((selBlock?.offerIds ?? []).map(offer).filter(Boolean) as OffLite[]);

  const renderBlock = (pi: number, b: VolBlock) => {
    const offs = (b.offerIds ?? []).map(offer).filter(Boolean) as OffLite[];
    const isVuoto = vuoto(b);
    const attiva = sel?.pi === pi && sel?.id === b.id;
    return (
      <div
        key={b.id}
        draggable={!isVuoto}
        onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "block", id: b.id, pi }); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => drop(pi, b.id)}
        onClick={() => setSel({ pi, id: b.id })}
        className={`vol-cell${attiva ? " attiva" : ""}`}
        style={{
          gridColumn: `${b.c + 1} / span ${b.cs}`, gridRow: `${b.r + 1} / span ${b.rs}`,
          border: isVuoto ? "1.5px dashed var(--line)" : "1px solid var(--line)",
          background: b.imageUrl ? `center/cover no-repeat url(${b.imageUrl})` : isVuoto ? "rgba(255,255,255,0.5)" : "#fff",
        }}
      >
        <span className="vol-rif no-print">{riferimento(pi, b)}</span>
        {b.label && <span className="vol-label">{b.label}</span>}
        {offs.length > 0 && (
          <div style={{ display: "grid", gap: 2, gridTemplateColumns: offs.length > 1 ? "1fr 1fr" : "1fr", textAlign: "center" }}>
            {offs.map((o, i) => (
              <div key={`${o.id}_${i}`} style={{ minWidth: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.foto} alt="" style={{ maxWidth: "100%", height: b.rs > 1 ? 58 : 32, objectFit: "contain" }} />
                <div style={{ fontWeight: 600, fontSize: 9.5, lineHeight: 1.15 }}>
                  {(i === 0 ? b.descrizione : undefined) ?? o.descrizione}
                </div>
                <div style={{ color: "#c2410c", fontWeight: 800, fontSize: 12 }}>
                  € {(i === 0 ? b.prezzo : undefined) ?? o.prezzo}
                </div>
              </div>
            ))}
          </div>
        )}
        {b.testo && <div className="vol-testo">{b.testo}</div>}
        {isVuoto && <span className="vol-hint no-print">trascina qui</span>}
        {b.commento && <span className="vol-nota no-print" title={b.commento}>nota</span>}
      </div>
    );
  };

  const renderPage = (pi: number) => {
    const page = pages[pi];
    if (!page) return null;
    return (
      <div key={page.id} className="vol-page-wrap">
        <div className="no-print vol-page-tools">
          <span className="vol-numero">Pag. {pi + 1}</span>
          <input value={page.titolo ?? ""} placeholder="nome pagina"
            onChange={(e) => upd((ps) => { ps[pi].titolo = e.target.value; return ps; })}
            style={{ marginTop: 0, width: 118, fontWeight: 700, fontSize: 12 }} />
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>griglia</span>
          <select value={page.cols} onChange={(e) => upd((ps) => { ps[pi].cols = Number(e.target.value); return ps; })} style={{ marginTop: 0, width: 46, fontSize: 11 }}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ fontSize: 10.5 }}>×</span>
          <select value={page.rows} onChange={(e) => upd((ps) => { ps[pi].rows = Number(e.target.value); return ps; })} style={{ marginTop: 0, width: 46, fontSize: 11 }}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {pages.length > 1 && (
            <button className="mini-btn" style={{ color: "var(--red)" }} title="Elimina pagina"
              onClick={() => confirm(`Eliminare la pagina ${pi + 1}?`) && upd((ps) => ps.filter((_, i) => i !== pi))}>✕</button>
          )}
        </div>

        <div className="vol-page" style={{ gridTemplateColumns: `repeat(${page.cols}, 1fr)`, gridTemplateRows: `repeat(${page.rows}, 1fr)` }}>
          {(page.sezioni ?? []).map((s) => (
            <div key={s.id} className="vol-sezione"
              style={{ gridColumn: `${s.c + 1} / span ${s.cs}`, gridRow: `${s.r + 1} / span ${s.rs}`, background: s.bg }}>
              {s.titolo && <div className="vol-sezione-titolo">{s.titolo}</div>}
            </div>
          ))}
          {page.blocks.map((b) => renderBlock(pi, b))}
        </div>

        <details className="no-print vol-note">
          <summary>Note della pagina per il grafico{page.note ? " ●" : ""}</summary>
          <textarea rows={2} defaultValue={page.note ?? ""} placeholder="Es. sfondo verde su tutta la pagina, titolo in alto…"
            onBlur={(e) => upd((ps) => { ps[pi].note = e.target.value || undefined; return ps; })} />
        </details>
      </div>
    );
  };

  return (
    <div className="vol-layout">
      {/* ---------- colonna sinistra: filtro + offerte disponibili ---------- */}
      <aside className="vol-filtro no-print" onDragOver={(e) => e.preventDefault()} onDrop={dropSuElenco}>
        <div className="vol-filtro-fissa">
          <div className="vol-filtro-head">
            Filtra le offerte
            <button type="button" className="mini-btn" title={filtroChiuso ? "Espandi filtro" : "Comprimi filtro"}
              onClick={() => setFiltroChiuso((v) => !v)}>
              {filtroChiuso ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
          {!filtroChiuso && (
            <div className="vol-filtro-body">
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
                <label className="field" style={{ flex: 1 }}>Non tratt. da
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
              <label style={{ fontSize: 11.5, display: "block", marginBottom: 8 }}>
                <input type="checkbox" checked={mostraScartate} onChange={(e) => setMostraScartate(e.target.checked)} />{" "}
                mostra offerte non selezionate (&quot;no volantino&quot;)
              </label>
              <button className="btn btn-outline btn-sm" type="button" style={{ width: "100%" }}
                onClick={() => setF({ animale: "", caratt: "", label: "", minVoti: "", minNon: "", marca: "", fornitore: "" })}>
                Azzera filtri
              </button>
            </div>
          )}
        </div>

        <div className="vol-filtro-scroll">
        <div className="vol-filtro-head">
          Da collocare ({daCollocare})
          {inserite.size > 0 && <span className="pill pill-green" style={{ marginLeft: 6 }}>{inserite.size} già nel volantino</span>}
        </div>
        <div className="vol-filtro-lista">
          {disponibili.length === 0 && (
            <p className="empty" style={{ fontSize: 12 }}>
              Nessuna offerta da collocare. Per rimetterne una qui, trascina la sua cella su questo elenco.
            </p>
          )}
          {disponibili.map((o) => {
            const usata = inserite.has(o.id);
            return (
            <div key={o.id} className="vol-off" draggable onDragStart={() => setDrag({ kind: "offer", id: o.id })}
              style={usata ? { opacity: 0.45 } : undefined}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.foto} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.padre ?? o.descrizione}
                  </div>
                  {o.padre && (
                    <div style={{ fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {o.descrizione}
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                    € {o.prezzo}
                    {usata && <span className="pill pill-gray">già usata</span>}
                    {o.paginaId === NO_VOLANTINO && <span className="pill pill-red">no volantino</span>}
                    {o.paginaId && o.paginaId !== NO_VOLANTINO && !usata && (
                      <span className="pill pill-amber" title="pagina assegnata da Import offerte">
                        → {pages.findIndex((p) => p.id === o.paginaId) + 1 || "?"}
                      </span>
                    )}
                    {o.voti > 0 && <span className="pill pill-green">{o.voti} voti</span>}
                    {o.nonTrattati > 0 && <span className="pill pill-red">{o.nonTrattati} n.t.</span>}
                    {o.label && <span className="pill pill-blue">{o.label}</span>}
                    {o.focus && <span className="pill pill-gray" title="focus">{o.focus}</span>}
                  </div>
                </div>
              </div>
              {o.articoli.length > 0 && (
                <button type="button" className="mini-btn" style={{ marginTop: 4 }}
                  onClick={() => setDettaglio(dettaglio === o.id ? null : o.id)}>
                  {dettaglio === o.id
                    ? "Nascondi articoli"
                    : o.padre ? `Vedi i ${o.articoli.length} articoli contenuti` : "Vedi l'articolo"}
                </button>
              )}
              {dettaglio === o.id && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 10.5, color: "var(--muted)" }}>
                  {o.articoli.map((a) => <li key={a.ean}>{a.descrizione} <span style={{ opacity: 0.7 }}>· {a.ean}</span></li>)}
                </ul>
              )}
            </div>
            );
          })}
        </div>
        </div>
      </aside>

      {/* ---------- centro: barra strumenti, schede, pagine ---------- */}
      <div>
        <div className="vol-toolbar no-print">
          <div className="vol-tabs">
            {spreads.map((g, i) => (
              <button key={i} type="button" className={`vol-tab${i === spread ? " attiva" : ""}`} onClick={() => { setSpread(i); setSel(null); }}>
                {etichettaSpread(g)}
                {g.map((pi) => pages[pi]?.titolo).filter(Boolean).length > 0 && (
                  <span className="vol-tab-nome">{[...new Set(g.map((pi) => pages[pi]?.titolo).filter(Boolean))].join(" · ")}</span>
                )}
              </button>
            ))}
          </div>
          <div className="vol-actions">
            <span className={`pill ${stato === "errore" ? "pill-red" : "pill-green"}`} style={{ opacity: stato ? 1 : 0.4 }}>
              {stato === "salvo" ? "Salvataggio…" : stato === "salvato" ? "Salvato" : stato === "errore" ? "Errore" : "Salvataggio automatico"}
            </span>
            {clip && <span className="pill pill-amber">Cella copiata</span>}
            <button className="btn btn-sm" title="Salva volantino" aria-label="Salva volantino" onClick={() => salva()}>
              <Save size={14} style={{ verticalAlign: -2, marginRight: 5 }} />Salva
            </button>
            <button className="btn btn-outline btn-sm" title="Esporta PDF" aria-label="Esporta PDF" onClick={() => window.print()}>
              <FileDown size={14} style={{ verticalAlign: -2 }} />
            </button>
            <a className="btn btn-outline btn-sm" title="Excel per il grafico" aria-label="Excel per il grafico" href={excelHref}>
              <Sheet size={14} style={{ verticalAlign: -2 }} />
            </a>
            <a
              className="btn btn-outline btn-sm"
              title="ZIP per il grafico: Excel + foto in alta risoluzione"
              aria-label="ZIP per il grafico: Excel + foto in alta risoluzione"
              href={fotoZipHref}
            >
              <ImageDown size={14} style={{ verticalAlign: -2 }} />
            </a>
            {daDisporre.length > 0 && (
              <button className="btn btn-sm" type="button" onClick={disponiPerPagina}
                title="Colloca nelle pagine le offerte a cui è già stata assegnata una pagina in Import offerte">
                Disponi per pagina ({daDisporre.length})
              </button>
            )}
            <button className="btn btn-outline btn-sm" type="button" onClick={avvicinaSimili}
              title="Riordina le offerte già collocate mettendo vicine quelle con stessa etichetta o focus">
              Avvicina simili
            </button>
            <button className="btn btn-outline btn-sm" title="Aggiungi pagina" aria-label="Aggiungi pagina" onClick={() => upd((ps) => [...ps, pagina("")])}>
              <Plus size={14} style={{ verticalAlign: -2 }} />
            </button>
          </div>
        </div>

        {avviso && <div className="alert alert-amber no-print">{avviso}</div>}

        {/* eccedenze: offerte assegnate a una pagina che non ha più celle libere */}
        {eccedenze.length > 0 && (
          <div className="alert alert-red no-print" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{eccedenze.length} offerte non ci stanno nella pagina assegnata.</strong>
            <span style={{ fontSize: 12.5 }}>
              Restano nell&apos;elenco a sinistra: allarga la griglia della pagina, unisci meno celle o spostane
              qualcuna su un&apos;altra pagina.
            </span>
            <span style={{ fontSize: 11.5, color: "var(--muted)", width: "100%" }}>
              {[...new Set(eccedenze.map((o) => o.padre ?? o.descrizione))].slice(0, 6).join(" · ")}
              {eccedenze.length > 6 ? " …" : ""}
            </span>
          </div>
        )}

        <div className="vol-spread">{spreadCorrente.map((pi) => renderPage(pi))}</div>

        {/* in stampa escono tutte le pagine, non solo la scheda aperta */}
        <div className="solo-stampa">{pages.map((_, pi) => renderPage(pi))}</div>
      </div>

      {/* ---------- colonna destra: modifica della cella scelta ---------- */}
      <aside className="vol-side no-print">
        {!selBlock || !selPage ? (
          <div className="card" style={{ padding: 14 }}>
            <strong style={{ fontSize: 13 }}>Nessuna cella scelta</strong>
            <p className="hint" style={{ margin: "6px 0 0" }}>
              Fai clic su una cella del volantino per modificarla qui: contenuti, unioni, etichetta e commenti.
              Le offerte si trascinano dall&apos;elenco a sinistra.
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 13, flex: 1 }}>Cella {riferimento(sel!.pi, selBlock)}</strong>
              <button className="mini-btn" onClick={() => setSel(null)}>Chiudi</button>
            </div>

            <div className="vol-side-riga">
              <button className="btn btn-outline btn-sm" onClick={() => unisci(sel!.pi, selBlock.id, "destra")}>Unisci →</button>
              <button className="btn btn-outline btn-sm" onClick={() => unisci(sel!.pi, selBlock.id, "giu")}>Unisci ↓</button>
              {selBlock.cs > 1 && <button className="btn btn-outline btn-sm" onClick={() => separa(sel!.pi, selBlock.id, "destra")}>Separa ←</button>}
              {selBlock.rs > 1 && <button className="btn btn-outline btn-sm" onClick={() => separa(sel!.pi, selBlock.id, "giu")}>Separa ↑</button>}
            </div>
            <div className="vol-side-riga">
              <button className="btn btn-outline btn-sm" onClick={() => setClip({ ...selBlock })}>Copia</button>
              {clip && <button className="btn btn-outline btn-sm" onClick={() => patch(sel!.pi, selBlock.id, contenutoDi(clip))}>Incolla</button>}
              {!vuoto(selBlock) && <button className="btn btn-outline btn-sm danger" onClick={() => svuota(sel!.pi, selBlock.id)}>Svuota</button>}
            </div>

            {selOffs.length > 0 && (
              <>
                <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "10px 0" }} />
                <strong style={{ fontSize: 12.5 }}>Offerte nella cella ({selOffs.length})</strong>
                {selOffs.map((o, i) => (
                  <div key={`${o.id}_${i}`} style={{ display: "flex", gap: 6, alignItems: "center", margin: "4px 0", fontSize: 11.5 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.foto} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.descrizione}</span>
                    <button className="mini-btn" title="Togli dalla cella (torna nell'elenco)"
                      onClick={() => patch(sel!.pi, selBlock.id, { offerIds: (selBlock.offerIds ?? []).filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <label className="field">Descrizione (solo su questo volantino)
                  <input key={`d_${selBlock.id}`} defaultValue={selBlock.descrizione ?? selOffs[0].descrizione}
                    onBlur={(e) => patch(sel!.pi, selBlock.id, { descrizione: e.target.value || undefined })} />
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                  <label className="field" style={{ flex: 1 }}>Prezzo
                    <input key={`p_${selBlock.id}`} defaultValue={selBlock.prezzo ?? selOffs[0].prezzo}
                      onBlur={(e) => patch(sel!.pi, selBlock.id, { prezzo: e.target.value || undefined })} />
                  </label>
                  <button className="btn btn-outline btn-sm" style={{ marginBottom: 12 }}
                    onClick={async () => {
                      await updateZooOfferQuick(selOffs[0].id, selBlock.descrizione ?? selOffs[0].descrizione, selBlock.prezzo ?? selOffs[0].prezzo);
                      patch(sel!.pi, selBlock.id, { descrizione: undefined, prezzo: undefined });
                      window.location.reload();
                    }}>Salva nel database</button>
                </div>
              </>
            )}

            <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "10px 0" }} />
            <label className="field">Etichetta
              <select key={`l_${selBlock.id}`} defaultValue={selBlock.label ?? ""}
                onChange={(e) => patch(sel!.pi, selBlock.id, { label: e.target.value || undefined })}>
                <option value="">— nessuna —</option>
                {labels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="field">Testo (anche sopra l&apos;immagine)
              <textarea key={`t_${selBlock.id}`} rows={2} defaultValue={selBlock.testo ?? ""}
                onBlur={(e) => patch(sel!.pi, selBlock.id, { testo: e.target.value || undefined })} />
            </label>
            <label className="field">Commento per il grafico
              <textarea key={`c_${selBlock.id}`} rows={2} defaultValue={selBlock.commento ?? ""}
                onBlur={(e) => patch(sel!.pi, selBlock.id, { commento: e.target.value || undefined })} />
            </label>
            <label className="field">Immagine di sfondo
              <input type="file" accept="image/*" style={{ fontSize: 11 }}
                onChange={(e) => e.target.files?.[0] && caricaImmagine(sel!.pi, selBlock.id, e.target.files[0])} />
            </label>
            {selBlock.imageUrl && (
              <button className="btn btn-outline btn-sm" onClick={() => patch(sel!.pi, selBlock.id, { imageUrl: undefined })}>Togli immagine</button>
            )}

            <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "10px 0" }} />
            <strong style={{ fontSize: 12.5 }}>Sfondo di gruppo (sezione)</strong>
            <p className="hint" style={{ margin: "4px 0 6px", fontSize: 11 }}>
              Colora un&apos;area della pagina dietro le celle: le offerte restano posizionabili sopra.
            </p>
            <button className="btn btn-outline btn-sm" onClick={() => aggiungiSezione(sel!.pi, selBlock)}>Crea sezione da questa cella</button>
            {(selPage.sezioni ?? []).map((s) => (
              <div key={s.id} style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
                <input value={s.titolo ?? ""} onChange={(e) => patchSezione(sel!.pi, s.id, { titolo: e.target.value })}
                  placeholder="Titolo" style={{ marginTop: 0, flex: 1, fontSize: 11 }} />
                <input type="color" value={s.bg} onChange={(e) => patchSezione(sel!.pi, s.id, { bg: e.target.value })}
                  style={{ marginTop: 0, width: 30, height: 26, padding: 0 }} />
                <button className="mini-btn" title="Allarga a destra" onClick={() => patchSezione(sel!.pi, s.id, { cs: Math.min(s.cs + 1, selPage.cols - s.c) })}>→</button>
                <button className="mini-btn" title="Allarga in basso" onClick={() => patchSezione(sel!.pi, s.id, { rs: Math.min(s.rs + 1, selPage.rows - s.r) })}>↓</button>
                <button className="mini-btn" title="Elimina sezione"
                  onClick={() => upd((ps) => { ps[sel!.pi].sezioni = (ps[sel!.pi].sezioni ?? []).filter((x) => x.id !== s.id); return ps; })}>✕</button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
