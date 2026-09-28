/*
 * Fusione a tre vie di due salvataggi contemporanei dello stesso blob.
 *
 * base   = il blob com'era quando l'ho letto
 * mio    = il blob con le mie modifiche
 * loro   = il blob com'è adesso nel database (qualcun altro ha salvato nel frattempo)
 *
 * Il risultato parte da "loro" e ci riapplica solo quello che IO ho cambiato
 * rispetto a "base". Così due persone che toccano cose diverse (due offerte,
 * due campi, due articoli) non si cancellano più a vicenda. Se toccano lo
 * stesso campo vince l'ultimo salvataggio, come prima.
 *
 * Negli elenchi di oggetti con un "id" le voci si confrontano per id (aggiunte,
 * tolte, modificate); negli altri elenchi per contenuto.
 */

type Json = unknown;

function uguali(a: Json, b: Json): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function oggetto(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function idDi(v: Json): string | undefined {
  return oggetto(v) && typeof v.id === "string" && v.id ? v.id : undefined;
}

/** Tutti gli elementi hanno un id, e gli id non si ripetono. */
function elencoConId(...elenchi: Json[][]): boolean {
  for (const e of elenchi) {
    const visti = new Set<string>();
    for (const x of e) {
      const id = idDi(x);
      if (!id || visti.has(id)) return false;
      visti.add(id);
    }
  }
  return true;
}

function fondiElenchi(base: Json[], mio: Json[], loro: Json[]): Json[] {
  if (elencoConId(base, mio, loro)) {
    const baseId = new Map(base.map((x) => [idDi(x)!, x]));
    const mioId = new Map(mio.map((x) => [idDi(x)!, x]));
    const loroId = new Set(loro.map((x) => idDi(x)!));
    const out: Json[] = [];
    for (const x of loro) {
      const id = idDi(x)!;
      const inBase = baseId.has(id);
      if (inBase && !mioId.has(id)) {
        // l'ho tolta io: resta tolta, a meno che loro l'abbiano cambiata nel frattempo
        if (uguali(x, baseId.get(id))) continue;
        out.push(x);
        continue;
      }
      out.push(mioId.has(id) ? fondi(baseId.get(id), mioId.get(id), x) : x);
    }
    // le mie aggiunte, nella posizione che hanno nel mio elenco
    mio.forEach((x, i) => {
      const id = idDi(x)!;
      if (baseId.has(id) || loroId.has(id)) return;
      out.splice(Math.min(i, out.length), 0, x);
    });
    return out;
  }
  // elenchi senza id: per contenuto
  const chiave = (x: Json) => JSON.stringify(x);
  const inBase = new Map<string, number>();
  for (const x of base) inBase.set(chiave(x), (inBase.get(chiave(x)) ?? 0) + 1);
  const inMio = new Map<string, number>();
  for (const x of mio) inMio.set(chiave(x), (inMio.get(chiave(x)) ?? 0) + 1);
  const tolti = new Map<string, number>();
  for (const [k, n] of inBase) {
    const d = n - (inMio.get(k) ?? 0);
    if (d > 0) tolti.set(k, d);
  }
  const aggiunti: Json[] = [];
  const contati = new Map<string, number>();
  for (const x of mio) {
    const k = chiave(x);
    contati.set(k, (contati.get(k) ?? 0) + 1);
    if (contati.get(k)! > (inBase.get(k) ?? 0)) aggiunti.push(x);
  }
  const out: Json[] = [];
  for (const x of loro) {
    const k = chiave(x);
    const t = tolti.get(k) ?? 0;
    if (t > 0) { tolti.set(k, t - 1); continue; }
    out.push(x);
  }
  return [...out, ...aggiunti];
}

export function fondi(base: Json, mio: Json, loro: Json): Json {
  if (uguali(mio, base)) return loro; // io non ho cambiato niente qui
  if (uguali(loro, base)) return mio; // loro non hanno cambiato niente qui
  if (oggetto(base) && oggetto(mio) && oggetto(loro)) {
    const out: Record<string, Json> = { ...loro };
    const chiavi = new Set([...Object.keys(base), ...Object.keys(mio)]);
    for (const k of chiavi) {
      const inBase = k in base, inMio = k in mio, inLoro = k in loro;
      if (inBase && !inMio) {
        // l'ho tolta io: via, salvo che loro l'abbiano cambiata
        if (!inLoro || uguali(loro[k], base[k])) delete out[k];
        continue;
      }
      if (!inBase) { out[k] = inLoro ? fondi(undefined, mio[k], loro[k]) : mio[k]; continue; }
      if (!inLoro) {
        // l'hanno tolta loro: resta tolta, salvo che io l'abbia cambiata
        if (!uguali(mio[k], base[k])) out[k] = mio[k];
        continue;
      }
      out[k] = fondi(base[k], mio[k], loro[k]);
    }
    return out;
  }
  if (Array.isArray(base) && Array.isArray(mio) && Array.isArray(loro)) return fondiElenchi(base, mio, loro);
  return mio; // stesso campo cambiato da entrambi: vince l'ultimo salvataggio
}
