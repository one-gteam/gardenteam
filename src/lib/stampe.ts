import fs from "fs";
import path from "path";
import { DB, SiteId, User, gestisce, gestisceConsorzio, livelloDi, userSites } from "./types";
import { readDomain, writeDomain } from "./supabase";
import { ELEMENTO_QR, isImageField } from "./cartello-campi";

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
  /** Spiegazione breve: si legge nell'editor, sul pulsante e nel riquadro "Campo scelto". */
  nota?: string;
  /** Gruppo di appartenenza (Descrizione, Prezzo, Misure e imballo…): vedi cartello-campi. */
  gruppo?: string;
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
  annoCollezione?: string; // anno di inserimento nella collezione (es. "2026")
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

/**
 * Dove si vede un campo, per ambito: `hidden` = non sul cartello stampato,
 * `online` = sulla scheda che si apre dal QR code (assente = sì). Un campo
 * "solo online" è hidden con online; uno "solo cartello" ha online: false.
 */
export interface FieldPref {
  scopeType: ScopeType;
  scopeId: string;
  fieldId: string;
  hidden: boolean;
  online?: boolean;
}

/** La scheda online di un ambito: se c'è e cosa mostra. */
export interface SchedaOnlinePref {
  scopeType: ScopeType;
  scopeId: string;
  /** Spenta = niente QR sui cartelli e pagina pubblica non raggiungibile. */
  attiva?: boolean;
  /** "tutto" = tutti i campi ammessi online; "extra" = solo quelli che non stanno sul cartello. */
  modo?: "tutto" | "extra";
  /** Frase in testa alla scheda (es. "Grazie per averci scelto"). */
  benvenuto?: string;
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

/**
 * La grafica del riquadro di un campo: titolo con icona, righe o fascia,
 * bordo e spazio interno. È quello che prima stava disegnato nell'immagine di
 * sfondo: portandolo sul campo, se il campo è vuoto sparisce anche la cornice.
 */
export interface Cornice {
  titolo?: string; // scritta sopra al valore, es. "misure imballo:"
  icona?: string; // uno o due caratteri nel quadratino accanto al titolo
  stile?: "linee" | "fascia" | "semplice"; // riga sopra e sotto il titolo / fascia colorata / solo testo
  colore?: string; // colore del titolo
  sfondo?: string; // fascia e quadratino dell'icona
  size?: number; // corpo del titolo (stessa scala dei campi)
  bordoColore?: string;
  bordoSpessore?: number; // mm
  bordoLati?: "tutti" | "sopra" | "sotto" | "sopra-sotto";
  padding?: number; // mm di spazio fra bordo e contenuto
}

export interface LayoutItem {
  fieldId: string; // "__img" immagini/loghi liberi, "__box" riquadro o scritta fissa, "__qr" QR della scheda online
  x: number; // % del cartello
  y: number;
  w: number;
  h: number;
  color?: string; // colore testo (es. bianco sui template a banda)
  imageUrl?: string; // solo per fieldId "__img"
  sticker?: StickerStyle; // bollino/sticker associato al campo fieldId
  size?: number; // dimensione font: sovrascrive il default del campo per questo elemento
  bold?: boolean; // grassetto: sovrascrive il default del campo per questo elemento
  italic?: boolean; // corsivo (nessun default: solo per elemento)
  align?: "left" | "center" | "right"; // allineamento del testo nel paragrafo
  valign?: "top" | "middle" | "bottom"; // dove sta il testo dentro al riquadro (default: in alto)
  font?: string; // chiave di LAYOUT_FONTS (vedi lib/layout-fonts): sovrascrive il carattere del campo
  bg?: string; // colore di sfondo del riquadro (assente = trasparente)
  radius?: number; // raggio degli angoli arrotondati, in mm (0/assente = angoli vivi)
  cornice?: Cornice; // titolo, bordo e spazio interno del riquadro
  testo?: string; // "__box": scritta fissa; "__qr": didascalia sotto al codice
  prefisso?: string; // davanti al valore, es. "€" davanti al prezzo
}

/** Margini del foglio, in mm, uno per lato. */
export interface LayoutMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_MARGINS: LayoutMargins = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Margini di un layout, con compatibilità all'indietro: i primi layout avevano
 * un unico valore `margin` uguale sui quattro lati.
 */
export function layoutMargins(l?: { margins?: LayoutMargins; margin?: number }): LayoutMargins {
  if (l?.margins) return l.margins;
  const m = l?.margin ?? 0;
  return { top: m, right: m, bottom: m, left: m };
}

/**
 * Margini per lato (mm) come arrivano dal client, entro limiti ragionevoli.
 * Vive qui e non in stampe-actions perché quello è un modulo "use server",
 * dove ogni export deve essere una funzione asincrona.
 */
export function sanitizeMargins(json: string): LayoutMargins {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = null;
  }
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lato = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 0));
  return { top: lato(m.top), right: lato(m.right), bottom: lato(m.bottom), left: lato(m.left) };
}

