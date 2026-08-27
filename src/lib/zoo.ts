import { Scope, ScopeType } from "./stampe";
import { DB } from "./types";
import { readDomain, writeDomain } from "./supabase";

/* ================== Tipi Macroarea Cartelli ZOO ================== */

export interface ZooProduct {
  id: string; // "z_" + ean
  ean: string;
  codice: string; // codice articolo fornitore
  descrizione: string; // descrizione dall'Excel
  marca: string;
  fornitore: string;
  categoria?: string;
  prezzo?: string; // prezzo base (non promo)
  image?: string; // /zoo-foto/<file>
  parentId?: string; // prodotto "padre" di cui è variante (gusto/formato)
}

/** Prodotto padre: raggruppa articoli simili, con testi per volantino e cartello. */
export interface ZooParent {
  id: string;
  nome: string;
  descVolantino: string;
  descCartello: string;
  image?: string; // immagine di riferimento (di un figlio o caricata)
  caratteristiche: string[]; // es. umido, secco, cane, gatto...
  aiGenerated?: boolean;
  note?: string;
}

/** Personalizzazione testi del padre per insegna/PV (la versione comune resta intatta). */
export interface ZooTextOverride {
  scopeType: ScopeType;
  scopeId: string;
  parentId: string;
  field: "nome" | "descVolantino" | "descCartello";
  value: string;
}

export interface ZooScheda {
  id: string;
  nome: string;
}

/**
 * Ciclo di vita di un volantino:
 *  - lavorazione → ci si sta lavorando: Import offerte, Scelta Offerte e Crea
 *    Volantino agiscono SOLO su questo, su pagine pulite;
 *  - chiusa → lavoro finito, offerte in corso nei punti vendita: non si compone
 *    più, ma i cartelli si stampano ancora (è il volantino "vivo" a scaffale);
 *  - archiviata → sostituita da un volantino nuovo: sparisce dalle pagine di
 *    lavoro e resta in "Archivio volantini", da dove si recupera o si elimina.
 */
export type CampaignStato = "lavorazione" | "chiusa" | "archiviata";

/** Campagna = import mensile di offerte, con validità e schede (pagine) del volantino. */
export interface ZooCampaign {
  id: string;
  nome: string;
  dal: string; // yyyy-mm-dd
  al: string;
  schede: ZooScheda[];
  attiva: boolean; // storico: manteneva "quella corrente" prima dei tre stati
  stato?: CampaignStato;
  chiusaIl?: string; // ISO
  archiviataIl?: string; // ISO
  /** Offerte e voti eliminati definitivamente: resta solo lo schema delle pagine. */
  svuotataIl?: string;
}

export interface ZooOffer {
  id: string;
  campaignId: string;
  ean: string;
  productId?: string;
  descrizione: string; // descrizione promo dall'Excel
  prezzoPromo: string;
  prezzoListino?: string;
  condizioni?: string;
  nuovo?: boolean; // prodotto creato da questo import (non era nel DB base)
  // scelte del Consorzio per il volantino:
  selezionata?: boolean;
  schedaId?: string;
  label?: string;
  gruppo?: string; // area tematica
  gruppoDescrizione?: string;
  tieniVicinoA?: string; // id di un'altra offerta da tenere adiacente
  ordine?: number;
  /**
   * Pagina del volantino a cui l'offerta è destinata (id di una VolPage), decisa
   * già da Import offerte: Crea Volantino la trova poi pronta da collocare in
   * quella pagina. `NO_VOLANTINO` = scartata, non andrà sul volantino.
   */
  paginaId?: string;
  focus?: string; // tema/angolo di comunicazione (campo libero)
  gruppoGrafico?: string; // offerte da impaginare vicine (stesso valore = stesso riquadro)
}

/** Valore di `paginaId` per le offerte escluse dal volantino. */
export const NO_VOLANTINO = "__no__";

/** Voto/segnalazione di un responsabile PV su un'offerta candidata al volantino. */
export interface ZooVote {
  offerId: string;
  userId: string;
  userName: string;
  scopeLabel: string; // nome PV/insegna
  tipo: "preferita" | "nontrattato";
  nota?: string;
  date: string;
}

