"use server";

import { redirect } from "next/navigation";
import { requireUser } from "./auth";
import { getDb } from "./db";
import { canAccessStampe, isZooEditor, resolveScope } from "./stampe";
import { LAYOUT_FONTS } from "./layout-fonts";
import {
  getZooDb, saveZooDb, ZooDB, ZooParent, campagnaInLavorazione, campagnaInCorso, campaignStato, NO_VOLANTINO,
} from "./zoo";
import { groupAndDescribe, groupAndDescribeBatched } from "./zoo-ai";
import { uploadPublicFile, publicUrlFor, listStorageFiles } from "./supabase";

async function requireZooUser() {
  const user = await requireUser();
  if (!canAccessStampe(user)) redirect("/studente");
  return user;
}

function backUrl(page: string, scopeParam: string, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams({ scope: scopeParam, ...extra });
  return `${page}?${qs.toString()}`;
}

function cell(row: Record<string, unknown>, ...cols: string[]): string {
  const keys = Object.keys(row);
  for (const col of cols) {
    const k = keys.find((x) => x.trim().toLowerCase() === col.toLowerCase());
    if (k !== undefined) {
      const v = String(row[k] ?? "").trim().replace(/\.0$/, "");
      if (v) return v;
    }
  }
  return "";
}

function priceStr(v: string): string {
  if (!v) return "";
  const n = v.replace(",", ".");
  const num = Number(n);
  if (Number.isNaN(num)) return v;
  return num.toFixed(2).replace(".", ",");
}

/** Prezzo valido e diverso da zero (i listini fornitore usano spesso "0" per "non disponibile"). */
function priceOrEmpty(v: string): string {
  const p = priceStr(v);
  return p && Number(p.replace(",", ".")) > 0 ? p : "";
}

interface ListinoRow {
  ean: string; codice: string; descrizione: string; fornitore: string;
  prezzoListino: string; prezzoPromo: string; condizioni: string;
  marca?: string; categoria?: string;
}

/**
 * Formato "listino multi-fornitore": la riga di intestazione (FORNITORE, EAN,
 * NR. ARTICOLO FORNITORE, TESTO BREVE, PREZZO DI VENDITA, % SCONTO 1 PROMO,
 * PREZZO/TIPO PROMO CONSIGLIATO) si ripete prima di ogni fornitore, ma ogni riga
 * dati porta già il proprio fornitore in colonna B: non serve altra logica "a
 * blocchi", basta trovare le colonne una volta e saltare le righe che ripetono
 * l'intestazione. Usato come fallback quando il formato a colonne fisse (righe
 * oggetto con intestazione unica in cima) non produce righe valide.
 */
function parseListinoBlocchi(XLSX: typeof import("xlsx"), wb: import("xlsx").WorkBook): ListinoRow[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const want: Record<string, string> = {
    fornitore: "fornitore", ean: "ean", codice: "nr. articolo fornitore",
    descrizione: "testo breve", prezzoListino: "prezzo di vendita",
    prezzoPromo: "prezzo/tipo promo consigliato",
  };
  let cols: Record<string, number> | undefined;
  for (const row of grid) {
    const cells = row.map(norm);
    if (cells.includes(want.fornitore) && cells.includes(want.ean) && cells.includes(want.descrizione)) {
      cols = Object.fromEntries(Object.entries(want).map(([k, label]) => [k, cells.indexOf(label)]));
      break;
    }
  }
  if (!cols || cols.fornitore < 0 || cols.ean < 0) return [];
  const rows: ListinoRow[] = [];
  for (const row of grid) {
    const fornitoreCell = norm(row[cols.fornitore]);
    if (!fornitoreCell || fornitoreCell === want.fornitore) continue; // riga di intestazione ripetuta o vuota
    const ean = String(row[cols.ean] ?? "").trim().replace(/\.0$/, "");
    if (!ean) continue;
    const promoRaw = String(row[cols.prezzoPromo] ?? "").trim();
    const promoNum = Number(promoRaw.replace(",", "."));
    const isNumeric = promoRaw !== "" && !Number.isNaN(promoNum);
    rows.push({
      ean,
      codice: cols.codice >= 0 ? String(row[cols.codice] ?? "").trim().replace(/\.0$/, "") : "",
      descrizione: cols.descrizione >= 0 ? String(row[cols.descrizione] ?? "").trim() : "",
      fornitore: String(row[cols.fornitore] ?? "").trim(),
      prezzoListino: cols.prezzoListino >= 0 ? priceOrEmpty(String(row[cols.prezzoListino] ?? "").trim()) : "",
      prezzoPromo: isNumeric ? priceStr(promoRaw) : "",
      condizioni: isNumeric ? "" : promoRaw,
    });
  }
  return rows;
}

/* ================== 1. Database prodotti / caricamento foto ================== */

export async function importZooProducts(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect("/stampe/zoo/dati");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(backUrl("/stampe/zoo/dati", scopeParam, { importati: "0" }));
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file!.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const db = await getZooDb();
  let n = 0;
  for (const row of rows) {
    const ean = cell(row, "EAN", "CODICE EAN", "BARCODE");
    const descrizione = cell(row, "DESCRIZIONE", "DESCRIZIONE ARTICOLO", "ARTICOLO");
    if (!ean || !descrizione) continue;
    const id = `z_${ean}`;
    let p = db.products.find((x) => x.id === id);
    if (!p) {
      p = { id, ean, codice: "", descrizione: "", marca: "", fornitore: "" };
      db.products.push(p);
    }
    p.descrizione = descrizione;
    p.codice = cell(row, "CODICE FORNITORE", "COD. FORNITORE", "ART. FORNITORE", "CODICE") || p.codice;
    p.marca = cell(row, "MARCA", "MARCHIO", "BRAND") || p.marca;
    p.fornitore = cell(row, "FORNITORE", "DITTA") || p.fornitore;
    p.categoria = cell(row, "CATEGORIA", "REPARTO", "FAMIGLIA") || p.categoria;
    p.prezzo = priceStr(cell(row, "PREZZO", "PREZZO VENDITA", "PREZZO BASE")) || p.prezzo;
    n++;
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { importati: String(n) }));
}

/**
 * Completa il caricamento foto DOPO che il browser le ha già messe nel bucket
 * (upload diretto via URL firmato, vedi /api/zoo-foto/sign: bypassa il limite
 * di dimensione del body delle funzioni serverless, che con centinaia di foto
 * in alta risoluzione manda in errore un upload passato dal server). Qui resta
 * solo l'abbinamento automatico per EAN/codice contenuto nel nome file. `back`
 * è la pagina da cui si è partiti (Database prodotti o Import offerte).
 */
export async function finalizeZooPhotoUpload(back: string, scopeParam: string, fileNames: string[]) {
  await requireZooUser();
  const db = await getZooDb();
  let matched = 0;
  for (const clean of fileNames) {
    const base = clean.replace(/\.[a-z0-9]+$/, "");
    const hit = db.products.find(
      (p) => (p.ean && base.includes(p.ean)) || (p.codice && p.codice.length > 3 && base.includes(p.codice.toLowerCase()))
    );
    if (hit) {
      hit.image = publicUrlFor(`zoo-foto/${clean}`);
      matched++;
    }
  }
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { foto: String(fileNames.length), abbinate: String(matched) }));
}

