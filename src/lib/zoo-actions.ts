"use server";

import { redirect } from "next/navigation";
import { requireUser } from "./auth";
import { getDb } from "./db";
import { canAccessStampe, isConsortiumEditor, resolveScope } from "./stampe";
import { getZooDb, saveZooDb, ZooDB, ZooParent } from "./zoo";
import { groupAndDescribe } from "./zoo-ai";
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

/* ================== 1. Database prodotti / caricamento foto ================== */

export async function importZooProducts(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect("/stampe/zoo/dati");
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

/** Carica una o più foto: se il nome file contiene EAN o codice fornitore, l'associazione è automatica. */
export async function uploadZooPhotos(scopeParam: string, formData: FormData) {
  await requireZooUser();
  const files = formData.getAll("foto") as File[];
  const db = await getZooDb();
  let saved = 0;
  let matched = 0;
  for (const file of files) {
    if (!file || file.size === 0 || !file.type.startsWith("image/")) continue;
    const clean = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
    const url = await uploadPublicFile(`zoo-foto/${clean}`, Buffer.from(await file.arrayBuffer()), file.type);
    saved++;
    const base = clean.replace(/\.[a-z0-9]+$/, "");
    const hit = db.products.find(
      (p) => (p.ean && base.includes(p.ean)) || (p.codice && p.codice.length > 3 && base.includes(p.codice.toLowerCase()))
    );
    if (hit) {
      hit.image = url;
      matched++;
    }
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { foto: String(saved), abbinate: String(matched) }));
}

/** Associa manualmente una foto già caricata (nel bucket zoo-foto) a un prodotto. */
export async function associateZooPhoto(scopeParam: string, productId: string, formData: FormData) {
  await requireZooUser();
  const fileName = String(formData.get("fileName") ?? "");
  const db = await getZooDb();
  const p = db.products.find((x) => x.id === productId);
  if (p && fileName) {
    p.image = publicUrlFor(`zoo-foto/${fileName}`);
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { prodotto: productId }));
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
export async function createZooParent(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/dati", scopeParam));
  const ids = (formData.getAll("sel") as string[]).filter(Boolean);
  const db = await getZooDb();
  const children = db.products.filter((p) => ids.includes(p.id));
  if (children.length === 0) redirect(backUrl("/stampe/zoo/dati", scopeParam));
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
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: id }));
}

/** "Associa con AI": raggruppa gli articoli selezionati e genera i testi volantino/cartello. */
export async function associaConAI(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/dati", scopeParam));
  const ids = (formData.getAll("sel") as string[]).filter(Boolean);
  const db = await getZooDb();
  const selected = db.products.filter((p) => ids.includes(p.id));
  if (selected.length === 0) redirect(backUrl("/stampe/zoo/dati", scopeParam));
  const { groups, usedAi, error } = await groupAndDescribe(db.settings.apiKey, selected, db.settings);
  const created = applyGroups(db, groups, usedAi);
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/dati", scopeParam, {
    ai: usedAi ? "1" : "0", padri: String(created), ...(error ? { aierr: error.slice(0, 120) } : {}),
  }));
}

/** Rigenera con l'AI i testi di un padre esistente (dai suoi articoli figli). */
export async function rigeneraTestiAI(parentId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/dati", scopeParam));
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  const children = db.products.filter((p) => p.parentId === parentId);
  if (!parent || children.length === 0) redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: parentId }));
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
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: parentId, ai: usedAi ? "1" : "0", ...(error ? { aierr: error.slice(0, 120) } : {}) }));
}

/** Salva nome/testi del padre: il Consorzio scrive la versione comune, insegna/PV una personalizzazione. */
export async function saveParentTexts(parentId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent) redirect(backUrl("/stampe/zoo/dati", scopeParam));
  const fieldsIn = {
    nome: String(formData.get("nome") ?? ""),
    descVolantino: String(formData.get("descVolantino") ?? ""),
    descCartello: String(formData.get("descCartello") ?? ""),
  };
  if (scope.type === "system") {
    if (isConsortiumEditor(user)) Object.assign(parent!, fieldsIn, { aiGenerated: false });
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
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: parentId }));
}

export async function setParentImage(parentId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: parentId }));
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  if (!parent) redirect(backUrl("/stampe/zoo/dati", scopeParam));
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
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: parentId }));
}

export async function toggleParentCaratteristica(parentId: string, caratteristica: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: parentId }));
  const db = await getZooDb();
  const parent = db.parents.find((p) => p.id === parentId);
  if (parent) {
    parent.caratteristiche = parent.caratteristiche.includes(caratteristica)
      ? parent.caratteristiche.filter((c) => c !== caratteristica)
      : [...parent.caratteristiche, caratteristica];
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/dati", scopeParam, { padre: parentId }));
}

