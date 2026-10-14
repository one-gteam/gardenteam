"use server";

import { getCurrentUser } from "./auth";
import { getZooDb, saveZooDb } from "./zoo";
import { getStampeDb } from "./stampe";
import { getDb } from "./db";
import { registra, segnaRipristinata, trovaVoce, type RifRegistro, type VoceRegistro } from "./registro";
import {
  updateParentFieldInline, setParentAnimaliInline, setTipologiaInline, updateOfferFieldInline,
  updateProductFieldInline, salvaDeadlineGrafico,
} from "./zoo-actions";
import { autosaveField } from "./stampe-actions";
import { quickSetRole, quickSetSites, quickToggleActive } from "./actions";
import { ROLE_LABELS, type Role, type SiteId } from "./types";

/*
 * Ripristino di una modifica dal Registro: rimette il valore di prima usando
 * le stesse azioni dell'interfaccia (stessi controlli, e il ripristino stesso
 * finisce nel registro). Solo l'amministratore di sistema.
 *
 * Prima di ripristinare si guarda se il valore è ancora quello lasciato dalla
 * modifica: se nel frattempo qualcuno l'ha cambiato di nuovo, si avvisa e si
 * ripristina solo se lo si chiede apposta (forza).
 */

type Esito = { ok: true } | { ok: false; error: string; ora?: string };

const sceltaScope = (scope: string) => {
  const [type, ...resto] = scope.split(":");
  return { type, id: resto.join(":") };
};

/** Il valore di adesso, nello stesso formato della voce (testo). undefined = non c'è più. */
async function valoreAttuale(rif: RifRegistro): Promise<string | undefined> {
  if (rif.tipo.startsWith("zoo-")) {
    const db = await getZooDb();
    switch (rif.tipo) {
      case "zoo-padre-testo": {
        const p = db.parents.find((x) => x.id === rif.id);
        if (!p) return undefined;
        const sc = sceltaScope(rif.scope);
        if (sc.type === "system") return p[rif.campo] ?? "";
        return db.textOverrides.find((o) => o.scopeType === sc.type && o.scopeId === sc.id && o.parentId === rif.id && o.field === rif.campo)?.value ?? p[rif.campo] ?? "";
      }
      case "zoo-animale": {
        const p = db.parents.find((x) => x.id === rif.id);
        return p ? p.caratteristiche.filter((c) => db.settings.categorieAnimali.includes(c)).join(", ") : undefined;
      }
      case "zoo-tipologia": {
        const x = rif.padre ? db.parents.find((p) => p.id === rif.id) : db.products.find((p) => p.id === rif.id);
        return x ? x.tipologia ?? "" : undefined;
      }
      case "zoo-offerta": {
        const o = db.offers.find((x) => x.id === rif.id);
        return o ? String((o as unknown as Record<string, unknown>)[rif.campo] ?? "") : undefined;
      }
      case "zoo-articolo":
        return db.products.find((x) => x.id === rif.id)?.descrizione;
      case "zoo-foto": {
        // la foto è stata tolta: «com'era dopo» = nessuna foto su tutti
        const imm = [
          ...(rif.padre ? [db.parents.find((x) => x.id === rif.padre)?.image] : []),
          ...rif.articoli.map((id) => db.products.find((x) => x.id === id)?.image),
        ];
        return imm.find(Boolean) ?? "";
      }
      case "zoo-deadline": {
        const c = db.campaigns.find((x) => x.id === rif.id);
        return c ? c.deadlineGrafico ?? "" : undefined;
      }
    }
  }
  if (rif.tipo === "arredo-campo") {
    const db = await getStampeDb();
    const p = db.products.find((x) => x.id === rif.id);
    if (!p) return undefined;
    const sc = sceltaScope(rif.scope);
    if (sc.type === "system") return p.fields[rif.campo] ?? "";
    return db.overrides.find((o) => o.scopeType === sc.type && o.scopeId === sc.id && o.productId === rif.id && o.fieldId === rif.campo)?.value ?? p.fields[rif.campo] ?? "";
  }
  const db = await getDb();
  const u = db.users.find((x) => x.id === (rif as { id: string }).id);
  if (!u) return undefined;
  if (rif.tipo === "utente-ruolo") return u.role;
  if (rif.tipo === "utente-aree") return [...(u.sites ?? [])].sort().join(",");
  if (rif.tipo === "utente-attivo") return String(u.active !== false);
  return undefined;
}