/** Associa manualmente una foto già caricata (nel bucket zoo-foto) a un prodotto. */
export async function associateZooPhoto(back: string, scopeParam: string, productId: string, formData: FormData) {
  await requireZooUser();
  const fileName = String(formData.get("fileName") ?? "");
  const db = await getZooDb();
  const p = db.products.find((x) => x.id === productId);
  if (p && fileName) {
    p.image = publicUrlFor(`zoo-foto/${fileName}`);
    await saveZooDb(db);
  }
  redirect(backUrl(back, scopeParam, { prodotto: productId }));
}

/**
 * Conferma in blocco gli abbinamenti foto→articolo/padre scelti nella tabella di
 * abbinamento. Il bersaglio è l'id di un articolo, oppure "p:<id>" per un
 * prodotto padre: la ricerca permette di scegliere l'uno o l'altro.
 */
export async function confirmZooPhotoTargets(
  coppie: { file: string; target: string }[]
): Promise<{ ok: boolean; n: number }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false, n: 0 };
  const db = await getZooDb();
  let n = 0;
  for (const { file, target } of coppie) {
    if (!file || !target) continue;
    const url = publicUrlFor(`zoo-foto/${file}`);
    if (target.startsWith("p:")) {
      const parent = db.parents.find((p) => p.id === target.slice(2));
      if (parent) { parent.image = url; n++; }
    } else {
      const p = db.products.find((x) => x.id === target);
      if (p) { p.image = url; n++; }
    }
  }
  await saveZooDb(db);
  return { ok: true, n };
}

/**
 * Conferma in blocco gli abbinamenti foto→articolo proposti per nome (nessuna AI):
 * un campo `pick_<nomefile>` per foto, valorizzato con l'id del prodotto scelto
 * (vuoto = nessun abbinamento per quella foto).
 */
export async function confirmZooPhotoMatches(back: string, scopeParam: string, formData: FormData) {
  await requireZooUser();
  const db = await getZooDb();
  let n = 0;
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("pick_")) continue;
    const fileName = key.slice("pick_".length);
    const productId = String(value);
    if (!productId || !fileName) continue;
    const p = db.products.find((x) => x.id === productId);
    if (p) {
      p.image = publicUrlFor(`zoo-foto/${fileName}`);
      n++;
    }
  }
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { abbinatenome: String(n) }));
}

function applyGroups(
  db: ZooDB,
  groups: { nome: string; descVolantino: string; descCartello: string; caratteristiche: string[]; eans: string[] }[],
  usedAi: boolean
): number {
  let created = 0;
  for (const g of groups) {
    const children = db.products.filter((p) => g.eans.includes(p.ean));
    if (children.length === 0) continue;
    const id = `zp_${Date.now()}_${created}`;
    const parent: ZooParent = {
      id,
      nome: g.nome,
      descVolantino: g.descVolantino,
      descCartello: g.descCartello,
      caratteristiche: g.caratteristiche.filter((c) => db.settings.caratteristiche.includes(c)),
      image: children.find((c) => c.image)?.image,
      aiGenerated: usedAi,
    };
    db.parents.push(parent);
    for (const c of children) c.parentId = id;
    created++;
  }
  return created;
}

/** Crea manualmente UN padre dagli articoli selezionati. */
export async function createZooParent(back: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl(back, scopeParam));
  const ids = (formData.getAll("sel") as string[]).filter(Boolean);
  const db = await getZooDb();
  const children = db.products.filter((p) => ids.includes(p.id));
  if (children.length === 0) redirect(backUrl(back, scopeParam));
  const id = `zp_${Date.now()}`;
  db.parents.push({
    id,
    nome: children[0].descrizione.split(/\s+/).slice(0, 5).join(" "),
    descVolantino: "",
    descCartello: "",
    caratteristiche: [],
    image: children.find((c) => c.image)?.image,
  });
  for (const c of children) c.parentId = id;
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { padre: id }));
}

/**
 * "Associa con AI": raggruppa gli articoli selezionati e genera i testi volantino/cartello.
 * A lotti (vedi groupAndDescribeBatched): con una selezione molto grande (es. "seleziona
 * tutto" su centinaia di articoli) una singola chiamata Claude rischierebbe di far scadere
 * il tempo massimo della funzione senza salvare nulla. Se restano articoli, l'operazione
 * va ripetuta (i già raggruppati non vengono riproposti, perché hanno un padre).
 */
export async function associaConAI(back: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl(back, scopeParam));
  const ids = (formData.getAll("sel") as string[]).filter(Boolean);
  const db = await getZooDb();
  const selected = db.products.filter((p) => ids.includes(p.id));
  if (selected.length === 0) redirect(backUrl(back, scopeParam));
  const { groups, usedAi, error, restanti } = await groupAndDescribeBatched(db.settings.apiKey, selected, db.settings);
  const created = applyGroups(db, groups, usedAi);
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, {
    ai: usedAi ? "1" : "0", padri: String(created),
    ...(restanti ? { restanti: String(restanti) } : {}),
    ...(error ? { aierr: error.slice(0, 120) } : {}),
  }));
}

/** Rigenera con l'AI i testi di un padre esistente (dai suoi articoli figli). */
export async function rigeneraTestiAI(back: string, parentId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl(back, scopeParam));
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  const children = db.products.filter((p) => p.parentId === parentId);
  if (!parent || children.length === 0) redirect(backUrl(back, scopeParam, { padre: parentId }));
  const { groups, usedAi, error } = await groupAndDescribe(db.settings.apiKey, children, db.settings, true);
  if (groups[0]) {
    parent.nome = groups[0].nome;
    parent.descVolantino = groups[0].descVolantino;
    parent.descCartello = groups[0].descCartello;
    if (parent.caratteristiche.length === 0) {
      parent.caratteristiche = groups[0].caratteristiche.filter((c) => db.settings.caratteristiche.includes(c));
    }
    parent.aiGenerated = usedAi;
  }
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { padre: parentId, ai: usedAi ? "1" : "0", ...(error ? { aierr: error.slice(0, 120) } : {}) }));
}

/** Salva nome/testi del padre: il Consorzio scrive la versione comune, insegna/PV una personalizzazione. */
export async function saveParentTexts(back: string, parentId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent) redirect(backUrl(back, scopeParam));
  const fieldsIn = {
    nome: String(formData.get("nome") ?? ""),
    descVolantino: String(formData.get("descVolantino") ?? ""),
    descCartello: String(formData.get("descCartello") ?? ""),
  };
  if (scope.type === "system") {
    if (isZooEditor(user)) Object.assign(parent!, fieldsIn, { aiGenerated: false });
  } else {
    for (const [field, value] of Object.entries(fieldsIn) as ["nome" | "descVolantino" | "descCartello", string][]) {
      const existing = db.textOverrides.find(
        (o) => o.scopeType === scope.type && o.scopeId === scope.id && o.parentId === parentId && o.field === field
      );
      if (value && value !== parent![field]) {
        if (existing) existing.value = value;
        else db.textOverrides.push({ scopeType: scope.type, scopeId: scope.id, parentId, field, value });
      } else if (existing && value === parent![field]) {
        db.textOverrides = db.textOverrides.filter((o) => o !== existing);
      }
    }
  }
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { padre: parentId }));
}