/** Fornitori/marchi/articoli nascosti da un'insegna o PV. */
export interface ZooHidden {
  scopeType: ScopeType;
  scopeId: string;
  kind: "fornitore" | "marca" | "articolo"; // articolo = ean
  value: string;
}

/** Prezzo proprio del PV (caricato via Excel EAN/cod.fornitore → prezzo). */
export interface ZooPvPrice {
  scopeType: ScopeType;
  scopeId: string;
  ean: string;
  prezzo: string;
}

/** Proposta di correzione inviata al Consorzio (come le 🚩 dell'Arredo). */
export interface ZooSuggestion {
  id: string;
  parentId?: string;
  offerId?: string;
  message: string;
  userId: string;
  userName: string;
  scopeLabel: string;
  date: string;
  status: "aperta" | "risolta";
}

/**
 * Blocco del volantino: occupa una o più celle della griglia della pagina.
 * La posizione è esplicita (riga/colonna + estensione), così unire, spostare
 * e copiare sono operazioni dirette e non dipendono dall'ordine nell'elenco.
 * I contenuti convivono: un blocco può avere sfondo immagine, testo sopra,
 * una o più offerte, un'etichetta e un commento per il grafico.
 */
export interface VolBlock {
  id: string;
  r: number; // riga 0-based
  c: number; // colonna 0-based
  rs: number; // righe occupate
  cs: number; // colonne occupate
  offerIds?: string[]; // una o più offerte nella stessa cella
  testo?: string;
  imageUrl?: string;
  label?: string; // etichetta grafica (SOTTOCOSTO, NOVITÀ…)
  commento?: string; // nota per chi impagina, non stampata
  // modifiche "solo per questo volantino" sulla prima offerta: non toccano il database
  descrizione?: string;
  prezzo?: string;
}

/** Sezione: sfondo + titolo su un'area della pagina; le offerte restano posizionabili sopra. */
export interface VolSection {
  id: string;
  r: number; c: number; rs: number; cs: number;
  titolo?: string;
  bg: string; // colore di sfondo
}

export interface VolPage {
  id: string;
  titolo?: string; // nome libero: il numero di pagina è calcolato dalla posizione
  note?: string; // indicazioni per chi impagina, valide per tutta la pagina
  cols: number;
  rows: number;
  blocks: VolBlock[];
  sezioni?: VolSection[];
}
export interface VolantinoLayout { campaignId: string; pages: VolPage[] }

/* --- vecchio formato a righe/celle, conservato solo per la migrazione --- */
interface OldCell { span?: number; vspan?: number; tipo?: string; offerId?: string; testo?: string; descrizione?: string; prezzo?: string }
interface OldRow { cols?: number; cells?: OldCell[] }
interface OldPage { id?: string; titolo?: string; rows?: (OldRow | unknown)[] }

/** Converte i volantini salvati col vecchio modello righe/celle nella griglia a blocchi. */
export function migraVolantinoPages(pages: unknown[]): VolPage[] {
  // il numero di pagina ora è automatico: togliamo il " — pag. N" dai vecchi titoli
  const pulisci = (t?: string) => (t ? t.replace(/\s*[—-]\s*pag\.?\s*\d+\s*$/i, "") : t);
  return (pages as OldPage[]).map((p, pi) => {
    if (Array.isArray((p as unknown as VolPage).blocks)) {
      const np = p as unknown as VolPage;
      return { ...np, titolo: pulisci(np.titolo) }; // già nuovo formato
    }
    const oldRows = (p.rows ?? []) as OldRow[];
    const cols = Math.max(1, ...oldRows.map((r) => r.cols ?? 3));
    const blocks: VolBlock[] = [];
    oldRows.forEach((row, ri) => {
      const unit = cols / (row.cols ?? cols);
      let c = 0;
      (row.cells ?? []).forEach((cell, ci) => {
        const cs = Math.round(unit * (cell.span ?? 1));
        blocks.push({
          id: `vb_${pi}_${ri}_${ci}`,
          r: ri, c, rs: cell.vspan === 2 ? 2 : 1, cs: Math.max(1, cs),
          ...(cell.offerId ? { offerIds: [cell.offerId] } : {}),
          ...(cell.testo ? { testo: cell.testo } : {}),
          ...(cell.descrizione ? { descrizione: cell.descrizione } : {}),
          ...(cell.prezzo ? { prezzo: cell.prezzo } : {}),
        });
        c += Math.max(1, cs);
      });
    });
    return { id: p.id ?? `vp_${pi}`, titolo: pulisci(p.titolo), cols, rows: Math.max(1, oldRows.length), blocks, sezioni: [] };
  });
}

