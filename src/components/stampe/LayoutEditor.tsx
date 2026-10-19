"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { Cornice, LayoutItem, LayoutMargins, PrintField, PrintFormat, StickerStyle } from "@/lib/stampe";
import { LAYOUT_FONTS, layoutFontCss } from "@/lib/layout-fonts";
import { saveLayout } from "@/lib/stampe-actions";
import { saveZooLayout } from "@/lib/zoo-actions";
import { applicaCampoATuttiILayout } from "@/lib/layout-actions";
import { copiaStileCampo } from "@/lib/layout-pulizia";
import { ELEMENTO_IMMAGINE, ELEMENTO_QR, ELEMENTO_RIQUADRO, DESCRIZIONI_CAMPI } from "@/lib/cartello-campi";
import QrSvg from "./QrSvg";
import {
  CorniceCampo, effettiTesto, Prezzo, alignPrezzo, bordoRiquadro, coloreCampo, conPrefisso, isPrezzoField, justifyPrezzo,
  stileStickerCartello, stileTestoCartello, testoStampato,
} from "./cartelloStyle";

/** Icone pronte per il titolo di un riquadro: quelle del cartello Garden Team più qualche altra. */
const ICONE_TITOLO = ["✳", "m", "C", "▣", "☘", "★", "!", "i", "€", "✓"];