/**
 * Come `saveParentTexts`, un solo campo e senza redirect: per la modifica in
 * linea nella tabella (autosalvataggio) invocata direttamente dal client, dove
 * un redirect ricaricherebbe la pagina ad ogni perdita di fuoco del campo.
 */
export async function updateParentFieldInline(
  parentId: string, field: "nome" | "descVolantino" | "descCartello", scopeParam: string, value: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent) return { ok: false };
  if (scope.type === "system") {
    if (!isZooEditor(user)) return { ok: false };
    parent[field] = value;
    parent.aiGenerated = false;
  } else {
    const existing = db.textOverrides.find(
      (o) => o.scopeType === scope.type && o.scopeId === scope.id && o.parentId === parentId && o.field === field
    );
    if (value && value !== parent[field]) {
      if (existing) existing.value = value;
      else db.textOverrides.push({ scopeType: scope.type, scopeId: scope.id, parentId, field, value });
    } else if (existing && value === parent[field]) {
      db.textOverrides = db.textOverrides.filter((o) => o !== existing);
    }
  }
  await saveZooDb(db);
  return { ok: true };
}

/**
 * Imposta in linea la categoria di animale (o la caratteristica di prodotto) di
 * un padre: le due dimensioni convivono nello stesso elenco `caratteristiche`,
 * quindi si sostituiscono solo i valori della dimensione scelta lasciando
 * intatta l'altra. Valore vuoto = nessun tag per quella dimensione.
 */
export async function setParentTagInline(
  parentId: string, kind: "animale" | "prodotto", value: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false };
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent) return { ok: false };
  const dominio = kind === "animale" ? db.settings.categorieAnimali : db.settings.caratteristicheProdotto;
  if (value && !dominio.includes(value)) return { ok: false };
  parent.caratteristiche = [
    ...parent.caratteristiche.filter((c) => !dominio.includes(c)),
    ...(value ? [value] : []),
  ];
  await saveZooDb(db);
  return { ok: true };
}

/** Modifica in linea di un campo dell'offerta (autosalvataggio, nessun redirect). */
export async function updateOfferFieldInline(
  offerId: string, field: "descrizione" | "prezzoPromo" | "prezzoListino" | "focus" | "label" | "paginaId", value: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false };
  const db = await getZooDb();
  const o = db.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false };
  const v = value.trim();
  if (field === "descrizione") o.descrizione = v || o.descrizione;
  else if (field === "prezzoPromo") o.prezzoPromo = v; // sempre valorizzato: vuoto = nessun prezzo
  else if (field === "paginaId") {
    o.paginaId = v || undefined;
    // assegnare una pagina significa sceglierla per il volantino; "no volantino" la scarta
    o.selezionata = Boolean(v) && v !== NO_VOLANTINO;
  } else o[field] = v || undefined;
  await saveZooDb(db);
  return { ok: true };
}

/**
 * Animale/caratteristica del padre riscritti da un'insegna/PV: il Consorzio
 * cambia i tag veri (che guidano anche il volantino), gli altri ambiti salvano
 * una personalizzazione che vale solo per i loro cartelli.
 */
export async function setParentTagScoped(
  parentId: string, kind: "animale" | "prodotto", scopeParam: string, value: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent) return { ok: false };
  const dominio = kind === "animale" ? db.settings.categorieAnimali : db.settings.caratteristicheProdotto;
  const v = value.trim();
  if (v && !dominio.includes(v)) return { ok: false };
  if (scope.type === "system") {
    if (!isZooEditor(user)) return { ok: false };
    parent.caratteristiche = [...parent.caratteristiche.filter((c) => !dominio.includes(c)), ...(v ? [v] : [])];
  } else {
    db.tagOverrides = db.tagOverrides.filter(
      (o) => !(o.scopeType === scope.type && o.scopeId === scope.id && o.parentId === parentId && o.kind === kind)
    );
    db.tagOverrides.push({ scopeType: scope.type, scopeId: scope.id, parentId, kind, value: v });
  }
  await saveZooDb(db);
  return { ok: true };
}

/**
 * Descrizione/condizioni dell'offerta riscritte da un'insegna/PV (il Consorzio
 * modifica invece l'offerta vera, comune a tutti).
 */
export async function setOfferTextScoped(
  offerId: string, field: "descrizione" | "condizioni", scopeParam: string, value: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const offer = db.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false };
  const v = value.trim();
  if (scope.type === "system") {
    if (!isZooEditor(user)) return { ok: false };
    if (field === "descrizione") offer.descrizione = v || offer.descrizione;
    else offer.condizioni = v || undefined;
  } else {
    db.offerOverrides = db.offerOverrides.filter(
      (o) => !(o.scopeType === scope.type && o.scopeId === scope.id && o.offerId === offerId && o.field === field)
    );
    // riportarlo uguale al Consorzio significa togliere la personalizzazione
    if (v !== (offer[field] ?? "")) {
      db.offerOverrides.push({ scopeType: scope.type, scopeId: scope.id, offerId, field, value: v });
    }
  }
  await saveZooDb(db);
  return { ok: true };
}

/** Segna come stampati i cartelli di queste offerte per l'ambito corrente. */
export async function markZooPrinted(scopeParam: string, offerIds: string[]): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const at = new Date().toISOString();
  for (const offerId of offerIds) {
    if (!db.offers.some((o) => o.id === offerId)) continue;
    const esistente = db.printed.find(
      (p) => p.scopeType === scope.type && p.scopeId === scope.id && p.offerId === offerId
    );
    if (esistente) esistente.at = at;
    else db.printed.push({ scopeType: scope.type, scopeId: scope.id, offerId, at });
  }
  await saveZooDb(db);
  return { ok: true };
}

/** Azzera il "già stampato": senza id azzera tutta la campagna indicata. */
export async function resetZooPrinted(back: string, scopeParam: string, campaignId: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const ids = (formData.getAll("sel") as string[]).filter(Boolean);
  const dellaCampagna = new Set(db.offers.filter((o) => o.campaignId === campaignId).map((o) => o.id));
  const daAzzerare = ids.length > 0 ? new Set(ids.filter((id) => dellaCampagna.has(id))) : dellaCampagna;
  const prima = db.printed.length;
  db.printed = db.printed.filter(
    (p) => !(p.scopeType === scope.type && p.scopeId === scope.id && daAzzerare.has(p.offerId))
  );
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { azzerati: String(prima - db.printed.length), campagna: campaignId }));
}

/**
 * Modifica in linea la descrizione di un articolo del database (non ha un
 * padre: nella tabella di Database prodotti è l'unico campo di testo che ha
 * senso editare direttamente sulla riga).
 */