export interface ZooSettings {
  caratteristiche: string[]; // = [...categorieAnimali, ...caratteristicheProdotto]: unione usata per il tag dei padri e il vincolo dell'AI
  categorieAnimali: string[]; // sottoinsieme di "caratteristiche": cane, gatto, roditori...
  caratteristicheProdotto: string[]; // sottoinsieme di "caratteristiche": umido, secco, snack...
  volantinoEditors?: string[]; // utenti (oltre a sistema/Gestore Zoo) che possono usare Crea Volantino
  labels: string[]; // etichette assegnabili alle offerte (es. SOTTOCOSTO, NOVITÀ)
  schedeDefault: string[]; // struttura standard delle schede del volantino
  istruzioniVolantino: string; // regole di scrittura testi volantino (guida anche l'AI)
  istruzioniCartello: string; // regole di scrittura testi cartelli
  apiKey?: string; // chiave API Claude — impostabile SOLO dall'amministratore di sistema
  formatoRegole: { caratteristica: string; formatId: string }[]; // formato consigliato per caratteristica
}

export interface ZooDB {
  settings: ZooSettings;
  products: ZooProduct[];
  parents: ZooParent[];
  textOverrides: ZooTextOverride[];
  campaigns: ZooCampaign[];
  offers: ZooOffer[];
  votes: ZooVote[];
  hidden: ZooHidden[];
  pvPrices: ZooPvPrice[];
  suggestions: ZooSuggestion[];
  volantinoLayouts: VolantinoLayout[];
  zooLayouts: ZooLayout[];
}

/* ================== Persistenza ================== */

const CATEGORIE_ANIMALI_DEFAULT = ["Cane", "Gatto", "Roditori", "Uccelli", "Pesci"];
const CARATTERISTICHE_PRODOTTO_DEFAULT = ["Umido", "Secco", "Snack", "Accessori", "Igiene"];

const DEFAULT_SETTINGS: ZooSettings = {
  caratteristiche: [...CATEGORIE_ANIMALI_DEFAULT, ...CARATTERISTICHE_PRODOTTO_DEFAULT],
  categorieAnimali: CATEGORIE_ANIMALI_DEFAULT,
  caratteristicheProdotto: CARATTERISTICHE_PRODOTTO_DEFAULT,
  labels: ["SOTTOCOSTO", "NOVITÀ", "ESCLUSIVA", "FORMATO CONVENIENZA", "PREZZO WOW"],
  schedeDefault: ["Copertina", "Cane", "Gatto", "Altri animali", "Accessori e igiene", "Retro"],
  istruzioniVolantino:
    "Testi brevi e commerciali (max 2 righe). Evidenziare il vantaggio per l'animale e il risparmio. Niente punto finale. Es: \"Croccantini ricchi di pollo fresco per cani adulti di taglia media\".",
  istruzioniCartello:
    "Testi descrittivi più completi (2-4 righe) per il cartello in punto vendita: composizione, formato, a chi è adatto. Tono informativo, frasi complete.",
  formatoRegole: [],
};

