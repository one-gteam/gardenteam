"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { getDb } from "./db";
import { uploadPublicFile } from "./supabase";
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
  Cornice, puoModificareLayout } from "./stampe";
import { ELEMENTO_IMMAGINE, ELEMENTO_QR, ELEMENTO_RIQUADRO, gruppoDi } from "./cartello-campi";
import { postLoginPath } from "./types";
import { LAYOUT_FONTS } from "./layout-fonts";

/* Stesso principio dello Zoo: qui si lavora sui Cartelli Arredo e serve quell'area. */
async function requireStampeUser() {
  const user = await requireUser();
  if (!canAccessArea(user, "arredo")) redirect(postLoginPath(user));
  return user;
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
  const product = db.products.find((p) => p.id === productId);
  if (!product) return { ok: false as const, error: "prodotto non trovato" };
  value = value.trim();

  if (scope.type === "system") {
    if (!isConsortiumEditor(user)) return { ok: false as const, error: "non autorizzato" };
    product.fields[fieldId] = value;
    await saveStampeDb(db);
    return { ok: true as const, custom: false };
  }
  const existing = db.overrides.find(
    (o) => o.scopeType === scope.type && o.scopeId === scope.id && o.productId === productId && o.fieldId === fieldId
  );
  if (value === (product.fields[fieldId] ?? "")) {
    db.overrides = db.overrides.filter((o) => o !== existing);
    await saveStampeDb(db);
    return { ok: true as const, custom: false };
  }
  if (existing) existing.value = value;
  else db.overrides.push({ scopeType: scope.type, scopeId: scope.id, productId, fieldId, value });
  await saveStampeDb(db);
  return { ok: true as const, custom: true };
}

/** Salva il valore di un campo: sul Consorzio se responsabile contenuti, altrimenti come personalizzazione. */
export async function savePrintField(productId: string, fieldId: string, scopeParam: string, formData: FormData) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
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
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId, salvato: "1" }));
}

export async function resetPrintField(productId: string, fieldId: string, scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
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
  if (scope.type === "system" || isStoreBlocked(db, scope)) {
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
  if (scope.type === "system" || isStoreBlocked(db, scope)) {
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
  if (isStoreBlocked(db, scope)) redirect("/stampe/impostazioni");
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
  if (isStoreBlocked(db, scope)) redirect("/stampe/impostazioni");
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
  if (isStoreBlocked(db, scope)) redirect("/stampe/arredo/layout");
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

const COLORE = /^#[0-9a-fA-F]{3,8}$/;

/** La cornice del riquadro, entro limiti ragionevoli; se non resta niente di valido non si salva. */
function sanitizeCornice(c: Record<string, unknown>): { cornice?: Cornice } {
  const out: Cornice = {};
  if (typeof c.titolo === "string" && c.titolo.trim()) out.titolo = c.titolo.slice(0, 80);
  if (typeof c.icona === "string" && c.icona.trim()) out.icona = [...c.icona.trim()].slice(0, 2).join("");
  if (["linee", "fascia", "semplice"].includes(c.stile as string)) out.stile = c.stile as Cornice["stile"];
  if (typeof c.colore === "string" && COLORE.test(c.colore)) out.colore = c.colore;
  if (typeof c.sfondo === "string" && COLORE.test(c.sfondo)) out.sfondo = c.sfondo;
  if (Number.isFinite(Number(c.size)) && Number(c.size) > 0) out.size = Math.max(4, Math.min(120, Number(c.size)));
  if (typeof c.bordoColore === "string" && COLORE.test(c.bordoColore)) out.bordoColore = c.bordoColore;
  if (Number.isFinite(Number(c.bordoSpessore)) && Number(c.bordoSpessore) > 0) out.bordoSpessore = Math.max(0.1, Math.min(10, Number(c.bordoSpessore)));
  if (["tutti", "sopra", "sotto", "sopra-sotto"].includes(c.bordoLati as string)) out.bordoLati = c.bordoLati as Cornice["bordoLati"];
  if (Number.isFinite(Number(c.padding)) && Number(c.padding) > 0) out.padding = Math.max(0, Math.min(30, Number(c.padding)));
  return Object.keys(out).length ? { cornice: out } : {};
}

/** Ripulisce un array di LayoutItem grezzo dal client: stessa validazione per il foglio normale e per quello senza foto. */
function sanitizeLayoutItems(raw: unknown, isKnownField: (fieldId: string) => boolean) {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter(
      (i) =>
        typeof i.fieldId === "string" &&
        (i.fieldId === ELEMENTO_IMMAGINE ? typeof i.imageUrl === "string"
          : i.fieldId === ELEMENTO_RIQUADRO || i.fieldId === ELEMENTO_QR ? true
          : isKnownField(i.fieldId))
    )
    .map((i) => ({
      fieldId: i.fieldId as string,
      x: Math.max(0, Math.min(95, Number(i.x) || 0)),
      y: Math.max(0, Math.min(95, Number(i.y) || 0)),
      w: Math.max(3, Math.min(100, Number(i.w) || 10)),
      h: Math.max(2, Math.min(100, Number(i.h) || 5)),
      ...(typeof i.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(i.color) ? { color: i.color } : {}),
      ...(i.fieldId === "__img" ? { imageUrl: String(i.imageUrl).slice(0, 300) } : {}),
      ...(Number.isFinite(Number(i.size)) ? { size: Math.max(4, Math.min(120, Number(i.size))) } : {}),
      ...(typeof i.bold === "boolean" ? { bold: i.bold } : {}),
      ...(typeof i.italic === "boolean" ? { italic: i.italic } : {}),
      ...(["left", "center", "right"].includes(i.align as string) ? { align: i.align as "left" | "center" | "right" } : {}),
      ...(typeof i.font === "string" && LAYOUT_FONTS.some((f) => f.id === i.font) ? { font: i.font as string } : {}),
      ...(typeof i.bg === "string" && /^#[0-9a-fA-F]{3,8}$/.test(i.bg) ? { bg: i.bg } : {}),
      ...(Number.isFinite(Number(i.radius)) ? { radius: Math.max(0, Math.min(40, Number(i.radius))) } : {}),
      ...(typeof i.testo === "string" && i.testo.trim() ? { testo: i.testo.slice(0, 200) } : {}),
      ...(typeof i.prefisso === "string" && i.prefisso.trim() ? { prefisso: i.prefisso.trim().slice(0, 6) } : {}),
      ...(i.cornice && typeof i.cornice === "object" ? sanitizeCornice(i.cornice as Record<string, unknown>) : {}),
      ...(i.sticker && typeof i.sticker === "object"
        ? {
            sticker: {
              shape: ["cerchio", "quadrato", "stella", "nastro"].includes((i.sticker as Record<string, unknown>).shape as string)
                ? ((i.sticker as Record<string, unknown>).shape as "cerchio")
                : "cerchio",
              bg: /^#[0-9a-fA-F]{3,8}$/.test(String((i.sticker as Record<string, unknown>).bg)) ? String((i.sticker as Record<string, unknown>).bg) : "#e8481c",
              rotation: Math.max(-180, Math.min(180, Number((i.sticker as Record<string, unknown>).rotation) || 0)),
              size: Math.max(6, Math.min(120, Number((i.sticker as Record<string, unknown>).size) || 16)),
              ...((i.sticker as Record<string, unknown>).font === "cn" ? { font: "cn" as const } : {}),
            },
          }
        : {}),
    }));
}

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
