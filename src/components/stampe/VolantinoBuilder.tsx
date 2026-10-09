"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save, Plus, ChevronDown, ChevronUp, ArrowLeft, Rows3, Columns2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { SceltaFoto } from "./UnisciNelVolantino";
import {
  saveVolantinoLayout, updateZooOfferQuick, uploadVolantinoImage, updateParentFieldInline,
  unisciVociVolantino, separaUnioneVolantino, updateOfferGroupFieldInline,
} from "@/lib/zoo-actions";
import { assegnaFocusOfferte } from "@/lib/zoo-focus-actions";
import { colonneGriglia, colonnaGriglia, colonnaSezione, colonneRiga, righeBloccate } from "@/lib/volantino-griglia";
import type { VolPage, VolBlock, VolSection } from "@/lib/zoo";

export interface ArtLite { ean: string; descrizione: string; marca: string }
/**
 * Voce della lista di sinistra: un PRODOTTO PADRE (che raccoglie le offerte dei
 * suoi gusti/formati) oppure una singola offerta senza padre. `articoli` elenca
 * i prodotti contenuti, apribile dalla lista per sapere cosa c'è dentro.
 */
export interface OffLite {
  id: string; descrizione: string; prezzo: string; prezzoListino?: string; foto: string;
  /** Sconto sul prezzo di partenza, già scritto ("-23%"), e tipologia dell'offerta ("3x2", "sconto"). */
  sconto?: string; tipi?: string[];
  voti: number; nonTrattati: number; scheda?: string;
  marca: string; fornitore: string; caratts: string[]; label?: string;
  padre?: string; // nome del prodotto padre, se la voce ne rappresenta uno
  padreId?: string; // id del padre
  /** Voci unite per il volantino con prezzi diversi: il prezzo è il più basso, "a partire da". */
  aPartireDa?: boolean;
  /** Id dell'unione "solo volantino" a cui appartiene la voce. */
  unione?: string;
  /** Prezzo scritto a parole per la voce unita ("Sconto 20%"): sta al posto del prezzo. */
  prezzoTesto?: string;
  offerIds?: string[]; // offerte racchiuse dalla voce (assente = solo `id`)
  articoli: ArtLite[]; // articoli (gusti/formati) racchiusi dalla voce
  paginaId?: string; // pagina decisa in Scelta offerte / Offerte in corso (NO_VOLANTINO = scartata; "animale:Cane" = animale, pagina da decidere qui)
  focus?: string;
  animale?: string; // primo animale del padre
  animali?: string[]; // tutti gli animali del padre (per proporre le pagine giuste)
  /** Voce unita: le foto scelte da mostrare (una o più). */
  fotoUnione?: string[];
  caratt?: string; // prima caratteristica di prodotto del padre
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
  // celle per riga: le righe attraversate da una cella alta restano a page.cols
  const bloccate = righeBloccate(page);
  const colsRiga = Object.fromEntries(Object.entries(page.colsRiga ?? {}).filter(([r, n]) => Number(r) < page.rows && !bloccate.has(Number(r)) && n > 0 && n !== page.cols));
  const pg = { ...page, colsRiga };
  const nDi = (b: VolBlock) => (b.rs > 1 ? page.cols : colonneRiga(pg, b.r));
  for (const b of page.blocks) {
    if (b.r >= page.rows || b.c >= nDi(b)) continue;
    const cs = Math.max(1, Math.min(b.cs, nDi(b) - b.c));
    const rs = Math.max(1, Math.min(b.rs, page.rows - b.r));
    let libero = true;
    for (let r = b.r; r < b.r + rs; r++) for (let c = b.c; c < b.c + cs; c++) if (occupato.has(`${r}_${c}`)) libero = false;
    if (!libero) continue;
    for (let r = b.r; r < b.r + rs; r++) for (let c = b.c; c < b.c + cs; c++) occupato.set(`${r}_${c}`, b.id);
    blocks.push({ ...b, rs, cs });
  }
  for (let r = 0; r < page.rows; r++) {
    for (let c = 0; c < colonneRiga(pg, r); c++) {
      if (!occupato.has(`${r}_${c}`)) {
        const nb = { id: uid("vb"), r, c, rs: 1, cs: 1 };
        occupato.set(`${r}_${c}`, nb.id);
        blocks.push(nb);
      }
    }
  }
  return {
    ...page,
    colsRiga: Object.keys(colsRiga).length ? colsRiga : undefined,
    blocks: blocks.sort((a, b) => a.r - b.r || a.c - b.c),
    sezioni: (page.sezioni ?? []).filter((s) => s.r < page.rows && s.c < page.cols),
  };
}

const ANIMALE_PREFISSO = "animale:";
const animaleDi = (paginaId?: string) => (paginaId?.startsWith(ANIMALE_PREFISSO) ? paginaId.slice(ANIMALE_PREFISSO.length) : undefined);