export interface CardLayout {
  id: string;
  formatId: string;
  scopeType: ScopeType;
  scopeId: string;
  /** Nome scelto per riconoscerlo quando ce n'è più di uno per lo stesso formato. */
  nome?: string;
  tipologie: string[]; // vuoto = tutte
  items: LayoutItem[];
  /** Versione alternativa usata in stampa quando il campo foto non ha un'immagine. */
  itemsNoPhoto?: LayoutItem[];
  /** Margini del foglio (mm, per lato): guide a cui i campi si agganciano nell'editor. */
  margins?: LayoutMargins;
  /** Vecchio margine unico, tenuto solo per leggere i layout salvati prima. */
  margin?: number;
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
  schedaOnline: SchedaOnlinePref[];
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
  if (!db.schedaOnline) db.schedaOnline = [];
  if (!db.formats) db.formats = [];
  if (!db.layouts) db.layouts = [];
  if (!db.reports) db.reports = [];
  return db;
}

export async function saveStampeDb(db: StampeDB): Promise<void> {
  await writeDomain("stampe", db);
}

/* ================== Permessi e ambiti ================== */

/** Chi può entrare nel sito Stampe: chi ha almeno una delle sue tre aree. */
export function canAccessStampe(user: User): boolean {
  const sites = userSites(user);
  return sites.includes("arredo") || sites.includes("zoo") || sites.includes("piante");
}

/** Accesso a una specifica area del sito Stampe. */
export function canAccessArea(user: User, area: "arredo" | "zoo" | "piante"): boolean {
  return userSites(user).includes(area);
}

/**
 * Gestisce l'area in QUESTO ambito? Chi la gestisce a livello di Consorzio la
 * gestisce ovunque; chi la gestisce per un'insegna la gestisce anche nei suoi
 * punti vendita; chi la gestisce per un punto vendita solo lì.
 */
export function gestisceArea(user: User, area: SiteId, scope: { type: ScopeType; id: string }, academyDb: DB): boolean {
  if (user.role === "system_admin") return true;
  if (!gestisce(user, area)) return false;
  const livello = livelloDi(user);
  if (livello === "consorzio") return true;
  if (scope.type === "system") return false;
  if (livello === "insegna") {
    if (scope.type === "tenant") return scope.id === user.tenantId;
    return academyDb.stores.find((s) => s.id === scope.id)?.tenantId === user.tenantId;
  }
  return scope.type === "store" && scope.id === user.storeId;
}

/**
 * Può cambiare i layout dei cartelli in questo ambito? Chi gestisce l'area, e
 * il Grafico nel suo ambito: al Consorzio ovunque, in un'insegna sui suoi PV,
 * in un PV solo lì. Il grafico non tocca prodotti, offerte e testi: solo
 * layout e stampa.
 */
export function puoModificareLayout(user: User, area: SiteId, scope: { type: ScopeType; id: string }, academyDb: DB): boolean {
  if (gestisceArea(user, area, scope, academyDb)) return true;
  if (user.role !== "grafico" || !userSites(user).includes(area)) return false;
  const livello = livelloDi(user);
  if (livello === "consorzio") return true;
  if (scope.type === "system") return false;
  if (livello === "insegna") {
    if (scope.type === "tenant") return scope.id === user.tenantId;
    return academyDb.stores.find((s) => s.id === scope.id)?.tenantId === user.tenantId;
  }
  return scope.type === "store" && scope.id === user.storeId;
}

/** Vede la pagina Layout? Chi gestisce l'area o il Grafico (il menu la mostra solo a loro). */
export function vedeLayout(user: User, area: SiteId): boolean {
  return gestisce(user, area) || (user.role === "grafico" && userSites(user).includes(area));
}

/** Il responsabile contenuti del Consorzio (area Arredo) modifica la versione comune. */
export function isConsortiumEditor(user: User): boolean {
  return gestisceConsorzio(user, "arredo");
}