export async function updateProductFieldInline(
  productId: string, field: "descrizione", value: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false };
  const db = await getZooDb();
  const p = db.products.find((x) => x.id === productId);
  if (!p) return { ok: false };
  const v = value.trim();
  if (field === "descrizione") p.descrizione = v || p.descrizione;
  await saveZooDb(db);
  return { ok: true };
}

/**
 * Come sopra ma su tutte le offerte di un prodotto padre: nella vista
 * raggruppata la riga rappresenta il padre, quindi pagina/etichetta/focus si
 * applicano a tutte le sue varianti insieme.
 */
export async function updateOfferGroupFieldInline(
  offerIds: string[], field: "focus" | "label" | "paginaId", value: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false };
  const db = await getZooDb();
  const v = value.trim();
  for (const o of db.offers) {
    if (!offerIds.includes(o.id)) continue;
    if (field === "paginaId") {
      o.paginaId = v || undefined;
      o.selezionata = Boolean(v) && v !== NO_VOLANTINO;
    } else o[field] = v || undefined;
  }
  await saveZooDb(db);
  return { ok: true };
}

/** Sposta un articolo sotto un altro prodotto padre (o lo lascia senza padre). */
export async function moveProductToParent(
  back: string, scopeParam: string, productId: string, newParentId: string
): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false };
  const db = await getZooDb();
  const p = db.products.find((x) => x.id === productId);
  if (!p) return { ok: false };
  if (newParentId && !db.parents.some((x) => x.id === newParentId)) return { ok: false };
  if (newParentId) p.parentId = newParentId;
  else delete p.parentId;
  await saveZooDb(db);
  return { ok: true };
}

/**
 * Unisce più prodotti padre in uno: gli articoli dei padri "sorgente" passano
 * sotto il padre di destinazione, che conserva i propri testi (le
 * caratteristiche si sommano, la foto resta quella della destinazione se c'è).
 * I padri svuotati e le loro personalizzazioni per ambito vengono eliminati.
 */
export async function mergeZooParents(targetId: string, sourceIds: string[]): Promise<{ ok: boolean; spostati: number }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false, spostati: 0 };
  const db = await getZooDb();
  const target = db.parents.find((p) => p.id === targetId);
  const sources = db.parents.filter((p) => sourceIds.includes(p.id) && p.id !== targetId);
  if (!target || sources.length === 0) return { ok: false, spostati: 0 };
  let spostati = 0;
  for (const p of db.products) {
    if (p.parentId && sources.some((s) => s.id === p.parentId)) {
      p.parentId = target.id;
      spostati++;
    }
  }
  target.caratteristiche = [...new Set([...target.caratteristiche, ...sources.flatMap((s) => s.caratteristiche)])];
  if (!target.image) target.image = sources.find((s) => s.image)?.image;
  const rimossi = new Set(sources.map((s) => s.id));
  db.parents = db.parents.filter((p) => !rimossi.has(p.id));
  db.textOverrides = db.textOverrides.filter((o) => !rimossi.has(o.parentId));
  await saveZooDb(db);
  return { ok: true, spostati };
}

/**
 * Variante per il form di Import offerte: unisce i padri spuntati (checkbox
 * "selpadre") nel PRIMO spuntato, che dà i testi al gruppo risultante.
 */
export async function mergeParentsForm(back: string, scopeParam: string, formData: FormData) {
  const ids = (formData.getAll("selpadre") as string[]).filter(Boolean);
  if (ids.length < 2) redirect(backUrl(back, scopeParam, { unificati: "0" }));
  const res = await mergeZooParents(ids[0], ids.slice(1));
  redirect(backUrl(back, scopeParam, { unificati: res.ok ? String(ids.length) : "0", padre: ids[0] }));
}

/** Assegna al padre una delle foto già caricate nel bucket. */
export async function setParentImageFromFile(parentId: string, fileName: string): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  if (!isZooEditor(user)) return { ok: false };
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent || !fileName) return { ok: false };
  parent.image = publicUrlFor(`zoo-foto/${fileName}`);
  await saveZooDb(db);
  return { ok: true };
}

export async function setParentImage(back: string, parentId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl(back, scopeParam, { padre: parentId }));
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent) redirect(backUrl(back, scopeParam));
  const fromChild = String(formData.get("fromChild") ?? "");
  const file = formData.get("file") as File | null;
  if (fromChild) {
    const child = db.products.find((p) => p.id === fromChild);
    if (child?.image) parent!.image = child.image;
  } else if (file && file.size > 0 && file.type.startsWith("image/")) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const name = `padre_${parentId}_${Date.now()}.${ext}`;
    parent!.image = await uploadPublicFile(`zoo-foto/${name}`, Buffer.from(await file.arrayBuffer()), file.type);
  }
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { padre: parentId }));
}

export async function toggleParentCaratteristica(back: string, parentId: string, caratteristica: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl(back, scopeParam, { padre: parentId }));
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  if (parent) {
    parent.caratteristiche = parent.caratteristiche.includes(caratteristica)
      ? parent.caratteristiche.filter((c) => c !== caratteristica)
      : [...parent.caratteristiche, caratteristica];
    await saveZooDb(db);
  }
  redirect(backUrl(back, scopeParam, { padre: parentId }));
}

export async function scioglieParent(back: string, parentId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl(back, scopeParam));
  const db = await getZooDb();
  db.parents = db.parents.filter((p) => p.id !== parentId);
  for (const p of db.products) if (p.parentId === parentId) delete p.parentId;
  db.textOverrides = db.textOverrides.filter((o) => o.parentId !== parentId);
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam));
}

/** Nasconde/mostra fornitore, marchio o singolo articolo per l'ambito corrente. */
export async function toggleZooHidden(scopeParam: string, kind: "fornitore" | "marca" | "articolo", value: string, back: string) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system") redirect(backUrl(back, scopeParam));
  const existing = db.hidden.find(
    (h) => h.scopeType === scope.type && h.scopeId === scope.id && h.kind === kind && h.value === value
  );
  if (existing) db.hidden = db.hidden.filter((h) => h !== existing);
  else db.hidden.push({ scopeType: scope.type, scopeId: scope.id, kind, value });
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam));
}

/** Nasconde in blocco gli articoli selezionati (checkbox "sel") per l'ambito corrente. */
export async function toggleZooHiddenBulk(back: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system") redirect(backUrl(back, scopeParam));
  const ids = (formData.getAll("sel") as string[]).filter(Boolean);
  const eans = new Set(db.products.filter((p) => ids.includes(p.id)).map((p) => p.ean));
  for (const ean of eans) {
    const existing = db.hidden.find(
      (h) => h.scopeType === scope.type && h.scopeId === scope.id && h.kind === "articolo" && h.value === ean
    );
    if (!existing) db.hidden.push({ scopeType: scope.type, scopeId: scope.id, kind: "articolo", value: ean });
  }
  await saveZooDb(db);
  redirect(backUrl(back, scopeParam, { nontenuti: String(eans.size) }));
}

