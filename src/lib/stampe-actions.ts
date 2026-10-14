"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { getDb } from "./db";
import { uploadPublicFile, publicUrlFor } from "./supabase";
import { registra } from "./registro";
import type { SchedaExtra, StampeDB, Totem } from "./stampe";
import { randomBytes } from "crypto";
import {
  getStampeDb,
  saveStampeDb,
  canAccessArea,
  gestisceArea,
  isConsortiumEditor,
  resolveScope,
  isStoreBlocked,
  effectiveValue,
  ScopeType,
  sanitizeMargins,
  puoModificareLayout } from "./stampe";
import { gruppoDi } from "./cartello-campi";
import { postLoginPath } from "./types";
import { sanitizeLayoutItems } from "./layout-pulizia";

/* Stesso principio dello Zoo: qui si lavora sui Cartelli Arredo e serve quell'area. */
async function requireStampeUser() {
  const user = await requireUser();
  if (!canAccessArea(user, "arredo")) redirect(postLoginPath(user));
  return user;
}

/**
 * Può personalizzare questo ambito? Il Consorzio (scope «system») solo chi cura
 * l'Arredo per il Consorzio: prima chiunque stesse al Consorzio con l'area
 * Arredo (anche un grafico) cambiava campi, liste e testi per tutti. Un'insegna
 * o un PV: non bloccato dall'insegna, e non il grafico, che fa layout e stampa.
 */
function puoPersonalizzare(user: Parameters<typeof isConsortiumEditor>[0], scope: { type: string; id: string }, db: StampeDB): boolean {
  if (scope.type === "system") return isConsortiumEditor(user);
  return !isStoreBlocked(db, scope as Parameters<typeof isStoreBlocked>[1]) && user.role !== "grafico";
}

/** Gli indirizzi dei nostri file caricati (Supabase, cartella arredo-media): niente foto da siti esterni sulle pagine pubbliche. */
function mediaNostro(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const base = publicUrlFor("arredo-media/");
  return url.startsWith(base) && !url.slice(base.length).includes("..") && url.length < 600;
}

function backUrl(page: string, scopeParam: string, extra: Record<string, string> = {}) {
  // `page` puo' gia' portarsi dietro dei parametri (es. "...?abbina=1"): si uniscono, non si sovrascrivono
  const [percorso, suoi] = page.split("?");
  const qs = new URLSearchParams(suoi ?? "");
  for (const [k, v] of Object.entries({ scope: scopeParam, ...extra })) qs.set(k, v);
  return `${percorso}?${qs.toString()}`;
}

/**
 * Salvataggio automatico di un campo (chiamato dall'editor con debounce).
 * Ritorna lo stato della versione per aggiornare i badge senza ricaricare.
 */
export async function autosaveField(productId: string, fieldId: string, scopeParam: string, value: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (isStoreBlocked(db, scope)) return { ok: false as const, error: "personalizzazione disabilitata dall'insegna" };
  if (!puoPersonalizzare(user, scope, db)) return { ok: false as const, error: "non autorizzato" };
  const product = db.products.find((p) => p.id === productId);
  if (!product) return { ok: false as const, error: "prodotto non trovato" };
  value = value.trim();
  const primaCampo = scope.type === "system" ? (product.fields[fieldId] ?? "") : (db.overrides.find((o) => o.scopeType === scope.type && o.scopeId === scope.id && o.productId === productId && o.fieldId === fieldId)?.value ?? product.fields[fieldId] ?? "");
  const annota = () => registra(user, { area: "arredo", cosa: db.fields.find((f) => f.id === fieldId)?.label ?? fieldId, oggetto: `${product.fields.titolo ?? ""} (${product.codice})`, prima: primaCampo, dopo: value, ambito: scope.type === "system" ? undefined : scope.label, rif: { tipo: "arredo-campo", id: product.id, campo: fieldId, scope: `${scope.type}:${scope.id}` } });

  if (scope.type === "system") {
    if (!isConsortiumEditor(user)) return { ok: false as const, error: "non autorizzato" };
    product.fields[fieldId] = value;
    annota();
    await saveStampeDb(db);
    return { ok: true as const, custom: false };
  }
  const existing = db.overrides.find(
    (o) => o.scopeType === scope.type && o.scopeId === scope.id && o.productId === productId && o.fieldId === fieldId
  );
  if (value === (product.fields[fieldId] ?? "")) {
    db.overrides = db.overrides.filter((o) => o !== existing);
    annota();
    await saveStampeDb(db);
    return { ok: true as const, custom: false };
  }
  if (existing) existing.value = value;
  else db.overrides.push({ scopeType: scope.type, scopeId: scope.id, productId, fieldId, value });
  annota();
  await saveStampeDb(db);
  return { ok: true as const, custom: true };
}

/** Salva il valore di un campo: sul Consorzio se responsabile contenuti, altrimenti come personalizzazione. */
export async function savePrintField(productId: string, fieldId: string, scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!puoPersonalizzare(user, scope, db)) redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId }));
  const product = db.products.find((p) => p.id === productId);
  if (!product) redirect("/stampe/arredo/dati");
  const value = String(formData.get("value") ?? "").trim();

  if (scope.type === "system") {
    if (!isConsortiumEditor(user)) redirect("/stampe/arredo/dati");
    product!.fields[fieldId] = value;
  } else {
    const existing = db.overrides.find(
      (o) => o.scopeType === scope.type && o.scopeId === scope.id && o.productId === productId && o.fieldId === fieldId
    );
    if (value === (product!.fields[fieldId] ?? "")) {
      // uguale alla versione comune: rimuovi la personalizzazione
      db.overrides = db.overrides.filter((o) => o !== existing);
    } else if (existing) {
      existing.value = value;
    } else {
      db.overrides.push({ scopeType: scope.type, scopeId: scope.id, productId, fieldId, value });
    }
  }
  registra(user, { area: "arredo", cosa: db.fields.find((f) => f.id === fieldId)?.label ?? fieldId, oggetto: `${product!.fields.titolo ?? ""} (${product!.codice})`, dopo: value, ambito: scope.type === "system" ? undefined : scope.label });
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId, salvato: "1" }));
}

export async function resetPrintField(productId: string, fieldId: string, scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!puoPersonalizzare(user, scope, db)) redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId }));
  if (scope.type !== "system") {
    db.overrides = db.overrides.filter(
      (o) => !(o.scopeType === scope.type && o.scopeId === scope.id && o.productId === productId && o.fieldId === fieldId)
    );
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId }));
}

