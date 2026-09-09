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
  /**
   * Chi possiede l'articolo. Assente = catalogo del Consorzio, comune a tutti.
   * Valorizzato = articolo caricato da un'insegna o da un punto vendita (tipico
   * dei codici interni, es. sfusi e private label): lo vedono solo loro.
   */
  scopeType?: ScopeType;
  scopeId?: string;
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

/**
 * Animale/caratteristica del padre riscritti da un'insegna/PV: non toccano i tag
 * del Consorzio (che restano quelli usati per il volantino comune), valgono solo
 * sui cartelli di quell'ambito.
 */
export interface ZooTagOverride {
  scopeType: ScopeType;
  scopeId: string;
  parentId: string;
  kind: "animale" | "prodotto";
  value: string; // vuoto = campo lasciato in bianco per questo ambito
}

/** Testi dell'offerta riscritti da un'insegna/PV (descrizione e condizioni). */
export interface ZooOfferOverride {
  scopeType: ScopeType;
  scopeId: string;
  offerId: string;
  field: "descrizione" | "condizioni";
  value: string;
}

/** Cartello già stampato da un ambito: serve a non ristampare due volte lo stesso. */
export interface ZooPrinted {
  scopeType: ScopeType;
  scopeId: string;
  offerId: string;
  at: string; // ISO
}

export interface ZooScheda {
  id: string;
  nome: string;
}

/**
 * Ciclo di vita di un volantino:
 *  - lavorazione → ci si sta lavorando: Offerte in corso, Scelta offerte Volantino e Crea
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
  /**
   * Offerta a meccanica invece che a prezzo secco: "3x2", "1+1", "-50% sul secondo".
   * Convive col prezzo (3x2 con il pezzo a € 4,99) o lo sostituisce, a seconda di
   * come è composto il layout del cartello.
   */
  meccanica?: string;
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
   * già da Offerte in corso: Crea Volantino la trova poi pronta da collocare in
   * quella pagina. `NO_VOLANTINO` = scartata, non andrà sul volantino.
   */
  paginaId?: string;
  focus?: string; // tema/angolo di comunicazione (campo libero)
  gruppoGrafico?: string; // offerte da impaginare vicine (stesso valore = stesso riquadro)
  /**
   * Offerta propria di un'insegna/PV invece che del Consorzio: non entra nel
   * volantino comune, si stampa solo nei cartelli di chi l'ha creata.
   */
  scopeType?: ScopeType;
  scopeId?: string;
}

/** Valore di `paginaId` per le offerte escluse dal volantino. */
export const NO_VOLANTINO = "__no__";

/**
 * Tipologie di offerta a cui si può agganciare un layout, esattamente come si fa
 * con animale e caratteristica: un cartello con il prezzo barrato ha bisogno di
 * un'impaginazione diversa da un 3x2 o da un "A SOLI". Sono stringhe leggibili
 * perché finiscono tali e quali fra i tag del layout.
 */
export const TIPO_BARRATO = "Promo con prezzo barrato";
export const TIPO_A_SOLI = "Promo senza prezzo barrato";
export const TIPO_MECCANICA = "Promo a meccanica (3x2)";
export const ZOO_TIPI_OFFERTA = [TIPO_BARRATO, TIPO_A_SOLI, TIPO_MECCANICA];

/** Tipologie che descrivono questa offerta: guidano la scelta del layout in stampa. */
export function tagsOfferta(offer: ZooOffer): string[] {
  const tags: string[] = [];
  if (offer.meccanica) tags.push(TIPO_MECCANICA);
  if (offer.prezzoListino) tags.push(TIPO_BARRATO);
  else if (offer.prezzoPromo) tags.push(TIPO_A_SOLI);
  return tags;
}

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

/**
 * Tabella dei codici promozione dell'insegna/PV: nel gestionale la promozione è
 * un codice (0006, PP, 0003…) e ogni insegna usa i suoi. Qui il codice prende un
 * nome leggibile ("A SOLI", "10%") che finisce sul cartello e a cui si può
 * agganciare un layout dedicato, esattamente come per le tipologie del Consorzio.
 */
export interface ZooPvPromoCode {
  scopeType: ScopeType;
  scopeId: string;
  codice: string;
  etichetta: string;
}