/* ================== 2. Import offerte mensili ================== */

export async function importZooOffers(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect("/stampe/zoo/offerte");
  const file = formData.get("file") as File | null;
  const nome = String(formData.get("nome") ?? "").trim() || `Offerte ${new Date().toLocaleDateString("it-IT")}`;
  const dal = String(formData.get("dal") ?? "");
  const al = String(formData.get("al") ?? "");
  if (!file || file.size === 0) redirect(backUrl("/stampe/zoo/offerte", scopeParam, { importate: "0" }));
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file!.arrayBuffer()), { type: "buffer" });
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  // formato a colonne fisse (intestazione unica in cima): se non produce righe con EAN,
  // si ricade sul formato "listino multi-fornitore" (intestazione ripetuta per blocco)
  const standardRows: ListinoRow[] = rawRows
    .map((row) => ({
      ean: cell(row, "EAN", "CODICE EAN", "BARCODE"),
      descrizione: cell(row, "DESCRIZIONE PROMO", "DESCRIZIONE", "ARTICOLO"),
      codice: cell(row, "CODICE FORNITORE", "COD. FORNITORE", "CODICE"),
      fornitore: cell(row, "FORNITORE", "DITTA"),
      prezzoListino: priceOrEmpty(cell(row, "PREZZO LISTINO", "LISTINO")),
      prezzoPromo: priceOrEmpty(cell(row, "PREZZO PROMO", "PREZZO OFFERTA", "PREZZO")),
      condizioni: cell(row, "CONDIZIONI", "VALIDITA'", "NOTE"),
      marca: cell(row, "MARCA", "MARCHIO", "BRAND"),
      categoria: cell(row, "CATEGORIA", "REPARTO"),
    }))
    .filter((r) => r.ean);
  const rows = standardRows.length > 0 ? standardRows : parseListinoBlocchi(XLSX, wb);
  const db = await getZooDb();

  /*
   * L'import alimenta il volantino IN LAVORAZIONE, non ne apre uno nuovo: aprire
   * il volantino successivo è una decisione esplicita ("Nuovo volantino"), perché
   * archivia quello precedente. Così si possono caricare più Excel sullo stesso
   * volantino (es. un fornitore alla volta) senza spezzarlo in campagne diverse.
   */
  let campaign = campagnaInLavorazione(db);
  if (!campaign) {
    for (const c of db.campaigns) c.attiva = false;
    campaign = {
      id: `zc_${Date.now()}`, nome, dal, al, attiva: true, stato: "lavorazione",
      schede: db.settings.schedeDefault.map((s, i) => ({ id: `s${i}`, nome: s })),
    };
    db.campaigns.push(campaign);
  } else {
    if (String(formData.get("nome") ?? "").trim()) campaign.nome = nome;
    if (dal) campaign.dal = dal;
    if (al) campaign.al = al;
    // "sostituisci": riparte da zero sulle offerte di questo volantino
    if (String(formData.get("sostituisci") ?? "") === "1") {
      const vecchie = new Set(db.offers.filter((o) => o.campaignId === campaign!.id).map((o) => o.id));
      db.offers = db.offers.filter((o) => !vecchie.has(o.id));
      db.votes = db.votes.filter((v) => !vecchie.has(v.offerId));
    }
  }
  const campaignId = campaign.id;
  const escludiMarginiamo = String(formData.get("escludimarginiamo") ?? "") === "1";

  let nOffers = 0;
  let nNew = 0;
  let nSenzaPrezzo = 0;
  let nMarginiamo = 0;
  for (const row of rows) {
    const { ean, descrizione } = row;
    if (!ean) continue;
    let product = db.products.find((p) => p.ean === ean);
    let nuovo = false;
    if (!product) {
      // il prodotto non è nel DB base: viene creato e vi resterà anche per il futuro
      nuovo = true;
      nNew++;
      product = {
        id: `z_${ean}`, ean,
        codice: row.codice,
        descrizione: descrizione,
        marca: row.marca ?? "",
        fornitore: row.fornitore,
        categoria: row.categoria,
      };
      db.products.push(product);
    }
    // "marginiamo": il fornitore non ha dato una promo, decide il PV — non è un'offerta vera
    if (escludiMarginiamo && row.condizioni.trim().toLowerCase() === "marginiamo") {
      nMarginiamo++;
      continue;
    }
    if (!row.prezzoPromo) nSenzaPrezzo++;
    db.offers.push({
      id: `zo_${Date.now()}_${nOffers}`,
      campaignId, ean, productId: product.id,
      descrizione: descrizione || product.descrizione,
      prezzoPromo: row.prezzoPromo,
      prezzoListino: row.prezzoListino,
      condizioni: row.condizioni,
      nuovo,
    });
    nOffers++;
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, {
    ...(nMarginiamo ? { esclusemarginiamo: String(nMarginiamo) } : {}),
    importate: String(nOffers), nuovi: String(nNew), ...(nSenzaPrezzo ? { senzaprezzo: String(nSenzaPrezzo) } : {}),
  }));
}

export async function updateCampaignDates(campaignId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (c) {
    c.nome = String(formData.get("nome") ?? c.nome);
    c.dal = String(formData.get("dal") ?? c.dal);
    c.al = String(formData.get("al") ?? c.al);
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/offerte", scopeParam));
}

/**
 * Elimina tutte le offerte di questo volantino (e i relativi voti) per ripartire
 * con un nuovo caricamento Excel da zero: la campagna resta, i prodotti e i
 * padri del database base non vengono toccati.
 */
export async function svuotaOfferteVolantino(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  const rimosse = new Set(db.offers.filter((o) => o.campaignId === campaignId).map((o) => o.id));
  db.offers = db.offers.filter((o) => o.campaignId !== campaignId);
  db.votes = db.votes.filter((v) => !rimosse.has(v.offerId));
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, { svuotato: String(rimosse.size) }));
}

/**
 * Rimuove dalle offerte di questo volantino quelle segnate "marginiamo" (il
 * fornitore non ha dato una promo, decide il PV): non sono offerte vere e non
 * dovrebbero comparire nei cartelli. Il prodotto resta nel database.
 */
export async function rimuoviOfferteMarginiamo(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  const rimosse = new Set(
    db.offers
      .filter((o) => o.campaignId === campaignId && (o.condizioni ?? "").trim().toLowerCase() === "marginiamo")
      .map((o) => o.id)
  );
  db.offers = db.offers.filter((o) => !rimosse.has(o.id));
  db.votes = db.votes.filter((v) => !rimosse.has(v.offerId));
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, { rimossemarginiamo: String(rimosse.size) }));
}

/* ---------- Ciclo di vita del volantino ---------- */

/**
 * "Chiudi volantino": il lavoro di composizione è finito. Le offerte restano in
 * corso a scaffale e i cartelli si stampano ancora; le pagine di lavoro però non
 * lo modificano più. Non archivia nulla: quello avviene aprendo il volantino dopo.
 */
export async function chiudiVolantino(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (c) {
    c.stato = "chiusa";
    c.chiusaIl = new Date().toISOString();
    c.attiva = false;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, { chiuso: "1" }));
}