export async function toggleFieldHidden(fieldId: string, scopeParam: string, productId: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!puoPersonalizzare(user, scope, db)) redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId }));
  const existing = db.fieldPrefs.find(
    (p) => p.scopeType === scope.type && p.scopeId === scope.id && p.fieldId === fieldId
  );
  if (existing) {
    existing.hidden = !existing.hidden;
    // scelta tornata quella di default (sul cartello e online): la riga non serve più
    if (!existing.hidden && existing.online !== false) db.fieldPrefs = db.fieldPrefs.filter((p) => p !== existing);
  } else {
    db.fieldPrefs.push({ scopeType: scope.type, scopeId: scope.id, fieldId, hidden: true });
  }
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId }));
}

/* ================== Scheda online: cosa va sul cartello e cosa dal QR ================== */

/** Scrive (o toglie, se è quella di default) la visibilità di un campo nell'ambito. */
function impostaVisibilita(db: Awaited<ReturnType<typeof getStampeDb>>, scope: { type: ScopeType; id: string }, fieldId: string, cartello: boolean, online: boolean) {
  db.fieldPrefs = db.fieldPrefs.filter((p) => !(p.scopeType === scope.type && p.scopeId === scope.id && p.fieldId === fieldId));
  if (cartello && online) return;
  db.fieldPrefs.push({ scopeType: scope.type, scopeId: scope.id, fieldId, hidden: !cartello, ...(online ? {} : { online: false }) });
}

/** Le due spunte di un campo nella pagina Scheda online: "sul cartello" e "online". */
export async function salvaVisibilitaCampo(fieldId: string, scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!gestisceArea(user, "arredo", scope, academyDb) || isStoreBlocked(db, scope)) return { ok: false, error: "Non puoi modificare questo ambito." };
  if (!db.fields.some((f) => f.id === fieldId)) return { ok: false, error: "Campo non trovato." };
  impostaVisibilita(db, scope, fieldId, fd.get("cartello") === "on", fd.get("online") === "on");
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/scheda");
  return { ok: true };
}

/** Stessa scelta per tutti i campi di un gruppo (es. "Misure e imballo" solo online). */
export async function salvaVisibilitaGruppo(gruppo: string, scopeParam: string, modo: "entrambi" | "cartello" | "online"): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!gestisceArea(user, "arredo", scope, academyDb) || isStoreBlocked(db, scope)) return { ok: false, error: "Non puoi modificare questo ambito." };
  for (const f of db.fields) {
    if (gruppoDi(f) !== gruppo) continue;
    impostaVisibilita(db, scope, f.id, modo !== "online", modo !== "cartello");
  }
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/scheda");
  return { ok: true };
}

/** Accesa/spenta, cosa mostra e frase di benvenuto della scheda online dell'ambito. */
export async function salvaSchedaOnline(scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!gestisceArea(user, "arredo", scope, academyDb) || isStoreBlocked(db, scope)) return { ok: false, error: "Non puoi modificare questo ambito." };
  const attiva = fd.get("attiva") === "on";
  const modo = fd.get("modo") === "extra" ? "extra" as const : "tutto" as const;
  const benvenuto = String(fd.get("benvenuto") ?? "").trim().slice(0, 200);
  db.schedaOnline = db.schedaOnline.filter((p) => !(p.scopeType === scope.type && p.scopeId === scope.id));
  db.schedaOnline.push({ scopeType: scope.type, scopeId: scope.id, attiva, modo, ...(benvenuto ? { benvenuto } : {}) });
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/scheda");
  return { ok: true };
}

/** Il gruppo di un campo (solo Consorzio): vale per tutti gli ambiti. */
export async function salvaGruppoCampo(fieldId: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) return { ok: false, error: "Solo il Consorzio classifica i campi." };
  const db = await getStampeDb();
  const f = db.fields.find((x) => x.id === fieldId);
  if (!f) return { ok: false, error: "Campo non trovato." };
  const nuovo = String(fd.get("gruppoNuovo") ?? "").trim() || String(fd.get("gruppo") ?? "").trim();
  f.gruppo = nuovo.slice(0, 40) || undefined;
  await saveStampeDb(db);
  revalidatePath("/stampe/impostazioni");
  revalidatePath("/stampe/arredo/scheda");
  return { ok: true };
}

export async function reportFieldError(productId: string, fieldId: string, scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const message = String(formData.get("message") ?? "").trim();
  if (message) {
    db.reports.push({
      id: `rep_${Date.now()}`,
      productId,
      fieldId,
      message: message.slice(0, 300),
      userId: user.id,
      date: new Date().toISOString(),
      status: "aperta",
    });
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId, segnalato: "1" }));
}

export async function resolveReport(reportId: string) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe");
  const db = await getStampeDb();
  const rep = db.reports.find((r) => r.id === reportId);
  if (rep) {
    rep.status = "risolta";
    await saveStampeDb(db);
  }
  revalidatePath("/stampe");
  redirect("/stampe");
}

export async function addPrintProduct(scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe/arredo/dati");
  const db = await getStampeDb();
  const titolo = String(formData.get("titolo") ?? "").trim();
  const codice = String(formData.get("codice") ?? "").trim() || `NEW${Date.now()}`;
  if (!titolo) redirect("/stampe/arredo/dati");
  const id = `p_${codice}`;
  if (!db.products.some((p) => p.id === id)) {
    // copia i dati da un prodotto esistente, se indicato (per codice o titolo)
    const copyFromKey = String(formData.get("copyFrom") ?? "").trim().toLowerCase();
    const source = copyFromKey
      ? db.products.find(
          (p) => p.codice.toLowerCase() === copyFromKey || `${p.fields.titolo} (${p.codice})`.toLowerCase() === copyFromKey
        )
      : undefined;
    const anno = String(formData.get("annoCollezione") ?? "").trim();
    db.products.push({
      id,
      codice,
      ean: String(formData.get("ean") ?? "").trim(),
      tipologia: String(formData.get("tipologia") ?? "").trim() || source?.tipologia || "Varie (Tavolini, Bauli, Ecc)",
      marca: String(formData.get("marca") ?? "").trim() || source?.marca || "Garden Team",
      annoCollezione: /^\d{4}$/.test(anno) ? anno : source?.annoCollezione,
      image: "",
      fields: { ...(source ? source.fields : {}), titolo },
    });
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: id }));
}