/** Promozione applicata a un articolo da quell'insegna/PV, come arriva dal loro file. */
export interface ZooPvPromo {
  scopeType: ScopeType;
  scopeId: string;
  ean: string;
  codice: string;
  prezzo?: string; // "prezzo fisso" del file, quando la meccanica è un prezzo secco
  dal?: string;
  al?: string;
}

/** Codici promozione più diffusi, proposti quando un ambito carica il primo file. */
export const PV_PROMO_CODES_DEFAULT: { codice: string; etichetta: string }[] = [
  { codice: "0006", etichetta: "A SOLI" },
  { codice: "0001", etichetta: "10%" },
  { codice: "PP", etichetta: "15%" },
  { codice: "0003", etichetta: "20%" },
];

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
  testo?: string; // testo libero mostrato sopra lo sfondo, oltre al titolo
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
  /** A chi è dedicata la pagina: guida la disposizione automatica delle offerte. */
  animale?: string;
  caratt?: string;
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
  condizioniStandard: string[]; // condizioni pronte del Consorzio, riusabili sui cartelli
  /** Aggiunge la validità del volantino ("dal… al…") in coda alle condizioni del cartello. */
  condizioniConValidita?: boolean;
}

/** Cartello che un'insegna/PV ha deciso di non stampare (l'offerta resta per gli altri). */
export interface ZooNoPrint {
  scopeType: ScopeType;
  scopeId: string;
  /** Esclusione del singolo cartello: vale per questa offerta e basta. */
  offerId?: string;
  /**
   * Esclusione per articolo (dall'import Excel dei codici): vale anche sulle
   * campagne future, perché il codice a barre resta lo stesso mentre l'offerta
   * cambia id a ogni volantino. Senza questo, la lista caricata sarebbe da
   * ricaricare ogni mese.
   */
  ean?: string;
}

/** Le due liste di esclusione di un ambito: per offerta e per codice a barre. */
export function noPrintSets(db: ZooDB, scope: Scope) {
  const miei = db.noPrint.filter((n) => n.scopeType === scope.type && n.scopeId === scope.id);
  return {
    offerIds: new Set(miei.map((n) => n.offerId).filter(Boolean) as string[]),
    eans: new Set(miei.map((n) => n.ean).filter(Boolean) as string[]),
  };
}

/**
 * Chiave API Claude di un'insegna/PV: serve a far lavorare "Associa con AI" sui
 * propri articoli senza dover chiedere quella del Consorzio (e senza consumarne
 * il credito). Se manca, vale quella del Consorzio.
 */
export interface ZooScopeApiKey {
  scopeType: ScopeType;
  scopeId: string;
  key: string;
}

/**
 * Nota lasciata sulla bozza del volantino da chi la rivede. Sta a parte dal
 * builder: chi commenta non deve poter spostare le offerte, e chi impagina deve
 * vedere tutte le note in un posto solo, comprese quelle degli altri.
 */
export interface ZooNotaBozza {
  id: string;
  campaignId: string;
  pageId?: string; // nota su una pagina precisa; assente = nota generale
  userId: string;
  userName: string;
  scopeLabel: string;
  testo: string;
  date: string; // ISO
  risolta?: boolean;
}

/** Immagine fissa caricata da PC (testata, cornice, logo) da posare sui layout. */
export interface ZooLayoutImage {
  id: string;
  name: string;
  url: string;
  scopeType: ScopeType;
  scopeId: string;
}

export interface ZooDB {
  settings: ZooSettings;
  products: ZooProduct[];
  parents: ZooParent[];
  textOverrides: ZooTextOverride[];
  tagOverrides: ZooTagOverride[];
  offerOverrides: ZooOfferOverride[];
  printed: ZooPrinted[];
  campaigns: ZooCampaign[];
  offers: ZooOffer[];
  votes: ZooVote[];
  hidden: ZooHidden[];
  pvPrices: ZooPvPrice[];
  suggestions: ZooSuggestion[];
  volantinoLayouts: VolantinoLayout[];
  zooLayouts: ZooLayout[];
  noPrint: ZooNoPrint[];
  layoutImages: ZooLayoutImage[];
  pvPromoCodes: ZooPvPromoCode[];
  pvPromos: ZooPvPromo[];
  scopeApiKeys: ZooScopeApiKey[];
  noteBozza: ZooNotaBozza[];
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
  condizioniStandard: [],
};

