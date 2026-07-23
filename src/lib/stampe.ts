import fs from "fs";
import path from "path";
import { DB, User, userSites } from "./types";
import { readDomain, writeDomain } from "./supabase";

/* ================== Tipi del sito Stampe ================== */

export interface PrintField {
  id: string;
  label: string;
  size: number; // font size di default nel cartello
  bold: boolean;
  font?: "cn"; // variante condensed (titoli e prezzi, come nel template)
  custom?: boolean;
  type?: "text" | "image"; // i campi immagine mostrano un URL/percorso e vengono resi come <img>
  scopeType?: ScopeType; // campo personalizzato di un'insegna/PV (assente = campo di sistema)
  scopeId?: string;
}

/** Valore con ambito: usato per marchi, tipologie e colori aggiunti da insegne/PV. */
export interface ScopedValue {
  value: string;
  scopeType?: ScopeType;
  scopeId?: string;
}

export interface PrintProduct {
  id: string;
  codice: string;
  ean: string;
  tipologia: string;
  marca: string;
  image: string; // percorso SharePoint/locale, collegato per codice articolo
  fields: Record<string, string>;
  variantOf?: string; // id del prodotto base per le varianti colore
}

export type ScopeType = "system" | "tenant" | "store";

export interface FieldOverride {
  scopeType: ScopeType;
  scopeId: string;
  productId: string;
  fieldId: string;
  value: string;
}

export interface FieldPref {
  scopeType: ScopeType;
  scopeId: string;
  fieldId: string;
  hidden: boolean;
}

export interface PrintFormat {
  id: string;
  name: string;
  w: number; // mm
  h: number; // mm
  background?: string; // /uploads/...
}

export interface StickerStyle {
  shape: "cerchio" | "quadrato" | "stella" | "nastro";
  bg: string; // colore di sfondo
  rotation: number; // gradi
  size: number; // dimensione testo
  font?: "cn";
}

export interface LayoutItem {
  fieldId: string; // "__img" per immagini/loghi liberi
  x: number; // % del cartello
  y: number;
  w: number;
  h: number;
  color?: string; // colore testo (es. bianco sui template a banda)
  imageUrl?: string; // solo per fieldId "__img"
  sticker?: StickerStyle; // bollino/sticker associato al campo fieldId
}

export interface CardLayout {
  id: string;
  formatId: string;
  scopeType: ScopeType;
  scopeId: string;
  tipologie: string[]; // vuoto = tutte
  items: LayoutItem[];
}

export interface ErrorReport {
  id: string;
  productId: string;
  fieldId: string;
  message: string;
  userId: string;
  date: string;
  status: "aperta" | "risolta";
}

export interface StampeSettings {
  sharepointImagesUrl?: string; // cartella SharePoint con le foto prodotti (collegate per codice articolo)
  sharepointExcelUrl?: string; // eventuale file Excel di origine
  note?: string;
  blockedStores?: string[]; // PV a cui l'insegna ha inibito la personalizzazione dei cartelli
}

export interface ScopedBackground {
  formatId: string;
  scopeType: ScopeType;
  scopeId: string;
  url: string;
}

export interface LayoutImage {
  id: string;
  name: string;
  url: string;
  scopeType: ScopeType;
  scopeId: string;
}

export interface StampeDB {
  settings: StampeSettings;
  fields: PrintField[];
  products: PrintProduct[];
  overrides: FieldOverride[];
  fieldPrefs: FieldPref[];
  formats: PrintFormat[];
  layouts: CardLayout[];
  reports: ErrorReport[];
  lists: { marche: ScopedValue[]; tipologie: ScopedValue[]; colori: ScopedValue[] };
  scopedBackgrounds: ScopedBackground[];
  layoutImages: LayoutImage[];
}

/* ================== Persistenza ================== */