/** Crea la variante colore: copia del prodotto collegata al padre, con colore da compilare. */
export async function createColorVariant(productId: string, scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe/arredo/dati");
  const db = await getStampeDb();
  const base = db.products.find((p) => p.id === productId);
  if (!base) redirect("/stampe/arredo/dati");
  const codice = String(formData.get("codice") ?? "").trim() || `${base!.codice}-V${Date.now() % 1000}`;
  const colore = String(formData.get("colore") ?? "").trim();
  const id = `p_${codice}`;
  if (!db.products.some((p) => p.id === id)) {
    db.products.push({
      ...base!,
      id,
      codice,
      ean: String(formData.get("ean") ?? "").trim(),
      variantOf: base!.variantOf ?? base!.id,
      fields: { ...base!.fields, ...(colore ? { colori: colore } : {}) },
    });
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: id }));
}

/** Aggiorna i dati anagrafici del prodotto (codice/ean/tipologia/marca). */
export async function updateProductMeta(productId: string, scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe/arredo/dati");
  const db = await getStampeDb();
  const p = db.products.find((x) => x.id === productId);
  if (!p) redirect("/stampe/arredo/dati");
  p!.ean = String(formData.get("ean") ?? p!.ean).trim();
  const tip = String(formData.get("tipologia") ?? "").trim();
  if (tip) p!.tipologia = tip;
  const marca = String(formData.get("marca") ?? "").trim();
  if (marca) p!.marca = marca;
  const anno = String(formData.get("annoCollezione") ?? "").trim();
  p!.annoCollezione = /^\d{4}$/.test(anno) ? anno : undefined;
  registra(user, { area: "arredo", cosa: "Anagrafica prodotto", oggetto: `${p!.fields.titolo ?? ""} (${p!.codice})`, dopo: `EAN ${p!.ean} · ${p!.tipologia} · ${p!.marca}${p!.annoCollezione ? ` · ${p!.annoCollezione}` : ""}` });
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId, salvato: "1" }));
}

/** Copia il valore di un campo su tutti i prodotti della tipologia o su tutti (solo Consorzio). */
export async function copyFieldBroadcast(productId: string, fieldId: string, scopeParam: string, target: "tipologia" | "tutti") {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe/arredo/dati");
  const db = await getStampeDb();
  const source = db.products.find((p) => p.id === productId);
  if (!source) redirect("/stampe/arredo/dati");
  const value = source!.fields[fieldId] ?? "";
  let n = 0;
  for (const p of db.products) {
    if (p.id === productId) continue;
    if (target === "tipologia" && p.tipologia !== source!.tipologia) continue;
    p.fields[fieldId] = value;
    n++;
  }
  registra(user, { area: "arredo", cosa: `Campo copiato su ${target === "tutti" ? "tutti i prodotti" : "tutta la tipologia"}`, oggetto: `${db.fields.find((f) => f.id === fieldId)?.label ?? fieldId} da ${source!.codice}`, dopo: value });
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId, copiati: String(n) }));
}

/* ================== Impostazioni: SharePoint, formati e campi ================== */

export async function saveStampeSettings(formData: FormData) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe");
  const db = await getStampeDb();
  const img = String(formData.get("sharepointImagesUrl") ?? "").trim();
  const xls = String(formData.get("sharepointExcelUrl") ?? "").trim();
  const okUrl = (u: string) => !u || /^https:\/\//i.test(u);
  if (okUrl(img)) db.settings.sharepointImagesUrl = img || undefined;
  if (okUrl(xls)) db.settings.sharepointExcelUrl = xls || undefined;
  db.settings.note = String(formData.get("note") ?? "").trim() || undefined;
  await saveStampeDb(db);
  redirect("/stampe/impostazioni?salvato=1");
}

export async function saveFormat(formatId: string | null, formData: FormData) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe");
  const db = await getStampeDb();
  const name = String(formData.get("name") ?? "").trim();
  const w = Number(formData.get("w"));
  const h = Number(formData.get("h"));
  if (!name || !(w > 20) || !(h > 20)) redirect("/stampe/impostazioni");

  let format = formatId ? db.formats.find((f) => f.id === formatId) : undefined;
  if (!format) {
    format = { id: `f_${Date.now()}`, name, w, h };
    db.formats.push(format);
  } else {
    format.name = name;
    format.w = w;
    format.h = h;
  }
  const bg = formData.get("background") as File | null;
  if (bg && bg.size > 0) {
    const ext = (bg.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["png", "jpg", "jpeg", "svg", "webp", "pdf"].includes(ext) && ext !== "pdf") {
      const fileName = `sfondo_${format.id}_${Date.now()}.${ext}`;
      format.background = await uploadPublicFile(
        `uploads/sfondi/${fileName}`, Buffer.from(await bg.arrayBuffer()), bg.type || `image/${ext}`
      );
    }
    // i pdf si convertono in produzione: nessun formato caricabile direttamente per ora
  }
  if (formData.get("removeBackground") === "on") format.background = undefined;
  await saveStampeDb(db);
  redirect("/stampe/impostazioni?salvato=1");
}

export async function deleteFormat(formatId: string) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe");
  const db = await getStampeDb();
  db.formats = db.formats.filter((f) => f.id !== formatId);
  db.layouts = db.layouts.filter((l) => l.formatId !== formatId);
  await saveStampeDb(db);
  redirect("/stampe/impostazioni?salvato=1");
}

export async function addField(formData: FormData) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe");
  const db = await getStampeDb();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) redirect("/stampe/impostazioni");
  const id = `f_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}_${Date.now() % 10000}`;
  const gruppo = String(formData.get("gruppo") ?? "").trim().slice(0, 40);
  db.fields.push({ id, label, size: 11, bold: false, custom: true, ...(gruppo ? { gruppo } : {}) });
  await saveStampeDb(db);
  redirect("/stampe/impostazioni?salvato=1");
}

export async function deleteField(fieldId: string) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe");
  const db = await getStampeDb();
  const f = db.fields.find((x) => x.id === fieldId);
  if (f?.custom) {
    db.fields = db.fields.filter((x) => x.id !== fieldId);
    for (const l of db.layouts) l.items = l.items.filter((i) => i.fieldId !== fieldId);
    db.overrides = db.overrides.filter((o) => o.fieldId !== fieldId);
    await saveStampeDb(db);
  }
  redirect("/stampe/impostazioni?salvato=1");
}

/* ================== Import Excel ================== */

