import type { GiacenzePV, StampeDB } from "./stampe";

/*
 * Arredo, «GT One legge»: il gestionale del punto vendita espone un indirizzo
 * con le quantità del magazzino e GT One lo legge (ogni mattina dal cron, o
 * a mano con «Leggi adesso» in Connettori). È il verso opposto dell'invio con
 * la chiave (/api/arredo-giacenze): il risultato finisce nello stesso posto.
 *
 * L'indirizzo risponde a una GET, senza parametri, in uno di questi modi:
 *   JSON  { "righe": [ { "codice": "AB123", "quantita": 4 } ] }
 *   JSON  { "quantita": { "AB123": 4 } }
 *   testo codice;quantita   (una riga per prodotto, con o senza intestazione)
 * Vale come «sostituisci»: quello che non c'è nella risposta va a zero.
 */

/** Indirizzo accettabile: https e non verso la rete interna di chi ospita GT One. */
export function indirizzoLetturaValido(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.startsWith("[")) return false; // IPv6 letterale: non serve, e si evita la rete interna
  return true;
}

function righeDa(testo: string, tipo: string): { codice: string; quantita: number }[] | null {
  const prova = tipo.includes("json") || /^\s*[[{]/.test(testo);
  if (prova) {
    let j: unknown;
    try { j = JSON.parse(testo); } catch { return null; }
    const o = j as { righe?: unknown; quantita?: unknown };
    const lista = Array.isArray(j) ? j : Array.isArray(o.righe) ? o.righe : null;
    if (lista) return lista.map((r) => ({ codice: String((r as { codice?: unknown })?.codice ?? "").trim(), quantita: Number((r as { quantita?: unknown })?.quantita) }));
    if (o.quantita && typeof o.quantita === "object") return Object.entries(o.quantita as Record<string, unknown>).map(([codice, q]) => ({ codice: codice.trim(), quantita: Number(q) }));
    return null;
  }
  return testo.split(/\r?\n/).map((l) => l.split(/[;,\t]/)).filter((c) => c.length >= 2)
    .map((c) => ({ codice: c[0].trim().replace(/^"|"$/g, ""), quantita: Number(c[1].trim().replace(",", ".")) }));
}

/**
 * Legge le quantità dall'indirizzo del PV e le scrive in `g` (non salva il
 * database: lo fa chi chiama). Ritorna l'esito in una riga, che resta anche
 * sul connettore; «OK…» se è andata.
 */
export async function leggiQuantitaArredo(db: StampeDB, g: GiacenzePV): Promise<string> {
  if (!g.url) return "Nessun indirizzo";
  if (!indirizzoLetturaValido(g.url)) return "Indirizzo non accettato (serve https verso internet)";
  const inizio = Date.now();
  let esito: string;
  try {
    const r = await fetch(g.url, { signal: AbortSignal.timeout(15000), cache: "no-store", redirect: "error", headers: { accept: "application/json, text/csv, text/plain" } });
    if (!r.ok) esito = `Risposta ${r.status} dal gestionale`;
    else {
      const testo = (await r.text()).slice(0, 5_000_000);
      const righe = righeDa(testo, r.headers.get("content-type") ?? "");
      if (!righe) esito = "Risposta non nel formato atteso (righe codice/quantità)";
      else {
        const codici = new Set(db.products.map((p) => p.codice));
        const buone = righe.filter((x) => x.codice && codici.has(x.codice) && Number.isFinite(x.quantita));
        if (buone.length === 0) esito = `Nessun codice del catalogo fra le ${righe.length} righe ricevute`;
        else {
          const nuove: Record<string, number> = {};
          for (const x of buone) nuove[x.codice] = Math.max(0, Math.floor(x.quantita));
          g.quantita = nuove;
          g.aggiornatoIl = new Date().toISOString();
          g.fonte = "lettura";
          esito = `OK in ${Date.now() - inizio} ms: ${buone.length} prodotti del catalogo su ${righe.length} righe`;
        }
      }
    }
  } catch (e) {
    esito = e instanceof Error && e.name === "TimeoutError" ? "Nessuna risposta entro 15 secondi" : "Gestionale non raggiungibile";
  }
  g.provatoIl = new Date().toISOString();
  g.esito = esito;
  return esito;
}

/** Il giro del mattino: legge tutti i PV con l'indirizzo acceso. */
export async function leggiTuttiArredo(db: StampeDB): Promise<{ letti: number; ok: number }> {
  let letti = 0, ok = 0;
  for (const g of db.giacenze) {
    if (!g.url || g.urlAttivo === false) continue;
    letti++;
    if ((await leggiQuantitaArredo(db, g)).startsWith("OK")) ok++;
  }
  return { letti, ok };
}