export default function VolantinoBuilder({
  campaignId, offers: offersProp, initialPages, animali, caratts, labels, marche, fornitori, scopeParam,
  focusDisponibili = [],
}: {
  campaignId: string; offers: OffLite[]; initialPages: VolPage[]; excelHref?: string; fotoZipHref?: string;
  animali: string[]; caratts: string[]; labels: string[]; marche: string[]; fornitori: string[];
  scopeParam: string;
  /** I focus del volantino (pagina Focus): si associano alle offerte delle celle, anche col colore di sfondo. */
  focusDisponibili?: { nome: string; colore?: string; descrizione?: string }[];
}) {
  const router = useRouter();
  /*
   * Modifiche fatte da qui (titolo del padre, descrizione/prezzo salvati nel
   * database, pagina assegnata) si applicano subito all'elenco senza ricaricare
   * la pagina: prima ogni salvataggio ricaricava tutto e si perdeva il punto.
   */
  const [sovr, setSovr] = useState<Record<string, Partial<OffLite>>>({});
  const offers = useMemo(() => offersProp.map((o) => (sovr[o.id] ? { ...o, ...sovr[o.id] } : o)), [offersProp, sovr]);
  const sovrascrivi = (id: string, campi: Partial<OffLite>) => setSovr((p) => ({ ...p, [id]: { ...(p[id] ?? {}), ...campi } }));
  const [pages, setPages] = useState<VolPage[]>(() =>
    (initialPages.length ? initialPages : PAGINE_DEFAULT()).map(normalizza)
  );
  const [stato, setStato] = useState<"" | "salvo" | "salvato" | "errore">("");
  const [drag, setDrag] = useState<{ kind: "offer" | "block"; id: string; pi?: number } | null>(null);
  const [clip, setClip] = useState<VolBlock | null>(null);
  const [sel, setSel] = useState<{ pi: number; id: string } | null>(null);
  const [dettaglio, setDettaglio] = useState<string | null>(null);
  // si riparte dalla scheda su cui si stava lavorando (ricordata su questo computer)
  const [spread, setSpread] = useState(0);
  // schede affiancate, oppure tutte le pagine una sotto l'altra (si scorre con la rotellina)
  const [vista, setVista] = useState<"schede" | "verticale">("schede");
  /*
   * Le preferenze ricordate si leggono DOPO il primo disegno: il server disegna
   * con i valori di partenza, e leggerle subito faceva disegnare al browser una
   * pagina diversa (errore di React, la pagina si ridisegnava da capo).
   */
  const [preferenzeLette, setPreferenzeLette] = useState(false);
  useEffect(() => {
    try {
      setSpread(Number(localStorage.getItem(`vol-scheda-${campaignId}`) ?? 0) || 0);
      if (localStorage.getItem(`vol-vista-${campaignId}`) === "verticale") setVista("verticale");
      const w = Number(localStorage.getItem("vol-larghezza-sx")); if (w) setLarghezzaSx(w);
    } catch { /* niente */ }
    setPreferenzeLette(true);
  }, [campaignId]);
  useEffect(() => { if (preferenzeLette) try { localStorage.setItem(`vol-scheda-${campaignId}`, String(spread)); } catch { /* niente */ } }, [spread, campaignId, preferenzeLette]);
  useEffect(() => { if (preferenzeLette) try { localStorage.setItem(`vol-vista-${campaignId}`, vista); } catch { /* niente */ } }, [vista, campaignId, preferenzeLette]);
  const [avviso, setAvviso] = useState("");
  // larghezza dell'elenco a sinistra, trascinando il suo bordo (ricordata su questo computer)
  const [larghezzaSx, setLarghezzaSx] = useState(320);
  useEffect(() => { if (larghezzaSx !== 320) try { localStorage.setItem("vol-larghezza-sx", String(larghezzaSx)); } catch { /* niente */ } }, [larghezzaSx]);
  const [f, setF] = useState({ animale: "", caratt: "", label: "", minVoti: "", minNon: "", marca: "", fornitore: "", pagina: "" });
  const [filtroChiuso, setFiltroChiuso] = useState(true);
  const [mostraScartate, setMostraScartate] = useState(false);
  const [soloQuestaPagina, setSoloQuestaPagina] = useState(true);
  // le offerte senza pagina (non scelte in Scelta offerte Volantino) non si propongono, salvo richiesta
  const [ancheSenzaPagina, setAncheSenzaPagina] = useState(false);
  const [vociDaUnire, setVociDaUnire] = useState<string[]>([]); // id delle voci spuntate
  const primoRender = useRef(true);

  /* --- schede: copertina da sola, poi coppie 2-3, 4-5, 6-7… --- */
  const spreads = useMemo(() => {
    const out: number[][] = [[0]];
    for (let i = 1; i < pages.length; i += 2) out.push(pages[i + 1] ? [i, i + 1] : [i]);
    return out;
  }, [pages]);
  const spreadCorrente = spreads[Math.min(spread, spreads.length - 1)] ?? [0];

  /* --- offerte già collocate: spariscono dall'elenco a sinistra --- */
  const inserite = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) for (const b of p.blocks) for (const id of b.offerIds ?? []) {
      s.add(id);
      // se l'offerta è finita dentro una voce unita, è collocata anche la voce
      const voce = offers.find((o) => o.offerIds?.includes(id));
      if (voce) s.add(voce.id);
    }
    return s;
  }, [pages]);

  /*
   * L'elenco mostra TUTTE le offerte che passano il filtro, comprese quelle già
   * collocate in una cella (in grigio, "già usata"): sparirle del tutto rendeva
   * difficile capire cosa fosse già stato piazzato. Restano trascinabili, utile
   * per rimetterne una in una seconda cella (es. la stessa offerta su due pagine).
   */
  /*
   * L'elenco a sinistra segue la scheda aperta: mostra le offerte destinate alle
   * pagine visibili più quelle ancora senza pagina (escluse le "no volantino"),
   * che sono le uniche che ha senso collocare qui e ora.
   */
  const idPagineVisibili = useMemo(
    () => new Set((vista === "verticale" ? pages.map((_, i) => i) : spreadCorrente).map((pi) => pages[pi]?.id).filter(Boolean) as string[]),
    [spreadCorrente, pages, vista]
  );
  /** Le pagine visibili coprono questa destinazione? Una pagina precisa, oppure un animale di una delle pagine. */
  const destinazioneVisibile = (paginaId: string) => {
    const a = animaleDi(paginaId);
    if (a) return pages.some((p) => idPagineVisibili.has(p.id) && p.animale === a);
    return idPagineVisibili.has(paginaId);
  };

  const disponibili = useMemo(() => offers.filter((o) => {
    // le offerte marcate "no volantino" restano fuori, salvo richiesta esplicita
    if (o.paginaId === NO_VOLANTINO && !mostraScartate) return false;
    if (f.pagina) {
      // filtro per destinazione: una pagina precisa, un animale («Cane, da collocare»), senza pagina
      if (f.pagina === "_nessuna" ? Boolean(o.paginaId) : o.paginaId !== f.pagina) return false;
    } else if (soloQuestaPagina) {
      // solo le offerte destinate a queste pagine (pagina precisa o animale della pagina); quelle senza pagina solo se richieste
      if (o.paginaId && o.paginaId !== NO_VOLANTINO ? !destinazioneVisibile(o.paginaId) : !ancheSenzaPagina) return false;
    }
    if (f.animale && !o.caratts.includes(f.animale)) return false;
    if (f.caratt && !o.caratts.includes(f.caratt)) return false;
    if (f.label && o.label !== f.label) return false;
    if (f.minVoti && o.voti < Number(f.minVoti)) return false;
    if (f.minNon && o.nonTrattati < Number(f.minNon)) return false;
    if (f.marca && o.marca !== f.marca) return false;
    if (f.fornitore && o.fornitore !== f.fornitore) return false;
    return true;
  }).sort((a, b) => Number(inserite.has(a.id)) - Number(inserite.has(b.id))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [offers, f, inserite, mostraScartate, soloQuestaPagina, ancheSenzaPagina, idPagineVisibili, pages]);
  const daCollocare = disponibili.filter((o) => !inserite.has(o.id)).length;

  /*
   * Offerte con una pagina assegnata da Offerte in corso ma non ancora collocate:
   * "Disponi per pagina" le mette nelle celle libere della loro pagina; quelle
   * che non ci stanno restano qui e vengono segnalate, perché è una scelta di
   * chi impagina (allargare la griglia, unire celle, spostarne altre).
   */
  const daDisporre = useMemo(
    () => offers.filter((o) => o.paginaId && o.paginaId !== NO_VOLANTINO && !inserite.has(o.id)),
    [offers, inserite]
  );
  /** Riquadri con più di un'offerta: da sparpagliare, una per cella. */
  const celleAffollate = useMemo(
    () => pages.reduce((n, p) => n + p.blocks.filter((b) => (b.offerIds?.length ?? 0) > 1).length, 0),
    [pages]
  );

  const upd = (fn: (p: VolPage[]) => VolPage[]) => setPages((prev) => fn(structuredClone(prev)).map(normalizza));
  const offer = (id?: string) => offers.find((o) => o.id === id) ?? offers.find((o) => !!id && o.offerIds?.includes(id));
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
  /** Il focus alle offerte della cella aperta e di quelle scelte con Ctrl/Maiusc; se richiesto anche il colore di sfondo. */
  const applicaFocus = async (nome: string) => {
    if (!sel) return;
    const celle = [sel, ...extra];
    const voci = celle.flatMap((c) => (pages[c.pi]?.blocks.find((b) => b.id === c.id)?.offerIds ?? []).map(offer).filter(Boolean) as OffLite[]);
    const ids = [...new Set(voci.flatMap((o) => o.offerIds ?? [o.id]))];
    if (ids.length === 0 && !colora) return flash("Nelle celle scelte non ci sono offerte.");
    const r = ids.length ? await assegnaFocusOfferte(campaignId, ids, nome).catch(() => ({ ok: false as const, colore: undefined })) : { ok: true, colore: focusDisponibili.find((f) => f.nome === nome)?.colore };
    if (!r.ok) return flash("Focus non salvato.");
    for (const o of voci) sovrascrivi(o.id, { focus: nome || undefined });
    if (colora) {
      const colore = nome ? (r.colore ?? focusDisponibili.find((f) => f.nome === nome)?.colore) : undefined;
      upd((ps) => { for (const c of celle) { const b = ps[c.pi]?.blocks.find((x) => x.id === c.id); if (b) b.bg = colore; } return ps; });
    }
    setFocusNuovo("");
    if (nome && !focusDisponibili.some((f) => f.nome === nome)) router.refresh(); // il focus nuovo entra nell'elenco
    flash(nome ? `Focus «${nome}» su ${celle.length} ${celle.length === 1 ? "cella" : "celle"}.` : `Focus tolto da ${celle.length} ${celle.length === 1 ? "cella" : "celle"}.`);
  };
  /** Dalla tessera a sinistra: cambia la destinazione (pagina precisa, animale, no volantino) e la applica subito. */
  const cambiaDestinazione = async (o: OffLite, v: string) => {
    const prima = o.paginaId;
    sovrascrivi(o.id, { paginaId: v || undefined });
    const r = await updateOfferGroupFieldInline(o.offerIds ?? [o.id], "paginaId", v).catch(() => ({ ok: false }));
    if (!r.ok) { sovrascrivi(o.id, { paginaId: prima }); flash("Pagina non salvata."); }
  };
  const nomeDestinazione = (paginaId?: string) => {
    if (!paginaId) return "da assegnare";
    if (paginaId === NO_VOLANTINO) return "no volantino";
    const a = animaleDi(paginaId);
    if (a) return `${a} · da collocare`;
    const i = pages.findIndex((p) => p.id === paginaId);
    return i >= 0 ? `Pag. ${i + 1}${pages[i].titolo ? ` ${pages[i].titolo}` : ""}` : "?";
  };

  /**
   * Genera il PDF del volantino (una pagina per foglio, come "Esporta PDF" ma
   * automatico e su tutte le pagine) e lo carica su Supabase Storage, poi
   * scarica lo ZIP: la route dello ZIP lo trova già lì e lo include. Le pagine
   * "solo per la stampa" esistono già nel DOM (le usa anche @media print) ma
   * sono `display: none` fuori stampa: le si rende visibili solo per la
   * cattura, poi si torna come prima.
   */


  /*
   * Unisce le voci spuntate in una sola voce del volantino, "a partire da" il
   * prezzo più basso. Solo volantino: i padri restano quelli, e in stampa
   * ogni prezzo ha il suo cartello.
   */
  // pannello di unione: titolo e foto da tenere
  const [unione, setUnione] = useState<{ titolo: string; foto: string[]; disponibili: string[] } | null>(null);
  const unisciVoci = () => {
    if (vociDaUnire.length < 2) return;
    const scelte = offers.filter((o) => vociDaUnire.includes(o.id));
    const disponibili = [...new Set(scelte.flatMap((o) => o.fotoUnione ?? [o.foto]).filter((u) => u && !u.endsWith("/mancante.jpg")))];
    setUnione({ titolo: scelte[0].padre ?? scelte[0].descrizione, foto: disponibili.slice(0, 1), disponibili });
  };
  const confermaUnione = async () => {
    if (!unione) return;
    const scelte = offers.filter((o) => vociDaUnire.includes(o.id));
    const res = await unisciVociVolantino(scelte.flatMap((o) => o.offerIds ?? [o.id]), {
      titolo: unione.titolo.trim() || undefined, prezzo: "minimo", foto: unione.foto.length ? unione.foto : undefined,
    });
    if (res.ok) { setVociDaUnire([]); setUnione(null); router.refresh(); flash("Voci unite: una sola voce nel volantino, «a partire da» il prezzo più basso."); }
    else flash(res.error ?? "Unione non riuscita.");
  };
  const separaVoce = async (unione: string) => {
    if (!confirm("Separare di nuovo le voci unite?")) return;
    const res = await separaUnioneVolantino(unione);
    if (res.ok) router.refresh();
    else flash(res.error ?? "Non riuscito.");
  };

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

  /**
   * Riempie le celle libere di ogni pagina con le offerte assegnate a quella
   * pagina: UNA offerta per cella, mai due nello stesso riquadro. Se la pagina
   * ha una tipologia impostata (animale/caratteristica), a parità di condizioni
   * vengono prima le offerte che le corrispondono.
   */
  const disponiPerPagina = () => {
    if (daDisporre.length === 0) return flash("Nessuna offerta con una pagina assegnata da collocare.");
    let messe = 0;
    upd((ps) => {
      const gia = new Set<string>();
      for (const page of ps) {
        // la pagina precisa, oppure l'animale della pagina («animale:Cane» va su tutte le pagine Cane, in ordine)
        let perQuesta = ordinaPerVicinanza(daDisporre.filter((o) => !gia.has(o.id) && (o.paginaId === page.id || (page.animale !== undefined && animaleDi(o.paginaId) === page.animale))));
        if (page.animale || page.caratt) {
          const corrisponde = (o: OffLite) =>
            (!page.animale || o.caratts.includes(page.animale)) && (!page.caratt || o.caratts.includes(page.caratt));
          perQuesta = [...perQuesta.filter(corrisponde), ...perQuesta.filter((o) => !corrisponde(o))];
        }
        if (perQuesta.length === 0) continue;
        // celle libere in ordine di lettura, così i gruppi restano adiacenti
        const libere = page.blocks.filter(vuoto).sort((a, b) => a.r - b.r || a.c - b.c);
        for (let i = 0; i < Math.min(libere.length, perQuesta.length); i++) {
          libere[i].offerIds = [perQuesta[i].id];
          gia.add(perQuesta[i].id);
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

  /** Sparpaglia le celle con più offerte: una sola per riquadro, il resto torna a sinistra. */
  const unaPerCella = () => {
    let liberate = 0;
    upd((ps) => {
      for (const page of ps) {
        for (const b of page.blocks) {
          if ((b.offerIds?.length ?? 0) > 1) {
            liberate += b.offerIds!.length - 1;
            b.offerIds = [b.offerIds![0]];
          }
        }
      }
      return ps;
    });
    flash(liberate > 0
      ? `${liberate} offerte tolte dai riquadri con più prodotti: sono tornate nell'elenco a sinistra.`
      : "Ogni riquadro contiene già una sola offerta.");
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
          .map((c) => ({ c, o: offer((c.offerIds ?? [])[0]) }))
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
      if (b.c + b.cs >= (b.rs > 1 ? page.cols : colonneRiga(page, b.r))) return flash("Non c'è spazio a destra: la cella tocca già il bordo della pagina.");
      for (let r = b.r; r < b.r + b.rs; r++) {
        const t = page.blocks.find((x) => x.r === r && x.c === b.c + b.cs);
        if (!t || t.rs > 1 || t.cs > 1) return flash("A destra c'è una cella già unita: separala prima.");
        target.push(t);
      }
    } else {
      if (b.r + b.rs >= page.rows) return flash("Non c'è spazio sotto: la cella tocca già il fondo della pagina.");
      if (colonneRiga(page, b.r) !== page.cols || colonneRiga(page, b.r + b.rs) !== page.cols) return flash("In verticale si uniscono solo righe con il numero di celle della pagina: rimetti le celle della riga come le altre.");
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

  /** Toglie una cella dalla riga: le altre della riga si allargano e si rinumerano. */
  const eliminaCella = (pi: number, id: string) => {
    const page = pages[pi];
    const b = page.blocks.find((x) => x.id === id);
    if (!b) return;
    if (b.rs > 1 || righeBloccate(page).has(b.r)) return flash("Questa riga ha una cella alta (unita in verticale): separala prima.");
    const n = colonneRiga(page, b.r);
    if (n - b.cs < 1) return flash("È l'unica cella della riga.");
    if (!vuoto(b) && !confirm("La cella non è vuota: il suo contenuto torna nell'elenco a sinistra. Toglierla?")) return;
    upd((ps) => {
      const p = ps[pi];
      p.blocks = p.blocks.filter((x) => x.id !== id);
      let c = 0;
      for (const x of p.blocks.filter((x) => x.r === b.r).sort((a, z) => a.c - z.c)) { x.c = c; c += x.cs; }
      p.colsRiga = { ...(p.colsRiga ?? {}), [String(b.r)]: n - b.cs };
      return ps;
    });
    setSel(null); setExtra([]);
  };
  /** Aggiunge una cella in fondo alla riga (se se n'è tolta una per sbaglio). */
  const aggiungiCella = (pi: number, r: number) => {
    const page = pages[pi];
    if (righeBloccate(page).has(r)) return flash("Questa riga ha una cella alta (unita in verticale): separala prima.");
    const n = colonneRiga(page, r);
    if (n >= 6) return flash("Al massimo 6 celle per riga.");
    upd((ps) => { ps[pi].colsRiga = { ...(ps[pi].colsRiga ?? {}), [String(r)]: n + 1 }; return ps; });
  };

  const separa = (pi: number, id: string, verso: "destra" | "giu") =>
    upd((ps) => { const b = blockOf(ps, pi, id)!; if (verso === "destra") b.cs = 1; else b.rs = 1; return ps; });

  const contenutoDi = (x: VolBlock) => ({
    offerIds: x.offerIds, testo: x.testo, imageUrl: x.imageUrl, label: x.label,
    commento: x.commento, descrizione: x.descrizione, prezzo: x.prezzo, bg: x.bg,
  });
  const VUOTO = { offerIds: undefined, testo: undefined, imageUrl: undefined, label: undefined, commento: undefined, descrizione: undefined, prezzo: undefined, bg: undefined };

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

  const aggiungiSezione = (pi: number, b: VolBlock) => {
    upd((ps) => {
      ps[pi].sezioni = [...(ps[pi].sezioni ?? []), { id: uid("vs"), r: b.r, c: b.c, rs: b.rs, cs: b.cs, bg: "#eaf3e2", titolo: "Sezione" }];
      return ps;
    });
    flash("Sezione creata su questa cella: allargala con → e ↓ qui sotto, o cambiale colore e titolo.");
  };
  const patchSezione = (pi: number, id: string, dati: Partial<VolSection>) => upd((ps) => {
    const s = (ps[pi].sezioni ?? []).find((x) => x.id === id);
    if (s) Object.assign(s, dati);
    return ps;
  });

  const etichettaSpread = (g: number[]) =>
    g[0] === 0 ? "Copertina" : g.length > 1 ? `Pag. ${g[0] + 1}-${g[1] + 1}` : `Pag. ${g[0] + 1}`;

  /* --- riferimento cella: numeroPagina-progressivo (es. 3-4) --- */
  const riferimento = (pi: number, b: VolBlock) => `${pi + 1}-${pages[pi].blocks.findIndex((x) => x.id === b.id) + 1}`;

  /*
   * Celle in più scelte con Ctrl/Maiusc + clic: il focus (e il suo colore) si
   * applica a tutte insieme. La prima resta quella aperta nel pannello.
   */
  const [extra, setExtra] = useState<{ pi: number; id: string }[]>([]);
  const [focusScelto, setFocusScelto] = useState("");
  const [focusNuovo, setFocusNuovo] = useState("");
  const [colora, setColora] = useState(true);
  const selBlock = sel ? pages[sel.pi]?.blocks.find((b) => b.id === sel.id) : undefined;
  const selPage = sel ? pages[sel.pi] : undefined;
  const selOffs = ((selBlock?.offerIds ?? []).map(offer).filter(Boolean) as OffLite[]);

  const renderBlock = (pi: number, b: VolBlock) => {
    const offs = (b.offerIds ?? []).map(offer).filter(Boolean) as OffLite[];
    const isVuoto = vuoto(b);
    const attiva = (sel?.pi === pi && sel?.id === b.id) || extra.some((c) => c.pi === pi && c.id === b.id);
    /*
     * Se la cella sta dentro una sezione, non deve dipingere il proprio fondo
     * bianco: le celle stanno sopra (z-index 1) e coprivano completamente il
     * colore della sezione, che quindi sembrava non venire creata.
     */
    const dentroSezione = (pages[pi].sezioni ?? []).some(
      (s) => b.r >= s.r && b.r < s.r + s.rs && b.c >= s.c && b.c < s.c + s.cs
    );
    return (
      <div
        key={b.id}
        draggable={!isVuoto}
        onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "block", id: b.id, pi }); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => drop(pi, b.id)}
        onClick={(e) => {
          if ((e.ctrlKey || e.metaKey || e.shiftKey) && sel) {
            if (sel.pi === pi && sel.id === b.id) return;
            setExtra((x) => x.some((c) => c.pi === pi && c.id === b.id) ? x.filter((c) => !(c.pi === pi && c.id === b.id)) : [...x, { pi, id: b.id }]);
            return;
          }
          setSel({ pi, id: b.id }); setExtra([]);
        }}
        className={`vol-cell${attiva ? " attiva" : ""}`}
        style={{
          gridColumn: colonnaGriglia(pages[pi], b), gridRow: `${b.r + 1} / span ${b.rs}`,
          border: isVuoto ? "1.5px dashed var(--line)" : "1px solid var(--line)",
          background: b.imageUrl
            ? `center/cover no-repeat url(${b.imageUrl})`
            : b.bg ? b.bg : dentroSezione ? "transparent" : isVuoto ? "rgba(255,255,255,0.5)" : "#fff",
        }}
      >
        <span className="vol-rif no-print">{riferimento(pi, b)}</span>
        {b.label && <span className="vol-label">{b.label}</span>}
        {offs.length > 0 && (
          <div style={{ display: "grid", gap: 2, gridTemplateColumns: offs.length > 1 ? "1fr 1fr" : "1fr", textAlign: "center" }}>
            {offs.map((o, i) => (
              <div key={`${o.id}_${i}`} style={{ minWidth: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {o.fotoUnione && o.fotoUnione.length > 1
                  ? <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>{o.fotoUnione.map((u) => <img key={u} src={u} alt="" style={{ maxWidth: `${100 / o.fotoUnione!.length}%`, height: b.rs > 1 ? 58 : 32, objectFit: "contain" }} />)}</div>
                  : <img src={o.fotoUnione?.[0] ?? o.foto} alt="" style={{ maxWidth: "100%", height: b.rs > 1 ? 58 : 32, objectFit: "contain" }} />}
                {o.padre && <div style={{ fontWeight: 800, fontSize: 9.5, lineHeight: 1.15 }}>{o.padre}</div>}
                <div style={{ fontWeight: o.padre ? 500 : 600, fontSize: o.padre ? 8.5 : 9.5, lineHeight: 1.15, color: o.padre ? "#555" : undefined }}>
                  {(i === 0 ? b.descrizione : undefined) ?? o.descrizione}
                </div>
                <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "baseline", flexWrap: "wrap" }}>
                  {o.prezzoTesto && !(i === 0 && b.prezzo)
                    ? <span style={{ color: "#c2410c", fontWeight: 800, fontSize: 11 }}>{o.prezzoTesto}</span>
                    : ((i === 0 ? b.prezzo : undefined) ?? o.prezzo)
                    ? <span style={{ color: "#c2410c", fontWeight: 800, fontSize: 12 }}>{o.aPartireDa && !(i === 0 && b.prezzo) ? "a partire da " : ""}€ {(i === 0 ? b.prezzo : undefined) ?? o.prezzo}</span>
                    : <span className="no-print" style={{ color: "#b45309", fontSize: 9 }}>prezzo da definire</span>}
                  {o.prezzoListino && (
                    <span style={{ fontSize: 9, color: "#777", textDecoration: "line-through" }}>€ {o.prezzoListino}</span>
                  )}
                  {o.sconto && <span style={{ fontSize: 9, fontWeight: 700, color: "#15803d" }}>{o.sconto}</span>}
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
      <div key={page.id} className="vol-page-wrap" id={`vol-pag-${pi}`}>
        {/* due righe volute: sopra numero + nome, sotto tipologia e griglia — così
            i controlli non vanno mai a capo a metà su una colonna da 430px */}
        <div className="no-print vol-page-tools">
          <div className="vol-page-tools-riga">
            <span className="vol-numero">Pag. {pi + 1}</span>
            <input value={page.titolo ?? ""} placeholder="nome pagina"
              onChange={(e) => upd((ps) => { ps[pi].titolo = e.target.value; return ps; })}
              style={{ marginTop: 0, flex: 1, minWidth: 0, fontWeight: 700, fontSize: 12 }} />
            {pages.length > 1 && (
              <button className="mini-btn" style={{ color: "var(--red)" }} title="Elimina pagina"
                onClick={() => confirm(`Eliminare la pagina ${pi + 1}?`) && upd((ps) => ps.filter((_, i) => i !== pi))}>✕</button>
            )}
          </div>
          <div className="vol-page-tools-riga">
            {/* tipologia della pagina: guida la disposizione automatica delle offerte */}
            <select value={page.animale ?? ""} title="Tipologia di animale della pagina"
              onChange={(e) => upd((ps) => { ps[pi].animale = e.target.value || undefined; return ps; })}
              style={{ marginTop: 0, flex: 1, minWidth: 0, fontSize: 11 }}>
              <option value="">— animale —</option>
              {animali.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={page.caratt ?? ""} title="Caratteristica di prodotto della pagina"
              onChange={(e) => upd((ps) => { ps[pi].caratt = e.target.value || undefined; return ps; })}
              style={{ marginTop: 0, flex: 1, minWidth: 0, fontSize: 11 }}>
              <option value="">— caratteristica —</option>
              {caratts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="vol-griglia">
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>griglia</span>
              <select value={page.cols} onChange={(e) => upd((ps) => { ps[pi].cols = Number(e.target.value); return ps; })} style={{ marginTop: 0, fontSize: 11 }}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span style={{ fontSize: 10.5 }}>×</span>
              <select value={page.rows} onChange={(e) => upd((ps) => { ps[pi].rows = Number(e.target.value); return ps; })} style={{ marginTop: 0, fontSize: 11 }}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </span>
          </div>
        </div>

        <div className="vol-page" style={{ gridTemplateColumns: colonneGriglia(), gridTemplateRows: `repeat(${page.rows}, 1fr)` }}>
          {(page.sezioni ?? []).map((s) => (
            <div key={s.id} className="vol-sezione"
              style={{ gridColumn: colonnaSezione(page, s), gridRow: `${s.r + 1} / span ${s.rs}`, background: s.bg }}>
              {s.testo && <div className="vol-sezione-testo">{s.testo}</div>}
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
    <div className="vol-layout" style={{ ["--vol-sx" as string]: `${larghezzaSx}px` }}>
      {/* ---------- colonna sinistra: filtro + offerte disponibili ---------- */}
      <aside className="vol-filtro no-print" onDragOver={(e) => e.preventDefault()} onDrop={dropSuElenco}>
        <span className="vol-maniglia" title="Trascina per allargare o stringere l'elenco"
          onPointerDown={(e) => {
            e.preventDefault();
            const x0 = e.clientX; const w0 = larghezzaSx;
            const muovi = (m: PointerEvent) => setLarghezzaSx(Math.max(220, Math.min(760, w0 + m.clientX - x0)));
            const su = () => { document.removeEventListener("pointermove", muovi); document.removeEventListener("pointerup", su); };
            document.addEventListener("pointermove", muovi); document.addEventListener("pointerup", su);
          }} />
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
              <label className="field">Destinazione
                <select value={f.pagina} onChange={(e) => setF({ ...f, pagina: e.target.value })}>
                  <option value="">Tutte (secondo la scheda aperta)</option>
                  {animali.map((a) => <option key={a} value={`${ANIMALE_PREFISSO}${a}`}>{a} · da collocare</option>)}
                  {pages.map((p, i) => <option key={p.id} value={p.id}>Pag. {i + 1}{p.titolo ? ` ${p.titolo}` : ""}</option>)}
                  <option value="_nessuna">senza pagina</option>
                  <option value={NO_VOLANTINO}>no volantino</option>
                </select>
              </label>
              <label style={{ fontSize: 11.5, display: "block", marginBottom: 4 }}>
                <input type="checkbox" checked={soloQuestaPagina} onChange={(e) => setSoloQuestaPagina(e.target.checked)} />{" "}
                solo le offerte scelte per queste pagine (in Scelta offerte Volantino)
              </label>
              {soloQuestaPagina && (
                <label style={{ fontSize: 11.5, display: "block", marginBottom: 4, paddingLeft: 18 }}>
                  <input type="checkbox" checked={ancheSenzaPagina} onChange={(e) => setAncheSenzaPagina(e.target.checked)} />{" "}
                  anche quelle senza pagina
                </label>
              )}
              <label style={{ fontSize: 11.5, display: "block", marginBottom: 8 }}>
                <input type="checkbox" checked={mostraScartate} onChange={(e) => setMostraScartate(e.target.checked)} />{" "}
                mostra offerte non selezionate (&quot;no volantino&quot;)
              </label>
              <button className="btn btn-outline btn-sm" type="button" style={{ width: "100%" }}
                onClick={() => setF({ animale: "", caratt: "", label: "", minVoti: "", minNon: "", marca: "", fornitore: "", pagina: "" })}>
                Azzera filtri
              </button>
            </div>
          )}
        </div>

        <div className="vol-filtro-scroll">
        <div className="vol-filtro-head">
          Da collocare ({daCollocare})
          {inserite.size > 0 && <span className="pill pill-green" style={{ marginLeft: 6 }}>{inserite.size} già nel volantino</span>}
          <button type="button" className={`btn btn-sm${vociDaUnire.length >= 2 ? "" : " btn-outline"}`} style={{ marginLeft: "auto" }} onClick={unisciVoci}
            disabled={vociDaUnire.length < 2}
            title="Spunta due o più tessere: diventano una voce sola nel volantino, «a partire da» il prezzo più basso. I cartelli restano separati.">
            Unisci nel volantino{vociDaUnire.length >= 2 ? ` (${vociDaUnire.length})` : ""}
          </button>
        </div>
        {unione && (
          <div className="vol-unione">
            <strong style={{ fontSize: 12.5 }}>Unisci {vociDaUnire.length} voci nel volantino</strong>
            <p className="hint" style={{ margin: "2px 0 6px", fontSize: 11 }}>Solo per il volantino: i cartelli restano separati per prezzo.</p>
            <label className="field" style={{ marginBottom: 6 }}>Titolo della voce unita
              <input value={unione.titolo} onChange={(e) => setUnione({ ...unione, titolo: e.target.value })} />
            </label>
            <SceltaFoto disponibili={unione.disponibili} scelte={unione.foto} onChange={(foto) => setUnione({ ...unione, foto })} />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={confermaUnione}>Unisci</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setUnione(null)}>Annulla</button>
            </div>
          </div>
        )}
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
              <div className="vol-off-corpo">
                <input type="checkbox" title="Spunta due o più voci per unirle nel volantino («a partire da»)"
                  checked={vociDaUnire.includes(o.id)}
                  onChange={(e) => setVociDaUnire((prev) =>
                    e.target.checked ? [...prev, o.id] : prev.filter((id) => id !== o.id))} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="vol-off-foto" src={o.foto} alt="" />
                <div style={{ minWidth: 0 }}>
                  <div className="vol-off-titolo">{o.padre ?? o.descrizione}</div>
                  {o.padre && <div className="vol-off-descr">{o.descrizione}</div>}
                  <div className="vol-off-prezzo">
                    {o.prezzoTesto ? <strong>{o.prezzoTesto}</strong> : o.prezzo ? <strong>{`${o.aPartireDa ? "a partire da " : ""}€ ${o.prezzo}`}</strong> : <span className="pill pill-amber">prezzo da definire</span>}
                    {o.prezzoListino && <span style={{ textDecoration: "line-through" }}>€ {o.prezzoListino}</span>}
                    {o.sconto && <span className="pill pill-green">{o.sconto}</span>}
                  </div>
                </div>
              </div>
              {/* sotto, a tutta larghezza: niente spazio vuoto sotto la foto */}
              <div className="vol-off-meta">
                {/* «prezzo barrato» non serve: si vede dal prezzo; restano 3x2 e le altre tipologie */}
                {(o.tipi ?? []).filter((t) => t !== "prezzo barrato").map((t) => <span key={t} className="pill pill-blue">{t}</span>)}
                {o.unione && (
                  <button type="button" className="mini-btn" title="Voci unite solo per il volantino" onClick={() => separaVoce(o.unione!)}>unite · separa</button>
                )}
                {usata && <span className="pill pill-gray">già usata</span>}
                {o.animale && <span className="pill pill-green" title="animale">{o.animale}</span>}
                {o.caratt && <span className="pill pill-gray" title="caratteristica">{o.caratt}</span>}
                {o.voti > 0 && <span className="pill pill-green">{o.voti} voti</span>}
                {o.nonTrattati > 0 && <span className="pill pill-red">{o.nonTrattati} n.t.</span>}
                {o.label && <span className="pill pill-blue">{o.label}</span>}
                {o.focus && <span className="pill pill-gray" title="focus">{o.focus}</span>}
                {o.articoli.length > 0 && (
                  <button type="button" className="mini-btn" onClick={() => setDettaglio(dettaglio === o.id ? null : o.id)}>
                    {dettaglio === o.id ? "nascondi" : o.articoli.length === 1 ? "1 articolo" : `${o.articoli.length} articoli`}
                  </button>
                )}
              </div>
              {/* destinazione: le pagine dell'animale come pulsanti, «no», e la tendina per le altre */}
              <div className="vol-off-pagine" onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const proposte = pages.map((p, i) => ({ p, i })).filter(({ p }) => p.animale && (o.animali ?? (o.animale ? [o.animale] : [])).includes(p.animale));
                  const altre = pages.map((p, i) => ({ p, i })).filter(({ p }) => !proposte.some((x) => x.p.id === p.id));
                  return (
                    <>
                      {animaleDi(o.paginaId) && <span className="pill pill-green" title="Scelta per animale in Scelta offerte: scegli qui la pagina precisa">{animaleDi(o.paginaId)} · da collocare</span>}
                      {proposte.map(({ p, i }) => (
                        <button key={p.id} type="button" className={`pagina-btn${o.paginaId === p.id ? " attiva" : ""}`}
                          onClick={() => cambiaDestinazione(o, o.paginaId === p.id ? (o.animale ? `${ANIMALE_PREFISSO}${o.animale}` : "") : p.id)}
                          title={`Pag. ${i + 1}${p.titolo ? ` ${p.titolo}` : ""}`}>
                          {o.paginaId === p.id ? "✓ " : ""}{i + 1}{p.titolo ? ` ${p.titolo}` : ""}
                        </button>
                      ))}
                      <button type="button" className={`pagina-btn no${o.paginaId === NO_VOLANTINO ? " attiva" : ""}`}
                        onClick={() => cambiaDestinazione(o, o.paginaId === NO_VOLANTINO ? "" : NO_VOLANTINO)}>✕ no</button>
                      <select value={altre.some(({ p }) => p.id === o.paginaId) ? o.paginaId : ""} onChange={(e) => cambiaDestinazione(o, e.target.value)}
                        className="vol-dest" title="Un'altra pagina">
                        <option value="">altra…</option>
                        {altre.map(({ p, i }) => <option key={p.id} value={p.id}>Pag. {i + 1}{p.titolo ? ` ${p.titolo}` : ""}</option>)}
                        {animali.map((a) => <option key={a} value={`${ANIMALE_PREFISSO}${a}`}>{a} · da collocare</option>)}
                      </select>
                    </>
                  );
                })()}
              </div>
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
            <button type="button" className="btn btn-outline btn-sm" title="Torna alla pagina precedente" onClick={() => history.back()}>
              <ArrowLeft size={14} style={{ verticalAlign: -2 }} /> Indietro
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setVista(vista === "schede" ? "verticale" : "schede")}
              title={vista === "schede" ? "Tutte le pagine una sotto l'altra: si scorre con la rotellina" : "Torna alle schede affiancate"}>
              {vista === "schede" ? <Rows3 size={14} style={{ verticalAlign: -2 }} /> : <Columns2 size={14} style={{ verticalAlign: -2 }} />}
              {" "}{vista === "schede" ? "Pagine in verticale" : "Schede affiancate"}
            </button>
            {spreads.map((g, i) => (
              <button key={i} type="button" className={`vol-tab${i === spread ? " attiva" : ""}`}
                onClick={() => { setSpread(i); setSel(null); if (vista === "verticale") document.getElementById(`vol-pag-${g[0]}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
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
            {daDisporre.length > 0 && (
              <button className="btn btn-sm" type="button" onClick={disponiPerPagina}
                title="Colloca nelle pagine le offerte a cui è già stata assegnata una pagina in Offerte in corso">
                Disponi per pagina ({daDisporre.length})
              </button>
            )}
            <button className="btn btn-outline btn-sm" type="button" onClick={avvicinaSimili}
              title="Riordina le offerte già collocate mettendo vicine quelle con stessa etichetta o focus">
              Avvicina simili
            </button>
            {celleAffollate > 0 && (
              <button className="btn btn-outline btn-sm" type="button" onClick={unaPerCella}
                title="Lascia una sola offerta per riquadro: le altre tornano nell'elenco a sinistra">
                Una per riquadro ({celleAffollate})
              </button>
            )}
            <button className="btn btn-outline btn-sm" title="Aggiungi pagina" aria-label="Aggiungi pagina" onClick={() => upd((ps) => [...ps, pagina("")])}>
              <Plus size={14} style={{ verticalAlign: -2 }} />
            </button>
          </div>
        </div>

        {avviso && <div className="alert alert-amber no-print">{avviso}</div>}

        {vista === "verticale"
          ? <div className="vol-verticale">{pages.map((_, pi) => renderPage(pi))}</div>
          : <div className="vol-spread">{spreadCorrente.map((pi) => renderPage(pi))}</div>}

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
              {extra.length > 0 && <span className="pill pill-blue">+{extra.length} celle</span>}
              <button className="mini-btn" onClick={() => { setSel(null); setExtra([]); }}>Chiudi</button>
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
            <div className="vol-side-riga" title="Righe con un numero di celle diverso: le celle che restano si allargano da sole">
              <span style={{ fontSize: 11.5 }}>Riga: {colonneRiga(selPage, selBlock.r)} celle</span>
              <button className="btn btn-outline btn-sm" onClick={() => eliminaCella(sel!.pi, selBlock.id)}>− Togli questa cella</button>
              <button className="btn btn-outline btn-sm" onClick={() => aggiungiCella(sel!.pi, selBlock.r)}>+ Cella sulla riga</button>
            </div>

            {/* un'altra offerta nello stesso riquadro: solo per il volantino, i padri non cambiano */}
            <label className="field" style={{ marginTop: 8 }}>
              {selOffs.length ? "Aggiungi un'altra offerta in questo riquadro" : "Metti un'offerta in questo riquadro"}
              <select key={`agg_${selBlock.id}_${(selBlock.offerIds ?? []).length}`} defaultValue="" onChange={(e) => {
                const id = e.target.value; if (!id) return;
                patch(sel!.pi, selBlock.id, { offerIds: [...(selBlock.offerIds ?? []), id] });
              }}>
                <option value="">— scegli un'offerta —</option>
                {offers.filter((o) => !inserite.has(o.id) && o.paginaId !== NO_VOLANTINO).map((o) => (
                  <option key={o.id} value={o.id}>{o.padre ?? o.descrizione}{o.prezzo ? ` · € ${o.prezzo}` : ""}</option>
                ))}
              </select>
              <span className="hint" style={{ fontSize: 10.5 }}>oppure trascina un&apos;offerta dall&apos;elenco sopra questa cella</span>
            </label>
            {selOffs.length > 0 && (
              <>
                <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "10px 0" }} />
                <strong style={{ fontSize: 12.5 }}>Offerte nella cella ({selOffs.length})</strong>
                {selOffs.map((o, i) => (
                  <div key={`${o.id}_${i}`} style={{ margin: "4px 0", fontSize: 11.5 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={o.foto} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <strong>{o.padre ?? o.descrizione}</strong>
                        {o.padre && <span style={{ color: "var(--muted)" }}> · {o.descrizione}</span>}
                      </span>
                      <button className="mini-btn" title="Togli dalla cella (torna nell'elenco)"
                        onClick={() => patch(sel!.pi, selBlock.id, { offerIds: (selBlock.offerIds ?? []).filter((_, j) => j !== i) })}>✕</button>
                    </div>
                    {o.articoli.length > 0 && (
                      <details style={{ marginLeft: 30, marginTop: 2 }}>
                        <summary style={{ cursor: "pointer", fontSize: 10.5, color: "var(--green-700)" }}>
                          {o.articoli.length > 1 ? `${o.articoli.length} articoli inclusi` : "1 articolo"}
                        </summary>
                        <ul style={{ margin: "2px 0 0", paddingLeft: 14, fontSize: 10.5, color: "var(--muted)" }}>
                          {o.articoli.map((a) => <li key={a.ean}>{a.descrizione} · {a.ean}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
                {/* il titolo appartiene al prodotto padre: si salva nel database, non solo qui */}
                {selOffs[0].padreId && (
                  <label className="field">
                    Titolo del prodotto padre <span className="hint" style={{ fontWeight: 400 }}>(vale ovunque)</span>
                    <input key={`t_${selOffs[0].padreId}`} defaultValue={selOffs[0].padre ?? ""}
                      onBlur={async (e) => {
                        const v = e.target.value.trim();
                        if (!v || v === selOffs[0].padre) return;
                        const res = await updateParentFieldInline(selOffs[0].padreId!, "nome", scopeParam, v);
                        if (res.ok) { for (const o of offers) if (o.padreId === selOffs[0].padreId) sovrascrivi(o.id, { padre: v }); flash("Titolo salvato."); }
                        else flash("Titolo non salvato.");
                      }} />
                  </label>
                )}
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
                      const d = selBlock.descrizione ?? selOffs[0].descrizione; const p = selBlock.prezzo ?? selOffs[0].prezzo;
                      await updateZooOfferQuick(selOffs[0].id, d, p);
                      sovrascrivi(selOffs[0].id, { descrizione: d, prezzo: p });
                      patch(sel!.pi, selBlock.id, { descrizione: undefined, prezzo: undefined });
                      flash("Salvato nel database: la descrizione e il prezzo valgono ovunque.");
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
            {/* focus: alle offerte di questa cella e di quelle scelte con Ctrl/Maiusc + clic, con il suo colore */}
            <div className="vol-focus-box">
              <strong style={{ fontSize: 12.5 }}>Focus</strong>
              <span className="hint" style={{ display: "block", fontSize: 11 }}>
                {extra.length ? `Vale per ${extra.length + 1} celle (Ctrl o Maiusc + clic per aggiungerne o toglierne).` : "Ctrl o Maiusc + clic su altre celle per applicarlo a più tessere insieme."}
              </span>
              {selOffs[0]?.focus && <span className="pill pill-blue" style={{ margin: "4px 0", display: "inline-block" }}>attuale: {selOffs[0].focus}</span>}
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <select value={focusScelto} onChange={(e) => setFocusScelto(e.target.value)} style={{ marginTop: 0, flex: 1, minWidth: 0, fontSize: 12 }}>
                  <option value="">— scegli un focus —</option>
                  {focusDisponibili.map((f) => <option key={f.nome} value={f.nome}>{f.nome}</option>)}
                </select>
                <button type="button" className="btn btn-sm" disabled={!focusScelto} onClick={() => applicaFocus(focusScelto)}>Applica</button>
              </div>
              {focusScelto && focusDisponibili.find((f) => f.nome === focusScelto)?.descrizione && (
                <p className="hint" style={{ margin: "4px 0 0", fontSize: 11, whiteSpace: "pre-line" }}>{focusDisponibili.find((f) => f.nome === focusScelto)!.descrizione}</p>
              )}
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <input value={focusNuovo} onChange={(e) => setFocusNuovo(e.target.value)} placeholder="oppure un focus nuovo…" style={{ marginTop: 0, flex: 1, minWidth: 0, fontSize: 12 }} />
                <button type="button" className="btn btn-outline btn-sm" disabled={!focusNuovo.trim()} onClick={() => applicaFocus(focusNuovo.trim())}>Crea</button>
              </div>
              <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, marginTop: 4 }}>
                <input type="checkbox" checked={colora} onChange={(e) => setColora(e.target.checked)} /> colora lo sfondo con il colore del focus
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                {selOffs.some((o) => o.focus) && <button type="button" className="mini-btn" onClick={() => applicaFocus("")}>togli il focus</button>}
                <span style={{ fontSize: 11 }}>sfondo cella</span>
                <input type="color" value={selBlock.bg ?? "#ffffff"} onChange={(e) => { const v = e.target.value; upd((ps) => { for (const c of [sel!, ...extra]) { const b = ps[c.pi]?.blocks.find((x) => x.id === c.id); if (b) b.bg = v; } return ps; }); }}
                  style={{ width: 30, height: 22, padding: 0, marginTop: 0 }} title="Colore di sfondo della cella (e delle celle scelte)" />
                {selBlock.bg && <button type="button" className="mini-btn" onClick={() => upd((ps) => { for (const c of [sel!, ...extra]) { const b = ps[c.pi]?.blocks.find((x) => x.id === c.id); if (b) b.bg = undefined; } return ps; })}>togli sfondo</button>}
              </div>
            </div>
            <label className="field">Testo (anche sopra l&apos;immagine)
              <textarea key={`t_${selBlock.id}_${selBlock.testo ?? ""}`} rows={2} defaultValue={selBlock.testo ?? ""}
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
              <div key={s.id} style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input value={s.titolo ?? ""} onChange={(e) => patchSezione(sel!.pi, s.id, { titolo: e.target.value })}
                    placeholder="Titolo" style={{ marginTop: 0, flex: 1, fontSize: 11 }} />
                  <input type="color" value={s.bg} onChange={(e) => patchSezione(sel!.pi, s.id, { bg: e.target.value })}
                    style={{ marginTop: 0, width: 30, height: 26, padding: 0 }} />
                  <button className="mini-btn" title="Allarga a destra" onClick={() => patchSezione(sel!.pi, s.id, { cs: Math.min(s.cs + 1, selPage.cols - s.c) })}>→</button>
                  <button className="mini-btn" title="Allarga in basso" onClick={() => patchSezione(sel!.pi, s.id, { rs: Math.min(s.rs + 1, selPage.rows - s.r) })}>↓</button>
                  <button className="mini-btn" title="Elimina sezione"
                    onClick={() => upd((ps) => { ps[sel!.pi].sezioni = (ps[sel!.pi].sezioni ?? []).filter((x) => x.id !== s.id); return ps; })}>✕</button>
                </div>
                <textarea key={`stx_${s.id}`} rows={2} defaultValue={s.testo ?? ""} placeholder="Testo del gruppo (es. presentazione, promo dedicata…)"
                  onBlur={(e) => patchSezione(sel!.pi, s.id, { testo: e.target.value || undefined })}
                  style={{ marginTop: 4, fontSize: 11, width: "100%" }} />
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
