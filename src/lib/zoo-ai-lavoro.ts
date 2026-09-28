import { getZooDb, saveZooDb, type ZooDB, type ZooParent } from "./zoo";
import { groupAndDescribe, type AiGroup } from "./zoo-ai";

/*
 * "Associa tutti con l'AI" in background: il pulsante risponde subito, il
 * lavoro continua dopo la risposta (after() di Next) e lo stato sta nel
 * database, così la pagina mostra l'avanzamento.
 *
 * Veloce per due motivi:
 *  - 4 lotti alla volta verso Claude invece di uno dopo l'altro (un lotto da
 *    30 articoli impiega ~30 s: in fila erano 10 minuti per 600 articoli);
 *  - quando il tempo di una funzione (300 s) sta per finire, il lavoro riparte
 *    da solo chiamando /api/zoo/associa-continua: prima si doveva ripremere
 *    il pulsante, e fra un giro e l'altro passavano minuti.
 *
 * Le chiamate a Claude vanno in parallelo, ma i salvataggi uno alla volta: ogni
 * lotto rilegge il database, applica i suoi padri e salva subito, così i lotti
 * non si sovrascrivono fra loro e chi lavora sulle offerte non perde niente.
 */

export interface LavoroAi {
  stato: "in corso" | "finito" | "errore";
  inizio: string;
  /** Ultimo segno di vita (un lotto salvato, un giro ripartito). */
  battito?: string;
  fine?: string;
  totale: number;
  fatti: number;
  padri: number;
  restanti?: number;
  errore?: string;
  campaignId?: string;
  /** Articoli ancora da fare, per il giro successivo. */
  daFare?: string[];
  giro?: number;
}

const LOTTO = 30;
const IN_PARALLELO = 4;
/** Dopo questo tempo non si avviano lotti nuovi: quelli partiti finiscono entro i 300 s della funzione. */
const BUDGET_MS = 190_000;
const GIRI_MASSIMI = 15;
/** Un lavoro "in corso" senza segni di vita da così tanto è morto con la funzione che lo eseguiva. */
export const LAVORO_SCADUTO_MS = 6 * 60_000;

export function lavoroAttivo(l?: LavoroAi): boolean {
  if (!l || l.stato !== "in corso") return false;
  return Date.now() - new Date(l.battito ?? l.inizio).getTime() < LAVORO_SCADUTO_MS;
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
  db.settings.aiLavoro = { ...(db.settings.aiLavoro as LavoroAi), ...patch, battito: new Date().toISOString() };
  await saveZooDb(db);
}

function siteUrl(): string {
  return (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
}

/** Fa ripartire il lavoro in una funzione nuova (e con 300 s nuovi). Ritorna false se non si può. */
async function riparti(): Promise<boolean> {
  const segreto = process.env.CRON_SECRET;
  if (!segreto) return false;
  try {
    const r = await fetch(`${siteUrl()}/api/zoo/associa-continua`, {
      method: "POST",
      headers: { Authorization: `Bearer ${segreto}` },
      signal: AbortSignal.timeout(20_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Un giro di lavoro: fino a 4 lotti da 30 articoli alla volta, finché c'è
 * tempo; si ferma al primo errore dell'AI. Se resta qualcosa riparte da solo.
 */
export async function eseguiAssociazione(apiKey: string, productIds: string[]): Promise<void> {
  const partenza = Date.now();
  const iniziale = (await getZooDb()).settings.aiLavoro;
  let fatti = iniziale?.fatti ?? 0;
  let padri = iniziale?.padri ?? 0;
  const lotti: string[][] = [];
  for (let i = 0; i < productIds.length; i += LOTTO) lotti.push(productIds.slice(i, i + LOTTO));
  const completati = new Set<number>();
  let errore: string | undefined;
  let prossimo = 0;
  // i salvataggi passano da qui uno alla volta
  let coda: Promise<unknown> = Promise.resolve();
  const salvaInOrdine = (fn: () => Promise<void>) => { const p = coda.then(fn); coda = p.catch(() => undefined); return p; };

  const lavoratore = async () => {
    while (!errore && prossimo < lotti.length && Date.now() - partenza < BUDGET_MS) {
      const n = prossimo++;
      const ids = lotti[n];
      const snapshot = await getZooDb();
      const lotto = snapshot.products.filter((p) => ids.includes(p.id) && !p.parentId);
      if (lotto.length > 0) {
        const res = await groupAndDescribe(apiKey, lotto, snapshot.settings);
        if (!res.usedAi) {
          // chiave rifiutata, credito finito, modello non disponibile: meglio fermarsi che riempire il database di bozze
          errore = res.error ?? "L'AI non ha risposto";
          return;
        }
        await salvaInOrdine(async () => {
          const db = await getZooDb();
          padri += applicaGruppi(db, res.groups);
          fatti += ids.length;
          db.settings.aiLavoro = { ...(db.settings.aiLavoro as LavoroAi), fatti, padri, battito: new Date().toISOString() };
          await saveZooDb(db);
        });
      } else {
        fatti += ids.length;
      }
      completati.add(n);
    }
  };

  try {
    await Promise.all(Array.from({ length: IN_PARALLELO }, lavoratore));
    await coda;
    const daFare = lotti.filter((_, i) => !completati.has(i)).flat();
    if (errore) {
      await scriviStato({ stato: "errore", fine: new Date().toISOString(), fatti, padri, errore, daFare, restanti: daFare.length });
      return;
    }
    if (daFare.length === 0) {
      await scriviStato({ stato: "finito", fine: new Date().toISOString(), fatti, padri, restanti: 0, daFare: undefined });
      return;
    }
    // resta del lavoro: si riparte da soli, con un giro nuovo
    const giro = (iniziale?.giro ?? 1) + 1;
    if (giro > GIRI_MASSIMI) {
      await scriviStato({ stato: "finito", fine: new Date().toISOString(), fatti, padri, daFare, restanti: daFare.length });
      return;
    }
    await scriviStato({ stato: "in corso", fatti, padri, daFare, restanti: daFare.length, giro });
    if (!(await riparti())) {
      await scriviStato({ stato: "finito", fine: new Date().toISOString(), restanti: daFare.length });
    }
  } catch (e) {
    await scriviStato({ stato: "errore", fine: new Date().toISOString(), fatti, padri, errore: e instanceof Error ? e.message : String(e) });
  }
}