export async function getStampeDb(): Promise<StampeDB> {
  const db = await readDomain<StampeDB>("stampe", {} as StampeDB);
  if (!db.settings) db.settings = {};
  if (!db.settings.blockedStores) db.settings.blockedStores = [];
  if (!db.lists) db.lists = { marche: [], tipologie: [], colori: [] };
  if (!db.scopedBackgrounds) db.scopedBackgrounds = [];
  if (!db.layoutImages) db.layoutImages = [];
  if (!db.products) db.products = [];
  if (!db.fields) db.fields = [];
  if (!db.overrides) db.overrides = [];
  if (!db.fieldPrefs) db.fieldPrefs = [];
  if (!db.formats) db.formats = [];
  if (!db.layouts) db.layouts = [];
  if (!db.reports) db.reports = [];
  return db;
}

export async function saveStampeDb(db: StampeDB): Promise<void> {
  await writeDomain("stampe", db);
}

/* ================== Permessi e ambiti ================== */

/** Chi può entrare nel sito Stampe: chi ha la macroarea "stampe" tra i suoi accessi. */
export function canAccessStampe(user: User): boolean {
  return userSites(user).includes("stampe");
}

/** Il responsabile contenuti del Consorzio modifica la versione comune. */
export function isConsortiumEditor(user: User): boolean {
  return user.role === "system_admin" || user.role === "course_manager";
}

export interface Scope {
  type: ScopeType;
  id: string;
  label: string;
}

/**
 * Gli ambiti selezionabili in alto a destra, in base al ruolo.
 * `academyDb` è il database Academy (tenants/stores) già caricato dalla pagina
 * chiamante — evitiamo di ricaricarlo qui per non moltiplicare le chiamate a Supabase.
 */
export function scopesForUser(user: User, academyDb: DB): Scope[] {
  if (isConsortiumEditor(user)) {
    return [
      { type: "system" as const, id: "", label: "🏛️ Consorzio (comune a tutti)" },
      ...academyDb.tenants.map((t) => ({ type: "tenant" as const, id: t.id, label: `${t.emoji} ${t.name}` })),
    ];
  }
  if (user.role === "group_admin" && user.tenantId) {
    const tenant = academyDb.tenants.find((t) => t.id === user.tenantId)!;
    const stores = academyDb.stores.filter((s) => s.tenantId === user.tenantId);
    return [
      { type: "tenant" as const, id: tenant.id, label: `${tenant.emoji} ${tenant.name} (tutta l'insegna)` },
      ...stores.map((s) => ({ type: "store" as const, id: s.id, label: `📍 ${s.name}` })),
    ];
  }
  if (user.storeId) {
    const store = academyDb.stores.find((s) => s.id === user.storeId)!;
    return [{ type: "store" as const, id: store.id, label: `📍 ${store.name}` }];
  }
  return [{ type: "system", id: "", label: "🏛️ Consorzio" }];
}

export function resolveScope(user: User, param: string | undefined, academyDb: DB): Scope {
  const scopes = scopesForUser(user, academyDb);
  const found = param ? scopes.find((s) => `${s.type}:${s.id}` === param) : undefined;
  return found ?? scopes[0];
}

/* ================== Valori effettivi (comune + personalizzazioni) ================== */