const EXCEL_COLUMNS: [string, string][] = [
  ["CODICE FORNITORE", "codice"],
  ["EAN", "ean"],
  ["TIPOLOGIA", "tipologia"],
  ["MARCA", "marca"],
  ["Anno collezione", "annoCollezione"],
  ["Titolo", "titolo"],
  ["Sottotitolo", "sottotitolo"],
  ["Materiali", "materiali"],
  ["Parti incluse", "partiIncluse"],
  ["Colori", "colori"],
  ["Misure imballo", "misure"],
  ["Buono a sapersi", "buono"],
  ["Consigli utili", "consigli"],
  ["Prezzo", "prezzo"],
  ["Prezzo listino", "prezzoListino"],
  ["Trasporto", "trasporto"],
];

export async function importProductsExcel(scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  if (!isConsortiumEditor(user)) redirect("/stampe/arredo/dati");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(backUrl("/stampe/arredo/dati", scopeParam, { importati: "0" }));
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file!.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const db = await getStampeDb();
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const get = (col: string) => String(row[col] ?? "").trim().replace(/\.0$/, "");
    const codice = get("CODICE FORNITORE");
    const titolo = get("Titolo");
    if (!codice || !titolo) continue;
    const id = `p_${codice}`;
    let p = db.products.find((x) => x.id === id);
    if (!p) {
      p = { id, codice, ean: "", tipologia: "Varie (Tavolini, Bauli, Ecc)", marca: "Garden Team", image: "", fields: {} };
      db.products.push(p);
      created++;
    } else {
      updated++;
    }
    for (const [col, fieldId] of EXCEL_COLUMNS) {
      const v = get(col);
      if (!v) continue;
      if (fieldId === "codice") continue;
      if (fieldId === "ean") p.ean = v;
      else if (fieldId === "tipologia") p.tipologia = v;
      else if (fieldId === "marca") p.marca = v;
      else if (fieldId === "annoCollezione") p.annoCollezione = /^\d{4}$/.test(v) ? v : p.annoCollezione;
      else p.fields[fieldId] = v;
    }
  }
  registra(user, { area: "arredo", cosa: "Import prodotti da Excel", oggetto: file!.name, dopo: `${created} nuovi, ${updated} aggiornati` });
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { importati: String(created + updated), nuovi: String(created) }));
}

/**
 * Import Excel per insegna/PV: le celle compilate diventano personalizzazioni
 * (override) del proprio ambito, senza toccare la versione del Consorzio.
 * I prodotti si abbinano per CODICE FORNITORE; righe con codici sconosciuti
 * vengono saltate (i prodotti nuovi li crea solo il Consorzio). Celle identiche
 * al valore già in vigore non generano override inutili.
 */
export async function importOverridesExcel(scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system" || !puoPersonalizzare(user, scope, db)) {
    redirect(backUrl("/stampe/arredo/dati", scopeParam, { importati: "0" }));
  }
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(backUrl("/stampe/arredo/dati", scopeParam, { importati: "0" }));
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file!.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  let touched = 0;
  for (const row of rows) {
    const get = (col: string) => String(row[col] ?? "").trim().replace(/\.0$/, "");
    const codice = get("CODICE FORNITORE");
    const product = db.products.find((p) => p.codice === codice);
    if (!product) continue;
    let rowTouched = false;
    for (const [col, fieldId] of EXCEL_COLUMNS) {
      // anagrafica (codice/ean/tipologia/marca/anno) è del Consorzio: qui solo i campi testuali
      if (["codice", "ean", "tipologia", "marca", "annoCollezione"].includes(fieldId)) continue;
      const v = get(col);
      if (!v) continue;
      const current = effectiveValue(db, scope, product, fieldId, academyDb).value;
      if (v === current) continue;
      const existing = db.overrides.find(
        (o) => o.scopeType === scope.type && o.scopeId === scope.id && o.productId === product.id && o.fieldId === fieldId
      );
      if (existing) existing.value = v;
      else db.overrides.push({ scopeType: scope.type, scopeId: scope.id, productId: product.id, fieldId, value: v });
      rowTouched = true;
    }
    if (rowTouched) touched++;
  }
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { importati: String(touched), personalizzati: "1" }));
}

/**
 * Associazione codici interni: l'insegna/PV carica l'Excel scaricato con la colonna
 * "CODICE INTERNO" compilata; ogni riga diventa la personalizzazione del campo codiceInterno.
 */
export async function importInternalCodes(scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system" || !puoPersonalizzare(user, scope, db)) {
    redirect(backUrl("/stampe/impostazioni", scopeParam, { codici: "0" }));
  }
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(backUrl("/stampe/impostazioni", scopeParam, { codici: "0" }));
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file!.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  let n = 0;
  for (const row of rows) {
    const codice = String(row["CODICE FORNITORE"] ?? "").trim().replace(/\.0$/, "");
    const interno = String(row["CODICE INTERNO"] ?? "").trim().replace(/\.0$/, "");
    if (!codice || !interno) continue;
    const product = db.products.find((p) => p.codice === codice);
    if (!product) continue;
    const existing = db.overrides.find(
      (o) => o.scopeType === scope.type && o.scopeId === scope.id && o.productId === product.id && o.fieldId === "codiceInterno"
    );
    if (existing) existing.value = interno;
    else db.overrides.push({ scopeType: scope.type, scopeId: scope.id, productId: product.id, fieldId: "codiceInterno", value: interno });
    n++;
  }
  await saveStampeDb(db);
  redirect(backUrl("/stampe/impostazioni", scopeParam, { codici: String(n) }));
}

/* ================== Campi personalizzati e liste (per ambito) ================== */

export async function addScopedField(scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!puoPersonalizzare(user, scope, db)) redirect("/stampe/impostazioni");
  const label = String(formData.get("label") ?? "").trim();
  if (!label) redirect("/stampe/impostazioni");
  const type = formData.get("type") === "image" ? "image" as const : "text" as const;
  db.fields.push({
    id: `f_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}_${Date.now() % 100000}`,
    label,
    size: type === "image" ? 11 : 11,
    bold: false,
    custom: true,
    type,
    scopeType: scope.type === "system" ? undefined : scope.type,
    scopeId: scope.type === "system" ? undefined : scope.id,
  });
  await saveStampeDb(db);
  redirect(backUrl("/stampe/impostazioni", scopeParam, { salvato: "1" }));
}