/** Riapre un volantino chiuso per correggerlo (solo se non ce n'è già uno in lavorazione). */
export async function riapriVolantino(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  if (campagnaInLavorazione(db)) redirect(backUrl("/stampe/zoo/offerte", scopeParam, { errore: "giaaperto" }));
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (c) {
    c.stato = "lavorazione";
    c.attiva = true;
    delete c.chiusaIl;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, { riaperto: "1" }));
}

/**
 * "Nuovo volantino": archivia quello chiuso (le sue offerte escono dalle pagine di
 * lavoro ma restano recuperabili) e apre un volantino vuoto su cui ricominciare.
 * Lo schema delle pagine può essere ereditato come punto di partenza.
 */
export async function nuovoVolantino(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  if (campagnaInLavorazione(db)) redirect(backUrl("/stampe/zoo/offerte", scopeParam, { errore: "giaaperto" }));

  const precedente = campagnaInCorso(db);
  if (precedente) {
    precedente.stato = "archiviata";
    precedente.archiviataIl = new Date().toISOString();
    precedente.attiva = false;
  }

  const nome = String(formData.get("nome") ?? "").trim() || `Volantino ${new Date().toLocaleDateString("it-IT")}`;
  const id = `zc_${Date.now()}`;
  db.campaigns.push({
    id, nome,
    dal: String(formData.get("dal") ?? ""),
    al: String(formData.get("al") ?? ""),
    attiva: true, stato: "lavorazione",
    schede: db.settings.schedeDefault.map((s, i) => ({ id: `s${i}`, nome: s })),
  });

  // eredita l'impaginazione del volantino precedente come modello di partenza
  if (String(formData.get("ereditaSchema") ?? "") === "1" && precedente) {
    const vecchio = db.volantinoLayouts.find((l) => l.campaignId === precedente.id);
    if (vecchio) {
      // solo la griglia e le parti grafiche: le offerte del volantino vecchio no
      const pulite = JSON.parse(JSON.stringify(vecchio.pages)) as typeof vecchio.pages;
      for (const p of pulite) {
        p.blocks = (p.blocks ?? []).map((b) => {
          const { offerIds: _o, descrizione: _d, prezzo: _p, ...resto } = b;
          return resto;
        });
      }
      db.volantinoLayouts.push({ campaignId: id, pages: pulite });
    }
  }

  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, { nuovo: "1" }));
}

/** Archivia a mano un volantino chiuso, senza aprirne uno nuovo. */
export async function archiviaVolantino(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/archivio", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (c) {
    c.stato = "archiviata";
    c.archiviataIl = new Date().toISOString();
    c.attiva = false;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/archivio", scopeParam));
}

/** Riporta un volantino archiviato fra quelli chiusi (torna visibile in Stampa cartelli). */
export async function recuperaVolantino(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/archivio", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (c && !c.svuotataIl) {
    c.stato = "chiusa";
    delete c.archiviataIl;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/archivio", scopeParam, { recuperato: "1" }));
}

/**
 * Elimina definitivamente i dati di un volantino archiviato: offerte, voti e
 * segnalazioni. Resta lo SCHEMA delle pagine di Crea Volantino, riutilizzabile
 * come modello. Prodotti e padri non si toccano: sono il database condiviso.
 * Le foto che nessun altro volantino usa diventano "non usate" e si ripuliscono
 * dalla pagina Archivio file.
 */
export async function eliminaDatiVolantino(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/archivio", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (!c || campaignStato(c) !== "archiviata") redirect(backUrl("/stampe/zoo/archivio", scopeParam));

  const ids = new Set(db.offers.filter((o) => o.campaignId === campaignId).map((o) => o.id));
  db.offers = db.offers.filter((o) => o.campaignId !== campaignId);
  db.votes = db.votes.filter((v) => !ids.has(v.offerId));
  db.suggestions = db.suggestions.filter((s) => !s.offerId || !ids.has(s.offerId));

  // lo schema resta, ma senza i riferimenti alle offerte cancellate
  const layout = db.volantinoLayouts.find((l) => l.campaignId === campaignId);
  if (layout) {
    for (const p of layout.pages) {
      p.blocks = (p.blocks ?? []).map((b) => {
        const { offerIds: _o, descrizione: _d, prezzo: _p, ...resto } = b;
        return resto;
      });
    }
  }
  c!.svuotataIl = new Date().toISOString();
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/archivio", scopeParam, { svuotato: "1" }));
}

/** Elimina del tutto un volantino archiviato, schema delle pagine compreso. */
export async function eliminaVolantino(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/archivio", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (!c || campaignStato(c) !== "archiviata") redirect(backUrl("/stampe/zoo/archivio", scopeParam));
  const ids = new Set(db.offers.filter((o) => o.campaignId === campaignId).map((o) => o.id));
  db.offers = db.offers.filter((o) => o.campaignId !== campaignId);
  db.votes = db.votes.filter((v) => !ids.has(v.offerId));
  db.suggestions = db.suggestions.filter((s) => !s.offerId || !ids.has(s.offerId));
  db.volantinoLayouts = db.volantinoLayouts.filter((l) => l.campaignId !== campaignId);
  db.campaigns = db.campaigns.filter((x) => x.id !== campaignId);
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/archivio", scopeParam, { eliminato: "1" }));
}

/**
 * Raggruppa con l'AI gli articoli senza padre DEL VOLANTINO IN LAVORAZIONE: si
 * lavora solo su ciò che serve a questo volantino, non su tutto il database.
 */
export async function associaNuoviConAI(scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  const campaign = campagnaInLavorazione(db);
  const inVolantino = new Set(
    db.offers.filter((o) => o.campaignId === campaign?.id).map((o) => o.productId)
  );
  const orphans = db.products.filter((p) => !p.parentId && inVolantino.has(p.id));
  if (orphans.length === 0) redirect(backUrl("/stampe/zoo/offerte", scopeParam, { padri: "0" }));
  const { groups, usedAi, error, restanti } = await groupAndDescribeBatched(db.settings.apiKey, orphans, db.settings);
  const created = applyGroups(db, groups, usedAi);
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, {
    padri: String(created), ai: usedAi ? "1" : "0",
    ...(restanti ? { restanti: String(restanti) } : {}),
    ...(error ? { aierr: error.slice(0, 120) } : {}),
  }));
}

/* ================== 3. Volantino: voti PV e scelte del Consorzio ================== */