/** Chi cura i contenuti Zoo a livello di Consorzio. */
export function isZooEditor(user: User): boolean {
  return gestisceConsorzio(user, "zoo");
}

/** Chi curerà i contenuti Piante a livello di Consorzio (area in preparazione). */
export function isPianteEditor(user: User): boolean {
  return gestisceConsorzio(user, "piante");
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
  // chi sta al Consorzio (amministratore o gestore) lavora sulla versione comune e vede le insegne
  if (user.role === "system_admin" || (livelloDi(user) === "consorzio" && user.role === "manager")) {
    return [
      { type: "system" as const, id: "", label: "Consorzio (comune a tutti)" },
      ...academyDb.tenants.map((t) => ({ type: "tenant" as const, id: t.id, label: t.name })),
    ];
  }
  if (livelloDi(user) === "insegna" && user.tenantId) {
    const tenant = academyDb.tenants.find((t) => t.id === user.tenantId)!;
    const stores = academyDb.stores.filter((s) => s.tenantId === user.tenantId);
    return [
      { type: "tenant" as const, id: tenant.id, label: `${tenant.name} (tutta l'insegna)` },
      ...stores.map((s) => ({ type: "store" as const, id: s.id, label: s.name })),
    ];
  }
  if (user.storeId) {
    const store = academyDb.stores.find((s) => s.id === user.storeId)!;
    return [{ type: "store" as const, id: store.id, label: store.name }];
  }
  return [{ type: "system", id: "", label: "Consorzio" }];
}

export function resolveScope(user: User, param: string | undefined, academyDb: DB): Scope {
  const scopes = scopesForUser(user, academyDb);
  const found = param ? scopes.find((s) => `${s.type}:${s.id}` === param) : undefined;
  return found ?? scopes[0];
}

/* ================== Valori effettivi (comune + personalizzazioni) ================== */