export async function deleteScopedField(fieldId: string, scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const f = db.fields.find((x) => x.id === fieldId);
  const owns =
    f?.custom &&
    ((!f.scopeType && isConsortiumEditor(user)) || (f.scopeType === scope.type && f.scopeId === scope.id));
  if (owns) {
    db.fields = db.fields.filter((x) => x.id !== fieldId);
    for (const l of db.layouts) l.items = l.items.filter((i) => i.fieldId !== fieldId);
    db.overrides = db.overrides.filter((o) => o.fieldId !== fieldId);
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/impostazioni", scopeParam, { salvato: "1" }));
}

export async function addListValue(key: "marche" | "tipologie" | "colori", scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!puoPersonalizzare(user, scope, db)) redirect("/stampe/impostazioni");
  const value = String(formData.get("value") ?? "").trim();
  if (value && !db.lists[key].some((v) => v.value.toLowerCase() === value.toLowerCase())) {
    db.lists[key].push({
      value,
      scopeType: scope.type === "system" ? undefined : scope.type,
      scopeId: scope.type === "system" ? undefined : scope.id,
    });
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/impostazioni", scopeParam, { salvato: "1" }));
}

export async function removeListValue(key: "marche" | "tipologie" | "colori", value: string, scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  db.lists[key] = db.lists[key].filter((v) => {
    if (v.value !== value) return true;
    const owns = (!v.scopeType && isConsortiumEditor(user)) || (v.scopeType === scope.type && v.scopeId === scope.id);
    return !owns;
  });
  await saveStampeDb(db);
  redirect(backUrl("/stampe/impostazioni", scopeParam, { salvato: "1" }));
}

/** L'insegna decide quali suoi PV possono personalizzare i cartelli. */
export async function toggleStoreBlock(storeId: string, scopeParam: string) {
  const user = await requireStampeUser();
  if (user.role !== "group_admin" && user.role !== "system_admin") redirect("/stampe/impostazioni");
  // un'insegna blocca o sblocca solo i propri punti vendita
  if (user.role === "group_admin") {
    const academyDb = await getDb();
    if (academyDb.stores.find((s) => s.id === storeId)?.tenantId !== user.tenantId) redirect("/stampe/impostazioni");
  }
  const db = await getStampeDb();
  const blocked = db.settings.blockedStores ?? [];
  db.settings.blockedStores = blocked.includes(storeId)
    ? blocked.filter((s) => s !== storeId)
    : [...blocked, storeId];
  await saveStampeDb(db);
  redirect(backUrl("/stampe/impostazioni", scopeParam, { salvato: "1" }));
}

/* ================== Sfondi e immagini personalizzati per il layout ================== */

async function saveUpload(file: File, dir: string, prefix: string): Promise<string | null> {
  if (!file || file.size === 0 || !file.type.startsWith("image/")) return null;
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `${prefix}_${Date.now()}.${ext}`;
  return uploadPublicFile(`${dir}/${name}`, Buffer.from(await file.arrayBuffer()), file.type);
}

export async function uploadScopedBackground(formatId: string, scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system") {
    if (!isConsortiumEditor(user)) redirect("/stampe/arredo/layout");
  } else if (isStoreBlocked(db, scope)) redirect("/stampe/arredo/layout");
  const file = formData.get("background") as File;
  const url = await saveUpload(file, "uploads/sfondi", `bg_${formatId}_${scope.type}_${scope.id || "sys"}`);
  if (url) {
    if (scope.type === "system") {
      const f = db.formats.find((x) => x.id === formatId);
      if (f) f.background = url;
    } else {
      const existing = db.scopedBackgrounds.find(
        (b) => b.formatId === formatId && b.scopeType === scope.type && b.scopeId === scope.id
      );
      if (existing) existing.url = url;
      else db.scopedBackgrounds.push({ formatId, scopeType: scope.type, scopeId: scope.id, url });
    }
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/layout", scopeParam, { formato: formatId }));
}

export async function removeScopedBackground(formatId: string, scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (isStoreBlocked(db, scope) || !puoModificareLayout(user, "arredo", scope, academyDb)) redirect(backUrl("/stampe/arredo/layout", scopeParam, { formato: formatId }));
  db.scopedBackgrounds = db.scopedBackgrounds.filter(
    (b) => !(b.formatId === formatId && b.scopeType === scope.type && b.scopeId === scope.id)
  );
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/layout", scopeParam, { formato: formatId }));
}

export async function uploadLayoutImage(scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (isStoreBlocked(db, scope) || !puoModificareLayout(user, "arredo", scope, academyDb)) redirect("/stampe/arredo/layout");
  const file = formData.get("image") as File;
  const name = String(formData.get("name") ?? "").trim() || file?.name || "Immagine";
  const url = await saveUpload(file, "uploads/layout-img", `img_${scope.type}_${scope.id || "sys"}`);
  if (url) {
    db.layoutImages.push({ id: `li_${Date.now()}`, name: name.slice(0, 40), url, scopeType: scope.type, scopeId: scope.id });
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/layout", scopeParam, { formato: String(formData.get("formatId") ?? "") }));
}

/* ================== Layout ================== */


/**
 * Salva un layout: se `layoutId` esiste già (nel proprio ambito) lo aggiorna,
 * altrimenti ne crea uno nuovo — così lo stesso formato può avere più layout,
 * ciascuno con un nome, invece di uno solo per formato+ambito. Ritorna l'id
 * (nuovo o esistente): il client lo tiene per i salvataggi successivi, così
 * l'autosalvataggio aggiorna sempre lo stesso layout invece di duplicarlo.
 */
export async function saveLayout(
  layoutId: string,
  formatId: string,
  scopeParam: string,
  nome: string,
  tipologieCsv: string,
  itemsJson: string,
  marginsJson: string,
  itemsNoPhotoJson: string
): Promise<{ ok: boolean; id?: string }> {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!puoModificareLayout(user, "arredo", scope, academyDb)) return { ok: false };

  let items: unknown;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(items)) return { ok: false };
  if (isStoreBlocked(db, scope)) return { ok: false };
  const isKnownField = (fieldId: string) => db.fields.some((f) => f.id === fieldId);
  const clean = sanitizeLayoutItems(items, isKnownField);
  let itemsNoPhotoRaw: unknown;
  try {
    itemsNoPhotoRaw = JSON.parse(itemsNoPhotoJson);
  } catch {
    itemsNoPhotoRaw = [];
  }
  const cleanNoPhoto = sanitizeLayoutItems(itemsNoPhotoRaw, isKnownField);
  const margins = sanitizeMargins(marginsJson);
  const tipologie = tipologieCsv.split(",").map((t) => t.trim()).filter(Boolean);
  const nomePulito = nome.trim().slice(0, 60);

  let layout = db.layouts.find((l) => l.id === layoutId && l.scopeType === scope.type && l.scopeId === scope.id);
  if (!layout) {
    layout = {
      id: `l_${Date.now()}`, formatId, scopeType: scope.type as ScopeType, scopeId: scope.id,
      nome: nomePulito || undefined, tipologie, items: clean, itemsNoPhoto: cleanNoPhoto, margins,
    };
    db.layouts.push(layout);
  } else {
    layout.items = clean;
    layout.itemsNoPhoto = cleanNoPhoto;
    layout.tipologie = tipologie;
    layout.margins = margins;
    layout.margin = undefined; // sostituito dai margini per lato
    layout.nome = nomePulito || undefined;
  }
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/layout");
  return { ok: true, id: layout.id };
}

