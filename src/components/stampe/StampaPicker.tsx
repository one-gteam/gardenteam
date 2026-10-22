"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Evento con cui altri pezzi della pagina aggiungono un cartello ai selezionati (duplicati, cartelli nuovi). */
export const EVENTO_SELEZIONA = "stampa-seleziona";

/** Il testo in cui si cerca, senza accenti e maiuscole. */
const piano = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Interruttore a pillola: acceso = quella cosa esce sul cartello. Sostituisce
 * le spunte "nascondi…", che si leggevano al contrario e occupavano tre righe.
 */
function Interruttore({ acceso, on, off, titolo, onClick }: {
  acceso: boolean; on: string; off: string; titolo: string; onClick: () => void;
}) {
  return (
    <button type="button" className={`chip ${acceso ? "on" : "off"}`} title={titolo} onClick={onClick}>
      {acceso ? on : off}
    </button>
  );
}

interface ProdLite {
  id: string;
  titolo: string;
  codice: string;
  prezzo: string;
  tipologia: string;
  /** Prezzo di partenza dell'offerta (senza €), se c'è. */
  listino?: string;
  /** Quantità a magazzino dal gestionale collegato (somma dei codici del padre). */
  giacenza?: string;
  /** Codice dell'articolo nel gestionale collegato. */
  codiceGestionale?: string;
  /** Segnato non conforme da chi è in reparto: il motivo, se l'ha scritto. */
  nonConforme?: string;
  /** Altro testo in cui cercare (descrizioni degli articoli, EAN, marca, fornitore). */
  cerca?: string;
  /** Cartello proprio: l'etichetta da mostrare ("vostro", "condiviso da …"). */
  propria?: string;
  /** Nel volantino la voce è unita ad altre (il cartello resta separato): la nota da mostrare. */
  unione?: string;
  /** Gli articoli del padre (gusti, formati), da aprire nella lista. */
  articoli?: { ean: string; descrizione: string; giacenza?: number }[];
}

export interface StampaPickerProps {
  products: ProdLite[];
  /** Quanti prodotti passano i filtri in tutto: l'elenco ne mostra al massimo 150. */
  totale?: number;
  /** Indirizzo della stessa pagina senza il limite dei 150, quando ce ne sono di più. */
  mostraTuttiHref?: string;
  formats: { id: string; name: string }[];
  fields: { id: string; label: string }[];
  scopeParam: string;
  filters: Record<string, string>;
  initialSelected: string[];
  /** Prodotti già selezionati che i filtri hanno nascosto: restano in tabella. */
  prodottiSelezionati?: ProdLite[];
  initialFormats: Record<string, string>;
  initialPrices: Record<string, string>;
  initialNoPrice: Record<string, boolean>;
  initialHidden: Record<string, string[]>;
  globalFormat: string;
  baseUrl?: string; // pagina di stampa da richiamare (default: arredo)
  printed?: Record<string, string>; // id → data ISO dell'ultima stampa in questo ambito
  /** Segna come stampati al momento della stampa; con le impostazioni di ogni cartello, finiscono anche in «Già stampati». */
  onPrint?: (ids: string[], vociJson?: string) => Promise<{ ok: boolean }>;
  /** Colonna «Copie»: quante volte stampare ogni cartello (copie_<id> nell'indirizzo). */
  conCopie?: boolean;
  initialCopie?: Record<string, number>;
  /** Carta per formato (A5/A6…): più cartelli per foglio A4 o la carta del formato. Di partenza dalle Preferenze di stampa. */
  cartaIniziale?: Record<string, "a4" | "formato">;
  /** Salva i parametri di una stampa troppo lunga per l'indirizzo e ne dà l'id (?ripresa=id). */
  salvaSelezione?: (query: string) => Promise<string | null>;
  /** Misure dei formati, per sapere quanti ne stanno su un A4. */
  misureFormati?: Record<string, { w: number; h: number }>;
  /** Prezzi di partenza (barrati) scritti a mano per il singolo cartello. */
  initialListini?: Record<string, string>;
  /** Cartelli da stampare senza foto, anche se l'articolo ce l'ha. */
  initialNoPhoto?: Record<string, boolean>;
  /** Layout scelto per il singolo cartello (vuoto = quello automatico) e i layout fra cui scegliere. */
  initialLayouts?: Record<string, string>;
  layoutScelte?: { id: string; formatId: string; nome: string; tipologie?: string[] }[];
  /** Cartelli senza il prezzo di partenza: al suo posto esce «A SOLI». */
  initialNoListino?: Record<string, boolean>;
  /**
   * Salva in PDF direttamente (senza aprire l'anteprima di stampa): riceve il
   * nome del file e i parametri dei cartelli. Senza, si apre l'anteprima.
   */
  onPdf?: (nome: string, query: string) => Promise<void>;
  /** Mette i cartelli selezionati in coda ("dopo" o "arrivo") con le loro impostazioni. */
  onQueue?: (stato: "dopo" | "arrivo", vociJson: string) => Promise<{ ok: boolean; n: number }>;
  /**
   * Chiamato a ogni cambio di selezione o di impostazioni con i parametri
   * dell'anteprima: chi lo riceve può ridisegnare i cartelli senza ricaricare.
   */
  onChange?: (query: string) => void;
  /** "Aggiorna anteprima": se c'è, sostituisce la navigazione alla stessa pagina. */
  onPreview?: () => void;
  /** Apre il pannello dei testi del cartello di quella riga (Stampa Zoo). */
  onPersonalizza?: (id: string) => void;
  /** Duplica il cartello di quella riga in uno proprio. */
  onDuplica?: (id: string) => void;
  /**
   * La ricerca filtra l'elenco nel browser, subito, senza tornare al server; e
   * la selezione resta mentre si cercano altri prodotti.
   */
  cercaNelBrowser?: boolean;
  /** Testo iniziale della ricerca (dall'indirizzo). */
  cercaIniziale?: string;
  /** Pulsante "Nuovo cartello" da mettere in testa all'elenco. */
  nuovoCartello?: ReactNode;
}