export function parentScopes(scope: Scope, academyDb: DB): { type: ScopeType; id: string }[] {
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

/** Dove si vede un campo in questo ambito: la scelta più vicina nella catena PV → insegna → Consorzio. */
export function visibilitaCampo(db: StampeDB, scope: Scope, fieldId: string, academyDb: DB): { cartello: boolean; online: boolean } {
  for (const s of parentScopes(scope, academyDb)) {
    const pref = db.fieldPrefs.find((p) => p.scopeType === s.type && p.scopeId === s.id && p.fieldId === fieldId);
    if (pref) return { cartello: !pref.hidden, online: pref.online !== false };
  }
  return { cartello: true, online: true };
}

/** Campo nascosto sul cartello stampato, per questo ambito? */
export function isFieldHidden(db: StampeDB, scope: Scope, fieldId: string, academyDb: DB): boolean {
  return !visibilitaCampo(db, scope, fieldId, academyDb).cartello;
}

/** Impostazioni della scheda online per l'ambito (la più vicina nella catena; di default accesa, con tutto). */
export function schedaOnlinePer(db: StampeDB, scope: Scope, academyDb: DB): { attiva: boolean; modo: "tutto" | "extra"; benvenuto: string } {
  for (const s of parentScopes(scope, academyDb)) {
    const pref = db.schedaOnline.find((p) => p.scopeType === s.type && p.scopeId === s.id);
    if (pref) return { attiva: pref.attiva !== false, modo: pref.modo ?? "tutto", benvenuto: pref.benvenuto ?? "" };
  }
  return { attiva: true, modo: "tutto", benvenuto: "" };
}

/* ================== Scheda online (dal QR code) ================== */

function siteUrl(): string {
  return (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
}

/** L'ambito nell'indirizzo pubblico: "gt" per il Consorzio, altrimenti l'id dell'insegna o del PV. */
export function slugAmbito(scope: { type: ScopeType; id: string }): string {
  return scope.type === "system" ? "gt" : scope.id;
}

export function scopeDaSlug(slug: string, academyDb: DB): Scope | undefined {
  if (slug === "gt") return { type: "system", id: "", label: "Garden Team" };
  const tenant = academyDb.tenants.find((t) => t.id === slug);
  if (tenant) return { type: "tenant", id: tenant.id, label: tenant.name };
  const store = academyDb.stores.find((s) => s.id === slug);
  if (store) return { type: "store", id: store.id, label: store.name };
  return undefined;
}

/** Indirizzo della scheda online di un prodotto, per l'ambito che stampa (relativo o assoluto). */
export function schedaUrl(scope: { type: ScopeType; id: string }, product: PrintProduct, assoluto = true): string {
  const percorso = `/scheda/${slugAmbito(scope)}/${encodeURIComponent(product.codice)}`;
  return assoluto ? `${siteUrl()}${percorso}` : percorso;
}

/** L'insegna a cui la scheda si intitola (logo, colore, nome). */
export function insegnaDiScope(scope: Scope, academyDb: DB) {
  const tenantId = scope.type === "tenant" ? scope.id : scope.type === "store" ? academyDb.stores.find((s) => s.id === scope.id)?.tenantId : undefined;
  return academyDb.tenants.find((t) => t.id === tenantId);
}

/**
 * I campi che la scheda online mostra per questo prodotto: quelli ammessi
 * online per l'ambito (in modalità "extra" solo quelli che non stanno sul
 * cartello), con il valore effettivo e non vuoto. Le immagini stanno a parte.
 */
export function campiScheda(db: StampeDB, scope: Scope, product: PrintProduct, academyDb: DB): { field: PrintField; value: string }[] {
  const pref = schedaOnlinePer(db, scope, academyDb);
  const out: { field: PrintField; value: string }[] = [];
  for (const f of fieldsForScope(db, scope, academyDb)) {
    if (isImageField(f, f.id)) continue;
    const vis = visibilitaCampo(db, scope, f.id, academyDb);
    if (!vis.online) continue;
    if (pref.modo === "extra" && vis.cartello) continue;
    const value = f.id === "codice" ? product.codice
      : f.id === "codiceInterno" ? effectiveValue(db, scope, product, f.id, academyDb).value
      : effectiveValue(db, scope, product, f.id, academyDb).value;
    if (value.trim()) out.push({ field: f, value });
  }
  return out;
}

/** Layout effettivo per formato+ambito(+tipologia): personalizzato se esiste, altrimenti quello del Consorzio. */
export function effectiveLayout(
  db: StampeDB, scope: Scope, formatId: string, academyDb: DB, tipologia?: string
): CardLayout | undefined {
  const candidates = db.layouts.filter((l) => l.formatId === formatId);
  const chain = parentScopes(scope, academyDb);
  const di = (l: CardLayout, s: { type: ScopeType; id: string }) => l.scopeType === s.type && l.scopeId === s.id;
  // stessa regola dello Zoo: prima il layout della tipologia giusta, dal più vicino al Consorzio; poi il generico più vicino
  for (const s of chain) {
    const specific = candidates.find((l) => di(l, s) && l.tipologie.length > 0 && !!tipologia && l.tipologie.includes(tipologia));
    if (specific) return specific;
  }
  for (const s of chain) {
    const generic = candidates.find((l) => di(l, s) && l.tipologie.length === 0);
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
  // il QR code porta alla scheda online: c'è solo se per questo ambito la scheda è accesa
  if (schedaOnlinePer(db, scope, academyDb).attiva) values[ELEMENTO_QR] = schedaUrl(scope, product);
  return values;
}

export { IMAGE_FIELDS, isImageField } from "./cartello-campi";

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

/** Anni collezione presenti a database, dal più recente. */
export function anniCollezione(db: StampeDB): string[] {
  return [...new Set(db.products.map((p) => p.annoCollezione).filter(Boolean) as string[])].sort().reverse();
}

export function filterProducts(
  db: StampeDB,
  f: { q?: string; tipologia?: string; marca?: string; prezzoMax?: string; anno?: string }
): PrintProduct[] {
  const q = (f.q ?? "").toLowerCase();
  const max = Number(f.prezzoMax) || 0;
  return db.products.filter((p) => {
    if (f.tipologia && p.tipologia !== f.tipologia) return false;
    if (f.marca && p.marca !== f.marca) return false;
    if (f.anno && (p.annoCollezione ?? "") !== f.anno) return false;
    if (q && !`${p.fields.titolo} ${p.fields.sottotitolo} ${p.codice}`.toLowerCase().includes(q)) return false;
    if (max > 0) {
      // "1.299,00": il punto delle migliaia va tolto, altrimenti diventava 1,299 €
      const testo = (p.fields.prezzo ?? "").replace(/[€\s]/g, "");
      const prezzo = parseFloat(testo.includes(",") ? testo.replace(/\./g, "").replace(",", ".") : testo);
      if (prezzo && prezzo > max) return false;
    }
    return true;
  });
}