export async function deleteLayout(layoutId: string, scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const l = db.layouts.find((x) => x.id === layoutId);
  if (l && l.scopeType === scope.type && l.scopeId === scope.id) {
    if (!puoModificareLayout(user, "arredo", scope, academyDb)) redirect("/stampe/arredo/layout");
    db.layouts = db.layouts.filter((x) => x.id !== layoutId);
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/layout", scopeParam));
}


/* ================== Scheda online: foto in più, apertura emozionale, accessori e simili ================== */

async function ambitoSchedaExtra(scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const ok = gestisceArea(user, "arredo", scope, academyDb) && !isStoreBlocked(db, scope);
  return { user, db, academyDb, scope, ok };
}

function recordExtra(db: StampeDB, scope: { type: ScopeType; id: string }, productId: string): SchedaExtra {
  let r = db.schedaExtra.find((x) => x.productId === productId && x.scopeType === scope.type && x.scopeId === scope.id);
  if (!r) { r = { scopeType: scope.type, scopeId: scope.id, productId }; db.schedaExtra.push(r); }
  return r;
}

/** Occhiello e frase dell'apertura, accessori e simili (id dei prodotti, uno per riga nel modulo). */
export async function salvaSchedaExtra(productId: string, scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { db, scope, ok } = await ambitoSchedaExtra(scopeParam);
  if (!ok) return { ok: false, error: "Non puoi modificare questo ambito." };
  if (!db.products.some((p) => p.id === productId)) return { ok: false, error: "Prodotto non trovato." };
  const r = recordExtra(db, scope, productId);
  const ids = (nome: string) => [...new Set((fd.getAll(nome) as string[]).filter((id) => id && id !== productId && db.products.some((p) => p.id === id)))].slice(0, 24);
  if (fd.get("campo") === "testi") {
    r.occhiello = String(fd.get("occhiello") ?? "").trim().slice(0, 60);
    r.frase = String(fd.get("frase") ?? "").trim().slice(0, 200);
  }
  if (fd.get("campo") === "accessori") r.accessori = ids("accessori");
  if (fd.get("campo") === "correlati") r.correlati = ids("correlati");
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/dati");
  return { ok: true };
}

/** Registra foto o video già caricati su Supabase (il browser li manda da solo, con l'URL firmato). */
export async function registraMediaScheda(productId: string, scopeParam: string, dove: "foto" | "emozionali", media: { url: string; tipo: "foto" | "video" }[]): Promise<{ ok: boolean; error?: string }> {
  const { db, scope, ok } = await ambitoSchedaExtra(scopeParam);
  if (!ok) return { ok: false, error: "Non puoi modificare questo ambito." };
  const r = recordExtra(db, scope, productId);
  if (!db.products.some((p) => p.id === productId)) return { ok: false, error: "Prodotto non trovato." };
  const buoni = (Array.isArray(media) ? media : []).filter((m) => mediaNostro(m?.url) && (m.tipo === "foto" || m.tipo === "video")).slice(0, 20);
  if (dove === "foto") r.foto = [...(r.foto ?? []), ...buoni.filter((m) => m.tipo === "foto").map((m) => m.url)].slice(0, 20);
  else r.emozionali = [...(r.emozionali ?? []), ...buoni.map((m) => ({ url: m.url, tipo: m.tipo }))].slice(0, 10);
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/dati");
  return { ok: true };
}

/** Toglie una foto o un video dalla scheda (il file resta nello storage: non si cancellano file in produzione da qui). */
export async function rimuoviMediaScheda(productId: string, scopeParam: string, dove: "foto" | "emozionali", url: string): Promise<{ ok: boolean; error?: string }> {
  const { db, scope, ok } = await ambitoSchedaExtra(scopeParam);
  if (!ok) return { ok: false, error: "Non puoi modificare questo ambito." };
  const r = recordExtra(db, scope, productId);
  if (dove === "foto") r.foto = (r.foto ?? []).filter((u) => u !== url);
  else r.emozionali = (r.emozionali ?? []).filter((m) => m.url !== url);
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/dati");
  return { ok: true };
}

/** Un'insegna o un PV torna a quello che decide il livello sopra, per una voce. */
export async function ereditaSchedaExtra(productId: string, scopeParam: string, voce: "foto" | "emozionali" | "accessori" | "correlati" | "testi"): Promise<{ ok: boolean; error?: string }> {
  const { db, scope, ok } = await ambitoSchedaExtra(scopeParam);
  if (!ok) return { ok: false, error: "Non puoi modificare questo ambito." };
  const r = db.schedaExtra.find((x) => x.productId === productId && x.scopeType === scope.type && x.scopeId === scope.id);
  if (r) {
    if (voce === "testi") { delete r.occhiello; delete r.frase; } else delete r[voce];
    if (Object.keys(r).length <= 3) db.schedaExtra = db.schedaExtra.filter((x) => x !== r);
  }
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/dati");
  return { ok: true };
}


/* ================== Catalogo online dell'insegna ================== */

/** L'insegna dell'ambito (un PV porta alla sua insegna) e se chi chiede la gestisce. */
async function ambitoInsegna(scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const tenantId = scope.type === "tenant" ? scope.id : scope.type === "store" ? academyDb.stores.find((s) => s.id === scope.id)?.tenantId : undefined;
  const storeId = scope.type === "store" ? scope.id : undefined;
  const ok = !!tenantId && gestisceArea(user, "arredo", scope, academyDb) && !isStoreBlocked(db, scope);
  // il catalogo è dell'insegna: dal PV si gestiscono solo le quantità
  const okInsegna = ok && scope.type === "tenant";
  return { user, db, academyDb, scope, tenantId, storeId, ok, okInsegna };
}

function prefCatalogo(db: StampeDB, tenantId: string) {
  let c = db.catalogo.find((x) => x.tenantId === tenantId);
  if (!c) { c = { tenantId }; db.catalogo.push(c); }
  return c;
}

/** Acceso/spento, titolo, banner e regole delle quantità del catalogo dell'insegna. */
export async function salvaCatalogo(scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { db, tenantId, okInsegna } = await ambitoInsegna(scopeParam);
  if (!okInsegna) return { ok: false, error: "Il catalogo lo gestisce l'insegna." };
  const c = prefCatalogo(db, tenantId!);
  c.attivo = fd.get("attivo") === "on";
  c.titolo = String(fd.get("titolo") ?? "").trim().slice(0, 60) || undefined;
  c.bannerOcchiello = String(fd.get("bannerOcchiello") ?? "").trim().slice(0, 60) || undefined;
  c.bannerTesto = String(fd.get("bannerTesto") ?? "").trim().slice(0, 120) || undefined;
  c.gestioneQuantita = fd.get("gestioneQuantita") === "on";
  c.esauritiNascosti = fd.get("esauriti") === "nascosti";
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true };
}

