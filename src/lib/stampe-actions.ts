"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { getDb } from "./db";
import { uploadPublicFile } from "./supabase";
import {
  getStampeDb,
  saveStampeDb,
  canAccessStampe,
  isConsortiumEditor,
  resolveScope,
  isStoreBlocked,
  ScopeType,
} from "./stampe";

async function requireStampeUser() {
  const user = await requireUser();
  if (!canAccessStampe(user)) redirect("/studente");
  return user;
}

function backUrl(page: string, scopeParam: string, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams({ scope: scopeParam, ...extra });
  return `${page}?${qs.toString()}`;
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
    db.fieldPrefs = db.fieldPrefs.filter((p) => p !== existing);
  } else {
    db.fieldPrefs.push({ scopeType: scope.type, scopeId: scope.id, fieldId, hidden: true });
  }
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { prodotto: productId }));
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
    db.products.push({
      id,
      codice,
      ean: String(formData.get("ean") ?? "").trim(),
      tipologia: String(formData.get("tipologia") ?? "").trim() || source?.tipologia || "Varie (Tavolini, Bauli, Ecc)",
      marca: String(formData.get("marca") ?? "").trim() || source?.marca || "Garden Team",
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
  db.fields.push({ id, label, size: 11, bold: false, custom: true });
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
      else p.fields[fieldId] = v;
    }
  }
  await saveStampeDb(db);
  redirect(backUrl("/stampe/arredo/dati", scopeParam, { importati: String(created + updated), nuovi: String(created) }));
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

/** Salva il layout per formato+ambito (items in JSON dal client editor). */
export async function saveLayout(
  formatId: string,
  scopeParam: string,
  tipologieCsv: string,
  itemsJson: string
) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (scope.type === "system" && !isConsortiumEditor(user)) return;

  let items: unknown;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return;
  }
  if (!Array.isArray(items)) return;
  if (isStoreBlocked(db, scope)) return;
  const clean = (items as Record<string, unknown>[])
    .filter(
      (i) =>
        typeof i.fieldId === "string" &&
        (i.fieldId === "__img" ? typeof i.imageUrl === "string" : db.fields.some((f) => f.id === i.fieldId))
    )
    .map((i) => ({
      fieldId: i.fieldId as string,
      x: Math.max(0, Math.min(95, Number(i.x) || 0)),
      y: Math.max(0, Math.min(95, Number(i.y) || 0)),
      w: Math.max(3, Math.min(100, Number(i.w) || 10)),
      h: Math.max(2, Math.min(100, Number(i.h) || 5)),
      ...(typeof i.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(i.color) ? { color: i.color } : {}),
      ...(i.fieldId === "__img" ? { imageUrl: String(i.imageUrl).slice(0, 300) } : {}),
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

  const tipologie = tipologieCsv.split(",").map((t) => t.trim()).filter(Boolean);
  let layout = db.layouts.find(
    (l) =>
      l.formatId === formatId &&
      l.scopeType === scope.type &&
      l.scopeId === scope.id &&
      l.tipologie.join(",") === tipologie.join(",")
  );
  if (!layout) {
    layout = { id: `l_${Date.now()}`, formatId, scopeType: scope.type as ScopeType, scopeId: scope.id, tipologie, items: clean };
    db.layouts.push(layout);
  } else {
    layout.items = clean;
    layout.tipologie = tipologie;
  }
  await saveStampeDb(db);
  revalidatePath("/stampe/arredo/layout");
}

export async function deleteLayout(layoutId: string, scopeParam: string) {
  const user = await requireStampeUser();
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const l = db.layouts.find((x) => x.id === layoutId);
  if (l && l.scopeType === scope.type && l.scopeId === scope.id) {
    if (l.scopeType === "system" && !isConsortiumEditor(user)) redirect("/stampe/arredo/layout");
    db.layouts = db.layouts.filter((x) => x.id !== layoutId);
    await saveStampeDb(db);
  }
  redirect(backUrl("/stampe/arredo/layout", scopeParam));
}
