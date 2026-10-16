"use server";

import { requireUser } from "./auth";
import { getDb } from "./db";
import { getStampeDb, saveStampeDb, isStoreBlocked, puoModificareLayout, resolveScope, type LayoutItem } from "./stampe";
import { getZooDb, saveZooDb, ZOO_FIELDS } from "./zoo";
import { copiaStileCampo, elementoLibero, sanitizeLayoutItems } from "./layout-pulizia";
import { registra } from "./registro";

/**
 * «Applica a tutti i layout»: l'aspetto del campo scelto (carattere, misura,
 * colori, allineamento, cornice, prefisso, sticker) va su quel campo in tutti
 * gli altri layout dello stesso ambito, nel foglio normale e in quello senza
 * foto. Con `conPosizione` anche posizione e misure, ma solo sui layout dello
 * stesso formato (su un formato diverso le percentuali non tornano).
 * Il layout aperto non si tocca qui: lo salva l'editor.
 */
export async function applicaCampoATuttiILayout(
  area: "arredo" | "zoo", scopeParam: string, layoutIdAperto: string, formatId: string, itemJson: string, conPosizione: boolean,
  /** Solo i layout dello stesso formato (predefinito), e se aggiungere l'elemento dove manca. */
  opzioni: { soloFormato?: boolean; aggiungi?: boolean } = {},
): Promise<{ ok: true; layout: number; nomi: string[] } | { ok: false; error: string }> {
  const user = await requireUser();
  const academyDb = await getDb();
  const scope = resolveScope(user, scopeParam, academyDb);
  if (!puoModificareLayout(user, area, scope, academyDb)) return { ok: false, error: "Non puoi modificare i layout di questo ambito." };
  let grezzo: unknown;
  try { grezzo = JSON.parse(itemJson); } catch { return { ok: false, error: "Campo non valido." }; }

  const applica = (layouts: { id: string; formatId: string; scopeType: string; scopeId: string; nome?: string; items: LayoutItem[]; itemsNoPhoto?: LayoutItem[] }[], noto: (f: string) => boolean) => {
    const modello = sanitizeLayoutItems([grezzo], noto)[0];
    if (!modello) return null;
    const nomi: string[] = [];
    // immagini e riquadri si riconoscono dal punto in cui stanno: valgono solo sullo stesso formato
    const soloFormato = opzioni.soloFormato !== false || elementoLibero(modello.fieldId);
    for (const l of layouts) {
      if (l.id === layoutIdAperto || l.scopeType !== scope.type || l.scopeId !== scope.id) continue;
      const stessoFormato = l.formatId === formatId;
      if (soloFormato && !stessoFormato) continue;
      // posizione e aggiunta hanno senso solo sullo stesso formato (le percentuali di un altro foglio non tornano)
      const o = { conPosizione: conPosizione && stessoFormato, aggiungi: !!opzioni.aggiungi && stessoFormato };
      const n = copiaStileCampo(l.items, modello, o) + (l.itemsNoPhoto ? copiaStileCampo(l.itemsNoPhoto, modello, o) : 0);
      if (n > 0) nomi.push(l.nome || l.formatId);
    }
    return { modello, nomi };
  };

  if (area === "arredo") {
    const db = await getStampeDb();
    if (isStoreBlocked(db, scope)) return { ok: false, error: "Personalizzazione disabilitata dall'insegna." };
    const r = applica(db.layouts, (f) => db.fields.some((x) => x.id === f));
    if (!r) return { ok: false, error: "Campo non valido." };
    if (r.nomi.length) {
      await saveStampeDb(db);
      registra(user, { area: "arredo", cosa: "Stile del campo su tutti i layout", oggetto: db.fields.find((f) => f.id === r.modello.fieldId)?.label ?? r.modello.fieldId, dopo: `${r.nomi.length} layout: ${r.nomi.join(", ")}`, ambito: scope.type === "system" ? undefined : scope.label });
    }
    return { ok: true, layout: r.nomi.length, nomi: r.nomi };
  }
  const db = await getZooDb();
  const r = applica(db.zooLayouts, (f) => ZOO_FIELDS.some((x) => x.id === f));
  if (!r) return { ok: false, error: "Campo non valido." };
  if (r.nomi.length) {
    await saveZooDb(db);
    registra(user, { area: "zoo", cosa: "Stile del campo su tutti i layout", oggetto: ZOO_FIELDS.find((f) => f.id === r.modello.fieldId)?.label ?? r.modello.fieldId, dopo: `${r.nomi.length} layout: ${r.nomi.join(", ")}`, ambito: scope.type === "system" ? undefined : scope.label });
  }
  return { ok: true, layout: r.nomi.length, nomi: r.nomi };
}