export async function getZooDb(): Promise<ZooDB> {
  const empty: ZooDB = {
    settings: DEFAULT_SETTINGS,
    products: [], parents: [], textOverrides: [], campaigns: [], offers: [],
    votes: [], hidden: [], pvPrices: [], suggestions: [], volantinoLayouts: [], zooLayouts: [],
  };
  const db = await readDomain<ZooDB>("zoo", empty);
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings ?? {}) };
  for (const k of ["products", "parents", "textOverrides", "campaigns", "offers", "votes", "hidden", "pvPrices", "suggestions", "volantinoLayouts", "zooLayouts"] as const) {
    if (!db[k]) (db as unknown as Record<string, unknown>)[k] = [];
  }
  return db;
}

export async function saveZooDb(db: ZooDB): Promise<void> {
  await writeDomain("zoo", db);
}

/* ================== Helper ambiti ================== */

/**
 * `academyDb` è il database Academy (tenants/stores) già caricato dalla pagina
 * chiamante — evitiamo di ricaricarlo qui per non moltiplicare le chiamate a Supabase.
 */
function chainFor(scope: Scope, academyDb: DB): { type: ScopeType; id: string }[] {
  const chain: { type: ScopeType; id: string }[] = [];
  if (scope.type === "store") {
    chain.push({ type: "store", id: scope.id });
    const store = academyDb.stores.find((s) => s.id === scope.id);
    if (store) chain.push({ type: "tenant", id: store.tenantId });
  } else if (scope.type === "tenant") {
    chain.push({ type: "tenant", id: scope.id });
  }
  chain.push({ type: "system", id: "" });
  return chain;
}

/** Testo effettivo del padre per un ambito: personalizzazione più vicina, altrimenti versione Consorzio. */
export function effectiveParentText(
  db: ZooDB, scope: Scope, parent: ZooParent, field: "nome" | "descVolantino" | "descCartello", academyDb: DB
): { value: string; custom: boolean } {
  for (const s of chainFor(scope, academyDb)) {
    if (s.type === "system") break;
    const ov = db.textOverrides.find(
      (o) => o.scopeType === s.type && o.scopeId === s.id && o.parentId === parent.id && o.field === field
    );
    if (ov) return { value: ov.value, custom: true };
  }
  return { value: parent[field] ?? "", custom: false };
}

/** Il prodotto è nascosto per questo ambito (fornitore, marchio o singolo articolo)? */
export function isZooHidden(db: ZooDB, scope: Scope, p: ZooProduct, academyDb: DB): boolean {
  for (const s of chainFor(scope, academyDb)) {
    if (s.type === "system") continue;
    const hit = db.hidden.some(
      (h) => h.scopeType === s.type && h.scopeId === s.id &&
        ((h.kind === "fornitore" && h.value === p.fornitore) ||
         (h.kind === "marca" && h.value === p.marca) ||
         (h.kind === "articolo" && h.value === p.ean))
    );
    if (hit) return true;
  }
  return false;
}

export function hiddenEntriesFor(db: ZooDB, scope: Scope): ZooHidden[] {
  return db.hidden.filter((h) => h.scopeType === scope.type && h.scopeId === scope.id);
}

/** Prezzo per il cartello: prezzo proprio del PV se caricato, altrimenti prezzo promo. */
export function pvPriceFor(db: ZooDB, scope: Scope, ean: string, academyDb: DB): string | undefined {
  for (const s of chainFor(scope, academyDb)) {
    if (s.type === "system") continue;
    const pp = db.pvPrices.find((p) => p.scopeType === s.type && p.scopeId === s.id && p.ean === ean);
    if (pp) return pp.prezzo;
  }
  return undefined;
}

/**
 * Foto del prodotto zoo: immagine del padre, altrimenti dell'articolo, altrimenti
 * il segnaposto "mancante".
 *
 * Nessuna ricerca su disco: le foto vivono nel bucket Supabase (zoo-foto) e il
 * percorso finisce in `image`. La vecchia sonda su `public/zoo-foto` provava 8
 * `fs.existsSync` per ogni articolo senza foto — 1.200+ articoli su questo
 * volantino, ripetuti ad ogni riga di ogni tabella — su una cartella che non
 * esiste nemmeno: era il costo maggiore nel render delle pagine offerte.
 */