export async function scioglieParent(parentId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/dati", scopeParam));
  const db = await getZooDb();
  db.parents = db.parents.filter((p) => p.id !== parentId);
  for (const p of db.products) if (p.parentId === parentId) delete p.parentId;
  db.textOverrides = db.textOverrides.filter((o) => o.parentId !== parentId);
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/dati", scopeParam));
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

/* ================== 2. Import offerte mensili ================== */

export async function importZooOffers(scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect("/stampe/zoo/offerte");
  const file = formData.get("file") as File | null;
  const nome = String(formData.get("nome") ?? "").trim() || `Offerte ${new Date().toLocaleDateString("it-IT")}`;
  const dal = String(formData.get("dal") ?? "");
  const al = String(formData.get("al") ?? "");
  if (!file || file.size === 0) redirect(backUrl("/stampe/zoo/offerte", scopeParam, { importate: "0" }));
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.from(await file!.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const db = await getZooDb();

  for (const c of db.campaigns) c.attiva = false;
  const campaignId = `zc_${Date.now()}`;
  db.campaigns.push({
    id: campaignId, nome, dal, al, attiva: true,
    schede: db.settings.schedeDefault.map((s, i) => ({ id: `s${i}`, nome: s })),
  });

  let nOffers = 0;
  let nNew = 0;
  for (const row of rows) {
    const ean = cell(row, "EAN", "CODICE EAN", "BARCODE");
    const descrizione = cell(row, "DESCRIZIONE PROMO", "DESCRIZIONE", "ARTICOLO");
    const prezzoPromo = priceStr(cell(row, "PREZZO PROMO", "PREZZO OFFERTA", "PREZZO"));
    if (!ean || !prezzoPromo) continue;
    let product = db.products.find((p) => p.ean === ean);
    let nuovo = false;
    if (!product) {
      // il prodotto non è nel DB base: viene creato e vi resterà anche per il futuro
      nuovo = true;
      nNew++;
      product = {
        id: `z_${ean}`, ean,
        codice: cell(row, "CODICE FORNITORE", "COD. FORNITORE", "CODICE"),
        descrizione: descrizione,
        marca: cell(row, "MARCA", "MARCHIO", "BRAND"),
        fornitore: cell(row, "FORNITORE", "DITTA"),
        categoria: cell(row, "CATEGORIA", "REPARTO"),
      };
      db.products.push(product);
    }
    db.offers.push({
      id: `zo_${Date.now()}_${nOffers}`,
      campaignId, ean, productId: product.id,
      descrizione: descrizione || product.descrizione,
      prezzoPromo,
      prezzoListino: priceStr(cell(row, "PREZZO LISTINO", "LISTINO")),
      condizioni: cell(row, "CONDIZIONI", "VALIDITA'", "NOTE"),
      nuovo,
    });
    nOffers++;
  }
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, { importate: String(nOffers), nuovi: String(nNew) }));
}

export async function updateCampaignDates(campaignId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
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

/** Raggruppa con l'AI tutti i prodotti NUOVI (senza padre) dell'ultima campagna. */
export async function associaNuoviConAI(scopeParam: string) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/offerte", scopeParam));
  const db = await getZooDb();
  const orphans = db.products.filter((p) => !p.parentId);
  if (orphans.length === 0) redirect(backUrl("/stampe/zoo/offerte", scopeParam, { padri: "0" }));
  const { groups, usedAi, error } = await groupAndDescribe(db.settings.apiKey, orphans, db.settings);
  const created = applyGroups(db, groups, usedAi);
  await saveZooDb(db);
  redirect(backUrl("/stampe/zoo/offerte", scopeParam, {
    padri: String(created), ai: usedAi ? "1" : "0", ...(error ? { aierr: error.slice(0, 120) } : {}),
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

export async function toggleOfferSelected(offerId: string, scopeParam: string) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
  const db = await getZooDb();
  const o = db.offers.find((x) => x.id === offerId);
  if (o) {
    o.selezionata = !o.selezionata;
    if (!o.selezionata) o.schedaId = undefined;
    await saveZooDb(db);
  }
  redirect(backUrl("/stampe/zoo/volantino", scopeParam));
}

export async function updateOfferVolantino(offerId: string, scopeParam: string, formData: FormData) {
  const user = await requireZooUser();
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
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
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
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
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/volantino", scopeParam));
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
  if (!isConsortiumEditor(user)) redirect("/stampe/zoo/volantino");
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
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/impostazioni", scopeParam));
  const db = await getZooDb();
  const list = (name: string) =>
    String(formData.get(name) ?? "").split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  db.settings.caratteristiche = list("caratteristiche");
  db.settings.labels = list("labels");
  db.settings.schedeDefault = list("schedeDefault");
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
  if (!isConsortiumEditor(user)) redirect(backUrl("/stampe/zoo/impostazioni", scopeParam));
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