export async function getZooDb(): Promise<ZooDB> {
  const empty: ZooDB = {
    settings: DEFAULT_SETTINGS,
    products: [], parents: [], textOverrides: [], tagOverrides: [], offerOverrides: [], printed: [],
    campaigns: [], offers: [],
    votes: [], hidden: [], pvPrices: [], suggestions: [], volantinoLayouts: [], zooLayouts: [],
    noPrint: [], layoutImages: [], pvPromoCodes: [], pvPromos: [], scopeApiKeys: [], noteBozza: [],
  };
  const db = await readDomain<ZooDB>("zoo", empty);
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings ?? {}) };
  for (const k of ["products", "parents", "textOverrides", "tagOverrides", "offerOverrides", "printed", "campaigns", "offers", "votes", "hidden", "pvPrices", "suggestions", "volantinoLayouts", "zooLayouts", "noPrint", "layoutImages", "pvPromoCodes", "pvPromos", "scopeApiKeys", "noteBozza"] as const) {
    if (!db[k]) (db as unknown as Record<string, unknown>)[k] = [];
  }
  // i layout salvati prima delle tipologie non hanno il campo: senza questo la
  // stampa va in errore appena incontra uno di quei layout
  for (const l of db.zooLayouts) if (!l.tipologie) l.tipologie = [];
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

/**
 * Animale e caratteristica del padre come li vede questo ambito: se l'insegna li
 * ha riscritti vince la sua versione, altrimenti valgono i tag del Consorzio.
 */
export function effectiveParentTag(
  db: ZooDB, scope: Scope, parent: ZooParent, kind: "animale" | "prodotto", academyDb: DB
): { value: string; custom: boolean } {
  for (const s of chainFor(scope, academyDb)) {
    if (s.type === "system") break;
    const ov = db.tagOverrides.find(
      (o) => o.scopeType === s.type && o.scopeId === s.id && o.parentId === parent.id && o.kind === kind
    );
    if (ov) return { value: ov.value, custom: true };
  }
  const dal = kind === "animale" ? animaliDi(db, parent.caratteristiche) : caratteristicheProdottoDi(db, parent.caratteristiche);
  return { value: dal.join(", "), custom: false };
}

/** Descrizione/condizioni dell'offerta come le vede questo ambito. */
export function effectiveOfferText(
  db: ZooDB, scope: Scope, offer: ZooOffer, field: "descrizione" | "condizioni", academyDb: DB
): { value: string; custom: boolean } {
  for (const s of chainFor(scope, academyDb)) {
    if (s.type === "system") break;
    const ov = db.offerOverrides.find(
      (o) => o.scopeType === s.type && o.scopeId === s.id && o.offerId === offer.id && o.field === field
    );
    if (ov) return { value: ov.value, custom: true };
  }
  return { value: offer[field] ?? "", custom: false };
}

/** Il cartello di questa offerta è già stato stampato da questo ambito? */
export function printedAt(db: ZooDB, scope: Scope, offerId: string): string | undefined {
  return db.printed.find((p) => p.scopeType === scope.type && p.scopeId === scope.id && p.offerId === offerId)?.at;
}