export function zooImageUrl(p?: ZooProduct, parent?: ZooParent): string {
  return parent?.image ?? p?.image ?? "/immagini/mancante.jpg";
}

const STOPWORDS_ABBINAMENTO = new Set([
  "di", "da", "del", "della", "dei", "delle", "con", "per", "e", "il", "lo", "la",
  "i", "gli", "le", "un", "uno", "una", "in", "a", "al", "allo", "alla", "ai",
  "agli", "alle", "su", "sul", "tra", "fra", "nuovo", "nuova",
]);

/** Parole "significative" di un testo: minuscolo, senza accenti/punteggiatura, senza le più comuni. */
function tokenizzaPerAbbinamento(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS_ABBINAMENTO.has(w));
}

export interface AbbinamentoIndexEntry { productId: string; tokens: Set<string>; nums: Set<string> }

/**
 * Precalcola le parole significative di marca+descrizione di ogni articolo, UNA
 * volta sola: `suggestPhotoMatch` viene chiamata una volta per ciascuna foto da
 * abbinare, quindi con centinaia di foto e centinaia/migliaia di articoli senza
 * foto ripetere la tokenizzazione ad ogni chiamata sarebbe sprecato.
 */
export function buildAbbinamentoIndex(products: ZooProduct[]): AbbinamentoIndexEntry[] {
  return products.map((p) => {
    const tokens = new Set(tokenizzaPerAbbinamento(`${p.marca} ${p.descrizione}`));
    return { productId: p.id, tokens, nums: new Set([...tokens].filter((t) => /^\d+$/.test(t))) };
  });
}

/**
 * Propone a quale articolo abbinare una foto in base al SOLO nome del file (nessuna
 * AI): confronta le parole significative del nome file con marca+descrizione di ogni
 * articolo ancora senza foto (indice di Jaccard, con un piccolo bonus se coincidono
 * numeri come taglie o grammature), e ritorna i candidati migliori in ordine di
 * punteggio. L'abbinamento resta una PROPOSTA: va confermato da chi carica le foto.
 */
