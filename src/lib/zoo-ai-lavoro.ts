import { getZooDb, saveZooDb, type ZooDB, type ZooParent } from "./zoo";
import { groupAndDescribe, type AiGroup } from "./zoo-ai";

/*
 * "Associa tutti con l'AI" in background: il pulsante risponde subito, il
 * lavoro continua dopo la risposta (after() di Next) e lo stato sta nel
 * database, così la pagina mostra l'avanzamento. Si salva lotto per lotto:
 * la chiamata a Claude (lenta) avviene senza tenere il database in mano, poi
 * si rilegge, si applica e si salva subito — chi nel frattempo lavora sulle
 * offerte non perde le sue modifiche. Prima tutto girava in una sola richiesta
 * da 60 secondi: con quattro lotti Vercel la chiudeva a metà e non restava niente.
 */

export interface LavoroAi {
  stato: "in corso" | "finito" | "errore";
  inizio: string;
  fine?: string;
  totale: number;
  fatti: number;
  padri: number;
  restanti?: number;
  errore?: string;
  campaignId?: string;
}

const LOTTO = 30;
/** Tempo di lavoro per giro: la funzione ha 300 s, si tiene margine per l'ultimo salvataggio. */
const BUDGET_MS = 230_000;
/** Un lavoro "in corso" più vecchio di così è morto con la funzione che lo eseguiva. */
export const LAVORO_SCADUTO_MS = 6 * 60_000;

export function lavoroAttivo(l?: LavoroAi): boolean {
  return !!l && l.stato === "in corso" && Date.now() - new Date(l.inizio).getTime() < LAVORO_SCADUTO_MS;
}

function applicaGruppi(db: ZooDB, groups: AiGroup[]): number {
  let creati = 0;
  for (const g of groups) {
    // solo articoli ancora senza padre: nel frattempo qualcuno può averli raggruppati a mano
    const figli = db.products.filter((p) => g.eans.includes(p.ean) && !p.parentId);
    if (figli.length === 0) continue;
    const id = `zp_${Date.now()}_${creati}_${Math.random().toString(36).slice(2, 5)}`;
    const padre: ZooParent = {
      id,
      nome: g.nome,
      descVolantino: g.descVolantino,
      descCartello: g.descCartello,
      caratteristiche: g.caratteristiche.filter((c) => db.settings.caratteristiche.includes(c)),
      image: figli.find((c) => c.image)?.image,
      aiGenerated: true,
    };
    db.parents.push(padre);
    for (const c of figli) c.parentId = id;
    for (const c of g.contenuti ?? []) {
      const figlio = figli.find((f) => f.ean === c.ean);
      if (figlio && !figlio.contenuto && c.quantita > 0 && (c.unita === "kg" || c.unita === "l")) {
        figlio.contenuto = { quantita: c.quantita, unita: c.unita };
      }
    }
    creati++;
  }
  return creati;
}

async function scriviStato(patch: Partial<LavoroAi>) {
  const db = await getZooDb();
  db.settings.aiLavoro = { ...(db.settings.aiLavoro as LavoroAi), ...patch };
  await saveZooDb(db);
}

/** Il lavoro vero: lotti da 30 articoli finché c'è tempo; si ferma al primo errore dell'AI. */
export async function eseguiAssociazione(apiKey: string, productIds: string[]): Promise<void> {
  const partenza = Date.now();
  let fatti = 0;
  let padri = 0;
  try {
    for (let i = 0; i < productIds.length; i += LOTTO) {
      if (Date.now() - partenza > BUDGET_MS) break;
      const idLotto = productIds.slice(i, i + LOTTO);
      const snapshot = await getZooDb();
      const lotto = snapshot.products.filter((p) => idLotto.includes(p.id) && !p.parentId);
      if (lotto.length > 0) {
        const res = await groupAndDescribe(apiKey, lotto, snapshot.settings);
        if (!res.usedAi) {
          // chiave rifiutata, credito finito, modello non disponibile: meglio fermarsi che riempire il database di bozze
          await scriviStato({ stato: "errore", fine: new Date().toISOString(), fatti, padri, errore: res.error ?? "L'AI non ha risposto" });
          return;
        }
        const db = await getZooDb();
        padri += applicaGruppi(db, res.groups);
        fatti += idLotto.length;
        db.settings.aiLavoro = { ...(db.settings.aiLavoro as LavoroAi), fatti, padri };
        await saveZooDb(db);
      } else {
        fatti += idLotto.length;
      }
    }
    const restanti = Math.max(0, productIds.length - fatti);
    await scriviStato({ stato: "finito", fine: new Date().toISOString(), fatti, padri, restanti });
  } catch (e) {
    await scriviStato({ stato: "errore", fine: new Date().toISOString(), fatti, padri, errore: e instanceof Error ? e.message : String(e) });
  }
}