/** La foto del banner del catalogo, già caricata su Supabase. */
export async function salvaBannerCatalogo(scopeParam: string, url: string | null): Promise<{ ok: boolean; error?: string }> {
  const { db, tenantId, okInsegna } = await ambitoInsegna(scopeParam);
  if (!okInsegna) return { ok: false, error: "Il catalogo lo gestisce l'insegna." };
  const c = prefCatalogo(db, tenantId!);
  c.bannerUrl = mediaNostro(url) ? url : undefined;
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true };
}

/** Accende o spegne prodotti nel catalogo dell'insegna (uno, o tutti quelli di una tipologia). */
export async function accendiProdottiCatalogo(scopeParam: string, ids: string[], acceso: boolean): Promise<{ ok: boolean; error?: string }> {
  const { db, tenantId, okInsegna } = await ambitoInsegna(scopeParam);
  if (!okInsegna) return { ok: false, error: "Il catalogo lo gestisce l'insegna." };
  const c = prefCatalogo(db, tenantId!);
  const esistono = new Set(db.products.map((p) => p.id));
  ids = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && esistono.has(id)).slice(0, 5000);
  const spenti = new Set((c.spenti ?? []).filter((id) => esistono.has(id)));
  for (const id of ids) { if (acceso) spenti.delete(id); else spenti.add(id); }
  c.spenti = [...spenti];
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true };
}

/* ================== Quantità dei punti vendita ================== */

function giacenzaDi(db: StampeDB, storeId: string) {
  let g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g) { g = { storeId, quantita: {} }; db.giacenze.push(g); }
  return g;
}

/** Una quantità scritta a mano nell'elenco del PV. */
export async function salvaQuantitaMano(scopeParam: string, codice: string, quantita: string): Promise<{ ok: boolean; error?: string }> {
  const { db, storeId, ok } = await ambitoInsegna(scopeParam);
  if (!ok || !storeId) return { ok: false, error: "Le quantità si scrivono dal punto vendita." };
  if (!db.products.some((p) => p.codice === codice)) return { ok: false, error: "Codice non trovato." };
  const g = giacenzaDi(db, storeId);
  const n = quantita.trim() === "" ? undefined : Math.max(0, Math.floor(Number(quantita)));
  if (n === undefined) delete g.quantita[codice]; else if (Number.isFinite(n)) g.quantita[codice] = n; else return { ok: false, error: "Scrivi un numero." };
  g.aggiornatoIl = new Date().toISOString(); g.fonte = "mano";
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true };
}

/**
 * Le quantità da un Excel del PV: colonne «codice» e «quantità» (o le prime
 * due), un prodotto per riga. Sostituisce tutte le quantità del PV: è la foto
 * del magazzino di oggi.
 */
export async function importaQuantitaExcel(scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { db, storeId, ok } = await ambitoInsegna(scopeParam);
  if (!ok || !storeId) return { ok: false, error: "Le quantità si caricano dal punto vendita." };
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "Scegli un file." };
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const codici = new Set(db.products.map((p) => p.codice));
  const quantita: Record<string, number> = {};
  let ignorate = 0;
  for (const row of rows) {
    const chiavi = Object.keys(row);
    const kCod = chiavi.find((k) => /cod/i.test(k)) ?? chiavi[0];
    const kQta = chiavi.find((k) => /quant|qt|giac|pezzi|disp/i.test(k)) ?? chiavi[1];
    const codice = String(row[kCod] ?? "").trim().replace(/\.0$/, "");
    const n = Math.floor(Number(String(row[kQta] ?? "").replace(",", ".")));
    if (!codice || !codici.has(codice) || !Number.isFinite(n)) { ignorate++; continue; }
    quantita[codice] = Math.max(0, n);
  }
  if (Object.keys(quantita).length === 0) return { ok: false, error: "Nessuna riga valida: servono le colonne codice e quantità, con i codici fornitore del catalogo." };
  const g = giacenzaDi(db, storeId);
  g.quantita = quantita; g.aggiornatoIl = new Date().toISOString(); g.fonte = "excel";
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true, error: `Caricate ${Object.keys(quantita).length} quantità${ignorate ? `, ${ignorate} righe ignorate (codice sconosciuto o quantità non numerica)` : ""}.` };
}

/** Una nuova chiave per il gestionale del PV (quella vecchia smette di valere). */
export async function rigeneraTokenGiacenze(scopeParam: string): Promise<{ ok: boolean; error?: string }> {
  const { db, storeId, ok } = await ambitoInsegna(scopeParam);
  if (!ok || !storeId) return { ok: false, error: "La chiave è del punto vendita." };
  const g = giacenzaDi(db, storeId);
  g.token = `gt_${randomBytes(18).toString("base64url")}`;
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true };
}

/* ================== Totem del punto vendita ================== */