/** Selezione prodotti per la stampa: click per aggiungere, Shift+click per intervalli, formato per riga. */
export default function StampaPicker({
  products,
  totale,
  mostraTuttiHref,
  formats,
  fields,
  scopeParam,
  filters,
  initialSelected,
  prodottiSelezionati = [],
  initialFormats,
  initialPrices,
  initialNoPrice,
  initialHidden,
  globalFormat,
  baseUrl = "/stampe/arredo/stampa",
  printed,
  onPrint,
  conCopie = false,
  initialCopie,
  cartaIniziale,
  misureFormati,
  salvaSelezione,
  initialListini,
  initialNoPhoto,
  initialNoListino,
  initialLayouts,
  layoutScelte = [],
  onQueue,
  onPdf,
  onChange,
  onPreview,
  onPersonalizza,
  onDuplica,
  cercaNelBrowser = false,
  cercaIniziale = "",
  nuovoCartello,
}: StampaPickerProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [rowFormat, setRowFormat] = useState<Record<string, string>>(initialFormats);
  const [prices, setPrices] = useState<Record<string, string>>(initialPrices);
  const [listini, setListini] = useState<Record<string, string>>(initialListini ?? {});
  const [noPrice, setNoPrice] = useState<Record<string, boolean>>(initialNoPrice);
  const [noPhoto, setNoPhoto] = useState<Record<string, boolean>>(initialNoPhoto ?? {});
  const [noListino, setNoListino] = useState<Record<string, boolean>>(initialNoListino ?? {});
  const [esitoCoda, setEsitoCoda] = useState("");
  const [hiddenFields, setHiddenFields] = useState<Record<string, string[]>>(initialHidden);
  const [rowLayout, setRowLayout] = useState<Record<string, string>>(initialLayouts ?? {});
  const [copie, setCopie] = useState<Record<string, number>>(initialCopie ?? {});
  const [carta, setCarta] = useState<Record<string, "a4" | "formato">>(cartaIniziale ?? {});
  const [copieTutti, setCopieTutti] = useState("");
  const copieDi = (id: string) => Math.max(1, Math.min(99, Math.floor(copie[id] ?? 1)));
  const [aperti, setAperti] = useState<string[]>([]); // voci della lista con gli articoli aperti
  const [applyAll, setApplyAll] = useState(globalFormat);
  /* A5: di serie due cartelli per foglio A4, ognuno stampato due volte */
  const [doppio, setDoppio] = useState(true);
  const [cerca, setCerca] = useState(cercaIniziale);
  const [limite, setLimite] = useState(200);
  /*
   * La ricerca gira qui, sull'elenco già arrivato: prima ogni ricerca era un
   * giro dal server (lento), e cercare un secondo prodotto azzerava i
   * selezionati. Ogni parola deve comparire da qualche parte nella riga.
   */
  const indice = useMemo(
    () => new Map(products.map((p) => [p.id, piano(`${p.titolo} ${p.codice} ${p.tipologia} ${p.codiceGestionale ?? ""} ${p.cerca ?? ""}`)])),
    [products],
  );
  const filtrati = useMemo(() => {
    const parole = piano(cerca).split(/\s+/).filter(Boolean);
    if (!cercaNelBrowser || parole.length === 0) return products;
    return products.filter((p) => parole.every((w) => indice.get(p.id)?.includes(w)));
  }, [products, cerca, cercaNelBrowser, indice]);
  useEffect(() => { setLimite(200); }, [cerca]);
  const mostrati = cercaNelBrowser ? filtrati.slice(0, limite) : products;
  /* righe spuntate nella tabella dei selezionati: si tolgono in blocco, senza
     cliccare la ✕ una per una quando la lista è lunga */
  const [daTogliere, setDaTogliere] = useState<string[]>([]);
  // ultima casella cliccata nella tabella dei selezionati: con Maiusc si spunta l'intervallo
  const ultimaSpunta = useRef<number | null>(null);
  const menuCoda = useRef<HTMLDetailsElement>(null);
  const lastIndex = useRef<number | null>(null);

  // un duplicato o un cartello nuovo arriva da fuori: entra fra i selezionati
  useEffect(() => {
    const ascolta = (e: Event) => {
      const { id, al, togli, formato } = (e as CustomEvent<{ id: string; al?: string; togli?: boolean; formato?: string }>).detail;
      if (togli) { setSelected((prev) => prev.filter((x) => x !== id)); return; }
      setSelected((prev) => {
        if (prev.includes(id)) return prev;
        const dopo = al ? prev.indexOf(al) : -1;
        return dopo >= 0 ? [...prev.slice(0, dopo + 1), id, ...prev.slice(dopo + 1)] : [...prev, id];
      });
      if (formato) setRowFormat((prev) => ({ ...prev, [id]: formato }));
      else if (al) setRowFormat((prev) => (prev[al] ? { ...prev, [id]: prev[al] } : prev));
    };
    window.addEventListener(EVENTO_SELEZIONA, ascolta);
    return () => window.removeEventListener(EVENTO_SELEZIONA, ascolta);
  }, []);

  const toggle = (index: number, shift: boolean) => {
    const elenco = mostrati;
    const id = elenco[index].id;
    if (shift && lastIndex.current !== null && lastIndex.current < elenco.length) {
      const [a, b] = [Math.min(lastIndex.current, index), Math.max(lastIndex.current, index)];
      const range = elenco.slice(a, b + 1).map((p) => p.id);
      setSelected((prev) => [...prev, ...range.filter((x) => !prev.includes(x))]);
    } else {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
    lastIndex.current = index;
  };

  const buildUrl = (print: boolean) => {
    const params = new URLSearchParams({ scope: scopeParam });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    params.set("sel", selected.join(","));
    params.set("formato", applyAll);
    for (const id of selected) {
      if (rowFormat[id] && rowFormat[id] !== applyAll) params.set(`formato_${id}`, rowFormat[id]);
      if (prices[id]) params.set(`prezzo_${id}`, prices[id]);
      if (listini[id]) params.set(`listino_${id}`, listini[id]);
      if (noPrice[id]) params.set(`noprezzo_${id}`, "1");
      if (noPhoto[id]) params.set(`senzafoto_${id}`, "1");
      if (noListino[id]) params.set(`nolistino_${id}`, "1");
      if (hiddenFields[id]?.length) params.set(`nascondi_${id}`, hiddenFields[id].join(","));
      // il layout scelto vale solo se è del formato di quel cartello
      const lay = layoutScelte.find((l) => l.id === rowLayout[id]);
      if (lay && lay.formatId === (rowFormat[id] ?? applyAll)) params.set(`layout_${id}`, lay.id);
      if (conCopie && copieDi(id) > 1) params.set(`copie_${id}`, String(copieDi(id)));
    }
    if (!doppio) params.set("doppio", "0");
    for (const [fid, c] of Object.entries(carta)) params.set(`carta_${fid}`, c);
    if (print) params.set("print", "1");
    return `${baseUrl}?${params.toString()}`;
  };

  /*
   * L'indirizzo della pagina segue selezione e impostazioni: "Svuota" o "Togli
   * gli spuntati" cambiavano solo lo schermo, e al primo aggiornamento i
   * prodotti tornavano su. E cambiando un filtro (che ricarica la pagina) i
   * selezionati restano, con i loro formati e prezzi.
   */
  const indirizzo = buildUrl(false).split("?")[1];
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const gestiti = (k: string) =>
      ["sel", "formato", "doppio", "print", "pdf"].includes(k) || /^(formato|prezzo|listino|noprezzo|senzafoto|nolistino|nascondi|layout|copie)_/.test(k);
    // la carta non resta nell'indirizzo: a ogni apertura riparte dalle Preferenze di stampa
    for (const k of [...url.searchParams.keys()]) if (gestiti(k) || k.startsWith("carta_")) url.searchParams.delete(k);
    for (const [k, v] of new URLSearchParams(indirizzo)) if (gestiti(k) && v) url.searchParams.set(k, v);
    if (selected.length === 0) url.searchParams.delete("sel");
    if (url.toString() !== window.location.href) window.history.replaceState(null, "", url.toString());
  }, [indirizzo, selected.length]);

  /* i formati scelti che su un A4 ne stanno più di uno (A5, A6…): per loro si sceglie la carta */
  const formatiUsati = [...new Set(selected.map((id) => rowFormat[id] ?? applyAll))];
  const multipli = formatiUsati.map((fid) => {
    const m = misureFormati?.[fid];
    if (!m) return null;
    const n = (W: number, H: number) => Math.floor((W + 0.5) / m.w) * Math.floor((H + 0.5) / m.h);
    const per = Math.max(n(210, 297), n(297, 210));
    return per > 1 ? { fid, per, nome: formats.find((f) => f.id === fid)?.name.replace(/\s*\(.*\)\s*/, "") ?? fid } : null;
  }).filter(Boolean) as { fid: string; per: number; nome: string }[];
  const anyA5 = selected.some((id) => ["a5", "za5"].includes(rowFormat[id] ?? applyAll)) && carta.za5 !== "formato";

  /** Le impostazioni di un cartello con gli stessi nomi dell'indirizzo di stampa: così la coda le rigioca tali e quali. */
  const impostazioniDi = (id: string): Record<string, string> => {
    const out: Record<string, string> = { [`formato_${id}`]: rowFormat[id] ?? applyAll };
    if (prices[id]) out[`prezzo_${id}`] = prices[id];
    if (listini[id]) out[`listino_${id}`] = listini[id];
    if (noPrice[id]) out[`noprezzo_${id}`] = "1";
    if (noListino[id]) out[`nolistino_${id}`] = "1";
    if (noPhoto[id]) out[`senzafoto_${id}`] = "1";
    if (hiddenFields[id]?.length) out[`nascondi_${id}`] = hiddenFields[id].join(",");
    const lay = layoutScelte.find((l) => l.id === rowLayout[id]);
    if (lay && lay.formatId === (rowFormat[id] ?? applyAll)) out[`layout_${id}`] = lay.id;
    if (conCopie && copieDi(id) > 1) out[`copie_${id}`] = String(copieDi(id));
    return out;
  };
  /** Cosa si manda a onPrint: le impostazioni di ogni cartello, per l'elenco «Già stampati». */
  const vociStampa = () => JSON.stringify(selected.map((id) => ({ offerId: id, impostazioni: impostazioniDi(id) })));
  /* Copie: frecce su/giù e Invio passano alla casella del cartello dopo (o prima) */
  const vaiACopie = (da: HTMLInputElement, passo: number) => {
    const tutte = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-copie]"));
    const i = tutte.indexOf(da);
    const dopo = tutte[i + passo];
    if (dopo) { dopo.focus(); dopo.select(); }
  };
  const inCoda = async (stato: "dopo" | "arrivo") => {
    if (!onQueue || selected.length === 0) return;
    // un nome alla lista: nella scheda Liste si ritrova e si spunta con un clic
    let lista = "";
    if (stato === "dopo") {
      const proposta = `Lista del ${new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}`;
      const scelto = window.prompt("Nome della lista (es. «Scaffale cani», «Giro del lunedì»):", proposta);
      if (scelto === null) return; // annullato
      lista = scelto.trim().slice(0, 60);
    }
    const r = await onQueue(stato, JSON.stringify(selected.map((id) => ({ offerId: id, impostazioni: impostazioniDi(id), ...(lista ? { lista } : {}) }))));
    setEsitoCoda(r.ok
      ? (stato === "dopo" ? `✓ ${r.n} cartelli messi da parte${lista ? ` nella lista «${lista}»` : ""}: li stampi quando vuoi da «Da stampare più tardi».` : `✓ ${r.n} cartelli segnati come merce in arrivo.`)
      : "Non sono riuscito a metterli in coda.");
    if (r.ok) setSelected([]);
  };
  /** Nasconde (o rimette) prezzo, prezzo di partenza o foto su tutti i cartelli selezionati insieme. */
  const nascondiSuTutti = (cosa: "prezzo" | "listino" | "foto", valore: boolean) => {
    const tutti = Object.fromEntries(selected.map((id) => [id, valore]));
    if (cosa === "prezzo") setNoPrice((prev) => ({ ...prev, ...tutti }));
    if (cosa === "listino") setNoListino((prev) => ({ ...prev, ...tutti }));
    if (cosa === "foto") setNoPhoto((prev) => ({ ...prev, ...tutti }));
  };

  // ogni cambiamento va all'anteprima dal vivo, se la pagina ne ha una
  const queryAnteprima = selected.length > 0 ? buildUrl(false).split("?")[1] : "";
  useEffect(() => {
    onChange?.(queryAnteprima);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryAnteprima]);

  const dataStampa = (id: string) =>
    printed?.[id] ? new Date(printed[id]).toLocaleDateString("it-IT") : undefined;

  /** Prima di aprire l'anteprima di stampa segna i cartelli come già stampati. */
  const vaiAllaStampa = async (nomePdf?: string) => {
    let url = buildUrl(true) + (nomePdf ? `&pdf=${encodeURIComponent(nomePdf)}` : "");
    /*
     * Con centinaia di cartelli l'indirizzo supera quello che il server accetta
     * e l'anteprima di stampa non si apriva: la selezione si salva e si apre
     * col suo numero.
     */
    if (url.length > 6000 && salvaSelezione) {
      const id = await salvaSelezione(buildUrl(false).split("?")[1]).catch(() => null);
      if (id) url = `${baseUrl}?scope=${encodeURIComponent(scopeParam)}&ripresa=${id}&print=1${nomePdf ? `&pdf=${encodeURIComponent(nomePdf)}` : ""}`;
    }
    if (onPrint && selected.length > 0) {
      try { await onPrint(selected, vociStampa()); } catch { /* la stampa non deve fallire per questo */ }
    }
    router.push(url);
  };

  /*
   * Un prodotto scelto prima e poi nascosto da un filtro restava selezionato —
   * e nell'anteprima — ma spariva dalla tabella: sembrava comparire un cartello
   * di troppo. Qui si guarda anche l'elenco dei selezionati fuori filtro.
   */
  const catalogo = [...products, ...prodottiSelezionati.filter((p) => !products.some((q) => q.id === p.id))];
  // un cartello appena creato arriva prima dei suoi dati: intanto ha una riga provvisoria
  const selectedProds = selected.map((id) => catalogo.find((p) => p.id === id)
    ?? (cercaNelBrowser ? { id, titolo: "Nuovo cartello…", codice: "", prezzo: "", tipologia: "" } : undefined))
    .filter(Boolean) as ProdLite[];

  return (
    <>
      {/* elenco con selezione multipla */}
      <div className="card elenco-prodotti">
        {cercaNelBrowser && (
          <div className="elenco-cerca">
            <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)}
              placeholder="Cerca prodotto, EAN, marca…" aria-label="Cerca nell'elenco" />
            {cerca && <button type="button" className="chip" onClick={() => setCerca("")} title="Svuota la ricerca">✕</button>}
          </div>
        )}
        <div style={{ padding: "4px 6px", fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
          {cercaNelBrowser ? (
            <>
              {filtrati.length} {filtrati.length === 1 ? "prodotto" : "prodotti"}{cerca ? ` su ${products.length}` : ""}
              {filtrati.length > mostrati.length && (
                <> · ne vedi {mostrati.length}: <button type="button" className="link-btn" onClick={() => setLimite(Infinity)}>mostrali tutti</button></>
              )}
              {" "}· <strong>+</strong> aggiunge ai selezionati e puoi cercare il prossimo
            </>
          ) : totale !== undefined && totale > products.length ? (
            <>
              {products.length} prodotti di {totale} — restringi la ricerca, oppure{" "}
              {mostraTuttiHref
                ? <a href={mostraTuttiHref}>mostrali tutti</a>
                : "mostrali tutti"} (la pagina diventa più lenta)
            </>
          ) : (
            <>{products.length} prodotti — clic per selezionare, <kbd>Shift</kbd>+clic per intervalli</>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, padding: "0 6px 8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            title="Aggiunge ai selezionati tutti i prodotti che vedi nell'elenco"
            onClick={() => setSelected((prev) => [...prev, ...filtrati.map((p) => p.id).filter((id) => !prev.includes(id))])}
          >
            Aggiungi tutti ({filtrati.length})
          </button>
          {nuovoCartello}
        </div>
        {mostrati.map((p, i) => {
          const isSel = selected.includes(p.id);
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className={`prod-item ${isSel ? "active" : ""}`}
              onClick={(e) => toggle(i, e.shiftKey)}
              onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i, e.shiftKey); } }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {p.titolo}
                {p.propria && <span className="pill pill-blue" style={{ marginLeft: 6, fontSize: 9.5 }} title="Cartello fatto da un'insegna o da un punto vendita">{p.propria}</span>}
                {p.unione && <span className="pill pill-purple" style={{ marginLeft: 6, fontSize: 9.5 }} title="Solo nel volantino: il cartello resta separato per prezzo">⛓ {p.unione}</span>}
                {p.nonConforme !== undefined && (
                  <span className="pill pill-orange" style={{ marginLeft: 6, fontSize: 9.5 }}
                    title={p.nonConforme || "Segnato non conforme dal reparto: da sistemare prima di stampare"}>
                    ⚠ non conforme
                  </span>
                )}
                {dataStampa(p.id) && (
                  <span className="pill pill-gray" style={{ marginLeft: 6, fontSize: 9.5 }} title={`Già stampato il ${dataStampa(p.id)}`}>
                    ✓ stampato
                  </span>
                )}
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {p.articoli?.length
                    ? (
                      <button type="button" className="link-btn" title="Mostra gli articoli di questo cartello"
                        onClick={(e) => { e.stopPropagation(); setAperti((a) => (a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id])); }}>
                        {aperti.includes(p.id) ? "▾" : "▸"} {p.codice}
                      </button>
                    )
                    : p.codice} · {p.prezzo ? `€ ${p.prezzo}` : <span style={{ color: "#b45309" }}>prezzo da definire</span>} · {p.tipologia}
                  {p.giacenza !== undefined && (
                    <span className={`pill ${Number(p.giacenza) > 0 ? "pill-green" : "pill-red"}`} style={{ marginLeft: 6, fontSize: 9.5 }}
                      title="Giacenza dal gestionale">
                      giac. {p.giacenza}
                    </span>
                  )}
                  {p.codiceGestionale && <span className="hint" style={{ marginLeft: 6 }} title="Codice nel gestionale">cod. {p.codiceGestionale}</span>}
                </div>
                {p.articoli && aperti.includes(p.id) && (
                  <ul className="articoli-voce" onClick={(e) => e.stopPropagation()}>
                    {p.articoli.map((a) => (
                      <li key={a.ean}>
                        <span>{a.descrizione}</span>
                        <span className="hint">{a.ean}{a.giacenza !== undefined ? ` · giac. ${a.giacenza}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className={`aggiungi ${isSel ? "dentro" : ""}`}
                title={isSel ? "È fra i selezionati: clic per toglierlo" : "Aggiungi ai selezionati"}
                onClick={(e) => { e.stopPropagation(); toggle(i, e.shiftKey); }}>
                {isSel ? "✓" : "+"}
              </button>
            </div>
          );
        })}
        {mostrati.length === 0 && <p className="empty" style={{ padding: 10 }}>Nessun prodotto{cerca ? ` con «${cerca}»` : ""}.</p>}
      </div>

      {/* selezionati */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <h2 style={{ margin: 0, flex: 1 }}>Selezionati ({selectedProds.length})</h2>
          <label style={{ fontSize: 12.5, fontWeight: 700 }} title="Il formato di tutti i cartelli selezionati; nella tabella si cambia riga per riga">
            Formato per tutti{" "}
            <select value={applyAll} style={{ marginTop: 0 }}
              onChange={(e) => { setApplyAll(e.target.value); setRowFormat(Object.fromEntries(selected.map((id) => [id, e.target.value]))); }}>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          {selectedProds.length > 0 && (
            <>
              <button type="button" className="btn btn-outline btn-sm" disabled={daTogliere.length === 0}
                onClick={() => { setSelected((prev) => prev.filter((x) => !daTogliere.includes(x))); setDaTogliere([]); }}
                title="Toglie dalla selezione le righe spuntate">
                Togli gli spuntati{daTogliere.length > 0 ? ` (${daTogliere.length})` : ""}
              </button>
              <button type="button" className="btn btn-outline btn-sm"
                onClick={() => { setSelected([]); setDaTogliere([]); }}
                title="Svuota tutta la selezione">
                Svuota
              </button>
            </>
          )}
        </div>
        {selectedProds.length === 0 && <p className="empty">Seleziona i prodotti dall&apos;elenco a sinistra (Shift+clic per più righe): l&apos;anteprima compare a destra.</p>}
        {selectedProds.length > 0 && daTogliere.length > 0 && (() => {
          const ids = daTogliere.filter((id) => selected.includes(id));
          const metti = (set: (u: (prev: Record<string, boolean>) => Record<string, boolean>) => void, v: boolean, solo: string[] = ids) =>
            set((prev) => ({ ...prev, ...Object.fromEntries(solo.map((id) => [id, v])) }));
          const formatiSpuntati = [...new Set(ids.map((id) => rowFormat[id] ?? applyAll))];
          return (
            <div className="blocco-spuntati">
              <strong>Ai {ids.length} spuntati:</strong>
              <label>Formato
                <select value="" onChange={(e) => { const v = e.target.value; if (!v) return; setRowFormat((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, v])) })); }}>
                  <option value="">—</option>
                  {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              {layoutScelte.some((l) => formatiSpuntati.includes(l.formatId)) && (
                <label>Layout
                  <select value="" onChange={(e) => {
                    const v = e.target.value;
                    const lay = layoutScelte.find((l) => l.id === v);
                    setRowLayout((prev) => ({ ...prev, ...Object.fromEntries(ids
                      .filter((id) => v === "auto" || (lay && lay.formatId === (rowFormat[id] ?? applyAll)))
                      .map((id) => [id, v === "auto" ? "" : v])) }));
                    const tip = lay?.tipologie ?? [];
                    const toccati = ids.filter((id) => lay && lay.formatId === (rowFormat[id] ?? applyAll));
                    if (tip.includes("Promo senza prezzo barrato")) metti(setNoListino, true, toccati);
                    else if (tip.includes("Promo con prezzo barrato")) metti(setNoListino, false, toccati);
                  }}>
                    <option value="">—</option>
                    <option value="auto">Automatico</option>
                    {layoutScelte.filter((l) => formatiSpuntati.includes(l.formatId)).map((l) => (
                      <option key={l.id} value={l.id}>{l.nome}{formatiSpuntati.length > 1 ? ` (${formats.find((f) => f.id === l.formatId)?.name ?? ""})` : ""}</option>
                    ))}
                  </select>
                </label>
              )}
              {conCopie && (
                <label>Copie
                  <input type="number" min={1} max={99} placeholder="—" style={{ width: 56 }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const n = Math.max(1, Math.min(99, Math.floor(Number((e.target as HTMLInputElement).value) || 1)));
                      setCopie((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, n])) }));
                    }}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const n = Math.max(1, Math.min(99, Math.floor(Number(v) || 1)));
                      setCopie((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, n])) }));
                    }} />
                </label>
              )}
              <span className="chips">
                <button type="button" className="chip" onClick={() => metti(setNoPrice, false)}>€ prezzo sì</button>
                <button type="button" className="chip" onClick={() => metti(setNoPrice, true)}>senza prezzo</button>
                <button type="button" className="chip" onClick={() => metti(setNoListino, false)}>barrato sì</button>
                <button type="button" className="chip" onClick={() => metti(setNoListino, true)}>A SOLI</button>
                <button type="button" className="chip" onClick={() => metti(setNoPhoto, false)}>foto sì</button>
                <button type="button" className="chip" onClick={() => metti(setNoPhoto, true)}>senza foto</button>
              </span>
              <details className="flag-details">
                <summary className="chip" style={{ opacity: 1 }}>Campi ▾</summary>
                <div className="flag-popover" style={{ maxHeight: 260, overflowY: "auto", zIndex: 60 }}>
                  <span className="hint" style={{ fontSize: 11 }}>Spunta = nascosto su tutti gli spuntati</span>
                  {fields.map((f) => {
                    const quanti = ids.filter((id) => hiddenFields[id]?.includes(f.id)).length;
                    return (
                      <label key={f.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={quanti === ids.length} ref={(el) => { if (el) el.indeterminate = quanti > 0 && quanti < ids.length; }}
                          onChange={(e) => setHiddenFields((prev) => {
                            const out = { ...prev };
                            for (const id of ids) {
                              const cur = out[id] ?? [];
                              out[id] = e.target.checked ? [...new Set([...cur, f.id])] : cur.filter((x) => x !== f.id);
                            }
                            return out;
                          })} />
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              </details>
            </div>
          );
        })()}
        {selectedProds.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox" title="Spunta tutte" checked={daTogliere.length === selectedProds.length && selectedProds.length > 0}
                      onChange={(e) => setDaTogliere(e.target.checked ? selectedProds.map((p) => p.id) : [])} />
                  </th>
                  <th>Prodotto</th>
                  {conCopie && (
                    <th title="Quante copie stampare di ogni cartello. Frecce o Invio: casella del cartello dopo">
                      Copie
                      <div style={{ display: "flex", gap: 3, marginTop: 3, fontWeight: 400 }}>
                        <input type="number" min={1} max={99} value={copieTutti} placeholder="tutti" title="Una quantità uguale per tutti i cartelli"
                          onChange={(e) => setCopieTutti(e.target.value)} style={{ width: 54, marginTop: 0, fontSize: 12 }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click(); } }} />
                        <button type="button" className="mini-btn" disabled={!copieTutti}
                          onClick={() => {
                            const n = Math.max(1, Math.min(99, Math.floor(Number(copieTutti) || 1)));
                            setCopie(Object.fromEntries(selected.map((id) => [id, n])));
                            setCopieTutti("");
                          }}>a tutti</button>
                      </div>
                    </th>
                  )}
                  <th>Formato</th><th>Prezzo cartello</th><th>Prezzo di partenza</th>
                  <th title="Cosa esce sul cartello: acceso = si stampa, spento = no">Sul cartello</th><th></th>
                </tr></thead>
                <tbody>
                  {selectedProds.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input type="checkbox" checked={daTogliere.includes(p.id)} title="Spunta per cambiare più cartelli insieme, o per toglierli dalla selezione (Maiusc+clic: un intervallo)"
                          onClick={(e) => {
                            const i = selectedProds.findIndex((x) => x.id === p.id);
                            const da = ultimaSpunta.current;
                            const acceso = (e.currentTarget as HTMLInputElement).checked;
                            if (e.shiftKey && da !== null && da < selectedProds.length && da !== i) {
                              const tratto = selectedProds.slice(Math.min(da, i), Math.max(da, i) + 1).map((x) => x.id);
                              setDaTogliere((prev) => (acceso ? [...new Set([...prev, ...tratto])] : prev.filter((x) => !tratto.includes(x))));
                            } else {
                              setDaTogliere((prev) => (acceso ? [...prev, p.id] : prev.filter((x) => x !== p.id)));
                            }
                            ultimaSpunta.current = i;
                          }}
                          onChange={() => { /* gestito nel clic, per sapere se c'è Maiusc */ }} />
                      </td>
                      <td>
                        <strong>{p.titolo}</strong>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.codice} · {p.tipologia}</div>
                      </td>
                      {conCopie && (
                        <td>
                          <input type="number" min={1} max={99} data-copie value={copie[p.id] ?? 1}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => { const n = Math.floor(Number(e.target.value)); setCopie((prev) => ({ ...prev, [p.id]: Number.isFinite(n) && n > 0 ? Math.min(99, n) : 1 })); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); vaiACopie(e.currentTarget, e.shiftKey && e.key === "Enter" ? -1 : 1); }
                              else if (e.key === "ArrowUp") { e.preventDefault(); vaiACopie(e.currentTarget, -1); }
                            }}
                            style={{ width: 54, marginTop: 0, fontWeight: (copie[p.id] ?? 1) > 1 ? 700 : 400 }} />
                        </td>
                      )}
                      <td>
                        <select
                          value={rowFormat[p.id] ?? applyAll}
                          onChange={(e) => setRowFormat((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          style={{ marginTop: 0, minWidth: 150 }}
                        >
                          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                        {layoutScelte.some((l) => l.formatId === (rowFormat[p.id] ?? applyAll)) && (
                          <select value={rowLayout[p.id] ?? ""} title="Il layout di questo cartello: automatico = quello giusto per il tipo di offerta"
                            onChange={(e) => {
                              const v = e.target.value;
                              setRowLayout((prev) => ({ ...prev, [p.id]: v }));
                              // il layout dice anche se c'è il barrato: l'interruttore lo segue
                              const tip = layoutScelte.find((l) => l.id === v)?.tipologie ?? [];
                              if (tip.includes("Promo senza prezzo barrato")) setNoListino((prev) => ({ ...prev, [p.id]: true }));
                              else if (tip.includes("Promo con prezzo barrato")) setNoListino((prev) => ({ ...prev, [p.id]: false }));
                            }}
                            style={{ marginTop: 4, minWidth: 150, fontSize: 12 }}>
                            <option value="">Layout automatico</option>
                            {layoutScelte.filter((l) => l.formatId === (rowFormat[p.id] ?? applyAll)).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                          </select>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          value={prices[p.id] ?? p.prezzo}
                          onChange={(e) => setPrices((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          style={{ width: 85, marginTop: 0 }}
                        />
                      </td>
                      <td>
                        {/* il barrato del solo cartello: vuoto = quello dell'offerta */}
                        <input
                          type="text"
                          value={listini[p.id] ?? p.listino ?? ""}
                          placeholder="A SOLI"
                          onChange={(e) => setListini((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          style={{ width: 85, marginTop: 0 }}
                        />
                      </td>
                      <td className="cella-chips">
                        <div className="chips">
                          <Interruttore acceso={!noPrice[p.id]} on="€ prezzo" off="senza prezzo"
                            titolo="Il prezzo promo sul cartello: spento = si stampa senza prezzo"
                            onClick={() => setNoPrice((prev) => ({ ...prev, [p.id]: !prev[p.id] }))} />
                          <Interruttore acceso={!noListino[p.id]} on="barrato" off="A SOLI"
                            titolo="Il prezzo di partenza barrato: spento = al suo posto esce «A SOLI» e il cartello usa il layout «Promo senza prezzo barrato»"
                            onClick={() => setNoListino((prev) => ({ ...prev, [p.id]: !prev[p.id] }))} />
                          {/* senza foto si stampa il "foglio senza foto" del layout, con i campi ridisposti */}
                          <Interruttore acceso={!noPhoto[p.id]} on="foto" off="senza foto"
                            titolo="La foto dell'articolo: spento = si stampa il foglio senza foto, anche se l'articolo ce l'ha"
                            onClick={() => setNoPhoto((prev) => ({ ...prev, [p.id]: !prev[p.id] }))} />
                        </div>
                        <div className="chips" style={{ marginTop: 4 }}>
                        {onPersonalizza && (
                          <button type="button" className="chip" onClick={() => onPersonalizza(p.id)}
                            title="Correggi titolo, descrizione, prezzi e condizioni di questo cartello">
                            ✎ Testi
                          </button>
                        )}
                        {onDuplica && (
                          <button type="button" className="chip" onClick={() => onDuplica(p.id)}
                            title="Fa una copia di questo cartello, solo vostra, da correggere a piacere">
                            ⧉ Duplica
                          </button>
                        )}
                        <details className="flag-details"
                          onToggle={(e) => {
                            // la tabella dei selezionati scorre e taglia ciò che esce: la finestrella si apre «sopra» la pagina
                            const d = e.currentTarget;
                            const pop = d.querySelector<HTMLElement>(".flag-popover");
                            const sum = d.querySelector("summary");
                            if (!d.open || !pop || !sum) return;
                            const r = sum.getBoundingClientRect();
                            const alto = Math.min(260, pop.scrollHeight || 260);
                            const sotto = window.innerHeight - r.bottom > alto + 8;
                            Object.assign(pop.style, {
                              position: "fixed", right: "auto",
                              top: `${sotto ? r.bottom + 4 : Math.max(8, r.top - alto - 4)}px`,
                              left: `${Math.max(8, Math.min(r.left, window.innerWidth - 310))}px`,
                            });
                            const chiudi = (ev: Event) => { if (pop.contains(ev.target as Node)) return; d.open = false; window.removeEventListener("scroll", chiudi, true); };
                            window.addEventListener("scroll", chiudi, true);
                          }}>
                          <summary className="chip" style={{ opacity: 1 }} title="Nascondi alcuni campi in questo cartello">
                            Campi{hiddenFields[p.id]?.length ? ` (−${hiddenFields[p.id].length})` : ""}
                          </summary>
                          <div className="flag-popover" style={{ maxHeight: 240, overflowY: "auto", zIndex: 60 }}>
                            {fields.map((f) => (
                              <label key={f.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={hiddenFields[p.id]?.includes(f.id) ?? false}
                                  onChange={(e) =>
                                    setHiddenFields((prev) => {
                                      const cur = prev[p.id] ?? [];
                                      return { ...prev, [p.id]: e.target.checked ? [...cur, f.id] : cur.filter((x) => x !== f.id) };
                                    })
                                  }
                                />
                                {f.label}
                              </label>
                            ))}
                          </div>
                        </details>
                        </div>
                      </td>
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" title="Togli dalla selezione"
                          onClick={() => setSelected((prev) => prev.filter((x) => x !== p.id))}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* stessa scelta su tutti i selezionati in un colpo: spunta = nascondi, togli la spunta = rimetti */}
            <div className="chips" style={{ marginTop: 10, alignItems: "center" }}>
              <span className="hint" style={{ marginRight: 4 }}>Su tutti:</span>
              {([["prezzo", "€ prezzo", "senza prezzo"], ["listino", "barrato", "A SOLI"], ["foto", "foto", "senza foto"]] as const).map(([cosa, on, off]) => {
                const acceso = selected.some((id) => !(cosa === "prezzo" ? noPrice[id] : cosa === "listino" ? noListino[id] : noPhoto[id]));
                return (
                  <Interruttore key={cosa} acceso={acceso} on={on} off={off}
                    titolo="Accende o spegne questa cosa su tutti i cartelli selezionati insieme"
                    onClick={() => nascondiSuTutti(cosa, acceso)} />
                );
              })}
            </div>
            {esitoCoda && <div className="alert alert-green" style={{ marginTop: 8 }}>{esitoCoda}</div>}
            <div className="azioni-stampa">
              {onQueue && (
                <details className="menu-tendina" ref={menuCoda}>
                  <summary className="btn btn-outline" title="Mette da parte i cartelli selezionati con tutte le impostazioni">
                    Metti in coda ▾
                  </summary>
                  <div>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => { menuCoda.current?.removeAttribute("open"); inCoda("dopo"); }}
                      title="Si stampano dopo, in blocco, dalla scheda Liste">
                      Da stampare più tardi
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => { menuCoda.current?.removeAttribute("open"); inCoda("arrivo"); }}
                      title="Merce non ancora arrivata: le impostazioni restano salvate, si stampa quando entra">
                      Merce in arrivo
                    </button>
                  </div>
                </details>
              )}
              {/* senza anteprima dal vivo (Arredo) il pulsante ricarica la pagina con la selezione */}
              {!onChange && (
                <button type="button" className="btn btn-outline" onClick={() => (onPreview ? onPreview() : router.push(buildUrl(false)))}>
                  Aggiorna anteprima →
                </button>
              )}
              <span style={{ flex: 1 }} />
              {multipli.map((m) => (
                <label key={m.fid} className={`interruttore-grande ${carta[m.fid] === "formato" ? "acceso" : ""}`}
                  title={`Spento: ${m.per} cartelli ${m.nome} per foglio A4. Acceso: la stampante ha la carta ${m.nome}, un cartello per foglio a misura. Di partenza come nelle Preferenze di stampa.`}>
                  <input type="checkbox" checked={carta[m.fid] === "formato"} onChange={(e) => setCarta((prev) => ({ ...prev, [m.fid]: e.target.checked ? "formato" : "a4" }))} />
                  <span>{m.nome} · {carta[m.fid] === "formato" ? `carta ${m.nome}, uno per foglio` : `${m.per} per foglio A4`}</span>
                </label>
              ))}
              {anyA5 && (
                <label className={`interruttore-grande ${doppio ? "acceso" : ""}`}
                  title="Gli A5 escono sempre due per foglio A4 orizzontale. Acceso: ogni cartello due volte sullo stesso foglio. Spento: due cartelli diversi per foglio.">
                  <input type="checkbox" checked={doppio} onChange={(e) => setDoppio(e.target.checked)} />
                  <span>A5 · {doppio ? "ogni cartello 2 volte" : "2 cartelli diversi"} per foglio A4</span>
                </label>
              )}
              <button type="button" className="btn btn-outline" title="Salva i cartelli in un PDF col nome che scegli"
                onClick={() => {
                  const proposta = `Cartelli ${new Date().toLocaleDateString("it-IT").replace(/\//g, "-")}`;
                  const nome = window.prompt("Nome del file PDF:", proposta);
                  if (!nome || !nome.trim()) return;
                  const pulito = nome.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
                  if (onPdf) {
                    // il PDF si fa qui e si scarica: niente pagina nuova
                    void (async () => {
                      if (onPrint && selected.length > 0) { try { await onPrint(selected, vociStampa()); } catch { /* niente */ } }
                      await onPdf(pulito, buildUrl(false).split("?")[1]);
                    })();
                  } else vaiAllaStampa(pulito);
                }}>
                Salva in PDF…
              </button>
              <button type="button" className="btn" onClick={() => vaiAllaStampa()}
                title="Apre l'anteprima di stampa: da lì Stampa o Salva come PDF (Ctrl+P)">
                Stampa {selectedProds.length} {selectedProds.length === 1 ? "cartello" : "cartelli"} →
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