export async function voteZooOffer(offerId: string, tipo: "preferita" | "nontrattato", scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const nota = String(formData?.get("nota") ?? "");
  const existing = db.votes.find((v) => v.offerId === offerId && v.userId === user.id && v.tipo === tipo);
  if (existing) {
    db.votes = db.votes.filter((v) => v !== existing); // secondo clic = rimuove il voto
  } else {
    db.votes.push({
      offerId, userId: user.id, userName: `${user.firstName} ${user.lastName}`,
      scopeLabel: scope.label.replace(/^[^\s]+\s/, ""), tipo, nota: nota || undefined,
      date: new Date().toISOString(),
    });
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/volantino", scopeParam));
}

/** Voto in blocco sulle offerte spuntate: aggiunge il voto dove manca (non toglie). */
export async function voteZooOffersBulk(tipo: "preferita" | "nontrattato", scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  /*
   * Scelta Offerte presenta un prodotto padre per riga: la spunta porta l'id di
   * una sola offerta del gruppo, quindi qui si estende a tutte le varianti dello
   * stesso padre (nella stessa campagna) — è quello che si aspetta chi spunta
   * la riga "Crocchette Adult", non "solo il gusto pollo".
   */
  const scelte = (formData.getAll("zsel") as string[]).filter(Boolean);
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const ids = new Set<string>();
  for (const offerId of scelte) {
    const o = db.offers.find((x) => x.id === offerId);
    if (!o) continue;
    ids.add(o.id);
    const parentId = prodById.get(o.productId ?? "")?.parentId;
    if (!parentId) continue;
    for (const s of db.offers) {
      if (s.campaignId !== o.campaignId) continue;
      if (prodById.get(s.productId ?? "")?.parentId === parentId) ids.add(s.id);
    }
  }
  for (const offerId of ids) {
    if (db.votes.some((v) => v.offerId === offerId && v.userId === user.id && v.tipo === tipo)) continue;
    db.votes.push({
      offerId, userId: user.id, userName: `${user.firstName} ${user.lastName}`,
      scopeLabel: scope.label.replace(/^[^\s]+\s/, ""), tipo,
      date: new Date().toISOString(),
    });
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/volantino", scopeParam, { votate: String(ids.size) }));
}

export async function toggleOfferSelected(offerId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
  const db = await getZooDb();
  const o = db.offers.find((x) => x.id === offerId);
  if (o) {
    o.selezionata = !o.selezionata;
    if (!o.selezionata) o.schedaId = undefined;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/volantino", scopeParam));
}

/**
 * Come `toggleOfferSelected`, ma su un intero gruppo di offerte (le varianti di
 * uno stesso padre, presentate come una riga sola in Scelta Offerte): se non
 * sono tutte già nel volantino le aggiunge tutte, altrimenti le toglie tutte.
 */
export async function toggleOffersGroupSelected(offerIds: string[], scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
  const db = await getZooDb();
  const offs = db.offers.filter((o) => offerIds.includes(o.id));
  const tutteDentro = offs.length > 0 && offs.every((o) => o.selezionata);
  for (const o of offs) {
    o.selezionata = !tutteDentro;
    if (!o.selezionata) o.schedaId = undefined;
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/volantino", scopeParam));
}

export async function updateOfferVolantino(offerId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
  const db = await getZooDb();
  const o = db.offers.find((x) => x.id === offerId);
  if (o) {
    o.schedaId = String(formData.get("schedaId") ?? "") || undefined;
    o.label = String(formData.get("label") ?? "") || undefined;
    o.gruppo = String(formData.get("gruppo") ?? "") || undefined;
    o.gruppoDescrizione = String(formData.get("gruppoDescrizione") ?? "") || undefined;
    o.tieniVicinoA = String(formData.get("tieniVicinoA") ?? "") || undefined;
    const d = String(formData.get("descrizione") ?? "");
    if (d) o.descrizione = d;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/volantino", scopeParam, { offerta: offerId }));
}

export async function renameScheda(campaignId: string, schedaId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  const s = c?.schede.find((x) => x.id === schedaId);
  const nome = String(formData.get("nome") ?? "").trim();
  if (s && nome) {
    s.nome = nome;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/volantino", scopeParam));
}

export async function addScheda(campaignId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (c) {
    c.schede.push({ id: `s${Date.now()}`, nome: `Scheda ${c.schede.length + 1}` });
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/volantino", scopeParam));
}

/* ================== 4. Stampa cartelli promo (PV) ================== */

/** Import Excel prezzi propri del PV: colonne EAN (o CODICE FORNITORE) e PREZZO. */
export async function importPvPrices(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system") redirect(backUrl("/stampe/zoo/stampa", scopeParam, { prezzi: "0" }));
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(backUrl("/stampe/zoo/stampa", scopeParam, { prezzi: "0" }));
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file!.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  let n = 0;
  for (const row of rows) {
    const prezzo = priceStr(cell(row, "PREZZO", "PREZZO VENDITA", "PREZZO PV"));
    if (!prezzo) continue;
    let ean = cell(row, "EAN", "CODICE EAN", "BARCODE");
    if (!ean) {
      const codice = cell(row, "CODICE FORNITORE", "COD. FORNITORE", "CODICE");
      ean = db.products.find((p) => p.codice === codice)?.ean ?? "";
    }
    if (!ean) continue;
    const existing = db.pvPrices.find((p) => p.scopeType === scope.type && p.scopeId === scope.id && p.ean === ean);
    if (existing) existing.prezzo = prezzo;
    else db.pvPrices.push({ scopeType: scope.type, scopeId: scope.id, ean, prezzo });
    n++;
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/stampa", scopeParam, { prezzi: String(n) }));
}

/**
 * Prezzo di vendita del singolo articolo per questo ambito (stessa cosa che fa
 * l'import Excel dei prezzi, ma su una riga sola): vuoto = torna al prezzo promo
 * del Consorzio.
 */
export async function setPvPriceInline(ean: string, scopeParam: string, value: string): Promise<{ ok: boolean }> {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system") return { ok: false };
  const prezzo = priceStr(value);
  db.pvPrices = db.pvPrices.filter((p) => !(p.scopeType === scope.type && p.scopeId === scope.id && p.ean === ean));
  if (prezzo) db.pvPrices.push({ scopeType: scope.type, scopeId: scope.id, ean, prezzo });
  await saveZooDb(db);
  return { ok: true };
}

/** Proposta di correzione al Consorzio (testi condivisi, dati offerta...). */
export async function sendZooSuggestion(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const message = String(formData.get("message") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "") || undefined;
  const offerId = String(formData.get("offerId") ?? "") || undefined;
  const back = String(formData.get("back") ?? "/stampe/zoo/stampa");
  if (message) {
    db.suggestions.push({
      id: `zs_${Date.now()}`, parentId, offerId, message,
      userId: user.id, userName: `${user.firstName} ${user.lastName}`,
      scopeLabel: scope.label, date: new Date().toISOString(), status: "aperta",
    });
    await saveZooDb(db);
  }
  redirect(backUrl(back, scopeParam));
}

export async function resolveZooSuggestion(id: string) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect("/stampe/zoo/volantino");
  const db = await getZooDb();
  const s = db.suggestions.find((x) => x.id === id);
  if (s) {
    s.status = "risolta";
    await saveZooDb(db);
  }
  redirect("/stampe/zoo/volantino?scope=system%3A");
}

/* ================== 5. Impostazioni Zoo ================== */

export async function saveZooSettings(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/impostazioni", scopeParam));
  const db = await getZooDb();
  const list = (name: string) =>
    String(formData.get(name) ?? "").split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  db.settings.categorieAnimali = list("categorieAnimali");
  db.settings.caratteristicheProdotto = list("caratteristicheProdotto");
  db.settings.caratteristiche = [...db.settings.categorieAnimali, ...db.settings.caratteristicheProdotto];
  db.settings.labels = list("labels");
  db.settings.schedeDefault = list("schedeDefault");
  db.settings.condizioniStandard = String(formData.get("condizioniStandard") ?? "")
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  db.settings.istruzioniVolantino = String(formData.get("istruzioniVolantino") ?? db.settings.istruzioniVolantino);
  db.settings.istruzioniCartello = String(formData.get("istruzioniCartello") ?? db.settings.istruzioniCartello);
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/impostazioni", scopeParam, { salvate: "1" }));
}

/** La chiave API Claude può essere impostata SOLO dall'amministratore di sistema. */
export async function saveZooApiKey(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (user.role !== "system_admin") redirect(backUrl("/stampe/zoo/impostazioni", scopeParam));
  const db = await getZooDb();
  const key = String(formData.get("apiKey") ?? "").trim();
  db.settings.apiKey = key || undefined;
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/impostazioni", scopeParam, { chiave: key ? "1" : "0" }));
}

export async function saveFormatoRegola(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/impostazioni", scopeParam));
  const db = await getZooDb();
  const caratteristica = String(formData.get("caratteristica") ?? "");
  const formatId = String(formData.get("formatId") ?? "");
  if (caratteristica) {
    db.settings.formatoRegole = db.settings.formatoRegole.filter((r) => r.caratteristica !== caratteristica);
    if (formatId) db.settings.formatoRegole.push({ caratteristica, formatId });
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/impostazioni", scopeParam));
}

/* ================== Crea Volantino (builder) ================== */

/** Può costruire il volantino: sistema/Gestore Zoo, oppure utenti da loro scelti. */
export async function canBuildVolantinoCheck(): Promise<boolean> {
  const user = await requireZooUser();
  const db = await getZooDb();
  return isZooEditor(user) || (db.settings.volantinoEditors ?? []).includes(user.id);
}

export async function saveVolantinoLayout(campaignId: string, pagesJson: string) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const allowed = isZooEditor(user) || (db.settings.volantinoEditors ?? []).includes(user.id);
  if (!allowed) return { ok: false as const };
  let pages;
  try { pages = JSON.parse(pagesJson); } catch { return { ok: false as const }; }
  const existing = db.volantinoLayouts.find((l) => l.campaignId === campaignId);
  if (existing) existing.pages = pages;
  else db.volantinoLayouts.push({ campaignId, pages });
  await saveZooDb(db);
  return { ok: true as const };
}

/** Il Gestore Zoo (o sistema) sceglie chi altro può usare Crea Volantino. */
export async function saveVolantinoEditors(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isZooEditor(user)) redirect(backUrl("/stampe/zoo/crea-volantino", scopeParam));
  const db = await getZooDb();
  db.settings.volantinoEditors = (formData.getAll("editor") as string[]).filter(Boolean);
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/crea-volantino", scopeParam, { salvato: "1" }));
}

/** Modifica rapida di un'offerta dal builder del volantino ("salva anche nel database"). */
export async function updateZooOfferQuick(offerId: string, descrizione: string, prezzo: string) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const allowed = isZooEditor(user) || (db.settings.volantinoEditors ?? []).includes(user.id);
  if (!allowed) return { ok: false as const };
  const o = db.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false as const };
  if (descrizione.trim()) o.descrizione = descrizione.trim();
  if (prezzo.trim()) o.prezzoPromo = prezzo.trim();
  await saveZooDb(db);
  return { ok: true as const };
}

/** Salva il layout cartello zoo per formato+ambito (stessa firma di saveLayout dell'Arredo). */
export async function saveZooLayout(
  formatId: string, scopeParam: string, _tipologieCsv: string, itemsJson: string, borderJson: string
) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system" && !isZooEditor(user)) return;
  let items: unknown;
  try { items = JSON.parse(itemsJson); } catch { return; }
  if (!Array.isArray(items)) return;
  const { ZOO_FIELDS } = await import("./zoo");
  const clean = (items as Record<string, unknown>[])
    .filter((i) => typeof i.fieldId === "string" && (i.fieldId === "__img" ? typeof i.imageUrl === "string" : ZOO_FIELDS.some((f) => f.id === i.fieldId)))
    .map((i) => ({
      fieldId: i.fieldId as string,
      x: Math.max(0, Math.min(95, Number(i.x) || 0)),
      y: Math.max(0, Math.min(95, Number(i.y) || 0)),
      w: Math.max(3, Math.min(100, Number(i.w) || 10)),
      h: Math.max(2, Math.min(100, Number(i.h) || 5)),
      ...(typeof i.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(i.color) ? { color: i.color as string } : {}),
      ...(typeof i.imageUrl === "string" ? { imageUrl: i.imageUrl as string } : {}),
      ...(Number.isFinite(Number(i.size)) ? { size: Math.max(4, Math.min(120, Number(i.size))) } : {}),
      ...(typeof i.bold === "boolean" ? { bold: i.bold as boolean } : {}),
      ...(typeof i.italic === "boolean" ? { italic: i.italic as boolean } : {}),
      ...(["left", "center", "right"].includes(i.align as string) ? { align: i.align as "left" | "center" | "right" } : {}),
      ...(typeof i.font === "string" && LAYOUT_FONTS.some((f) => f.id === i.font) ? { font: i.font as string } : {}),
      ...(i.sticker && typeof i.sticker === "object" ? { sticker: i.sticker as import("./stampe").StickerStyle } : {}),
    }));
  let borderRaw: unknown;
  try { borderRaw = JSON.parse(borderJson); } catch { borderRaw = null; }
  const b = (borderRaw && typeof borderRaw === "object" ? borderRaw : {}) as Record<string, unknown>;
  const border = {
    on: b.on === true,
    width: Math.max(0.25, Math.min(6, Number(b.width) || 1)),
    color: typeof b.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(b.color) ? b.color : "#111111",
    style: b.style === "dashed" ? ("dashed" as const) : ("solid" as const),
  };
  const existing = db.zooLayouts.find((l) => l.formatId === formatId && l.scopeType === scope.type && l.scopeId === scope.id);
  if (existing) { existing.items = clean; existing.border = border; }
  else db.zooLayouts.push({ id: `zl_${Date.now()}`, formatId, scopeType: scope.type, scopeId: scope.id, items: clean, border });
  await saveZooDb(db);
}

/** Immagine caricata in una cella del volantino (sfondo o elemento grafico). */
export async function uploadVolantinoImage(formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  if (!(isZooEditor(user) || (db.settings.volantinoEditors ?? []).includes(user.id))) return { ok: false as const };
  const file = formData.get("image") as File | null;
  if (!file || file.size === 0 || !file.type.startsWith("image/")) return { ok: false as const };
  const clean = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  const url = await uploadPublicFile(`volantino/${Date.now()}_${clean}`, Buffer.from(await file.arrayBuffer()), file.type);
  return { ok: true as const, url };
}
