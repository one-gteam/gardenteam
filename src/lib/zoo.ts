import fs from "fs";
import path from "path";
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

/** Campagna = import mensile di offerte, con validità e schede (pagine) del volantino. */
export interface ZooCampaign {
  id: string;
  nome: string;
  dal: string; // yyyy-mm-dd
  al: string;
  schede: ZooScheda[];
  attiva: boolean;
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

export interface ZooSettings {
  caratteristiche: string[]; // umido, secco, cane, gatto, roditori...
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
}

/* ================== Persistenza ================== */

const DEFAULT_SETTINGS: ZooSettings = {
  caratteristiche: ["Cane", "Gatto", "Roditori", "Uccelli", "Pesci", "Umido", "Secco", "Snack", "Accessori", "Igiene"],
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
    votes: [], hidden: [], pvPrices: [], suggestions: [],
  };
  const db = await readDomain<ZooDB>("zoo", empty);
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings ?? {}) };
  for (const k of ["products", "parents", "textOverrides", "campaigns", "offers", "votes", "hidden", "pvPrices", "suggestions"] as const) {
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

/** Foto del prodotto zoo: percorso salvato, tentativo per EAN/codice, altrimenti "mancante". */
export function zooImageUrl(p?: ZooProduct, parent?: ZooParent): string {
  if (parent?.image) return parent.image;
  if (p?.image) return p.image;
  if (p) {
    for (const name of [p.ean, p.codice]) {
      for (const ext of ["jpg", "png", "jpeg", "webp"]) {
        const abs = path.join(process.cwd(), "public", "zoo-foto", `${name}.${ext}`);
        if (fs.existsSync(abs)) return `/zoo-foto/${name}.${ext}`;
      }
    }
  }
  return "/immagini/mancante.jpg";
}

export function activeCampaign(db: ZooDB): ZooCampaign | undefined {
  return db.campaigns.find((c) => c.attiva) ?? db.campaigns[db.campaigns.length - 1];
}

export function fornitoriList(db: ZooDB): string[] {
  return Array.from(new Set(db.products.map((p) => p.fornitore).filter(Boolean))).sort();
}

export function marcheList(db: ZooDB): string[] {
  return Array.from(new Set(db.products.map((p) => p.marca).filter(Boolean))).sort();
}