/** Riquadro del pannello di destra richiudibile, per non dover scorrere fra tante sezioni aperte. */
function Sezione({
  titolo, aperta = true, children,
}: {
  titolo: string;
  aperta?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={aperta} style={{ borderBottom: "1.5px dashed var(--line)", paddingBottom: 10, marginBottom: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14, padding: "2px 0", listStyle: "revert" }}>
        {titolo}
      </summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}

/** Un comando di tutto il layout (nome, foglio, quando usarlo…): pulsante nella barra in alto che apre una finestrella. */
/**
 * Finestrella a comparsa della barra. Si apre sotto il pulsante e, se uscirebbe
 * dallo schermo (a destra o a sinistra), si sposta quanto basta per starci.
 */
function Finestrella({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  const corpo = useRef<HTMLDivElement>(null);
  const sistema = (aperta: boolean) => {
    const el = corpo.current;
    if (!el) return;
    el.style.left = "0px";
    if (!aperta) return;
    const r = el.getBoundingClientRect();
    const margine = 8;
    let sposta = 0;
    if (r.right > window.innerWidth - margine) sposta = window.innerWidth - margine - r.right;
    if (r.left + sposta < margine) sposta = margine - r.left;
    el.style.left = `${sposta}px`;
  };
  return (
    <details className="editor-pop" onToggle={(e) => sistema((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="btn btn-outline btn-sm">{titolo} ▾</summary>
      <div ref={corpo} className="editor-pop-corpo">{children}</div>
    </details>
  );
}

/** Colori pronti per i testi del cartello: quelli di casa Garden Team più i neutri. */
const COLORI_TESTO = [
  { nome: "Rosso offerta", valore: "#c8161d" },
  { nome: "Nero", valore: "#111111" },
  { nome: "Bianco", valore: "#ffffff" },
  { nome: "Verde Garden Team", valore: "#00652e" },
  { nome: "Verde chiaro", valore: "#8dc63f" },
  { nome: "Arancio", valore: "#d97706" },
  { nome: "Blu", valore: "#1d4ed8" },
  { nome: "Grigio", valore: "#6b7280" },
];

/** Editor drag & drop del layout cartello: trascina i campi, ridimensionali dall'angolo, si salva da solo. */
/**
 * Casella numerica che applica i limiti solo quando si è finito di scrivere
 * (uscita dal campo o Invio): limitando a ogni tasto, scrivere "120" diventava
 * "6" al primo "1" e poi "400" — non si riusciva a mettere il numero voluto.
 */
function NumeroConLimiti({ valore, min, max, onCommit, style }: {
  valore: number; min: number; max: number; onCommit: (n: number) => void; style?: React.CSSProperties;
}) {
  const [testo, setTesto] = useState(String(valore));
  useEffect(() => { setTesto(String(valore)); }, [valore]);
  const conferma = () => {
    const n = Number(testo.replace(",", "."));
    const pulito = Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : valore;
    setTesto(String(pulito));
    if (pulito !== valore) onCommit(pulito);
  };
  return (
    <input type="number" min={min} max={max} step={1} value={testo} style={style}
      onChange={(e) => {
        setTesto(e.target.value);
        /*
         * Le freccette (della casella o della tastiera) danno subito un numero
         * buono: si applica al volo. Scrivendo a mano, un numero ancora fuori
         * dai limiti («1» mentre si scrive «12») aspetta l'uscita dal campo.
         */
        const n = Number(e.target.value.replace(",", "."));
        if (e.target.value !== "" && Number.isInteger(n) && n >= min && n <= max && n !== valore) onCommit(n);
      }}
      onBlur={conferma}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); conferma(); } }} />
  );
}

export default function LayoutEditor({
  format,
  fields,
  initialLayoutId,
  initialNome,
  initialItems,
  initialItemsNoPhoto,
  initialMargins,
  scopeParam,
  initialTipologie,
  tipologieDisponibili,
  tipologiePromo = [],
  sampleValues,
  canEdit: puoModificare,
  bloccato = false,
  images = [],
  area = "arredo",
  ambiti = [],
  fontPropri = [],
  testataAmbito,
}: {
  format: PrintFormat;
  fields: PrintField[];
  /** Id del layout aperto: assente = non ancora salvato, il primo salvataggio ne crea uno. */
  initialLayoutId?: string;
  initialNome?: string;
  initialItems: LayoutItem[];
  /** Foglio alternativo per quando manca la foto: se assente si parte da una copia del foglio normale. */
  initialItemsNoPhoto?: LayoutItem[];
  /** Margini del foglio, in mm, uno per lato. */
  initialMargins?: LayoutMargins;
  scopeParam: string;
  initialTipologie: string[];
  tipologieDisponibili: string[];
  /** Sottoinsieme di `tipologieDisponibili` che descrive il tipo di promozione: mostrato a parte. */
  tipologiePromo?: string[];
  sampleValues: Record<string, string>;
  canEdit: boolean;
  /**
   * Lucchetto per chi non è amministratore: il layout si apre in sola lettura
   * e si modifica solo dopo aver cliccato il lucchetto (con avviso). Evita i
   * ritocchi per sbaglio su un layout che stampa tutto il Consorzio.
   */
  bloccato?: boolean;
  images?: { name: string; url: string }[];
  area?: "arredo" | "zoo"; // dove salvare il layout (default: arredo)
  /** Insegne/PV a cui chi gestisce può assegnare una copia di questo layout. */
  ambiti?: { value: string; label: string }[];
  /** Font caricati dall'ambito (o dalla sua insegna, o dal Consorzio): si aggiungono al menu «Carattere». */
  fontPropri?: { id: string; nome: string }[];
  /**
   * La testata dell'insegna/PV su questo formato: in anteprima si vede al posto
   * di quella del Consorzio (o in grigio leggero, se è nascosta). Solo vista:
   * il layout salvato non cambia.
   */
  testataAmbito?: { modo: "riquadro" | "piena" | "nessuna"; url?: string; nome: string };
}) {
  const [layoutId, setLayoutId] = useState(initialLayoutId ?? "");
  const [nome, setNome] = useState(initialNome ?? "");
  const [dupName, setDupName] = useState("");
  const [items, setItems] = useState<LayoutItem[]>(initialItems);
  const [itemsNoPhoto, setItemsNoPhoto] = useState<LayoutItem[]>(initialItemsNoPhoto ?? initialItems);
  // due fogli, due modalità: quello che si vede/trascina è sempre quello attivo
  const [mode, setMode] = useState<"normal" | "noPhoto">("normal");
  const activeItems = mode === "normal" ? items : itemsNoPhoto;
  /*
   * Si salva da solo, ma solo dopo che qualcuno ha toccato qualcosa. Senza
   * questa guardia bastava aprire un layout del Consorzio da un'insegna — o
   * eliminarne uno e ritrovarsi sulla pagina — perché l'autosalvataggio ne
   * creasse una copia che nessuno aveva chiesto.
   */
  const [tocco, setTocco] = useState(false);
  const setItemsAttivi = mode === "normal" ? setItems : setItemsNoPhoto;
  const setActiveItems: typeof setItems = (v) => { setTocco(true); setItemsAttivi(v); };
  const [margins, setMargins] = useState<LayoutMargins>(initialMargins ?? { top: 0, right: 0, bottom: 0, left: 0 });
  const [tipologie, setTipologie] = useState<string[]>(initialTipologie);
  const [selected, setSelected] = useState<number | null>(null);
  /*
   * Selezione multipla (Ctrl/Maiusc + clic): `selected` è il campo principale,
   * quello che si modifica nel pannello; `altri` quelli scelti insieme, che si
   * allineano, si spostano con le frecce, si eliminano con Canc e cambiano
   * livello tutti insieme.
   */
  const [altri, setAltri] = useState<number[]>([]);
  const [rettangolo, setRettangolo] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [lineeAttive, setLineeAttive] = useState<{ x?: number; y?: number }>({});
  const [trascinando, setTrascinando] = useState(false);
  // lo spazio premuto: si trascina la vista invece dei campi (come in Illustrator)
  const [spazio, setSpazio] = useState(false);
  const vista = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  /*
   * Righelli, guide e griglia: le guide si tirano dai righelli e valgono per
   * questo formato (si ricordano su questo computer); la griglia è un aiuto a
   * schermo, in stampa non c'è.
   */
  const [righelli, setRighelli] = useState(true);
  const [griglia, setGriglia] = useState<{ attiva: boolean; passo: number }>({ attiva: false, passo: 5 });
  const [guideUtente, setGuideUtente] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [guidaInMano, setGuidaInMano] = useState<{ asse: "x" | "y"; indice: number | null; pos: number } | null>(null);
  const scelto = (i: number) => selected === i || altri.includes(i);
  const sceltiTutti = selected === null ? [] : [selected, ...altri.filter((i) => i !== selected)];
  const scegliSolo = (i: number | null) => { setSelected(i); setAltri([]); };
  const [sbloccato, setSbloccato] = useState(false);
  const canEdit = puoModificare && (!bloccato || sbloccato);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; mode: "move" | "resize"; startX: number; startY: number; orig: LayoutItem; gruppo: { i: number; x: number; y: number }[] } | null>(null);
  // cronologia per annulla/ripristina: una per foglio, così non si mescolano
  const history = useRef<LayoutItem[][]>([initialItems]);
  const historyPos = useRef(0);
  const historyNoPhoto = useRef<LayoutItem[][]>([initialItemsNoPhoto ?? initialItems]);
  const historyPosNoPhoto = useRef(0);
  const activeHistory = mode === "normal" ? history : historyNoPhoto;
  const activeHistoryPos = mode === "normal" ? historyPos : historyPosNoPhoto;
  const [, forceHistory] = useState(0);

  const switchMode = (next: "normal" | "noPhoto") => {
    setMode(next);
    setSelected(null);
  };

  const pushHistory = (next: LayoutItem[]) => {
    activeHistory.current = [...activeHistory.current.slice(0, activeHistoryPos.current + 1), next].slice(-40);
    activeHistoryPos.current = activeHistory.current.length - 1;
    forceHistory((n) => n + 1);
  };
  const undo = () => {
    if (activeHistoryPos.current > 0) {
      activeHistoryPos.current -= 1;
      setActiveItems(activeHistory.current[activeHistoryPos.current]);
      forceHistory((n) => n + 1);
    }
  };
  const redo = () => {
    if (activeHistoryPos.current < activeHistory.current.length - 1) {
      activeHistoryPos.current += 1;
      setActiveItems(activeHistory.current[activeHistoryPos.current]);
      forceHistory((n) => n + 1);
    }
  };

  // zoom di lavoro: il cartello reale è piccolo, ingrandirlo mentre si lavora aiuta a posizionare i campi con precisione
  const [zoom, setZoom] = useState(1.5);
  const areaRef = useRef<HTMLDivElement>(null);
  /** Zoom che fa stare il cartello intero nell'area grigia. */
  const adatta = () => {
    const el = areaRef.current;
    if (!el) return;
    const z = Math.min((el.clientWidth - 28) / (format.w * 2.4), (el.clientHeight - 28) / (format.h * 2.4));
    setZoom(Math.max(0.6, Math.min(3.2, Math.floor(z * 20) / 20)));
  };
  // guide e griglia ricordate per formato, su questo computer
  const chiaveGuide = `gt-layout-guide-${area}-${format.id}`;
  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(chiaveGuide) ?? "null");
      if (g && Array.isArray(g.x) && Array.isArray(g.y)) setGuideUtente({ x: g.x.filter(Number.isFinite), y: g.y.filter(Number.isFinite) });
      const gr = JSON.parse(localStorage.getItem("gt-layout-griglia") ?? "null");
      if (gr && typeof gr.attiva === "boolean") setGriglia({ attiva: gr.attiva, passo: Math.max(1, Math.min(50, Number(gr.passo) || 5)) });
      const ri = localStorage.getItem("gt-layout-righelli");
      if (ri) setRighelli(ri === "1");
    } catch { /* niente */ }
  }, [chiaveGuide]);
  const salvaGuide = (g: { x: number[]; y: number[] }) => { setGuideUtente(g); try { localStorage.setItem(chiaveGuide, JSON.stringify(g)); } catch { /* niente */ } };
  useEffect(() => { try { localStorage.setItem("gt-layout-griglia", JSON.stringify(griglia)); } catch { /* niente */ } }, [griglia]);
  useEffect(() => { try { localStorage.setItem("gt-layout-righelli", righelli ? "1" : "0"); } catch { /* niente */ } }, [righelli]);

  // una guida tirata dal righello (o spostata): segue il mouse, rilasciata fuori dal foglio si toglie
  useEffect(() => {
    if (!guidaInMano) return;
    const muovi = (e: MouseEvent) => {
      const p = puntoNelFoglio(e);
      setGuidaInMano((g) => (g ? { ...g, pos: g.asse === "x" ? p.x : p.y } : g));
    };
    const lascia = () => {
      setGuidaInMano((g) => {
        if (!g) return null;
        const lista = [...guideUtente[g.asse]];
        if (g.indice !== null) lista.splice(g.indice, 1);
        if (g.pos > 0.3 && g.pos < 99.7) lista.push(+g.pos.toFixed(2));
        salvaGuide({ ...guideUtente, [g.asse]: lista });
        return null;
      });
    };
    window.addEventListener("mousemove", muovi);
    window.addEventListener("mouseup", lascia);
    return () => { window.removeEventListener("mousemove", muovi); window.removeEventListener("mouseup", lascia); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidaInMano?.asse, guidaInMano?.indice, guideUtente]);

  // con lo spazio premuto si sposta la vista trascinando
  useEffect(() => {
    const muovi = (e: MouseEvent) => {
      const v = vista.current, el = areaRef.current;
      if (!v || !el) return;
      el.scrollLeft = v.sl - (e.clientX - v.x);
      el.scrollTop = v.st - (e.clientY - v.y);
    };
    const lascia = () => { vista.current = null; };
    window.addEventListener("mousemove", muovi);
    window.addEventListener("mouseup", lascia);
    return () => { window.removeEventListener("mousemove", muovi); window.removeEventListener("mouseup", lascia); };
  }, []);

  // Ctrl + rotellina: zoom
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const rotella = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.6, Math.min(3.2, +(z + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))));
    };
    el.addEventListener("wheel", rotella, { passive: false });
    return () => el.removeEventListener("wheel", rotella);
  }, []);

  // all'apertura il cartello si adatta allo spazio, che ora è più grande
  useEffect(() => { adatta(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [format.id]);
  const scale = 2.4 * zoom; // px per mm
  const W = format.w * scale;
  const H = format.h * scale;

  const isImageField = (fieldId: string) => {
    const meta = fields.find((f) => f.id === fieldId);
    return fieldId === "__img" || fieldId === "foto" || fieldId === "logoAzienda" || fieldId === "logoInsegna" || meta?.type === "image";
  };
  // sul foglio "senza foto" l'anteprima non deve mostrare una foto che in stampa non ci sarebbe
  const previewValues = mode === "noPhoto"
    ? Object.fromEntries(Object.entries(sampleValues).map(([k, v]) => (isImageField(k) ? [k, ""] : [k, v])))
    : sampleValues;

  // conversione % del cartello ↔ millimetri reali, per mostrare/impostare le misure sul foglio
  const mmX = (pct: number) => (pct / 100) * format.w;
  const mmY = (pct: number) => (pct / 100) * format.h;
  const pctFromMmX = (mm: number) => (mm / format.w) * 100;
  const pctFromMmY = (mm: number) => (mm / format.h) * 100;
  // le misure si possono leggere e scrivere in mm o in cm, a scelta
  const [unita, setUnita] = useState<"mm" | "cm">("cm");
  const inUnita = (mm: number) => (unita === "cm" ? (mm / 10).toFixed(2) : mm.toFixed(1));
  const daUnita = (v: string) => (unita === "cm" ? (Number(v) || 0) * 10 : Number(v) || 0);
  const passo = unita === "cm" ? 0.05 : 0.5;

  const onMouseDown = (e: React.MouseEvent, index: number, mode: "move" | "resize") => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    /*
     * preventDefault (che evita di selezionare il testo mentre si trascina)
     * lascia il cursore nell'ultima casella del pannello: Canc e le frecce
     * finivano lì invece che sul campo. Si toglie il fuoco dalla casella.
     */
    const attivo = document.activeElement as HTMLElement | null;
    if (attivo && ["INPUT", "TEXTAREA", "SELECT"].includes(attivo.tagName)) attivo.blur();
    if (spazio) return; // con lo spazio si sposta la vista, non i campi
    // i compagni di gruppo del campo cliccato
    const gid = activeItems[index]?.gruppo;
    const compagni = gid ? activeItems.map((it, i) => (it.gruppo === gid ? i : -1)).filter((i) => i >= 0) : [index];
    // Ctrl/Maiusc + clic: aggiunge o toglie il campo (o il suo gruppo) dalla selezione, senza trascinare
    if (mode === "move" && (e.ctrlKey || e.metaKey || e.shiftKey) && selected !== null && selected !== index) {
      setAltri((a) => (a.includes(index) ? a.filter((x) => !compagni.includes(x)) : [...new Set([...a, ...compagni])]));
      return;
    }
    // bloccato: si sceglie (per sbloccarlo o cambiarne l'aspetto) ma non si sposta né si ridimensiona
    if (activeItems[index]?.bloccato) { scegliSolo(index); return; }
    // trascinando un campo già scelto insieme ad altri, o di un gruppo, si spostano tutti (i bloccati restano)
    const insieme = new Set<number>(mode === "move" && scelto(index) && sceltiTutti.length > 1 ? sceltiTutti : []);
    if (mode === "move") for (const c of compagni) insieme.add(c);
    insieme.delete(index);
    const gruppo = [...insieme].filter((i) => !activeItems[i]?.bloccato).map((i) => ({ i, x: activeItems[i].x, y: activeItems[i].y }));
    if (insieme.size === 0) scegliSolo(index);
    else { setSelected(index); if (!(scelto(index) && sceltiTutti.length > 1)) setAltri([...insieme]); }
    if (mode === "move") setTrascinando(true);
    drag.current = { index, mode, startX: e.clientX, startY: e.clientY, orig: { ...activeItems[index] }, gruppo };
  };

  /*
   * Aggancio: mentre si trascina, un bordo (o il centro) del campo si appoggia
   * esattamente su una guida vicina — margini e bordi del foglio, il centro del
   * foglio, le guide tirate dai righelli e, come in Illustrator, i bordi e i
   * centri degli altri campi (guide intelligenti: si vede la linea). Con la
   * griglia accesa, se non c'è una guida vicina si va a passo di griglia.
   */
  const SOGLIA_MM = 1.5;
  const sogliaX = pctFromMmX(SOGLIA_MM);
  const sogliaY = pctFromMmY(SOGLIA_MM);
  const guideBaseX = [...[margins.left, format.w - margins.right, 0, format.w].map(pctFromMmX), 50, ...guideUtente.x];
  const guideBaseY = [...[margins.top, format.h - margins.bottom, 0, format.h].map(pctFromMmY), 50, ...guideUtente.y];
  const passoGrigliaX = pctFromMmX(griglia.passo);
  const passoGrigliaY = pctFromMmY(griglia.passo);
  /** Avvicina `v` (inizio del campo) a una guida, provando inizio, centro e fine (`extent` = larghezza o altezza). */
  const agganciaV = (v: number, guide: number[], soglia: number, extent: number, passoGriglia: number, soloFine = false) => {
    let best = v, dist = soglia, linea: number | undefined;
    const punti = soloFine ? [extent] : extent > 0 ? [0, extent / 2, extent] : [0];
    for (const g of guide) for (const off of punti) {
      const d = Math.abs(v + off - g);
      if (d < dist) { dist = d; best = g - off; linea = g; }
    }
    if (linea === undefined && griglia.attiva && passoGriglia > 0) {
      const fine = soloFine ? v + extent : v;
      best = Math.round(fine / passoGriglia) * passoGriglia - (soloFine ? extent : 0);
    }
    return { v: best, linea };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (rettangolo) {
      const p = puntoNelFoglio(e);
      setRettangolo((r) => (r ? { ...r, x1: p.x, y1: p.y } : r));
      return;
    }
    if (!drag.current) return;
    const { index, mode, startX, startY, orig, gruppo } = drag.current;
    const dx = ((e.clientX - startX) / W) * 100;
    const dy = ((e.clientY - startY) / H) * 100;
    const fermi = new Set([index, ...gruppo.map((g) => g.i)]);
    // le guide intelligenti: bordi e centri degli altri campi (non di quelli che si stanno spostando)
    const altriCampi = activeItems.filter((_, i) => !fermi.has(i));
    const guideX = [...guideBaseX, ...altriCampi.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const guideY = [...guideBaseY, ...altriCampi.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    if (mode === "move") {
      const ax = agganciaV(Math.max(0, Math.min(100 - orig.w, orig.x + dx)), guideX, sogliaX, orig.w, passoGrigliaX);
      const ay = agganciaV(Math.max(0, Math.min(100 - orig.h, orig.y + dy)), guideY, sogliaY, orig.h, passoGrigliaY);
      const nx = Math.max(0, Math.min(100 - orig.w, ax.v));
      const ny = Math.max(0, Math.min(100 - orig.h, ay.v));
      setLineeAttive({ x: ax.linea, y: ay.linea });
      // il gruppo si sposta dello stesso spostamento del campo trascinato, aggancio compreso
      const ddx = nx - orig.x, ddy = ny - orig.y;
      setActiveItems((prev) => prev.map((it, i) => {
        if (i === index) return { ...it, x: +nx.toFixed(2), y: +ny.toFixed(2) };
        const g = gruppo.find((x) => x.i === i);
        return g ? { ...it, x: Math.max(0, Math.min(100 - it.w, +(g.x + ddx).toFixed(2))), y: Math.max(0, Math.min(100 - it.h, +(g.y + ddy).toFixed(2))) } : it;
      }));
      return;
    }
    // ridimensionamento: si aggancia il bordo che si trascina (destro/inferiore)
    const wGrezza = Math.max(4, Math.min(100 - orig.x, orig.w + dx));
    const hGrezza = Math.max(2, Math.min(100 - orig.y, orig.h + dy));
    const aw = agganciaV(orig.x, guideX, sogliaX, wGrezza, passoGrigliaX, true);
    const ah = agganciaV(orig.y, guideY, sogliaY, hGrezza, passoGrigliaY, true);
    // agganciaV sposta l'inizio perché la FINE cada sulla guida: la nuova misura è quella fine meno l'inizio vero
    const w = aw.v + wGrezza - orig.x;
    const h = ah.v + hGrezza - orig.y;
    setLineeAttive({ x: aw.linea, y: ah.linea });
    setActiveItems((prev) => prev.map((it, i) => (i !== index ? it : {
      ...it,
      w: Math.max(4, Math.min(100 - it.x, +w.toFixed(2))),
      h: Math.max(2, Math.min(100 - it.y, +h.toFixed(2))),
    })));
  };

  const endDrag = () => {
    if (rettangolo) {
      // il rettangolo di selezione: si scelgono i campi che tocca (quelli bloccati no)
      const r = rettangolo;
      setRettangolo(null);
      const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
      if (x1 - x0 < 0.6 && y1 - y0 < 0.6) return;
      const dentro = activeItems.map((it, i) => ({ it, i }))
        .filter(({ it }) => !it.bloccato && it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + it.h > y0)
        .map(({ i }) => i);
      if (dentro.length) { setSelected(dentro[0]); setAltri(dentro.slice(1)); }
      return;
    }
    if (drag.current) {
      drag.current = null;
      setLineeAttive({});
      setTrascinando(false);
      pushHistory(activeItems);
    }
  };

  /** Punto del mouse sul foglio, in % (anche fuori dai bordi). */
  const puntoNelFoglio = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };

  /** Il foglio vuoto: un rettangolo per scegliere più campi, o (con lo spazio premuto) si sposta la vista. */
  const onMouseDownFoglio = (e: React.MouseEvent) => {
    if (spazio && areaRef.current) {
      e.preventDefault();
      vista.current = { x: e.clientX, y: e.clientY, sl: areaRef.current.scrollLeft, st: areaRef.current.scrollTop };
      return;
    }
    scegliSolo(null);
    if (!canEdit) return;
    const p = puntoNelFoglio(e);
    setRettangolo({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const addField = (fieldId: string) => {
    if (!canEdit) return;
    const next = [...activeItems, { fieldId, x: 10, y: 10, w: 40, h: 8 }];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  const addImage = (url: string) => {
    if (!canEdit) return;
    const next = [...activeItems, { fieldId: "__img", imageUrl: url, x: 10, y: 10, w: 25, h: 10 }];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  /** Riquadro libero: una fascia colorata, una cornice o una scritta fissa — si stampa sempre. */
  const addRiquadro = (conTesto: boolean) => {
    if (!canEdit) return;
    const next: LayoutItem[] = [
      ...activeItems,
      conTesto
        ? { fieldId: ELEMENTO_RIQUADRO, x: 10, y: 10, w: 40, h: 5, testo: "Scritta fissa", size: 12, bold: true }
        : { fieldId: ELEMENTO_RIQUADRO, x: 0, y: 5, w: 100, h: 5, bg: "#a6c788" },
    ];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  /** QR code che porta alla scheda online del prodotto (stampato solo se la scheda è accesa). */
  const addQr = () => {
    if (!canEdit) return;
    const next: LayoutItem[] = [
      ...activeItems,
      { fieldId: ELEMENTO_QR, x: 60, y: 86, w: 10, h: 9, testo: "Scheda completa", size: 7 },
    ];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  const addSticker = () => {
    if (!canEdit) return;
    const next: LayoutItem[] = [
      ...activeItems,
      {
        fieldId: fields.find((f) => f.id === "novita")?.id ?? fields[0].id,
        x: 65, y: 8, w: 22, h: 12,
        color: "#ffffff",
        sticker: { shape: "stella", bg: "#e8481c", rotation: -12, size: 16 },
      },
    ];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  /*
   * Frecce della tastiera per spostare il campo selezionato: il trascinamento col
   * mouse va bene per la posa grossolana, ma per allineare due campi al millimetro
   * serve un passo fisso. Maiusc = passo lungo. La cronologia si aggiorna al
   * rilascio del tasto, altrimenti tenendo premuta la freccia ogni ripetizione
   * diventerebbe un passo di "annulla" a sé.
   */
  useEffect(() => {
    if (!canEdit) return;
    const dentroUnCampo = (el: EventTarget | null) => {
      const tag = (el as HTMLElement | null)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const premuto = (e: KeyboardEvent) => {
      if (dentroUnCampo(e.target)) return;
      // annulla / ripristina come in Word
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) { e.preventDefault(); incolla(); return; }
      if (e.key === " ") { e.preventDefault(); if (!e.repeat) setSpazio(true); return; }
      if (selected === null) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { e.preventDefault(); duplica(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { copia(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")) { e.preventDefault(); raggruppa(!e.shiftKey); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSelected(); return; }
      if (e.key === "Escape") { scegliSolo(null); return; }
      const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (dx === 0 && dy === 0) return;
      e.preventDefault(); // altrimenti la pagina scorre invece di spostare il campo
      const passo = e.shiftKey ? 2 : 0.4;
      setActiveItems((prev) =>
        prev.map((it, i) => {
          if (!scelto(i) || it.bloccato) return it;
          return {
            ...it,
            x: Math.min(100 - it.w, Math.max(0, +(it.x + dx * passo).toFixed(2))),
            y: Math.min(100 - it.h, Math.max(0, +(it.y + dy * passo).toFixed(2))),
          };
        })
      );
    };
    const rilasciato = (e: KeyboardEvent) => {
      if (e.key === " ") setSpazio(false);
      if (selected === null || dentroUnCampo(e.target)) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) pushHistory(activeItems);
    };
    window.addEventListener("keydown", premuto);
    window.addEventListener("keyup", rilasciato);
    return () => {
      window.removeEventListener("keydown", premuto);
      window.removeEventListener("keyup", rilasciato);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, altri, canEdit, mode, activeItems]);

  const updateSelected = (patch: Partial<LayoutItem> | { sticker: Partial<StickerStyle> } | { cornice: Partial<Cornice> | undefined }) => {
    if (selected === null) return;
    const next = activeItems.map((it, i) => {
      if (i !== selected) return it;
      if ("sticker" in patch && it.sticker) {
        return { ...it, sticker: { ...it.sticker, ...(patch.sticker as Partial<StickerStyle>) } };
      }
      if ("cornice" in patch) {
        // la cornice si aggiorna un pezzo alla volta; undefined la toglie del tutto
        if (patch.cornice === undefined) { const { cornice: _via, ...resto } = it; void _via; return resto; }
        return { ...it, cornice: { ...(it.cornice ?? {}), ...patch.cornice } };
      }
      return { ...it, ...(patch as Partial<LayoutItem>) };
    });
    setActiveItems(next);
    pushHistory(next);
  };

  const selItem = selected !== null ? activeItems[selected] : null;
  /**
   * Distanze del campo dai vicini (o dai bordi del foglio), a sinistra, a
   * destra, sopra e sotto: le mostra mentre lo si sposta, in mm.
   */
  const distanzeDi = (it: LayoutItem) => {
    const altriC = activeItems.filter((o, i) => i !== selected && !altri.includes(i));
    const out: { asse: "x" | "y"; da: number; a: number; pos: number; mm: number }[] = [];
    const sovrV = (o: LayoutItem) => o.y < it.y + it.h && o.y + o.h > it.y;
    const sovrO = (o: LayoutItem) => o.x < it.x + it.w && o.x + o.w > it.x;
    const sx = Math.max(0, ...altriC.filter((o) => sovrV(o) && o.x + o.w <= it.x + 0.01).map((o) => o.x + o.w));
    const dx = Math.min(100, ...altriC.filter((o) => sovrV(o) && o.x >= it.x + it.w - 0.01).map((o) => o.x));
    const su = Math.max(0, ...altriC.filter((o) => sovrO(o) && o.y + o.h <= it.y + 0.01).map((o) => o.y + o.h));
    const giu = Math.min(100, ...altriC.filter((o) => sovrO(o) && o.y >= it.y + it.h - 0.01).map((o) => o.y));
    const cy = it.y + it.h / 2, cx = it.x + it.w / 2;
    if (it.x - sx > 0.05) out.push({ asse: "x", da: sx, a: it.x, pos: cy, mm: mmX(it.x - sx) });
    if (dx - (it.x + it.w) > 0.05) out.push({ asse: "x", da: it.x + it.w, a: dx, pos: cy, mm: mmX(dx - it.x - it.w) });
    if (it.y - su > 0.05) out.push({ asse: "y", da: su, a: it.y, pos: cx, mm: mmY(it.y - su) });
    if (giu - (it.y + it.h) > 0.05) out.push({ asse: "y", da: it.y + it.h, a: giu, pos: cx, mm: mmY(giu - it.y - it.h) });
    return out;
  };
  const barraRef = useRef<HTMLDivElement>(null);
  // la barra dei comandi va nella riga del titolo della pagina, accanto a formato/layout/insegna
  const [postoBarra, setPostoBarra] = useState<HTMLElement | null>(null);
  useEffect(() => { setPostoBarra(document.getElementById("editor-barra-posto")); }, []);
  const portaleBarra = (el: React.ReactElement) => (postoBarra ? createPortal(el, postoBarra) : el);
  useEffect(() => {
    const chiudi = (e: MouseEvent) => {
      for (const d of barraRef.current?.querySelectorAll<HTMLDetailsElement>("details.editor-pop[open]") ?? []) {
        if (!d.contains(e.target as Node)) d.open = false;
      }
    };
    document.addEventListener("mousedown", chiudi);
    return () => document.removeEventListener("mousedown", chiudi);
  }, []);
  // la testata è l'immagine libera più in alto del foglio (come in stampa: conTestataDiScopo)
  const indiceTestata = (() => {
    let migliore = -1;
    activeItems.forEach((it, i) => { if (it.fieldId === ELEMENTO_IMMAGINE && it.imageUrl && (migliore < 0 || it.y < activeItems[migliore].y)) migliore = i; });
    return migliore;
  })();

  /*
   * «Applica a tutti i layout»: l'aspetto del campo scelto va sullo stesso
   * campo negli altri layout di questo ambito (lato server) e, qui, sulle sue
   * altre copie in questo layout, in tutti e due i fogli.
   */
  const [conPosizione, setConPosizione] = useState(false);
  const [soloFormato, setSoloFormato] = useState(true);
  const [aggiungiDoveManca, setAggiungiDoveManca] = useState(false);
  const [esitoTutti, setEsitoTutti] = useState("");
  const libero = !!selItem && (selItem.fieldId === ELEMENTO_IMMAGINE || selItem.fieldId === ELEMENTO_RIQUADRO);
  const applicaATutti = () => {
    if (!selItem || !canEdit) return;
    const etichetta = selItem.fieldId === ELEMENTO_IMMAGINE ? "immagine (testata, logo…)"
      : selItem.fieldId === ELEMENTO_RIQUADRO ? (selItem.testo ? "scritta fissa" : "riquadro")
      : fields.find((f) => f.id === selItem.fieldId)?.label ?? selItem.fieldId;
    const dove = soloFormato || libero ? `i layout ${format.name} di questo ambito` : "tutti i layout di questo ambito";
    const cosa = libero ? `l'elemento «${etichetta}» (immagine/scritta, posizione e aspetto)` : `l'aspetto di «${etichetta}»${conPosizione ? ", con posizione e misure," : ""}`;
    if (!confirm(`Applicare ${cosa} a ${dove}, foglio con foto e senza foto?${aggiungiDoveManca ? "\nDove manca, viene aggiunto." : ""}`)) return;
    const modello = JSON.parse(JSON.stringify(selItem)) as LayoutItem;
    const opzioni = { conPosizione, aggiungi: aggiungiDoveManca };
    const copia = (lista: LayoutItem[]) => { const nuova = lista.map((x) => ({ ...x })); copiaStileCampo(nuova, modello, opzioni); return nuova; };
    setEsitoTutti("");
    startTransition(async () => {
      const r = await applicaCampoATuttiILayout(area, scopeParam, layoutId, format.id, JSON.stringify(modello), conPosizione, { soloFormato, aggiungi: aggiungiDoveManca });
      // il layout aperto si cambia dopo: il suo salvataggio automatico rilegge gli altri già aggiornati
      if (r.ok) { setTocco(true); setItems((v) => copia(v)); setItemsNoPhoto((v) => copia(v)); }
      setEsitoTutti(!r.ok ? r.error
        : r.layout === 0 ? `Negli altri layout era già così${aggiungiDoveManca ? "" : " (o non c'è: spunta «aggiungilo dove manca»)"}. Aggiornato il foglio ${mode === "normal" ? "senza foto" : "con foto"} di questo layout.`
        : `Aggiornati ${r.layout} layout: ${r.nomi.join(", ")}; e l'altro foglio di questo.`);
    });
  };

  const removeSelected = () => {
    if (selected === null) return;
    const via = new Set(sceltiTutti.filter((i) => !activeItems[i]?.bloccato));
    const next = activeItems.filter((_, i) => !via.has(i));
    setActiveItems(next);
    pushHistory(next);
    scegliSolo(null);
  };

  /** Aggiunge campi (copiati o duplicati) un poco spostati, e li sceglie. */
  const aggiungiCopie = (campi: LayoutItem[], spostamento = 2) => {
    if (!canEdit || campi.length === 0) return;
    const nuovoGruppo = new Map<string, string>();
    const copie = campi.map((c) => {
      const it: LayoutItem = JSON.parse(JSON.stringify(c));
      if (it.gruppo) { if (!nuovoGruppo.has(it.gruppo)) nuovoGruppo.set(it.gruppo, `g_${Date.now().toString(36)}${nuovoGruppo.size}`); it.gruppo = nuovoGruppo.get(it.gruppo); }
      it.bloccato = undefined;
      it.x = Math.min(100 - it.w, it.x + spostamento);
      it.y = Math.min(100 - it.h, it.y + spostamento);
      return it;
    });
    const next = [...activeItems, ...copie];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
    setAltri(copie.slice(1).map((_, k) => activeItems.length + 1 + k));
  };
  const duplica = () => aggiungiCopie(sceltiTutti.map((i) => activeItems[i]));
  /** Copia negli appunti di GT One (valgono anche per un altro layout, su questo computer). */
  const copia = () => {
    if (!sceltiTutti.length) return;
    try { localStorage.setItem("gt-layout-appunti", JSON.stringify({ area, campi: sceltiTutti.map((i) => activeItems[i]) })); } catch { /* niente */ }
  };
  const incolla = () => {
    try {
      const a = JSON.parse(localStorage.getItem("gt-layout-appunti") ?? "null") as { area?: string; campi?: LayoutItem[] } | null;
      if (!a?.campi?.length) return;
      // solo i campi che esistono in quest'area (Zoo e Arredo hanno campi diversi)
      const noti = new Set(fields.map((f) => f.id));
      aggiungiCopie(a.campi.filter((c) => noti.has(c.fieldId) || c.fieldId === ELEMENTO_IMMAGINE || c.fieldId === ELEMENTO_RIQUADRO || c.fieldId === ELEMENTO_QR), a.area === area ? 2 : 0);
    } catch { /* niente */ }
  };
  /** Raggruppa i campi scelti (o separa il gruppo). */
  const raggruppa = (unisci: boolean) => {
    if (sceltiTutti.length < (unisci ? 2 : 1)) return;
    const gid = `g_${Date.now().toString(36)}`;
    const set = new Set(sceltiTutti);
    const vecchi = new Set(sceltiTutti.map((i) => activeItems[i].gruppo).filter(Boolean));
    const next = activeItems.map((it, i) => (unisci
      ? (set.has(i) ? { ...it, gruppo: gid } : it)
      : (it.gruppo && vecchi.has(it.gruppo) ? { ...it, gruppo: undefined } : it)));
    setActiveItems(next);
    pushHistory(next);
  };
  const blocca = (si: boolean) => {
    const set = new Set(sceltiTutti);
    const next = activeItems.map((it, i) => (set.has(i) ? { ...it, bloccato: si || undefined } : it));
    setActiveItems(next);
    pushHistory(next);
  };

  /*
   * Livelli: nel cartello (e in stampa) i campi si disegnano nell'ordine
   * dell'elenco, l'ultimo sopra a tutti. «Primo piano» lo porta in fondo
   * all'elenco, «Secondo piano» in cima; avanti/indietro di un posto.
   */
  const cambiaLivello = (verso: "primo" | "avanti" | "indietro" | "fondo") => {
    if (selected === null) return;
    const set = new Set(sceltiTutti);
    const lista = activeItems.map((it, i) => ({ it, i }));
    let nuova: { it: LayoutItem; i: number }[];
    if (verso === "primo") nuova = [...lista.filter((x) => !set.has(x.i)), ...lista.filter((x) => set.has(x.i))];
    else if (verso === "fondo") nuova = [...lista.filter((x) => set.has(x.i)), ...lista.filter((x) => !set.has(x.i))];
    else {
      nuova = [...lista];
      const ordine = verso === "avanti" ? [...nuova.keys()].reverse() : [...nuova.keys()];
      for (const k of ordine) {
        if (!set.has(nuova[k].i)) continue;
        const j = verso === "avanti" ? k + 1 : k - 1;
        if (j < 0 || j >= nuova.length || set.has(nuova[j].i)) continue;
        [nuova[k], nuova[j]] = [nuova[j], nuova[k]];
      }
    }
    const next = nuova.map((x) => x.it);
    const nuovoIndice = (vecchio: number) => nuova.findIndex((x) => x.i === vecchio);
    setActiveItems(next);
    pushHistory(next);
    setSelected(nuovoIndice(selected));
    setAltri(altri.map(nuovoIndice));
  };

  /** Allinea i campi scelti insieme: sul primo scelto (il principale) o, per distribuire, fra i due estremi. */
  const allinea = (come: "sx" | "cx" | "dx" | "alto" | "cy" | "basso" | "distribH" | "distribV" | "largh" | "alt") => {
    if (sceltiTutti.length < 2 || selected === null) return;
    const rif = activeItems[selected];
    const set = sceltiTutti;
    let next = [...activeItems];
    if (come === "distribH" || come === "distribV") {
      const asse = come === "distribH" ? "x" : "y";
      const dim = come === "distribH" ? "w" : "h";
      const ordinati = [...set].sort((a, b) => next[a][asse] - next[b][asse]);
      const inizio = next[ordinati[0]][asse];
      const fine = next[ordinati[ordinati.length - 1]][asse] + next[ordinati[ordinati.length - 1]][dim];
      const pieni = ordinati.reduce((t, i) => t + next[i][dim], 0);
      const spazio = (fine - inizio - pieni) / (ordinati.length - 1);
      let pos = inizio;
      for (const i of ordinati) { next[i] = { ...next[i], [asse]: +pos.toFixed(2) }; pos += next[i][dim] + spazio; }
    } else {
      next = next.map((it, i) => {
        if (!set.includes(i) || i === selected || it.bloccato) return it;
        switch (come) {
          case "sx": return { ...it, x: rif.x };
          case "dx": return { ...it, x: Math.max(0, rif.x + rif.w - it.w) };
          case "cx": return { ...it, x: Math.max(0, +(rif.x + rif.w / 2 - it.w / 2).toFixed(2)) };
          case "alto": return { ...it, y: rif.y };
          case "basso": return { ...it, y: Math.max(0, rif.y + rif.h - it.h) };
          case "cy": return { ...it, y: Math.max(0, +(rif.y + rif.h / 2 - it.h / 2).toFixed(2)) };
          case "largh": return { ...it, w: Math.min(100 - it.x, rif.w) };
          case "alt": return { ...it, h: Math.min(100 - it.y, rif.h) };
          default: return it;
        }
      });
    }
    setActiveItems(next);
    pushHistory(next);
  };

  const layoutUrlBase = `/stampe/${area}/layout?formato=${format.id}&scope=${scopeParam}`;

  const doSave = () => {
    if (!canEdit) return;
    startTransition(async () => {
      const save = area === "zoo" ? saveZooLayout : saveLayout;
      const res = await save(
        layoutId, format.id, scopeParam, nome, tipologie.join(","), JSON.stringify(items), JSON.stringify(margins), JSON.stringify(itemsNoPhoto)
      );
      if (res.ok && res.id && res.id !== layoutId) {
        setLayoutId(res.id);
        // il primo salvataggio di un layout nuovo gli dà un id: si aggiorna l'URL senza ricaricare,
        // così un aggiornamento della pagina ritrova lo stesso layout invece di crederlo assente
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("layout", res.id);
          window.history.replaceState(null, "", url.toString());
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  // autosalvataggio: ogni modifica si salva da sola poco dopo, niente pulsante da ricordarsi di premere
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;
  const skipFirstSave = useRef(true);
  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    if (!canEdit || !tocco) return;
    const t = setTimeout(() => doSaveRef.current(), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, itemsNoPhoto, margins, tipologie, nome]);

  /** Crea un nuovo layout a partire dal contenuto attuale (duplica quello aperto, o lo salva con un nuovo nome). */
  const doDuplicate = () => {
    if (!canEdit) return;
    startTransition(async () => {
      const save = area === "zoo" ? saveZooLayout : saveLayout;
      const finalName = dupName.trim() || `${nome || format.name} (copia)`;
      const res = await save(
        "", format.id, scopeParam, finalName, tipologie.join(","), JSON.stringify(items), JSON.stringify(margins), JSON.stringify(itemsNoPhoto)
      );
      if (res.ok && res.id) window.location.href = `${layoutUrlBase}&layout=${res.id}`;
    });
  };

  /*
   * Assegna il layout a un'insegna o a un punto vendita: ne salva una copia
   * nell'ambito scelto, che da quel momento vince sul layout del Consorzio per
   * quei cartelli. L'originale resta dov'è.
   */
  const [assegnaA, setAssegnaA] = useState(scopeParam);
  const doAssegna = () => {
    if (!canEdit || assegnaA === scopeParam) return;
    startTransition(async () => {
      const save = area === "zoo" ? saveZooLayout : saveLayout;
      const etichetta = ambiti.find((a) => a.value === assegnaA)?.label ?? "";
      const res = await save(
        "", format.id, assegnaA, (nome || format.name) + (etichetta ? ` — ${etichetta}` : ""),
        tipologie.join(","), JSON.stringify(items), JSON.stringify(margins), JSON.stringify(itemsNoPhoto)
      );
      if (res.ok && res.id) window.location.href = `/stampe/${area}/layout?formato=${format.id}&scope=${assegnaA}&layout=${res.id}`;
    });
  };

  /*
   * I bordi buoni per l'allineamento sono i margini, non il taglio della carta:
   * allineare "a sinistra" deve portare il campo sul margine sinistro, che è la
   * riga tratteggiata che si vede sul foglio.
   */
  const bordoSx = pctFromMmX(margins.left);
  const bordoDx = 100 - pctFromMmX(margins.right);
  const bordoAlto = pctFromMmY(margins.top);
  const bordoBasso = 100 - pctFromMmY(margins.bottom);

  /** Campi presenti sul foglio normale e non su quello senza foto (con i nomi leggibili). */
  const mancantiSenzaFoto = [...new Set(items.map((i) => i.fieldId))]
    .filter((fid) => fid !== "__img" && !itemsNoPhoto.some((i) => i.fieldId === fid))
    .filter((fid) => !(fields.find((f) => f.id === fid)?.label ?? "").toLowerCase().includes("foto"))
    .map((fid) => fields.find((f) => f.id === fid)?.label ?? fid)
    .filter((etichetta) => !/immagine|foto/i.test(etichetta));

  const usedFields = new Set(activeItems.map((i) => i.fieldId));

  return (
    <div>
    {/* i comandi che valgono per tutto il layout: pulsanti in alto, ognuno apre la sua finestrella */}
    {portaleBarra(<div className="editor-barra" ref={barraRef}>
        {/* identità del layout: nome, e come farne una copia */}
        {canEdit && (
          <div className="panel-layout">
          <Finestrella titolo="Layout">
            <label className="field" style={{ marginBottom: 8 }}>
              Nome
              <input type="text" value={nome} onChange={(e) => { setTocco(true); setNome(e.target.value); }} placeholder="es. Cartello Gatto" />
            </label>
            <label className="field" style={{ marginBottom: 4 }}>
              Duplica come nuovo layout
              <input type="text" value={dupName} onChange={(e) => setDupName(e.target.value)} placeholder={`${nome || format.name} (copia)`} />
            </label>
            <button type="button" className="btn btn-outline btn-sm" style={{ width: "100%" }} onClick={doDuplicate} disabled={pending}>
              Crea copia
            </button>
          </Finestrella>
          </div>
        )}
        {/* proprietà del foglio: valgono per tutto il cartello, non per il campo selezionato */}
        {canEdit && (
          <div className="panel-layout">
          <Finestrella titolo={`Foglio (${format.w}×${format.h} mm)`}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Margini ({unita})</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {([["top", "Alto"], ["bottom", "Basso"], ["left", "Sinistra"], ["right", "Destra"]] as const).map(
                ([lato, etichetta]) => (
                  <label key={lato} className="field" style={{ marginBottom: 0 }}>
                    {etichetta}
                    <input
                      type="number" step={passo} min={0} value={inUnita(margins[lato])}
                      onChange={(e) =>
                        { setTocco(true); setMargins((m) => ({ ...m, [lato]: Math.max(0, Math.min(100, daUnita(e.target.value))) })); }
                      }
                    />
                  </label>
                )
              )}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>
              Compaiono sul foglio come linee tratteggiate: trascinando un campo lì vicino, si aggancia da solo.
              Servono ad allineare — non spostano i campi già posizionati.
            </p>
          </Finestrella>
          </div>
        )}
        <div className="panel-layout">
          <Finestrella titolo={`Quando usare${tipologie.length ? ` (${tipologie.length})` : ": sempre"}`}>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
            Nessuna spunta = layout valido per tutti i cartelli di questo formato. Spuntando qualcosa il layout
            viene scelto in stampa solo per i cartelli che corrispondono: così un &quot;A SOLI&quot; può essere
            impaginato diversamente da un 3x2.
          </p>
          {tipologiePromo.length > 0 && (
            <>
              <strong style={{ fontSize: 12.5 }}>Tipo di promozione</strong>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "4px 0 10px" }}>
                {tipologiePromo.map((t) => (
                  <label key={t} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={tipologie.includes(t)}
                      disabled={!canEdit}
                      onChange={(e) =>
                        { setTocco(true); setTipologie((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t))); }
                      }
                    />
                    {t}
                  </label>
                ))}
              </div>
              <strong style={{ fontSize: 12.5 }}>Tipo di prodotto</strong>
            </>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, maxHeight: 220, overflowY: "auto" }}>
            {tipologieDisponibili.filter((t) => !tipologiePromo.includes(t)).map((t) => (
              <label key={t} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={tipologie.includes(t)}
                  disabled={!canEdit}
                  onChange={(e) =>
                    { setTocco(true); setTipologie((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t))); }
                  }
                />
                {t}
              </label>
            ))}
          </div>
        </Finestrella>
          </div>
        {canEdit && ambiti.length > 1 && (
          <div className="panel-layout">
            <Finestrella titolo="Assegna a un'insegna / punto vendita">
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
                Ne salva una copia per l&apos;ambito scelto: da lì in poi quei cartelli usano questo layout
                invece di quello del Consorzio. L&apos;originale resta dov&apos;è.
              </p>
              <select value={assegnaA} onChange={(e) => setAssegnaA(e.target.value)} style={{ marginTop: 0 }}>
                {ambiti.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              <button type="button" className="btn btn-sm" style={{ width: "100%", marginTop: 8 }}
                disabled={pending || assegnaA === scopeParam} onClick={doAssegna}>
                Assegna una copia
              </button>
            </Finestrella>
          </div>
        )}
        {canEdit ? (
          <div className="panel-layout">
            <button type="button" className={`btn btn-outline btn-sm salva-stato${saved && !pending ? " salvato" : ""}`} onClick={doSave} disabled={pending} title="Le modifiche si salvano da sole poco dopo ogni cambiamento">
              {/* lo stato sta dentro al pulsante, a larghezza fissa: prima la scritta «Salvato» accanto spostava la riga */}
              {pending ? "Salvo…" : saved ? "✓ Salvato" : "Salva ora"}
            </button>
          </div>
        ) : (
          <span className="hint" style={{ fontSize: 12.5 }}>
            Stai vedendo il layout del Consorzio: scegli la tua insegna/PV in alto per personalizzarlo.
          </span>
        )}
    </div>)}
    <div className="layout-editor">
      <div className="card" style={{ padding: 12 }}>
        {/* qual è il campo scelto: sul foglio l'etichetta è piccola e a volte
            finisce sotto un altro riquadro, qui si legge sempre */}
        <div style={{
          margin: "2px 0 10px", padding: "8px 10px", borderRadius: 8,
          background: selItem ? "var(--green-50)" : "#f4f4f2",
          border: `1px solid ${selItem ? "var(--green-500)" : "var(--line)"}`,
        }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>Campo scelto</div>
          <strong style={{ fontSize: 13.5 }}>
            {selItem
              ? (selItem.fieldId === ELEMENTO_IMMAGINE ? "Immagine libera"
                : selItem.fieldId === ELEMENTO_RIQUADRO ? (selItem.testo ? "Scritta fissa" : "Riquadro / fascia")
                : selItem.fieldId === ELEMENTO_QR ? "QR code della scheda online"
                : fields.find((f) => f.id === selItem.fieldId)?.label ?? selItem.fieldId)
              : "nessuno — clicca un campo sul foglio"}
          </strong>
          {/* la spiegazione del campo: serve dove due campi si somigliano,
              come "Meccanica promo" e "Tipo di promozione" */}
          {selItem && fields.find((f) => f.id === selItem.fieldId)?.nota && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.3 }}>
              {fields.find((f) => f.id === selItem.fieldId)?.nota}
            </div>
          )}
          {/* applica a tutti: per i campi l'aspetto; per immagini (testata) e riquadri l'elemento intero, riconosciuto dal punto in cui sta */}
          {selItem && canEdit && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
              <button type="button" className="btn btn-outline btn-sm" style={{ width: "100%" }} disabled={pending} onClick={applicaATutti}
                title={libero
                  ? "Sostituisce l'immagine o il riquadro che sta nello stesso punto negli altri layout del formato (e nel foglio senza foto)"
                  : "Carattere, misura, colori, allineamento, cornice, prefisso e sticker di questo campo vanno sugli altri layout (e sul foglio senza foto)"}>
                {pending ? "Applico…" : "Applica a tutti i layout"}
              </button>
              <div style={{ display: "grid", gap: 3, marginTop: 5, fontSize: 11.5, color: "var(--muted)" }}>
                {!libero && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={soloFormato} onChange={(e) => setSoloFormato(e.target.checked)} />
                    solo i layout {format.name}
                  </label>
                )}
                {!libero && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={conPosizione} onChange={(e) => setConPosizione(e.target.checked)} />
                    anche posizione e misure (stesso formato)
                  </label>
                )}
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={aggiungiDoveManca} onChange={(e) => setAggiungiDoveManca(e.target.checked)} />
                  aggiungilo dove manca (stesso formato)
                </label>
                {libero && <span>Vale per i layout {format.name}: si sostituisce l&apos;elemento che sta nello stesso punto.</span>}
              </div>
              {esitoTutti && <div style={{ fontSize: 11.5, marginTop: 5 }}>{esitoTutti}</div>}
            </div>
          )}
        </div>
        <h3 style={{ margin: "2px 6px 10px" }}>Campi disponibili</h3>
        <div className="editor-fields">
          {fields.map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn btn-outline btn-sm"
              style={{ textAlign: "left", opacity: usedFields.has(f.id) ? 0.45 : 1 }}
              onClick={() => addField(f.id)}
              disabled={!canEdit}
              title={[f.nota, usedFields.has(f.id) ? "Già nel cartello (puoi aggiungerlo di nuovo)" : "Aggiungi al cartello"].filter(Boolean).join(" — ")}
            >
              ＋ {f.label}
              {(f.nota ?? DESCRIZIONI_CAMPI[area][f.id]) && (
                <span className="campo-info" tabIndex={0} role="note" aria-label={f.nota ?? DESCRIZIONI_CAMPI[area][f.id]}
                  data-descr={f.nota ?? DESCRIZIONI_CAMPI[area][f.id]}
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}>i</span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 10, width: "100%" }} onClick={addSticker} disabled={!canEdit}>
          Aggiungi sticker / bollino
        </button>
        <h3 style={{ margin: "14px 6px 8px" }}>Grafica</h3>
        <div className="editor-fields">
          <button type="button" className="btn btn-outline btn-sm" style={{ textAlign: "left" }} onClick={() => addRiquadro(false)} disabled={!canEdit}
            title="Una fascia o un riquadro colorato, con o senza bordo: si stampa sempre">
            ▬ Fascia / riquadro colorato
          </button>
          <button type="button" className="btn btn-outline btn-sm" style={{ textAlign: "left" }} onClick={() => addRiquadro(true)} disabled={!canEdit}
            title="Una scritta uguale su tutti i cartelli, es. «il nostro prezzo:»">
            Aa Scritta fissa
          </button>
          <button type="button" className="btn btn-outline btn-sm" style={{ textAlign: "left" }} onClick={addQr} disabled={!canEdit}
            title="Porta il cliente alla scheda online del prodotto (pagina Scheda online)">
            ▦ QR code scheda online
          </button>
        </div>
        <p className="hint" style={{ margin: "6px 6px 0", fontSize: 11.5 }}>
          Il titolo di un campo (es. «misure imballo:» con l&apos;icona) si imposta nel pannello «Cornice e titolo» del campo scelto:
          se il prodotto non ha quel dato, sparisce anche il titolo.
        </p>
        {images.length > 0 && (
          <>
            <h3 style={{ margin: "14px 6px 8px" }}>Le tue immagini</h3>
            <div className="editor-fields">
              {images.map((img) => (
                <button key={img.url} type="button" className="btn btn-outline btn-sm" style={{ textAlign: "left" }} onClick={() => addImage(img.url)} disabled={!canEdit}>
                  {img.name}
                </button>
              ))}
            </div>
          </>
        )}
        {selected !== null && canEdit && (
          <button type="button" className="btn btn-sm" style={{ marginTop: 12, background: "var(--red)" }} onClick={removeSelected}>
            Rimuovi elemento selezionato
          </button>
        )}
      </div>

      <div>
        {puoModificare && bloccato && (
          <div className={`alert ${sbloccato ? "alert-amber" : "alert-gray"}`} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ flex: 1 }}>
              {sbloccato
                ? "🔓 Layout sbloccato: ogni modifica salvata cambia i cartelli di chi usa questo layout."
                : "🔒 Layout protetto: si guarda ma non si modifica. Per cambiarlo clicca il lucchetto."}
            </span>
            <button type="button" className="btn btn-outline btn-sm"
              onClick={() => {
                if (sbloccato) { setSbloccato(false); setSelected(null); return; }
                if (confirm("Sbloccare il layout? Le modifiche che salverai cambiano i cartelli stampati con questo layout. Se vuoi solo provare, fai prima una copia.")) setSbloccato(true);
              }}>
              {sbloccato ? "🔒 Blocca di nuovo" : "🔓 Sblocca per modificare"}
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" className={`btn btn-sm ${mode === "normal" ? "" : "btn-outline"}`} onClick={() => switchMode("normal")}>
              Foglio normale
            </button>
            <button type="button" className={`btn btn-sm ${mode === "noPhoto" ? "" : "btn-outline"}`} onClick={() => switchMode("noPhoto")}
              title="Cosa stampare quando il prodotto non ha una foto caricata">
              Foglio senza foto
            </button>
          </div>
          {canEdit && (
            <>
              <button type="button" className="btn btn-outline btn-sm" onClick={undo} disabled={activeHistoryPos.current === 0} title="Annulla (indietro)">↶ Indietro</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={redo} disabled={activeHistoryPos.current >= activeHistory.current.length - 1} title="Ripristina (avanti)">↷ Avanti</button>
            </>
          )}
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: canEdit ? 10 : 0 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.2).toFixed(1)))} title="Rimpicciolisci">－</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)", minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setZoom((z) => Math.min(3.2, +(z + 0.2).toFixed(1)))} title="Ingrandisci">＋</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={adatta} title="Il cartello intero nello spazio disponibile (Ctrl + rotellina per lo zoom, spazio + trascina per spostare la vista)">Adatta</button>
            <button type="button" className={`btn btn-outline btn-sm${righelli ? " attivo" : ""}`} onClick={() => setRighelli((v) => !v)} title="Righelli in cm: trascina da un righello per tirare una guida">Righelli</button>
            <button type="button" className={`btn btn-outline btn-sm${griglia.attiva ? " attivo" : ""}`} onClick={() => setGriglia((g) => ({ ...g, attiva: !g.attiva }))} title="Griglia a schermo: i campi si agganciano al passo">Griglia</button>
            {griglia.attiva && (
              <select value={griglia.passo} onChange={(e) => setGriglia((g) => ({ ...g, passo: Number(e.target.value) }))} style={{ marginTop: 0, width: 80, fontSize: 12 }} title="Passo della griglia">
                {[2, 5, 10, 20].map((p) => <option key={p} value={p}>{p} mm</option>)}
              </select>
            )}
            {(guideUtente.x.length + guideUtente.y.length) > 0 && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => salvaGuide({ x: [], y: [] })} title="Toglie tutte le guide di questo formato">Togli guide ({guideUtente.x.length + guideUtente.y.length})</button>
            )}
          </div>
        </div>
        {mode === "noPhoto" && (
          <>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
              Questo foglio si stampa al posto di quello normale solo quando il prodotto non ha una foto caricata:
              di solito conviene allargare gli altri campi per riempire lo spazio che lascerebbe libero la foto.
            </p>
            {/* i campi che stanno sul foglio normale ma qui no: senza questo avviso
                ci si accorge del buco solo davanti al cartello stampato */}
            {mancantiSenzaFoto.length > 0 && (
              <div className="alert alert-amber" style={{ fontSize: 12.5, padding: "8px 10px" }}>
                Qui mancano rispetto al foglio normale: <strong>{mancantiSenzaFoto.join(", ")}</strong>.
                Se servono, aggiungili dall&apos;elenco dei campi.
              </div>
            )}
            {canEdit && (
              <button
                type="button" className="btn btn-outline btn-sm" style={{ marginBottom: 8 }}
                title="Riparte dal foglio con foto invece di ridisegnare tutto da capo"
                onClick={() => {
                  // la foto in stampa qui non c'è comunque: portarsela dietro confonderebbe soltanto
                  const copia = items.filter((it) => !isImageField(it.fieldId));
                  setTocco(true);
                  setItemsNoPhoto(copia);
                  pushHistory(copia);
                  setSelected(null);
                }}
              >
                Copia dal foglio con foto
              </button>
            )}
          </>
        )}
        <div ref={areaRef} className={`editor-area${spazio ? " mano" : ""}`}>
        <div className={righelli ? "editor-righelli" : undefined} style={{ width: W + (righelli ? 22 : 0) }}>
        {righelli && (
          <>
            <div className="righello righello-x" style={{ width: W, backgroundSize: `${scale * 10}px 100%, ${scale}px 35%` }}
              title="Trascina in giù per tirare una guida orizzontale"
              onMouseDown={(e) => { if (!canEdit) return; e.preventDefault(); setGuidaInMano({ asse: "y", indice: null, pos: -1 }); }}>
              {Array.from({ length: Math.floor(format.w / 10) + 1 }, (_, k) => <span key={k} style={{ left: k * 10 * scale }}>{k}</span>)}
            </div>
            <div className="righello righello-y" style={{ height: H, backgroundSize: `100% ${scale * 10}px, 35% ${scale}px` }}
              title="Trascina a destra per tirare una guida verticale"
              onMouseDown={(e) => { if (!canEdit) return; e.preventDefault(); setGuidaInMano({ asse: "x", indice: null, pos: -1 }); }}>
              {Array.from({ length: Math.floor(format.h / 10) + 1 }, (_, k) => <span key={k} style={{ top: k * 10 * scale }}>{k}</span>)}
            </div>
          </>
        )}
        <div
          ref={canvasRef}
          className="cartello editor-canvas"
          style={{
            width: W, height: H,
            backgroundImage: format.background ? `url("${format.background}")` : undefined, backgroundSize: "100% 100%",
            boxSizing: "border-box",
          }}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onMouseDown={onMouseDownFoglio}
        >
          {(margins.top > 0 || margins.right > 0 || margins.bottom > 0 || margins.left > 0) && (
            /*
             * Guide dei margini: linee tratteggiate a cui i campi si agganciano.
             * Sono solo un riferimento visivo — NON spostano i campi da sole (un
             * padding sul foglio non toccherebbe comunque i campi, che sono
             * posizionati in modo assoluto: le percentuali si calcolano sul
             * padding box, non sul contenuto).
             */
            <div
              style={{
                position: "absolute", pointerEvents: "none", boxSizing: "border-box",
                left: margins.left * scale,
                top: margins.top * scale,
                width: W - (margins.left + margins.right) * scale,
                height: H - (margins.top + margins.bottom) * scale,
                outline: "1px dashed #c2410c",
              }}
            />
          )}
          {activeItems.map((item, i) => {
            const meta = fields.find((f) => f.id === item.fieldId);
            const eTestata = i === indiceTestata && !!testataAmbito;
            if (item.sticker) {
              return (
                <div
                  key={i}
                  className={`editor-item ${scelto(i) ? "selected" : ""}${altri.includes(i) ? " insieme" : ""}`}
                  style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%`, cursor: canEdit ? "move" : "default", overflow: "visible", transform: `rotate(${item.sticker.rotation}deg)` }}
                  onMouseDown={(e) => onMouseDown(e, i, "move")}
                >
                  <div style={stileStickerCartello(item, scale)}>
                    {testoStampato(typeof item.testo === "string" ? item.testo || "Testo" : previewValues[item.fieldId] || meta?.label || "Sticker")}
                  </div>
                  {canEdit && !item.bloccato && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                  {item.bloccato && <span className="editor-lucchetto" title="Bloccato">🔒</span>}
                </div>
              );
            }
            const etichettaMisure = canEdit && selected === i && (
              <span style={{ position: "absolute", left: 0, top: -18, fontSize: 10.5, color: "#274b7a", background: "#fff", padding: "0 4px", border: "1px solid var(--line)", borderRadius: 3, whiteSpace: "nowrap" }}>
                {inUnita(mmX(item.w))} × {inUnita(mmY(item.h))} {unita}
              </span>
            );
            const maniglia = canEdit && (item.bloccato ? <span className="editor-lucchetto" title="Bloccato">🔒</span> : <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />);
            const stileBase: React.CSSProperties = {
              left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%`,
              cursor: canEdit ? "move" : "default",
              background: item.bg,
              borderRadius: item.radius ? item.radius * scale : undefined,
              ...bordoRiquadro(item, scale),
            };
            if (item.fieldId === ELEMENTO_RIQUADRO) {
              return (
                <div key={i} className={`editor-item ${scelto(i) ? "selected" : ""}${altri.includes(i) ? " insieme" : ""}`} style={stileBase} onMouseDown={(e) => onMouseDown(e, i, "move")}>
                  <CorniceCampo item={item} scale={scale}>
                    {item.testo
                      ? <div style={{ width: "100%", height: "100%", ...stileTestoCartello(item, undefined, item.testo, scale) }}>{testoStampato(item.testo)}</div>
                      : !item.bg && !item.cornice ? <span style={{ fontSize: 11, color: "#999" }}>Riquadro</span> : null}
                  </CorniceCampo>
                  {etichettaMisure}
                  {maniglia}
                </div>
              );
            }
            if (item.fieldId === ELEMENTO_QR) {
              return (
                <div key={i} className={`editor-item ${scelto(i) ? "selected" : ""}${altri.includes(i) ? " insieme" : ""}`} style={{ ...stileBase, display: "flex", flexDirection: "column", alignItems: "center" }} onMouseDown={(e) => onMouseDown(e, i, "move")}>
                  <QrSvg testo={previewValues[ELEMENTO_QR] || "https://gardenteam.vercel.app/scheda"} colore={item.color} style={{ flex: 1, minHeight: 0, width: "100%", pointerEvents: "none" }} />
                  {item.testo && (
                    <div style={{ flex: "none", fontSize: ((item.size ?? 7) * scale) / 2.4, lineHeight: 1.1, textAlign: "center", color: coloreCampo(item), whiteSpace: "pre-line", padding: `${0.5 * scale}px 0 0` }}>
                      {item.testo}
                    </div>
                  )}
                  {etichettaMisure}
                  {maniglia}
                </div>
              );
            }
            const isImage = isImageField(item.fieldId);
            const nascosta = eTestata && testataAmbito!.modo === "nessuna";
            const imgSrc = eTestata && testataAmbito!.url && !nascosta ? testataAmbito!.url
              : item.fieldId === ELEMENTO_IMMAGINE ? item.imageUrl : previewValues[item.fieldId];
            if (isImage) {
              return (
                <div
                  key={i}
                  className={`editor-item ${scelto(i) ? "selected" : ""}${altri.includes(i) ? " insieme" : ""}`}
                  style={nascosta ? { ...stileBase, opacity: 0.18, filter: "grayscale(1)" } : stileBase}
                  onMouseDown={(e) => onMouseDown(e, i, "move")}
                  title={eTestata ? (nascosta ? `Testata nascosta per ${testataAmbito!.nome}: in stampa non c'è` : `Testata di ${testataAmbito!.nome}${testataAmbito!.modo === "piena" ? " (in stampa a tutta larghezza)" : ""}`) : undefined}
                >
                  {eTestata && (
                    <span className="testata-ambito-badge">{nascosta ? "nascosta" : `testata di ${testataAmbito!.nome}${testataAmbito!.modo === "piena" ? " · tutta larghezza" : ""}`}</span>
                  )}
                  {imgSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imgSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: `${eTestata ? "center" : item.fieldId === ELEMENTO_IMMAGINE ? item.align ?? "left" : "left"} top`, pointerEvents: "none", mixBlendMode: "multiply" }} />
                  ) : (
                    <span style={{ fontSize: 11, color: "#999" }}>{meta?.label ?? "Immagine"}</span>
                  )}
                  {canEdit && selected === i && (
                    <span style={{ position: "absolute", left: 0, top: -18, fontSize: 10.5, color: "#274b7a", background: "#fff", padding: "0 4px", border: "1px solid var(--line)", borderRadius: 3, whiteSpace: "nowrap" }}>
                      {inUnita(mmX(item.w))} × {inUnita(mmY(item.h))} {unita}
                    </span>
                  )}
                  {canEdit && !item.bloccato && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                  {item.bloccato && <span className="editor-lucchetto" title="Bloccato">🔒</span>}
                </div>
              );
            }
            /*
             * Da qui in giù il campo si disegna con le stesse regole della stampa
             * (Cartello): colori, carattere, interlinea, prezzo barrato e a capo
             * sui due spazi. Quando erano scritte due volte, l'anteprima
             * dell'editor mostrava un cartello diverso da quello stampato.
             */
            const raw = conPrefisso(item, previewValues[item.fieldId] ?? "");
            const testo = raw || meta?.label || "";
            if (isPrezzoField(item.fieldId)) {
              return (
                <div
                  key={i}
                  className={`editor-item ${scelto(i) ? "selected" : ""}${altri.includes(i) ? " insieme" : ""}`}
                  style={{
                    ...stileBase,
                    // il prezzo esce dal riquadro invece di essere tagliato, come in stampa
                    overflow: "visible",
                    color: coloreCampo(item),
                  }}
                  onMouseDown={(e) => onMouseDown(e, i, "move")}
                >
                  <CorniceCampo item={item} scale={scale}>
                    <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: justifyPrezzo(item), alignItems: alignPrezzo(item), overflow: "visible", ...effettiTesto(item, scale) }}>
                      {raw && (
                        <Prezzo value={raw} size={item.size ?? meta?.size ?? 11} scale={scale} valign={item.valign} align={item.align}
                          font={item.font !== undefined ? layoutFontCss(item.font) : undefined} />
                      )}
                    </div>
                  </CorniceCampo>
                  {canEdit && selected === i && (
                    <span style={{ position: "absolute", left: 0, top: -18, fontSize: 10.5, color: "#274b7a", background: "#fff", padding: "0 4px", border: "1px solid var(--line)", borderRadius: 3, whiteSpace: "nowrap" }}>
                      {inUnita(mmX(item.w))} × {inUnita(mmY(item.h))} {unita}
                    </span>
                  )}
                  {canEdit && !item.bloccato && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                  {item.bloccato && <span className="editor-lucchetto" title="Bloccato">🔒</span>}
                </div>
              );
            }
            return (
              <div
                key={i}
                className={`editor-item ${scelto(i) ? "selected" : ""}${altri.includes(i) ? " insieme" : ""}`}
                style={{
                  ...stileBase,
                  // campo senza valore d'esempio: si vede il nome del campo, sbiadito,
                  // perché non venga scambiato per un testo che verrà stampato
                  opacity: raw ? undefined : 0.45,
                }}
                onMouseDown={(e) => onMouseDown(e, i, "move")}
              >
                <CorniceCampo item={item} scale={scale}>
                  <div style={{ width: "100%", height: "100%", overflow: "hidden", ...stileTestoCartello(item, meta, testo, scale) }}>
                    {testoStampato(testo)}
                  </div>
                </CorniceCampo>
                {canEdit && selected === i && (
                  <span style={{ position: "absolute", left: 0, top: -18, fontSize: 10.5, color: "#274b7a", background: "#fff", padding: "0 4px", border: "1px solid var(--line)", borderRadius: 3, whiteSpace: "nowrap" }}>
                    {inUnita(mmX(item.w))} × {inUnita(mmY(item.h))} {unita}
                  </span>
                )}
                {canEdit && !item.bloccato && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                {item.bloccato && <span className="editor-lucchetto" title="Bloccato">🔒</span>}
              </div>
            );
          })}
          {/* griglia (solo a schermo) */}
          {griglia.attiva && (
            <div className="editor-griglia" style={{ backgroundSize: `${griglia.passo * scale}px ${griglia.passo * scale}px` }} />
          )}
          {/* guide tirate dai righelli: si spostano trascinandole, fuori dal foglio si tolgono */}
          {guideUtente.x.map((g, k) => (guidaInMano?.asse === "x" && guidaInMano.indice === k) ? null : (
            <div key={`gx${k}`} className="guida guida-x" style={{ left: `${g}%` }} title="Trascina per spostare, fuori dal foglio per togliere"
              onMouseDown={(e) => { if (!canEdit) return; e.stopPropagation(); e.preventDefault(); setGuidaInMano({ asse: "x", indice: k, pos: g }); }} />
          ))}
          {guideUtente.y.map((g, k) => (guidaInMano?.asse === "y" && guidaInMano.indice === k) ? null : (
            <div key={`gy${k}`} className="guida guida-y" style={{ top: `${g}%` }} title="Trascina per spostare, fuori dal foglio per togliere"
              onMouseDown={(e) => { if (!canEdit) return; e.stopPropagation(); e.preventDefault(); setGuidaInMano({ asse: "y", indice: k, pos: g }); }} />
          ))}
          {guidaInMano && guidaInMano.pos >= 0 && guidaInMano.pos <= 100 && (
            <div className={`guida guida-${guidaInMano.asse} in-mano`} style={guidaInMano.asse === "x" ? { left: `${guidaInMano.pos}%` } : { top: `${guidaInMano.pos}%` }} />
          )}
          {/* guide intelligenti: dove il campo si è agganciato */}
          {lineeAttive.x !== undefined && <div className="guida-smart guida-x" style={{ left: `${lineeAttive.x}%` }} />}
          {lineeAttive.y !== undefined && <div className="guida-smart guida-y" style={{ top: `${lineeAttive.y}%` }} />}
          {/* distanze in mm dal vicino più prossimo, mentre si sposta */}
          {trascinando && selItem && distanzeDi(selItem).map((d, k) => (
            <div key={`d${k}`} className={`distanza distanza-${d.asse}`}
              style={d.asse === "x"
                ? { left: `${d.da}%`, width: `${d.a - d.da}%`, top: `${d.pos}%` }
                : { top: `${d.da}%`, height: `${d.a - d.da}%`, left: `${d.pos}%` }}>
              <span>{d.mm.toFixed(1).replace(".", ",")} mm</span>
            </div>
          ))}
          {/* rettangolo di selezione */}
          {rettangolo && (
            <div className="editor-rettangolo" style={{
              left: `${Math.min(rettangolo.x0, rettangolo.x1)}%`, top: `${Math.min(rettangolo.y0, rettangolo.y1)}%`,
              width: `${Math.abs(rettangolo.x1 - rettangolo.x0)}%`, height: `${Math.abs(rettangolo.y1 - rettangolo.y0)}%`,
            }} />
          )}
        </div>
        </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
          Anteprima con un prodotto di esempio · trascina i campi, ridimensiona dall&apos;angolo · trascina sul foglio vuoto per sceglierne più d&apos;uno · Ctrl+D duplica, Ctrl+C/V copia e incolla, Ctrl+G raggruppa, Canc elimina, Ctrl+Z annulla · spazio + trascina sposta la vista, Ctrl + rotellina zoom.
        </p>
      </div>

      <div className="card editor-panel" style={{ padding: 14 }}>
        {/* i comandi del campo selezionato: tutto il pannello, distribuiti su più colonne */}
        <div className="panel-col panel-col-campo">
        {!selItem && <p className="hint" style={{ margin: 0 }}>Clicca un campo sul foglio per cambiarne carattere, colori, cornice e posizione. Ctrl + clic per sceglierne più d&apos;uno.</p>}
        {selItem && canEdit && (
          <div className="panel-campo">
            <div className="editor-livelli">
              {sceltiTutti.length > 1 && (
                <>
                  <strong>{sceltiTutti.length} campi scelti insieme</strong>
                  <span className="hint">Si allineano sul primo scelto (bordo verde pieno).</span>
                  <div className="editor-allinea">
                    <button type="button" className="mini-btn" title="Allinea a sinistra" onClick={() => allinea("sx")}>⇤ Sx</button>
                    <button type="button" className="mini-btn" title="Centra in orizzontale" onClick={() => allinea("cx")}>↔ Centro</button>
                    <button type="button" className="mini-btn" title="Allinea a destra" onClick={() => allinea("dx")}>⇥ Dx</button>
                    <button type="button" className="mini-btn" title="Allinea in alto" onClick={() => allinea("alto")}>⇡ Alto</button>
                    <button type="button" className="mini-btn" title="Centra in verticale" onClick={() => allinea("cy")}>↕ Centro</button>
                    <button type="button" className="mini-btn" title="Allinea in basso" onClick={() => allinea("basso")}>⇣ Basso</button>
                    <button type="button" className="mini-btn" title="Stessa distanza in orizzontale (almeno 3 campi)" disabled={sceltiTutti.length < 3} onClick={() => allinea("distribH")}>Distribuisci ↔</button>
                    <button type="button" className="mini-btn" title="Stessa distanza in verticale (almeno 3 campi)" disabled={sceltiTutti.length < 3} onClick={() => allinea("distribV")}>Distribuisci ↕</button>
                    <button type="button" className="mini-btn" title="Stessa larghezza del primo scelto" onClick={() => allinea("largh")}>Stessa larghezza</button>
                    <button type="button" className="mini-btn" title="Stessa altezza del primo scelto" onClick={() => allinea("alt")}>Stessa altezza</button>
                  </div>
                </>
              )}
              <div className="editor-allinea">
                <button type="button" className="mini-btn" title="Duplica (Ctrl+D)" onClick={duplica}>⧉ Duplica</button>
                <button type="button" className="mini-btn" title="Copia (Ctrl+C): si incolla anche in un altro layout con Ctrl+V" onClick={copia}>Copia</button>
                <button type="button" className="mini-btn" title="Incolla (Ctrl+V)" onClick={incolla}>Incolla</button>
                {sceltiTutti.length > 1 && <button type="button" className="mini-btn" title="Raggruppa (Ctrl+G): si scelgono e si spostano insieme" onClick={() => raggruppa(true)}>⊞ Raggruppa</button>}
                {sceltiTutti.some((i) => activeItems[i]?.gruppo) && <button type="button" className="mini-btn" title="Separa il gruppo (Ctrl+Maiusc+G)" onClick={() => raggruppa(false)}>⊟ Separa</button>}
                {sceltiTutti.some((i) => activeItems[i]?.bloccato)
                  ? <button type="button" className="mini-btn" title="Torna a spostarsi e ridimensionarsi" onClick={() => blocca(false)}>🔓 Sblocca</button>
                  : <button type="button" className="mini-btn" title="Non si sposta né si ridimensiona per sbaglio" onClick={() => blocca(true)}>🔒 Blocca</button>}
              </div>
              <div className="editor-allinea">
                <span className="hint">Livello:</span>
                <button type="button" className="mini-btn" title="Sopra a tutto" onClick={() => cambiaLivello("primo")}>⤒ Primo piano</button>
                <button type="button" className="mini-btn" title="Su di un livello" onClick={() => cambiaLivello("avanti")}>↑ Avanti</button>
                <button type="button" className="mini-btn" title="Giù di un livello" onClick={() => cambiaLivello("indietro")}>↓ Indietro</button>
                <button type="button" className="mini-btn" title="Sotto a tutto" onClick={() => cambiaLivello("fondo")}>⤓ Secondo piano</button>
                <button type="button" className="mini-btn" style={{ color: "var(--red, #b42318)" }} title="Elimina (tasto Canc)" onClick={removeSelected}>✕ Elimina</button>
              </div>
            </div>
          </div>
        )}
        {/* effetti del testo, come in Word: interlinea, spaziatura, contorno e ombra */}
        {selItem && canEdit && !selItem.sticker && !isImageField(selItem.fieldId) && selItem.fieldId !== ELEMENTO_QR && (selItem.fieldId !== ELEMENTO_RIQUADRO || !!selItem.testo) && (
          <div className="panel-campo">
            <Sezione titolo="Effetti del testo" aperta={!!(selItem.interlinea || selItem.spaziatura || selItem.contorno || selItem.ombra)}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label className="field" style={{ marginBottom: 0 }}>Interlinea
                  <input type="number" step={0.05} min={0.6} max={3} value={selItem.interlinea ?? 1.2}
                    onChange={(e) => updateSelected({ interlinea: Number(e.target.value) === 1.2 ? undefined : Number(e.target.value) })} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>Spazio fra le lettere
                  <input type="number" step={0.01} min={-0.2} max={1} value={selItem.spaziatura ?? 0}
                    onChange={(e) => updateSelected({ spaziatura: Number(e.target.value) || undefined })} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>Contorno (mm)
                  <input type="number" step={0.1} min={0} max={3} value={selItem.contorno?.spessore ?? 0}
                    onChange={(e) => updateSelected({ contorno: Number(e.target.value) > 0 ? { colore: selItem.contorno?.colore ?? "#ffffff", spessore: Number(e.target.value) } : undefined })} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>Colore contorno
                  <input type="color" value={selItem.contorno?.colore ?? "#ffffff"} disabled={!selItem.contorno}
                    onChange={(e) => updateSelected({ contorno: { colore: e.target.value, spessore: selItem.contorno?.spessore ?? 0.3 } })} />
                </label>
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 8 }}>
                <input type="checkbox" checked={!!selItem.ombra} onChange={(e) => updateSelected({ ombra: e.target.checked || undefined })} /> Ombra
              </label>
            </Sezione>
          </div>
        )}
        {selItem?.sticker && canEdit && (
          <div className="panel-campo">
          <Sezione titolo="Sticker selezionato">
            <label className="field">
              Cosa scrive
              <select value={typeof selItem.testo === "string" ? "__testo" : selItem.fieldId}
                onChange={(e) => e.target.value === "__testo"
                  ? updateSelected({ testo: selItem.testo || "Novità" })
                  : updateSelected({ fieldId: e.target.value, testo: undefined })}>
                <option value="__testo">Testo libero (sempre uguale)</option>
                {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            {typeof selItem.testo === "string" && (
              <label className="field">
                Testo del bollino
                <input type="text" value={selItem.testo} maxLength={60} placeholder="es. Nuovo, -20%, Bio"
                  onChange={(e) => updateSelected({ testo: e.target.value })} />
                <span className="hint" style={{ fontSize: 11.5 }}>Compare su tutti i cartelli con questo layout. Per andare a capo: due spazi.</span>
              </label>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label className="field">
                Forma
                <select value={selItem.sticker.shape} onChange={(e) => updateSelected({ sticker: { shape: e.target.value as StickerStyle["shape"] } })}>
                  <option value="cerchio">Cerchio</option>
                  <option value="quadrato">Quadrato</option>
                  <option value="stella">Stella/burst</option>
                  <option value="nastro">Nastro</option>
                </select>
              </label>
              <label className="field">
                Font
                <select value={selItem.sticker.font ?? ""} onChange={(e) => updateSelected({ sticker: { font: e.target.value === "cn" ? "cn" : undefined } })}>
                  <option value="">Avenir</option>
                  <option value="cn">Avenir Condensed</option>
                </select>
              </label>
              <label className="field">
                Colore sfondo
                <input type="color" value={selItem.sticker.bg} onChange={(e) => updateSelected({ sticker: { bg: e.target.value } })} style={{ width: "100%", height: 34, padding: 2 }} />
              </label>
              <label className="field">
                Colore testo
                <input type="color" value={selItem.color ?? "#ffffff"} onChange={(e) => updateSelected({ color: e.target.value })} style={{ width: "100%", height: 34, padding: 2 }} />
              </label>
            </div>
            <label className="field">
              Rotazione: {selItem.sticker.rotation}°
              <input type="range" min={-180} max={180} value={selItem.sticker.rotation} onChange={(e) => updateSelected({ sticker: { rotation: Number(e.target.value) } })} style={{ width: "100%" }} />
            </label>
            <label className="field">
              Dimensione testo: {selItem.sticker.size}
              <input type="range" min={6} max={60} value={selItem.sticker.size} onChange={(e) => updateSelected({ sticker: { size: Number(e.target.value) } })} style={{ width: "100%" }} />
            </label>
          </Sezione>
          </div>
        )}
        {/* scritta fissa / didascalia del QR: il testo che si stampa uguale su tutti i cartelli */}
        {selItem && (selItem.fieldId === ELEMENTO_RIQUADRO || selItem.fieldId === ELEMENTO_QR) && canEdit && (
          <div className="panel-campo">
          <Sezione titolo={selItem.fieldId === ELEMENTO_QR ? "QR code" : "Scritta fissa"}>
            {selItem.fieldId === ELEMENTO_QR && (
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
                Porta alla scheda online del prodotto, con i campi scelti nella pagina «Scheda online».
                Tienilo almeno 15 mm di lato. Se la scheda online è spenta, in stampa non esce.
              </p>
            )}
            <label className="field">
              {selItem.fieldId === ELEMENTO_QR ? "Didascalia sotto al codice" : "Testo"}
              <textarea rows={2} value={selItem.testo ?? ""} onChange={(e) => updateSelected({ testo: e.target.value })}
                placeholder={selItem.fieldId === ELEMENTO_QR ? "es. Inquadra per la scheda completa" : "es. il nostro prezzo:"} />
            </label>
          </Sezione>
          </div>
        )}
        {/* prefisso del valore: l'euro davanti al prezzo dell'Arredo, che arriva senza simbolo */}
        {selItem && isPrezzoField(selItem.fieldId) && canEdit && (
          <div className="panel-campo">
          <Sezione titolo="Simbolo davanti al prezzo" aperta={false}>
            <div style={{ display: "flex", gap: 4 }}>
              {["", "€"].map((p) => (
                <button key={p || "nessuno"} type="button" className={`btn btn-sm ${(selItem.prefisso ?? "") === p ? "" : "btn-outline"}`} style={{ flex: 1 }}
                  onClick={() => updateSelected({ prefisso: p || undefined })}>
                  {p || "nessuno"}
                </button>
              ))}
            </div>
          </Sezione>
          </div>
        )}
        {/* cornice: titolo con icona, bordo e spazio interno — la grafica che prima stava nello sfondo */}
        {selItem && !selItem.sticker && selItem.fieldId !== ELEMENTO_QR && selItem.fieldId !== ELEMENTO_IMMAGINE && canEdit && (
          <div className="panel-campo">
          <Sezione titolo="Cornice e titolo" aperta={!!selItem.cornice}>
            <label className="field">
              Titolo sopra al valore
              <input type="text" value={selItem.cornice?.titolo ?? ""} onChange={(e) => updateSelected({ cornice: { titolo: e.target.value } })}
                placeholder="es. misure imballo:" />
            </label>
            {selItem.cornice?.titolo && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label className="field">
                    Stile
                    <select value={selItem.cornice?.stile ?? "linee"} onChange={(e) => updateSelected({ cornice: { stile: e.target.value as Cornice["stile"] } })}>
                      <option value="linee">Riga sopra e sotto</option>
                      <option value="fascia">Fascia colorata</option>
                      <option value="semplice">Solo testo</option>
                    </select>
                  </label>
                  <label className="field">
                    Corpo: {selItem.cornice?.size ?? 12}
                    <input type="range" min={5} max={40} value={selItem.cornice?.size ?? 12}
                      onChange={(e) => updateSelected({ cornice: { size: Number(e.target.value) } })} style={{ width: "100%" }} />
                  </label>
                </div>
                <label className="field">
                  Icona nel quadratino
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                    {ICONE_TITOLO.map((ic) => (
                      <button key={ic} type="button" className={`btn btn-sm ${selItem.cornice?.icona === ic ? "" : "btn-outline"}`} style={{ padding: "0 8px", minWidth: 30 }}
                        onClick={() => updateSelected({ cornice: { icona: ic } })}>{ic}</button>
                    ))}
                    <input type="text" value={selItem.cornice?.icona ?? ""} maxLength={2} style={{ width: 44, marginTop: 0 }}
                      onChange={(e) => updateSelected({ cornice: { icona: e.target.value } })} placeholder="…" />
                    <button type="button" className="btn btn-outline btn-sm" style={{ padding: "0 8px" }} onClick={() => updateSelected({ cornice: { icona: undefined } })}>nessuna</button>
                  </div>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label className="field">
                    Colore titolo
                    <input type="color" value={selItem.cornice?.colore ?? (selItem.cornice?.stile === "fascia" ? "#ffffff" : "#111111")}
                      onChange={(e) => updateSelected({ cornice: { colore: e.target.value } })} style={{ width: "100%", height: 34, padding: 2 }} />
                  </label>
                  <label className="field">
                    {selItem.cornice?.stile === "fascia" ? "Colore fascia e icona" : "Colore icona"}
                    <input type="color" value={selItem.cornice?.sfondo ?? (selItem.cornice?.stile === "fascia" ? "#a6c788" : "#9bc77d")}
                      onChange={(e) => updateSelected({ cornice: { sfondo: e.target.value } })} style={{ width: "100%", height: 34, padding: 2 }} />
                  </label>
                </div>
              </>
            )}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 8 }}>
              <input type="checkbox" checked={!!selItem.cornice?.bordoColore}
                onChange={(e) => updateSelected({ cornice: { bordoColore: e.target.checked ? "#111111" : undefined } })} />
              Bordo del riquadro
            </label>
            {selItem.cornice?.bordoColore && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <label className="field">
                  Colore
                  <input type="color" value={selItem.cornice.bordoColore} onChange={(e) => updateSelected({ cornice: { bordoColore: e.target.value } })} style={{ width: "100%", height: 34, padding: 2 }} />
                </label>
                <label className="field">
                  Spessore (mm)
                  <input type="number" min={0.1} max={10} step={0.1} value={selItem.cornice.bordoSpessore ?? 0.3}
                    onChange={(e) => updateSelected({ cornice: { bordoSpessore: Number(e.target.value) || 0.3 } })} />
                </label>
                <label className="field">
                  Lati
                  <select value={selItem.cornice.bordoLati ?? "tutti"} onChange={(e) => updateSelected({ cornice: { bordoLati: e.target.value as Cornice["bordoLati"] } })}>
                    <option value="tutti">Tutti</option>
                    <option value="sopra">Solo sopra</option>
                    <option value="sotto">Solo sotto</option>
                    <option value="sopra-sotto">Sopra e sotto</option>
                  </select>
                </label>
              </div>
            )}
            <label className="field" style={{ marginBottom: 4 }}>
              Spazio interno: {(selItem.cornice?.padding ?? 0).toFixed(1)} mm
              <input type="range" min={0} max={15} step={0.5} value={selItem.cornice?.padding ?? 0}
                onChange={(e) => updateSelected({ cornice: { padding: Number(e.target.value) } })} style={{ width: "100%" }} />
            </label>
            {selItem.cornice && (
              <button type="button" className="btn btn-outline btn-sm" style={{ width: "100%" }} onClick={() => updateSelected({ cornice: undefined })}>
                Togli cornice e titolo
              </button>
            )}
          </Sezione>
          </div>
        )}
        {/* sfondo e angoli: valgono per qualsiasi riquadro selezionato, testo o immagine che sia */}
        {selItem && !selItem.sticker && canEdit && (
          <div className="panel-campo">
          <Sezione titolo="Sfondo del riquadro" aperta={false}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={selItem.bg !== undefined}
                onChange={(e) => updateSelected({ bg: e.target.checked ? "#ffffff" : undefined })}
              />
              Riquadro con sfondo colorato
            </label>
            {selItem.bg !== undefined && (
              <label className="field" style={{ marginBottom: 10 }}>
                Colore
                <input type="color" value={selItem.bg} onChange={(e) => updateSelected({ bg: e.target.value })}
                  style={{ width: "100%", height: 34, padding: 2 }} />
              </label>
            )}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={(selItem.radius ?? 0) > 0}
                onChange={(e) => updateSelected({ radius: e.target.checked ? 3 : 0 })}
              />
              Angoli arrotondati
            </label>
            {(selItem.radius ?? 0) > 0 && (
              <label className="field" style={{ marginBottom: 0 }}>
                Raggio: {inUnita(selItem.radius ?? 0)} {unita}
                <input type="range" min={0} max={20} step={0.5} value={selItem.radius ?? 0}
                  onChange={(e) => updateSelected({ radius: Number(e.target.value) })} style={{ width: "100%" }} />
              </label>
            )}
          </Sezione>
          </div>
        )}
        {selItem && !selItem.sticker && !isImageField(selItem.fieldId) && canEdit && (
          <div className="panel-campo">
          <Sezione titolo="Campo selezionato">
            <label className="field">
              Carattere
              <select value={selItem.font ?? ""} onChange={(e) => updateSelected({ font: e.target.value })}>
                {LAYOUT_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                {fontPropri.length > 0 && (
                  <optgroup label="Font caricati">
                    {fontPropri.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="field">
              Dimensione font
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="range" min={6} max={200}
                  value={selItem.size ?? fields.find((f) => f.id === selItem.fieldId)?.size ?? 11}
                  onChange={(e) => updateSelected({ size: Number(e.target.value) })}
                  style={{ flex: 1 }}
                />
                {/* casella accanto al cursore: sui prezzi grandi serve il numero esatto, non la posizione del cursore */}
                <NumeroConLimiti
                  key={selected}
                  valore={selItem.size ?? fields.find((f) => f.id === selItem.fieldId)?.size ?? 11}
                  min={6} max={400}
                  onCommit={(n) => updateSelected({ size: n })}
                  style={{ width: 68, marginTop: 0 }}
                />
              </span>
            </label>
            <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={selItem.bold ?? fields.find((f) => f.id === selItem.fieldId)?.bold ?? false}
                  onChange={(e) => updateSelected({ bold: e.target.checked })}
                />
                Grassetto
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" checked={selItem.italic ?? false} onChange={(e) => updateSelected({ italic: e.target.checked })} />
                Corsivo
              </label>
            </div>
            <label className="field" style={{ marginBottom: 10 }}>
              Allineamento del testo
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`btn btn-sm ${(selItem.align ?? (isPrezzoField(selItem.fieldId) ? "right" : "left")) === a ? "" : "btn-outline"}`}
                    style={{ flex: 1 }}
                    onClick={() => updateSelected({ align: a })}
                    title={a === "left" ? "Sinistra" : a === "center" ? "Centro" : "Destra"}
                  >
                    {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
                  </button>
                ))}
              </div>
            </label>
            {/* dove sta il testo dentro al suo riquadro: il prezzo centrato in
                verticale è la richiesta più frequente sui riquadri alti */}
            <label className="field" style={{ marginBottom: 10 }}>
              Testo nel riquadro
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {([["top", "⇡", "In alto"], ["middle", "↕", "Centrato"], ["bottom", "⇣", "In basso"]] as const).map(([v, icona, titolo]) => (
                  <button
                    key={v}
                    type="button"
                    className={`btn btn-sm ${(selItem.valign ?? "top") === v ? "" : "btn-outline"}`}
                    style={{ flex: 1 }}
                    onClick={() => updateSelected({ valign: v })}
                    title={titolo}
                  >
                    {icona}
                  </button>
                ))}
              </div>
            </label>
            {/* colore del testo: i colori di casa a portata di clic, più la ruota per gli altri */}
            <label className="field" style={{ marginBottom: 10 }}>
              Colore del testo
              <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                {COLORI_TESTO.map((c) => (
                  <button
                    key={c.valore}
                    type="button"
                    onClick={() => updateSelected({ color: c.valore })}
                    title={c.nome}
                    style={{
                      width: 24, height: 24, borderRadius: 6, cursor: "pointer",
                      background: c.valore, border: (selItem.color ?? "") === c.valore ? "3px solid var(--green-600)" : "1px solid var(--line)",
                    }}
                  />
                ))}
                <input type="color" value={selItem.color ?? coloreCampo(selItem)}
                  onChange={(e) => updateSelected({ color: e.target.value })}
                  title="Scegli un colore qualsiasi" style={{ width: 34, height: 26, padding: 2, marginTop: 0 }} />
                <button type="button" className="btn btn-outline btn-sm" style={{ padding: "0 8px" }}
                  onClick={() => updateSelected({ color: undefined })}
                  title="Torna al colore predefinito del campo (rosso sul prezzo, nero sugli altri)">
                  predefinito
                </button>
              </div>
            </label>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>
              Misure sul foglio — {unita === "cm" ? "centimetri" : "millimetri"}{" "}
              <button type="button" className="btn btn-outline btn-sm" style={{ padding: "0 6px", fontSize: 11 }}
                onClick={() => setUnita((u) => (u === "cm" ? "mm" : "cm"))}>
                passa a {unita === "cm" ? "mm" : "cm"}
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                X ({unita})
                <input type="number" step={passo} value={inUnita(mmX(selItem.x))}
                  onChange={(e) => updateSelected({ x: Math.max(0, Math.min(100 - selItem.w, pctFromMmX(daUnita(e.target.value)))) })} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Y ({unita})
                <input type="number" step={passo} value={inUnita(mmY(selItem.y))}
                  onChange={(e) => updateSelected({ y: Math.max(0, Math.min(100 - selItem.h, pctFromMmY(daUnita(e.target.value)))) })} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Largh. ({unita})
                <input type="number" step={passo} value={inUnita(mmX(selItem.w))}
                  onChange={(e) => updateSelected({ w: Math.max(3, Math.min(100 - selItem.x, pctFromMmX(daUnita(e.target.value)))) })} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Alt. ({unita})
                <input type="number" step={passo} value={inUnita(mmY(selItem.h))}
                  onChange={(e) => updateSelected({ h: Math.max(2, Math.min(100 - selItem.y, pctFromMmY(daUnita(e.target.value)))) })} />
              </label>
            </div>
            <label className="field" style={{ marginBottom: 0 }}>
              Allinea sul foglio
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginTop: 4 }}>
                <button type="button" className="btn btn-outline btn-sm" title="Sinistra (al margine)" onClick={() => updateSelected({ x: bordoSx })}>⇤ Sx</button>
                <button type="button" className="btn btn-outline btn-sm" title="Centro orizzontale (fra i margini)" onClick={() => updateSelected({ x: bordoSx + (bordoDx - bordoSx - selItem.w) / 2 })}>↔ Centro</button>
                <button type="button" className="btn btn-outline btn-sm" title="Destra (al margine)" onClick={() => updateSelected({ x: bordoDx - selItem.w })}>⇥ Dx</button>
                <button type="button" className="btn btn-outline btn-sm" title="Alto (al margine)" onClick={() => updateSelected({ y: bordoAlto })}>⇡ Alto</button>
                <button type="button" className="btn btn-outline btn-sm" title="Centro verticale (fra i margini)" onClick={() => updateSelected({ y: bordoAlto + (bordoBasso - bordoAlto - selItem.h) / 2 })}>↕ Centro</button>
                <button type="button" className="btn btn-outline btn-sm" title="Basso (al margine)" onClick={() => updateSelected({ y: bordoBasso - selItem.h })}>⇣ Basso</button>
              </div>
              <span className="hint" style={{ fontSize: 11 }}>Si allinea ai margini del foglio, non al bordo della carta.</span>
            </label>
          </Sezione>
          </div>
        )}
        </div>
      </div>
    </div>
    </div>
  );
}