function parentScopes(scope: Scope, academyDb: DB): { type: ScopeType; id: string }[] {
  // catena: store -> tenant -> system
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

/** Valore effettivo di un campo per un ambito: personalizzazione più vicina, altrimenti versione Consorzio. */
export function effectiveValue(db: StampeDB, scope: Scope, product: PrintProduct, fieldId: string, academyDb: DB) {
  for (const s of parentScopes(scope, academyDb)) {
    if (s.type === "system") break;
    const ov = db.overrides.find(
      (o) => o.scopeType === s.type && o.scopeId === s.id && o.productId === product.id && o.fieldId === fieldId
    );
    if (ov) return { value: ov.value, custom: true, scopeType: s.type };
  }
  return { value: product.fields[fieldId] ?? "", custom: false, scopeType: "system" as ScopeType };
}

/** Campo nascosto per questo ambito? */
export function isFieldHidden(db: StampeDB, scope: Scope, fieldId: string, academyDb: DB): boolean {
  for (const s of parentScopes(scope, academyDb)) {
    const pref = db.fieldPrefs.find((p) => p.scopeType === s.type && p.scopeId === s.id && p.fieldId === fieldId);
    if (pref) return pref.hidden;
  }
  return false;
}

/** Layout effettivo per formato+ambito(+tipologia): personalizzato se esiste, altrimenti quello del Consorzio. */
export function effectiveLayout(
  db: StampeDB, scope: Scope, formatId: string, academyDb: DB, tipologia?: string
): CardLayout | undefined {
  const candidates = db.layouts.filter((l) => l.formatId === formatId);
  const match = (l: CardLayout) => l.tipologie.length === 0 || (tipologia && l.tipologie.includes(tipologia));
  for (const s of parentScopes(scope, academyDb)) {
    // prima layout specifici per tipologia, poi generici
    const specific = candidates.find(
      (l) => l.scopeType === s.type && l.scopeId === s.id && l.tipologie.length > 0 && tipologia && l.tipologie.includes(tipologia)
    );
    if (specific) return specific;
    const generic = candidates.find((l) => l.scopeType === s.type && l.scopeId === s.id && match(l));
    if (generic) return generic;
  }
  return candidates.find((l) => l.scopeType === "system");
}

/* ================== Immagini prodotti (SharePoint / cartella immagini) ================== */

/**
 * Risolve la foto del prodotto: il percorso Excel (\immagini\foto prodotti\<file>) viene cercato
 * in public/immagini; se il file non c'è si usa l'immagine "mancante". Legge solo asset statici
 * inclusi nel deploy (public/), quindi funziona senza modifiche anche su Vercel.
 */
export function productImageUrl(product: PrintProduct): string {
  const raw = (product.image ?? "").replace(/\\/g, "/").replace(/^\/?immagini\//i, "");
  if (raw) {
    const rel = raw.split("/").filter(Boolean);
    const abs = path.join(process.cwd(), "public", "immagini", ...rel);
    if (fs.existsSync(abs)) return "/immagini/" + rel.join("/");
    // prova per codice articolo nelle estensioni comuni
  }
  for (const ext of ["jpg", "png", "jpeg", "webp"]) {
    const abs = path.join(process.cwd(), "public", "immagini", "foto prodotti", `${product.codice}.${ext}`);
    if (fs.existsSync(abs)) return `/immagini/foto prodotti/${product.codice}.${ext}`;
  }
  return "/immagini/mancante.jpg";
}

export function aziendaLogoUrl(marca: string): string {
  const file = marca.toLowerCase().replace(/\s+/g, "");
  for (const ext of ["jpg", "png"]) {
    const abs = path.join(process.cwd(), "public", "immagini", "azienda", `${file}.${ext}`);
    if (fs.existsSync(abs)) return `/immagini/azienda/${file}.${ext}`;
  }
  return "";
}

/** Logo dell'insegna per il piede del cartello: dipende dall'ambito scelto. */
export function insegnaLogoUrl(scope: Scope, academyDb: DB): string {
  let tenantId = scope.type === "tenant" ? scope.id : "";
  if (scope.type === "store") tenantId = academyDb.stores.find((s) => s.id === scope.id)?.tenantId ?? "";
  const tenant = academyDb.tenants.find((t) => t.id === tenantId);
  if (tenant?.logoUrl) return tenant.logoUrl;
  return "/immagini/azienda/gardenteam.jpg";
}

/** Valori pronti per il cartello: campi effettivi (con personalizzazioni) + immagini risolte. */
export function cartelloValues(db: StampeDB, scope: Scope, product: PrintProduct, academyDb: DB): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of fieldsForScope(db, scope, academyDb)) {
    if (isFieldHidden(db, scope, f.id, academyDb)) continue;
    if (f.id === "foto") values.foto = productImageUrl(product);
    else if (f.id === "logoAzienda") values.logoAzienda = aziendaLogoUrl(product.marca);
    else if (f.id === "logoInsegna") values.logoInsegna = insegnaLogoUrl(scope, academyDb);
    else if (f.id === "codice") values.codice = product.codice;
    else if (f.id === "codiceInterno") {
      // codice interno dell'insegna/PV (dall'associazione Excel); se assente, il codice fornitore
      values.codiceInterno = effectiveValue(db, scope, product, f.id, academyDb).value || product.codice;
    }
    else values[f.id] = effectiveValue(db, scope, product, f.id, academyDb).value;
  }
  return values;
}