async function totemDi(id: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const t = db.totem.find((x) => x.id === id);
  if (!t) return { user, db, academyDb, t: undefined, ok: false };
  const scope = { type: "store" as const, id: t.storeId, label: "" };
  const ok = gestisceArea(user, "arredo", scope, academyDb) && !isStoreBlocked(db, scope);
  return { user, db, academyDb, t, ok };
}

export async function creaTotem(scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { db, storeId, ok } = await ambitoInsegna(scopeParam);
  if (!ok || !storeId) return { ok: false, error: "Il totem si crea dal punto vendita." };
  const nome = String(fd.get("nome") ?? "").trim().slice(0, 60) || "Totem";
  const t: Totem = {
    id: `tt_${Date.now().toString(36)}`, storeId, nome, chiave: randomBytes(9).toString("base64url"), modo: "attesa", categorie: [], media: [],
    secondiMedia: 8, secondiInattivita: 45, secondiProdotto: 10, bannerOgni: 4, mostraPrezzi: true,
  };
  db.totem.push(t);
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/totem");
  return { ok: true };
}

export async function salvaTotem(id: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { db, t, ok } = await totemDi(id);
  if (!t || !ok) return { ok: false, error: "Totem non trovato o non tuo." };
  const num = (k: string, min: number, max: number, def: number) => { const n = Number(fd.get(k)); return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, Math.round(n))) : def; };
  t.nome = String(fd.get("nome") ?? t.nome).trim().slice(0, 60) || t.nome;
  t.modo = fd.get("modo") === "prodotti" ? "prodotti" : "attesa";
  t.categorie = (fd.getAll("categorie") as string[]).filter(Boolean).slice(0, 30);
  t.occhiello = String(fd.get("occhiello") ?? "").trim().slice(0, 60) || undefined;
  t.frase = String(fd.get("frase") ?? "").trim().slice(0, 120) || undefined;
  t.sottotitolo = String(fd.get("sottotitolo") ?? "").trim().slice(0, 160) || undefined;
  t.secondiMedia = num("secondiMedia", 3, 120, 8);
  t.secondiInattivita = num("secondiInattivita", 10, 900, 45);
  t.secondiProdotto = num("secondiProdotto", 3, 120, 10);
  t.bannerOgni = num("bannerOgni", 1, 50, 4);
  t.mostraPrezzi = fd.get("mostraPrezzi") === "on";
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/totem");
  return { ok: true };
}

export async function registraMediaTotem(id: string, media: { url: string; tipo: "foto" | "video" }[]): Promise<{ ok: boolean; error?: string }> {
  const { db, t, ok } = await totemDi(id);
  if (!t || !ok) return { ok: false, error: "Totem non trovato o non tuo." };
  const buoni = (Array.isArray(media) ? media : []).filter((m) => mediaNostro(m?.url) && (m.tipo === "foto" || m.tipo === "video")).map((m) => ({ url: m.url, tipo: m.tipo }));
  t.media = [...t.media, ...buoni].slice(0, 20);
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/totem");
  return { ok: true };
}

export async function rimuoviMediaTotem(id: string, url: string): Promise<{ ok: boolean; error?: string }> {
  const { db, t, ok } = await totemDi(id);
  if (!t || !ok) return { ok: false, error: "Totem non trovato o non tuo." };
  t.media = t.media.filter((m) => m.url !== url);
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/totem");
  return { ok: true };
}

export async function eliminaTotem(id: string): Promise<{ ok: boolean; error?: string }> {
  const { db, t, ok } = await totemDi(id);
  if (!t || !ok) return { ok: false, error: "Totem non trovato o non tuo." };
  db.totem = db.totem.filter((x) => x.id !== id);
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/totem");
  return { ok: true };
}

export async function rigeneraChiaveTotem(id: string): Promise<{ ok: boolean; error?: string }> {
  const { db, t, ok } = await totemDi(id);
  if (!t || !ok) return { ok: false, error: "Totem non trovato o non tuo." };
  t.chiave = randomBytes(9).toString("base64url");
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/totem");
  return { ok: true };
}


/* ================== Stampa cartelli Arredo: cosa stampare da un Excel ================== */

/**
 * Un Excel di prodotti (EAN o CODICE FORNITORE, una riga per prodotto) decide
 * la selezione di stampa: le righe con STAMPA «sì» (o senza colonna) entrano,
 * quelle con «no» (o NON STAMPARE «sì») escono. Si parte dalla selezione che
 * c'è già, così si possono caricare più file.
 */
export async function selezioneStampaDaExcel(scopeParam: string, selezioneAttuale: string, righeJson: string): Promise<void> {
  await requireStampeUser();
  const db = await getStampeDb();
  let righe: Record<string, unknown>[] = [];
  try { const r = JSON.parse(righeJson); if (Array.isArray(r)) righe = r; } catch { /* niente */ }
  const sel = new Set(selezioneAttuale.split(",").filter(Boolean));
  const val = (row: Record<string, unknown>, ...nomi: string[]) => {
    const k = Object.keys(row).find((x) => nomi.includes(x.trim().toLowerCase()));
    return k ? String(row[k] ?? "").trim().replace(/\.0$/, "") : "";
  };
  const si = (v: string) => ["si", "sì", "s", "1", "x", "true", "y", "yes"].includes(v.trim().toLowerCase());
  let dentro = 0, fuori = 0, sconosciuti = 0;
  for (const row of righe) {
    const ean = val(row, "ean", "codice ean", "barcode", "codice a barre", "cod. barre").replace(/\s/g, "").replace(/^'/, "");
    const codice = val(row, "codice fornitore", "cod. fornitore", "codice articolo", "codice");
    const p = db.products.find((x) => (ean && x.ean === ean) || (codice && x.codice === codice));
    if (!p) { if (ean || codice) sconosciuti++; continue; }
    const kNo = Object.keys(row).find((k) => ["non stampare", "escludi"].includes(k.trim().toLowerCase()));
    const kSi = Object.keys(row).find((k) => ["stampa", "stampare", "da stampare"].includes(k.trim().toLowerCase()));
    const stampa = kNo ? !si(String(row[kNo] ?? "")) : kSi ? si(String(row[kSi] ?? "")) : true;
    if (stampa) { if (!sel.has(p.id)) dentro++; sel.add(p.id); } else { if (sel.delete(p.id)) fuori++; }
  }
  const q = new URLSearchParams({ scope: scopeParam, tutti: "1", sel: [...sel].join(","), excel: `${dentro}_${fuori}_${sconosciuti}` });
  redirect(`/stampe/arredo/stampa?${q.toString()}`);
}