/** Il valore che la modifica aveva lasciato, nello stesso formato di valoreAttuale. */
function valoreDopo(v: VoceRegistro, rif: RifRegistro): string {
  if (rif.tipo === "utente-ruolo") return rif.dopo;
  if (rif.tipo === "utente-aree") return [...rif.dopo].sort().join(",");
  if (rif.tipo === "utente-attivo") return String(!rif.prima);
  return rif.vDopo ?? v.dopo ?? "";
}

/** Come si legge il valore di adesso nell'avviso. */
function leggibile(rif: RifRegistro, ora: string): string {
  if (rif.tipo === "utente-ruolo") return ROLE_LABELS[ora as Role] ?? ora;
  if (rif.tipo === "utente-attivo") return ora === "true" ? "attivo" : "cessato";
  if (rif.tipo === "utente-aree") return ora.split(",").filter(Boolean).join(", ") || "nessuna";
  return ora || "(vuoto)";
}

export async function ripristinaVoce(id: string, il: string, forza: boolean): Promise<Esito> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema può ripristinare." };
  const v = await trovaVoce(id, il);
  if (!v) return { ok: false, error: "Modifica non trovata nel registro." };
  const rif = v.rif;
  if (!rif) return { ok: false, error: "Questa modifica non si può ripristinare da qui." };
  if (v.ripristinataIl) return { ok: false, error: "Questa modifica è già stata ripristinata." };

  const ora = await valoreAttuale(rif);
  if (ora === undefined) return { ok: false, error: "L'elemento non c'è più (cancellato o archiviato)." };
  if (!forza && ora !== valoreDopo(v, rif)) {
    return { ok: false, error: "Nel frattempo il valore è stato cambiato di nuovo.", ora: leggibile(rif, ora) };
  }

  const prima = rif.vPrima ?? v.prima ?? "";
  let r: { ok: boolean; error?: string };
  switch (rif.tipo) {
    case "zoo-padre-testo": r = await updateParentFieldInline(rif.id, rif.campo, rif.scope, prima); break;
    case "zoo-animale": r = await setParentAnimaliInline(rif.id, prima.split(", ").filter(Boolean)); break;
    case "zoo-tipologia": r = await setTipologiaInline(rif.id, rif.padre, prima); break;
    case "zoo-offerta": r = await updateOfferFieldInline(rif.id, rif.campo, prima); break;
    case "zoo-articolo": r = await updateProductFieldInline(rif.id, "descrizione", prima); break;
    case "zoo-deadline": {
      const fd = new FormData();
      fd.set("deadline", prima);
      r = await salvaDeadlineGrafico(rif.id, fd);
      break;
    }
    case "zoo-foto": {
      // si rimette la foto dove era stata tolta (solo dove ora non ce n'è un'altra)
      const db = await getZooDb();
      const parent = rif.padre ? db.parents.find((x) => x.id === rif.padre) : undefined;
      if (parent && (!parent.image || forza)) parent.image = prima;
      for (const aid of rif.articoli) {
        const a = db.products.find((x) => x.id === aid);
        if (a && (!a.image || forza)) a.image = prima;
      }
      await saveZooDb(db);
      registra(user, { area: "zoo", cosa: "Foto rimessa (ripristino)", oggetto: v.oggetto, dopo: prima });
      r = { ok: true };
      break;
    }
    case "arredo-campo": r = await autosaveField(rif.id, rif.campo, rif.scope, prima); break;
    case "utente-ruolo": r = await quickSetRole(rif.id, rif.prima as Role); break;
    case "utente-aree": r = await quickSetSites(rif.id, rif.prima as SiteId[]); break;
    case "utente-attivo": {
      const db = await getDb();
      const u = db.users.find((x) => x.id === rif.id);
      r = u && (u.active !== false) !== rif.prima ? await quickToggleActive(rif.id) : { ok: true };
      break;
    }
  }
  if (!r.ok) return { ok: false, error: r.error ?? "Ripristino non riuscito." };
  await segnaRipristinata(v.id!, v.il, `${user.firstName} ${user.lastName}`.trim());
  return { ok: true };
}