/** Il prodotto è nascosto per questo ambito (fornitore, marchio o singolo articolo)? */
export function isZooHidden(db: ZooDB, scope: Scope, p: ZooProduct, academyDb: DB): boolean {
  for (const s of chainFor(scope, academyDb)) {
    if (s.type === "system") continue;
    const hit = db.hidden.some(
      (h) => h.scopeType === s.type && h.scopeId === s.id &&
        ((h.kind === "fornitore" && h.value === p.fornitore) ||
         (h.kind === "marca" && h.value === marcaEffettiva(p)) ||
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
 * Storia commerciale di un articolo: in quali volantini è stato in promozione e
 * in quali è finito davvero sulla carta. Sono due cose diverse — di tutte le
 * offerte trattate solo una parte va sul volantino, le altre restano promozioni
 * esposte in reparto col cartello.
 */
export interface ZooStoricoVoce {
  campaign: ZooCampaign;
  /** Pagina del volantino su cui è finito (le pagine portano il tema: Gatto, Cane, Acquariologia…). */
  pagina?: string;
}

export interface ZooStoricoProdotto {
  promo: ZooStoricoVoce[]; // volantini in cui l'articolo era in offerta
  volantino: ZooStoricoVoce[]; // ...e quelli in cui l'offerta è stata scelta per la stampa
}

/**
 * Storico di tutti gli articoli in una passata sola sulle offerte: con qualche
 * migliaio di offerte, cercarle articolo per articolo costerebbe un tempo
 * quadratico ad ogni caricamento del Database prodotti.
 */
export function storicoOfferteByEan(db: ZooDB): Map<string, ZooStoricoProdotto> {
  const perId = new Map(db.campaigns.map((c) => [c.id, c]));
  // dal più recente al più vecchio: in tabella si mostrano prima gli ultimi volantini
  const peso = new Map(
    [...db.campaigns].sort((a, b) => (b.dal ?? "").localeCompare(a.dal ?? "")).map((c, i) => [c.id, i])
  );
  // titolo della pagina di destinazione, per dire su QUALE parte del volantino è finito
  const titoloPagina = new Map<string, string>();
  for (const layout of db.volantinoLayouts) {
    layout.pages.forEach((p, i) => titoloPagina.set(p.id, p.titolo || `Pagina ${i + 1}`));
  }
  const out = new Map<string, ZooStoricoProdotto>();
  const visti = new Map<string, Set<string>>(); // ean → campagne già contate (una riga per volantino)
  for (const o of db.offers) {
    const campaign = perId.get(o.campaignId);
    if (!campaign || !o.ean) continue;
    const storico = out.get(o.ean) ?? { promo: [], volantino: [] };
    const chiaviViste = visti.get(o.ean) ?? new Set<string>();
    if (!chiaviViste.has(`p_${o.campaignId}`)) {
      storico.promo.push({ campaign });
      chiaviViste.add(`p_${o.campaignId}`);
    }
    if (o.selezionata && !chiaviViste.has(`v_${o.campaignId}`)) {
      const pagina = o.paginaId && o.paginaId !== NO_VOLANTINO ? titoloPagina.get(o.paginaId) : undefined;
      storico.volantino.push({ campaign, pagina });
      chiaviViste.add(`v_${o.campaignId}`);
    }
    visti.set(o.ean, chiaviViste);
    out.set(o.ean, storico);
  }
  const ordina = (vs: ZooStoricoVoce[]) =>
    vs.sort((a, b) => (peso.get(a.campaign.id) ?? 0) - (peso.get(b.campaign.id) ?? 0));
  for (const s of out.values()) {
    ordina(s.promo);
    ordina(s.volantino);
  }
  return out;
}

/** Periodo di validità di un volantino in forma breve, per le colonne strette. */
export function periodoBreve(c: ZooCampaign): string {
  const g = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : "");
  return c.dal && c.al ? `${g(c.dal)}–${g(c.al)}` : c.nome;
}

/**
 * Campagna delle pagine di lavoro (Offerte in corso, Scelta offerte Volantino, Crea Volantino):
 * quella in lavorazione. Se non ce n'è una si ripiega sulla chiusa più recente, così
 * le pagine mostrano comunque qualcosa finché non si apre il volantino successivo.
 */
export function activeCampaign(db: ZooDB): ZooCampaign | undefined {
  return campagnaInLavorazione(db) ?? campagnaInCorso(db) ?? db.campaigns[db.campaigns.length - 1];
}

export function fornitoriList(db: ZooDB): string[] {
  return Array.from(new Set(db.products.map((p) => p.fornitore).filter(Boolean))).sort();
}

/**
 * Marca da mostrare ovunque (elenchi, filtri, cartelli): i listini dei fornitori
 * quasi mai hanno una colonna MARCA — in quel caso vale il fornitore, altrimenti
 * la colonna "Marca" resterebbe vuota su tutto il catalogo e non ci si potrebbe
 * né filtrare né escludere quello che non si tratta.
 */
export function marcaEffettiva(p: Pick<ZooProduct, "marca" | "fornitore">): string {
  return p.marca || p.fornitore || "";
}

export function marcheList(db: ZooDB): string[] {
  return Array.from(new Set(db.products.map(marcaEffettiva).filter(Boolean))).sort();
}

/**
 * L'elemento (articolo o offerta) è di competenza di chi sta guardando?
 * Senza ambito è del Consorzio e lo vedono tutti; con un ambito lo vedono chi
 * l'ha creato e chi gli sta sotto (gli articoli dell'insegna valgono per i suoi
 * punti vendita), non gli altri.
 */
export function ownScopeVisible(
  scope: Scope, academyDb: DB, x: { scopeType?: ScopeType; scopeId?: string }
): boolean {
  if (!x.scopeType) return true; // roba del Consorzio: comune
  return chainFor(scope, academyDb).some((s) => s.type === x.scopeType && s.id === x.scopeId);
}

/** Articoli che questo ambito deve vedere: catalogo comune più i propri. */
export function visibleProducts(db: ZooDB, scope: Scope, academyDb: DB): ZooProduct[] {
  return db.products.filter((p) => ownScopeVisible(scope, academyDb, p));
}

/** Chiave API da usare per questo ambito: la propria se c'è, altrimenti quella del Consorzio. */
export function apiKeyFor(db: ZooDB, scope: Scope): string | undefined {
  const propria = db.scopeApiKeys.find((k) => k.scopeType === scope.type && k.scopeId === scope.id);
  return propria?.key || db.settings.apiKey;
}

/** Codici promozione dell'ambito (se non ne ha ancora, valgono quelli proposti). */
export function pvPromoCodesFor(db: ZooDB, scope: Scope): { codice: string; etichetta: string }[] {
  const propri = db.pvPromoCodes.filter((c) => c.scopeType === scope.type && c.scopeId === scope.id);
  return propri.length > 0 ? propri.map((c) => ({ codice: c.codice, etichetta: c.etichetta })) : PV_PROMO_CODES_DEFAULT;
}

/**
 * Promozione che quell'insegna/PV applica a un articolo, con l'etichetta leggibile:
 * è quella che si stampa sul cartello e che sceglie il layout, quando il punto
 * vendita fa promozioni diverse da quelle del Consorzio.
 */
export function pvPromoFor(
  db: ZooDB, scope: Scope, ean: string, academyDb: DB
): { codice: string; etichetta: string; prezzo?: string } | undefined {
  for (const s of chainFor(scope, academyDb)) {
    if (s.type === "system") continue;
    const p = db.pvPromos.find((x) => x.scopeType === s.type && x.scopeId === s.id && x.ean === ean);
    if (p) {
      const codici = pvPromoCodesFor(db, { ...scope, type: s.type, id: s.id } as Scope);
      const etichetta = codici.find((c) => c.codice === p.codice)?.etichetta ?? p.codice;
      return { codice: p.codice, etichetta, prezzo: p.prezzo };
    }
  }
  return undefined;
}

/** Le "caratteristiche" di un padre sono un elenco unico (animale + prodotto insieme): queste due funzioni separano le due dimensioni per mostrarle in colonne distinte. */
export function animaliDi(db: ZooDB, caratteristiche: string[]): string[] {
  return caratteristiche.filter((c) => db.settings.categorieAnimali.includes(c));
}
export function caratteristicheProdottoDi(db: ZooDB, caratteristiche: string[]): string[] {
  return caratteristiche.filter((c) => db.settings.caratteristicheProdotto.includes(c));
}

/* ================== Cartelli Zoo: campi, formati e layout per ambito ================== */

import type { PrintField, PrintFormat, LayoutItem, LayoutMargins } from "./stampe";

/** Campi disponibili sul cartello di un'offerta zoo (stessa meccanica dell'Arredo). */
export const ZOO_FIELDS: PrintField[] = [
  { id: "titolo", label: "Titolo del prodotto padre", size: 20, bold: true, font: "cn" },
  { id: "descCartello", label: "Descrizione del padre (cartello)", size: 12, bold: false },
  { id: "descrizione", label: "Descrizione offerta", size: 22, bold: true, font: "cn" },
  { id: "descrizioneArticolo", label: "Descrizione articolo", size: 14, bold: false },
  { id: "marca", label: "Marca", size: 14, bold: false },
  { id: "prezzoPromo", label: "Prezzo promo", size: 46, bold: true, font: "cn" },
  { id: "prezzoListino", label: "Prezzo listino (barrato) / «A SOLI»", size: 16, bold: false },
  { id: "meccanica", label: "Meccanica promo (3x2, 1+1…)", size: 30, bold: true, font: "cn" },
  { id: "tipoPromo", label: "Tipo promo del punto vendita (10%, A SOLI…)", size: 20, bold: true, font: "cn" },
  { id: "label", label: "Etichetta (SOTTOCOSTO, NOVITÀ…)", size: 16, bold: true, font: "cn" },
  { id: "condizioni", label: "Condizioni", size: 11, bold: false },
  { id: "condizioniStandard", label: "Condizioni pronte (da Impostazioni)", size: 11, bold: false },
  { id: "validita", label: "Validità dell'offerta (dal… al…)", size: 11, bold: false },
  { id: "eanLista", label: "EAN (tutti gli articoli del padre)", size: 9, bold: false },
  { id: "animale", label: "Tipologia animale", size: 12, bold: false },
  { id: "caratteristica", label: "Caratteristica prodotto", size: 12, bold: false },
  { id: "immagine", label: "Foto prodotto", size: 12, bold: false, type: "image" },
];

/** A4 per primo: è il formato usato di default in Layout e in Stampa cartelli. */
export const ZOO_FORMATS: PrintFormat[] = [
  { id: "za4", name: "A4", w: 210, h: 297 },
  { id: "za5", name: "A5", w: 148, h: 210 },
  { id: "za6", name: "A6 (scaffale)", w: 105, h: 148 },
];

/** Layout cartello zoo salvato per formato+ambito (Consorzio come base). */
export interface ZooLayout {
  id: string;
  formatId: string;
  scopeType: ScopeType;
  scopeId: string;
  /** Nome scelto per riconoscerlo quando ce n'è più di uno per lo stesso formato. */
  nome?: string;
  tipologie: string[]; // tag (animale/caratteristica) a cui è legato — vuoto = vale per tutti i prodotti
  items: LayoutItem[];
  /** Versione alternativa usata in stampa quando il padre non ha una foto caricata. */
  itemsNoPhoto?: LayoutItem[];
  /** Margini del foglio (mm, per lato): guide a cui i campi si agganciano nell'editor. */
  margins?: LayoutMargins;
  /** Vecchio margine unico, tenuto solo per leggere i layout salvati prima. */
  margin?: number;
}

/**
 * Layout effettivo per formato+ambito(+tag): personalizzato se esiste, altrimenti
 * quello del Consorzio. Stessa logica di `effectiveLayout` (Arredo), ma qui i
 * "tipologie" sono i tag animale/caratteristica del padre — un prodotto ne può
 * avere più di uno insieme (es. "Gatto" e "Umido"), per questo si passano come
 * lista e basta che il layout ne colleghi almeno uno.
 */
export function effectiveZooLayout(
  db: ZooDB, scope: Scope, formatId: string, academyDb: DB, tags: string[] = []
): ZooLayout {
  const candidates = db.zooLayouts.filter((l) => l.formatId === formatId);
  // i layout salvati prima delle tipologie non hanno il campo: valgono per tutti
  const tip = (l: ZooLayout) => l.tipologie ?? [];
  const match = (l: ZooLayout) => tip(l).length === 0 || tip(l).some((t) => tags.includes(t));
  for (const s of chainFor(scope, academyDb)) {
    const specific = candidates.find(
      (l) => l.scopeType === s.type && l.scopeId === s.id && tip(l).length > 0 && tip(l).some((t) => tags.includes(t))
    );
    if (specific) return specific;
    const generic = candidates.find((l) => l.scopeType === s.type && l.scopeId === s.id && match(l));
    if (generic) return generic;
  }
  return candidates.find((l) => l.scopeType === "system") ?? {
    id: "default", formatId, scopeType: "system", scopeId: "", tipologie: [], items: DEFAULT_ZOO_ITEMS,
  };
}

/**
 * Frase di validità costruita dalle date del volantino, in forma leggibile:
 * "Promozione valida dal 17 settembre al 18 ottobre". Se manca una delle due
 * date non si inventa nulla e la frase resta vuota.
 */
export function testoValidita(campaign?: ZooCampaign): string {
  if (!campaign?.dal || !campaign?.al) return "";
  const giorno = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  return `Promozione valida dal ${giorno(campaign.dal)} al ${giorno(campaign.al)}`;
}

/** Valori del cartello per un'offerta (con prezzo del PV se caricato). */
export function zooCartelloValues(
  db: ZooDB, offer: ZooOffer, scope?: Scope, academyDb?: DB
): Record<string, string> {
  const product = db.products.find((p) => p.id === offer.productId);
  const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
  // il cartello è per il codice padre: elenca gli EAN di tutte le sue varianti, non solo quella dell'offerta
  const fratelli = parent ? db.products.filter((p) => p.parentId === parent.id) : product ? [product] : [];
  // con un ambito si applicano le personalizzazioni dell'insegna/PV, altrimenti resta la versione del Consorzio
  const perScope = scope && academyDb;
  const testoPadre = (field: "nome" | "descCartello") =>
    !parent ? "" : perScope ? effectiveParentText(db, scope, parent, field, academyDb).value : parent[field] ?? "";
  const tagPadre = (kind: "animale" | "prodotto") => {
    if (!parent) return "";
    if (perScope) return effectiveParentTag(db, scope, parent, kind, academyDb).value;
    const dal = kind === "animale" ? animaliDi(db, parent.caratteristiche) : caratteristicheProdottoDi(db, parent.caratteristiche);
    return dal.join(", ");
  };
  const testoOfferta = (field: "descrizione" | "condizioni") =>
    perScope ? effectiveOfferText(db, scope, offer, field, academyDb).value : offer[field] ?? "";
  const foto = zooImageUrl(product, parent);
  const campaign = db.campaigns.find((c) => c.id === offer.campaignId);
  const validita = testoValidita(campaign);
  /*
   * Le condizioni possono portarsi dietro la validità del volantino: così i
   * cartelli già impaginati la mostrano senza rifare il layout. Chi preferisce
   * tenerla in un riquadro suo usa il campo "validita", che resta separato.
   */
  const condizioniSalvate = testoOfferta("condizioni");
  const condizioni = (db.settings.condizioniConValidita ?? true) && validita
    ? [condizioniSalvate, validita].filter(Boolean).join(" · ")
    : condizioniSalvate;
  return {
    /*
     * Senza prodotto padre il titolo resterebbe vuoto e il cartello uscirebbe
     * senza nome: succede sugli articoli propri di un punto vendita, che nascono
     * senza raggruppamento. In quel caso vale la descrizione dell'articolo.
     */
    titolo: testoPadre("nome") || product?.descrizione || offer.descrizione,
    descCartello: testoPadre("descCartello"),
    descrizione: testoOfferta("descrizione"),
    descrizioneArticolo: product?.descrizione ?? "",
    // i listini dei fornitori spesso non hanno la marca: meglio il fornitore che un campo vuoto
    marca: product?.marca || product?.fornitore || "",
    prezzoPromo: offer.prezzoPromo ? `€ ${offer.prezzoPromo}` : "",
    /*
     * Senza prezzo di partenza non c'è niente da barrare: al suo posto va la
     * dicitura "A SOLI", che introduce il prezzo promo (Cartello.tsx barra solo
     * i valori che sono davvero un prezzo).
     */
    prezzoListino: offer.prezzoListino
      ? `€ ${offer.prezzoListino}`
      : offer.prezzoPromo ? "A SOLI" : "",
    meccanica: offer.meccanica ?? "",
    // promozione applicata dall'insegna/PV (dal loro file): vuota per il Consorzio
    tipoPromo: perScope ? (pvPromoFor(db, scope, offer.ean, academyDb)?.etichetta ?? "") : "",
    label: offer.label ?? "",
    condizioni,
    /*
     * Le condizioni pronte del Consorzio (Impostazioni → "Condizioni pronte per i
     * cartelli"): uguali su tutti i cartelli, indipendenti dalla singola offerta.
     * Sono un campo a sé perché di solito vanno in un rigo fisso in fondo, accanto
     * o al posto delle condizioni della promozione.
     */
    condizioniStandard: db.settings.condizioniStandard.join(" · "),
    validita,
    eanLista: fratelli.map((p) => p.ean).join(" · "),
    animale: tagPadre("animale"),
    caratteristica: tagPadre("prodotto"),
    // niente foto caricata: si lascia il campo vuoto invece del segnaposto "mancante"
    immagine: foto === "/immagini/mancante.jpg" ? "" : foto,
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

/**
 * Export delle offerte di un volantino, in due tagli:
 *  - "volantino": quelle scelte, cioè finite sulla carta;
 *  - "fuori": quelle trattate come promozione ma non scelte per la stampa. Sono
 *    la maggioranza (di un migliaio di offerte ne va a volantino qualche
 *    centinaio) e servono lo stesso, perché in reparto vengono esposte col
 *    cartello: chi le esporta le usa per preparare cartelli e ordini.
 */
export function offerteExportRows(
  db: ZooDB, academyDb: DB, scope: Scope, campaign: ZooCampaign | undefined,
  tipo: "volantino" | "fuori"
): Record<string, string>[] {
  if (!campaign) return [];
  const pagine = new Map(
    (db.volantinoLayouts.find((l) => l.campaignId === campaign.id)?.pages ?? []).map((p, i) => [p.id, p.titolo || `Pagina ${i + 1}`])
  );
  const offers = db.offers.filter(
    (o) => o.campaignId === campaign.id && (tipo === "volantino" ? o.selezionata : !o.selezionata)
  );
  return offers
    .sort((a, b) => (a.descrizione ?? "").localeCompare(b.descrizione ?? "", "it"))
    .map((o) => {
      const p = db.products.find((x) => x.id === o.productId) ?? db.products.find((x) => x.ean === o.ean);
      const parent = p?.parentId ? db.parents.find((x) => x.id === p.parentId) : undefined;
      const base: Record<string, string> = {
        EAN: o.ean,
        "CODICE FORNITORE": p?.codice ?? "",
        DESCRIZIONE: o.descrizione || (p?.descrizione ?? ""),
        MARCA: p?.marca ?? "",
        FORNITORE: p?.fornitore ?? "",
        "PRODOTTO PADRE": parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : "",
        "PREZZO PROMO": o.prezzoPromo,
        "PREZZO LISTINO": o.prezzoListino ?? "",
        CONDIZIONI: o.condizioni ?? "",
        VOLANTINO: campaign.nome,
        "VALIDITA'": `${campaign.dal} - ${campaign.al}`,
      };
      if (tipo === "volantino") {
        return {
          ...base,
          PAGINA: o.paginaId && o.paginaId !== NO_VOLANTINO ? (pagine.get(o.paginaId) ?? "") : "",
          SCHEDA: campaign.schede.find((s) => s.id === o.schedaId)?.nome ?? "",
          ETICHETTA: o.label ?? "",
          "AREA TEMATICA": o.gruppo ?? "",
          FOCUS: o.focus ?? "",
          "RAGGRUPPAMENTO GRAFICO": o.gruppoGrafico ?? "",
          "DESCRIZIONE VOLANTINO": parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "",
          FOTO: zooImageUrl(p, parent),
        };
      }
      return {
        ...base,
        "SCARTATA DAL VOLANTINO": o.paginaId === NO_VOLANTINO ? "sì" : "",
        "DESCRIZIONE CARTELLO": parent ? effectiveParentText(db, scope, parent, "descCartello", academyDb).value : "",
        FOTO: zooImageUrl(p, parent),
      };
    });
}

/** Una riga dell'export "per cella" del volantino composto (crea-volantino/excel). */
export interface VolantinoCellRow {
  "N. pagina": number; Pagina: string; "Note della pagina": string; Cella: string;
  Riga: number; Colonna: number; "Righe occupate": number; "Colonne occupate": number;
  Sezione: string; "Sfondo sezione": string; "Testo sezione": string; "N. offerte": number; EAN: string;
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
        Sezione: sez?.titolo ?? "", "Sfondo sezione": sez?.bg ?? "", "Testo sezione": sez?.testo ?? "",
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
  { fieldId: "prezzoListino", x: 55, y: 66, w: 40, h: 7, align: "right" },
  { fieldId: "meccanica", x: 5, y: 74, w: 33, h: 12 },
  { fieldId: "prezzoPromo", x: 40, y: 74, w: 55, h: 18 },
  /*
   * La validità non ha un riquadro suo nel layout predefinito: arriva in coda
   * alle condizioni (impostazione "Aggiungi alle condizioni la validità"), che
   * è il modo che funziona anche sui layout già disegnati. Chi la vuole su una
   * riga separata aggiunge il campo "Validità" e toglie quell'impostazione,
   * altrimenti la frase comparirebbe due volte.
   */
  { fieldId: "condizioni", x: 5, y: 92, w: 90, h: 6 },
];