export function suggestPhotoMatch(
  fileBase: string, index: AbbinamentoIndexEntry[], limit = 5
): { productId: string; score: number }[] {
  const fileTokens = new Set(tokenizzaPerAbbinamento(fileBase.replace(/[_-]/g, " ")));
  if (fileTokens.size === 0) return [];
  const fileNums = new Set([...fileTokens].filter((t) => /^\d+$/.test(t)));
  const scored = index.map(({ productId, tokens, nums }) => {
    if (tokens.size === 0) return { productId, score: 0 };
    let common = 0;
    for (const t of fileTokens) if (tokens.has(t)) common++;
    let numBonus = 0;
    for (const n of fileNums) if (nums.has(n)) numBonus += 0.5;
    const union = new Set([...fileTokens, ...tokens]).size;
    return { productId, score: union > 0 ? (common + numBonus) / union : 0 };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Stato del volantino, ricavato anche dalle campagne salvate prima dei tre stati:
 * lì l'unica informazione era `attiva`, quindi la corrente diventa "in lavorazione"
 * e tutte le altre finiscono in archivio.
 */
export function campaignStato(c: ZooCampaign): CampaignStato {
  return c.stato ?? (c.attiva ? "lavorazione" : "archiviata");
}

/** Il volantino su cui si sta lavorando: uno solo alla volta. */
export function campagnaInLavorazione(db: ZooDB): ZooCampaign | undefined {
  return db.campaigns.find((c) => campaignStato(c) === "lavorazione");
}

/** Il volantino chiuso più recente: offerte in corso a scaffale, cartelli ancora stampabili. */
export function campagnaInCorso(db: ZooDB): ZooCampaign | undefined {
  return db.campaigns.filter((c) => campaignStato(c) === "chiusa").slice(-1)[0];
}

/** Volantini di cui ha senso stampare i cartelli: quello in corso e quello in preparazione. */
export function campagneStampabili(db: ZooDB): ZooCampaign[] {
  return [campagnaInCorso(db), campagnaInLavorazione(db)].filter(Boolean) as ZooCampaign[];
}

export function campagneArchiviate(db: ZooDB): ZooCampaign[] {
  return db.campaigns.filter((c) => campaignStato(c) === "archiviata").reverse();
}

/**
 * Campagna delle pagine di lavoro (Import offerte, Scelta Offerte, Crea Volantino):
 * quella in lavorazione. Se non ce n'è una si ripiega sulla chiusa più recente, così
 * le pagine mostrano comunque qualcosa finché non si apre il volantino successivo.
 */
export function activeCampaign(db: ZooDB): ZooCampaign | undefined {
  return campagnaInLavorazione(db) ?? campagnaInCorso(db) ?? db.campaigns[db.campaigns.length - 1];
}

export function fornitoriList(db: ZooDB): string[] {
  return Array.from(new Set(db.products.map((p) => p.fornitore).filter(Boolean))).sort();
}

export function marcheList(db: ZooDB): string[] {
  return Array.from(new Set(db.products.map((p) => p.marca).filter(Boolean))).sort();
}

/** Le "caratteristiche" di un padre sono un elenco unico (animale + prodotto insieme): queste due funzioni separano le due dimensioni per mostrarle in colonne distinte. */
export function animaliDi(db: ZooDB, caratteristiche: string[]): string[] {
  return caratteristiche.filter((c) => db.settings.categorieAnimali.includes(c));
}
export function caratteristicheProdottoDi(db: ZooDB, caratteristiche: string[]): string[] {
  return caratteristiche.filter((c) => db.settings.caratteristicheProdotto.includes(c));
}

/* ================== Cartelli Zoo: campi, formati e layout per ambito ================== */

import type { PrintField, PrintFormat, LayoutItem } from "./stampe";

/** Campi disponibili sul cartello di un'offerta zoo (stessa meccanica dell'Arredo). */
export const ZOO_FIELDS: PrintField[] = [
  { id: "descrizione", label: "Descrizione offerta", size: 22, bold: true, font: "cn" },
  { id: "marca", label: "Marca", size: 14, bold: false },
  { id: "prezzoPromo", label: "Prezzo promo", size: 46, bold: true, font: "cn" },
  { id: "prezzoListino", label: "Prezzo listino (barrato)", size: 16, bold: false },
  { id: "label", label: "Etichetta (SOTTOCOSTO, NOVITÀ…)", size: 16, bold: true, font: "cn" },
  { id: "condizioni", label: "Condizioni", size: 11, bold: false },
  { id: "immagine", label: "Foto prodotto", size: 12, bold: false, type: "image" },
];

export const ZOO_FORMATS: PrintFormat[] = [
  { id: "za6", name: "A6 (scaffale)", w: 105, h: 148 },
  { id: "za5", name: "A5", w: 148, h: 210 },
  { id: "za4", name: "A4", w: 210, h: 297 },
];

/** Layout cartello zoo salvato per formato+ambito (Consorzio come base). */
export interface ZooLayout {
  id: string;
  formatId: string;
  scopeType: ScopeType;
  scopeId: string;
  items: LayoutItem[];
}

/** Layout effettivo: quello dell'ambito, altrimenti la versione del Consorzio. */
export function effectiveZooLayout(db: ZooDB, scope: Scope, formatId: string): ZooLayout {
  return (
    db.zooLayouts.find((l) => l.formatId === formatId && l.scopeType === scope.type && l.scopeId === scope.id) ??
    db.zooLayouts.find((l) => l.formatId === formatId && l.scopeType === "system") ??
    { id: "default", formatId, scopeType: "system", scopeId: "", items: DEFAULT_ZOO_ITEMS }
  );
}

/** Valori del cartello per un'offerta (con prezzo del PV se caricato). */
export function zooCartelloValues(db: ZooDB, offer: ZooOffer): Record<string, string> {
  const product = db.products.find((p) => p.id === offer.productId);
  const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
  return {
    descrizione: offer.descrizione,
    marca: product?.marca ?? "",
    prezzoPromo: offer.prezzoPromo ? `€ ${offer.prezzoPromo}` : "",
    prezzoListino: offer.prezzoListino ? `€ ${offer.prezzoListino}` : "",
    label: offer.label ?? "",
    condizioni: offer.condizioni ?? "",
    immagine: zooImageUrl(product, parent),
  };
}

/** Una riga dell'export per il grafico: stesse chiavi delle intestazioni del foglio Excel. */
export interface VolantinoExportRow {
  SCHEDA: string; EAN: string; MARCA: string; TITOLO: string;
  "DESCRIZIONE VOLANTINO": string; "PREZZO PROMO": string; "PREZZO LISTINO": string;
  ETICHETTA: string; "AREA TEMATICA": string; "DESCRIZIONE AREA": string;
  "TENERE VICINO A": string; CONDIZIONI: string; FOTO: string; "VALIDITA'": string;
}

/**
 * Righe dell'export "per il grafico" (Excel e ZIP con le foto condividono lo stesso
 * elenco, così restano sempre coerenti): le offerte selezionate per il volantino, con
 * testi effettivi (personalizzazioni d'ambito comprese) e riferimento alla foto.
 */
export function volantinoExportRows(
  db: ZooDB, academyDb: DB, scope: Scope, campaign: ZooCampaign | undefined
): VolantinoExportRow[] {
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id && o.selezionata) : [];
  return offers
    .sort((a, b) => (a.schedaId ?? "").localeCompare(b.schedaId ?? "") || (a.ordine ?? 0) - (b.ordine ?? 0))
    .map((o) => {
      const p = db.products.find((x) => x.id === o.productId);
      const parent = p?.parentId ? db.parents.find((x) => x.id === p.parentId) : undefined;
      return {
        SCHEDA: campaign?.schede.find((s) => s.id === o.schedaId)?.nome ?? "",
        EAN: o.ean,
        MARCA: p?.marca ?? "",
        TITOLO: parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : (p?.descrizione ?? o.descrizione),
        "DESCRIZIONE VOLANTINO": parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : o.descrizione,
        "PREZZO PROMO": o.prezzoPromo,
        "PREZZO LISTINO": o.prezzoListino ?? "",
        ETICHETTA: o.label ?? "",
        "AREA TEMATICA": o.gruppo ?? "",
        "DESCRIZIONE AREA": o.gruppoDescrizione ?? "",
        "TENERE VICINO A": o.tieniVicinoA ? (db.offers.find((x) => x.id === o.tieniVicinoA)?.descrizione ?? "") : "",
        CONDIZIONI: o.condizioni ?? "",
        FOTO: zooImageUrl(p, parent),
        "VALIDITA'": campaign ? `${campaign.dal} - ${campaign.al}` : "",
      };
    });
}

/** Una riga dell'export "per cella" del volantino composto (crea-volantino/excel). */
export interface VolantinoCellRow {
  "N. pagina": number; Pagina: string; "Note della pagina": string; Cella: string;
  Riga: number; Colonna: number; "Righe occupate": number; "Colonne occupate": number;
  Sezione: string; "Sfondo sezione": string; "N. offerte": number; EAN: string;
  Descrizione: string; Marca: string; "Prezzo promo": string; "Prezzo listino": string;
  Etichetta: string; Testo: string; Immagine: string; "Commento per il grafico": string;
}

/** Righe dell'export "per cella": una per ogni cella non vuota della griglia del volantino. */
export function volantinoCellRows(db: ZooDB, campaignId: string): VolantinoCellRow[] {
  const layout = db.volantinoLayouts.find((l) => l.campaignId === campaignId);
  if (!layout) return [];
  const pages = migraVolantinoPages(layout.pages);
  const rows: VolantinoCellRow[] = [];
  pages.forEach((page, pi) => {
    const nomePagina = page.titolo || `Pagina ${pi + 1}`;
    page.blocks.forEach((b, bi) => {
      const offs = (b.offerIds ?? []).map((id) => db.offers.find((o) => o.id === id)).filter(Boolean) as ZooOffer[];
      if (offs.length === 0 && !b.testo && !b.imageUrl && !b.label) return; // celle vuote: non servono al grafico
      const sez = (page.sezioni ?? []).find(
        (s) => b.r >= s.r && b.r < s.r + s.rs && b.c >= s.c && b.c < s.c + s.cs
      );
      const primo = offs[0];
      rows.push({
        "N. pagina": pi + 1, Pagina: nomePagina, "Note della pagina": page.note ?? "",
        Cella: `${pi + 1}-${bi + 1}`, Riga: b.r + 1, Colonna: b.c + 1,
        "Righe occupate": b.rs, "Colonne occupate": b.cs,
        Sezione: sez?.titolo ?? "", "Sfondo sezione": sez?.bg ?? "",
        "N. offerte": offs.length, EAN: offs.map((o) => o.ean).join(" / "),
        Descrizione: b.descrizione ?? offs.map((o) => o.descrizione).join(" / "),
        Marca: offs.map((o) => db.products.find((p) => p.id === o.productId)?.marca ?? "").join(" / "),
        "Prezzo promo": b.prezzo ?? offs.map((o) => o.prezzoPromo).join(" / "),
        "Prezzo listino": offs.map((o) => o.prezzoListino ?? "").join(" / "),
        Etichetta: b.label ?? primo?.label ?? "",
        Testo: b.testo ?? "",
        Immagine: b.imageUrl ?? "",
        "Commento per il grafico": b.commento ?? "",
      });
    });
  });
  return rows;
}

export interface VolantinoPhotoRef { url: string; nome: string }

/**
 * Foto da consegnare al grafico assieme al volantino: quelle degli articoli
 * davvero impaginati (una per articolo/padre, dedotta dalla stessa `zooImageUrl`
 * usata ovunque nel sito) più le eventuali immagini di sfondo caricate nelle
 * celle. Deduplicate per URL. Solo URL assoluti (Supabase Storage): i percorsi
 * locali di sviluppo o "mancante.jpg" non hanno una foto reale da esportare.
 */
export function volantinoPhotoRefs(db: ZooDB, campaignId: string): VolantinoPhotoRef[] {
  const layout = db.volantinoLayouts.find((l) => l.campaignId === campaignId);
  if (!layout) return [];
  const pages = migraVolantinoPages(layout.pages);
  const seen = new Map<string, VolantinoPhotoRef>();
  for (const page of pages) {
    for (const b of page.blocks) {
      for (const offerId of b.offerIds ?? []) {
        const o = db.offers.find((x) => x.id === offerId);
        if (!o) continue;
        const p = db.products.find((x) => x.id === o.productId);
        const parent = p?.parentId ? db.parents.find((x) => x.id === p.parentId) : undefined;
        const url = zooImageUrl(p, parent);
        if (url.startsWith("http") && !seen.has(url)) {
          const nome = `${o.ean}_${(parent?.nome ?? p?.descrizione ?? o.descrizione).slice(0, 40)}`;
          seen.set(url, { url, nome });
        }
      }
      if (b.imageUrl && b.imageUrl.startsWith("http") && !seen.has(b.imageUrl)) {
        seen.set(b.imageUrl, { url: b.imageUrl, nome: `sfondo_${page.titolo ?? ""}_${b.id}` });
      }
    }
  }
  return [...seen.values()];
}

/** Layout cartello zoo di partenza, usato finché il Consorzio non ne salva uno. */
export const DEFAULT_ZOO_ITEMS: LayoutItem[] = [
  { fieldId: "immagine", x: 5, y: 6, w: 55, h: 38 },
  { fieldId: "label", x: 62, y: 6, w: 34, h: 10 },
  { fieldId: "descrizione", x: 5, y: 48, w: 90, h: 18 },
  { fieldId: "marca", x: 5, y: 67, w: 45, h: 7 },
  { fieldId: "prezzoListino", x: 55, y: 66, w: 40, h: 7 },
  { fieldId: "prezzoPromo", x: 40, y: 74, w: 55, h: 18 },
  { fieldId: "condizioni", x: 5, y: 93, w: 90, h: 5 },
];