export const IMAGE_FIELDS = new Set(["foto", "logoAzienda", "logoInsegna"]);

export function isImageField(field: PrintField | undefined, fieldId: string): boolean {
  return IMAGE_FIELDS.has(fieldId) || field?.type === "image";
}

/** Campi visibili in un ambito: campi di sistema + campi personalizzati dell'insegna/PV. */
export function fieldsForScope(db: StampeDB, scope: Scope, academyDb: DB): PrintField[] {
  const chain = parentScopes(scope, academyDb).map((s) => `${s.type}:${s.id}`);
  return db.fields.filter((f) => {
    if (!f.scopeType) return true;
    return chain.includes(`${f.scopeType}:${f.scopeId ?? ""}`);
  });
}

/** Sfondo effettivo di un formato: personalizzato dell'ambito, altrimenti quello del Consorzio. */
export function backgroundFor(db: StampeDB, format: PrintFormat, scope: Scope, academyDb: DB): string | undefined {
  for (const s of parentScopes(scope, academyDb)) {
    if (s.type === "system") break;
    const bg = db.scopedBackgrounds.find(
      (b) => b.formatId === format.id && b.scopeType === s.type && b.scopeId === s.id
    );
    if (bg) return bg.url;
  }
  return format.background;
}

/** Il PV è stato bloccato dalla personalizzazione dalla propria insegna? */
export function isStoreBlocked(db: StampeDB, scope: Scope): boolean {
  return scope.type === "store" && (db.settings.blockedStores ?? []).includes(scope.id);
}

/** Elenchi (marche/tipologie/colori): valori dai prodotti + aggiunte di sistema e dell'ambito. */
export function listValues(db: StampeDB, key: "marche" | "tipologie" | "colori", scope: Scope, academyDb: DB): string[] {
  const chain = new Set(parentScopes(scope, academyDb).map((s) => `${s.type}:${s.id}`));
  chain.add("system:");
  const fromLists = db.lists[key]
    .filter((v) => !v.scopeType || chain.has(`${v.scopeType}:${v.scopeId ?? ""}`))
    .map((v) => v.value);
  const fromProducts =
    key === "marche" ? db.products.map((p) => p.marca) : key === "tipologie" ? db.products.map((p) => p.tipologia) : [];
  return [...new Set([...fromProducts, ...fromLists])].filter(Boolean).sort();
}

export function filterProducts(
  db: StampeDB,
  f: { q?: string; tipologia?: string; marca?: string; prezzoMax?: string }
): PrintProduct[] {
  const q = (f.q ?? "").toLowerCase();
  const max = Number(f.prezzoMax) || 0;
  return db.products.filter((p) => {
    if (f.tipologia && p.tipologia !== f.tipologia) return false;
    if (f.marca && p.marca !== f.marca) return false;
    if (q && !`${p.fields.titolo} ${p.fields.sottotitolo} ${p.codice}`.toLowerCase().includes(q)) return false;
    if (max > 0) {
      const prezzo = parseFloat((p.fields.prezzo ?? "").replace(",", "."));
      if (prezzo && prezzo > max) return false;
    }
    return true;
  });
}
