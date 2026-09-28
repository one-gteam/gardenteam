import { firmaPer, firmaValida } from "./auth";

/*
 * Accesso ai file di un pacchetto SCORM senza sessione: il pacchetto gira in
 * un iframe isolato (origine "opaca", niente biscotti del sito), quindi i suoi
 * file non possono essere protetti dal login. Li protegge un gettone firmato
 * nel percorso, valido per quel pacchetto e per poche ore; i percorsi relativi
 * dentro al pacchetto se lo portano dietro da soli.
 */

export interface AccessoScorm {
  p: string; // prefisso del pacchetto nello storage (es. "scorm/l_123_456")
  e: number; // scadenza (ms)
  c: string; // canale dei messaggi verso la pagina del corso
  v: "1.2" | "2004";
  n: string; // nome dello studente, per cmi.learner_name
}

const ORE = 8;

export function gettoneScorm(p: string, v: AccessoScorm["v"], nome: string, canale: string): string {
  const dati: AccessoScorm = { p, e: Date.now() + ORE * 3600_000, c: canale, v, n: nome.slice(0, 80) };
  const corpo = Buffer.from(JSON.stringify(dati)).toString("base64url");
  return `${corpo}.${firmaPer("scorm", corpo)}`;
}

export function leggiGettoneScorm(gettone: string): AccessoScorm | null {
  const punto = gettone.lastIndexOf(".");
  if (punto <= 0) return null;
  const corpo = gettone.slice(0, punto);
  if (!firmaValida("scorm", corpo, gettone.slice(punto + 1))) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString()) as AccessoScorm;
    if (!d.p || !d.p.startsWith("scorm/") || !(d.e > Date.now())) return null;
    return d;
  } catch {
    return null;
  }
}
