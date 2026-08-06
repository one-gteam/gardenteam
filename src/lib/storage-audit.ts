import { STORAGE_BUCKET, supabase } from "./supabase";
import { getDb } from "./db";
import { getStampeDb } from "./stampe";
import { getZooDb } from "./zoo";
import { User } from "./types";

/** Cartelle di primo livello del bucket, con etichetta e chi le può ripulire. */
export const CARTELLE: { id: string; label: string; nota: string }[] = [
  { id: "uploads", label: "Copertine, allegati e sfondi", nota: "Immagini dei corsi, materiali delle lezioni, sfondi e loghi dei cartelli" },
  { id: "loghi", label: "Loghi consorzio e insegne", nota: "Loghi caricati dalle schede Consorzio e Insegna" },
  { id: "zoo-foto", label: "Foto prodotti Zoo", nota: "Foto caricate nel database prodotti Offerte Zoo" },
  { id: "volantino", label: "Immagini del volantino", nota: "Immagini inserite nelle celle di Crea Volantino" },
  { id: "scorm", label: "Pacchetti SCORM", nota: "File dei contenuti SCORM caricati nelle lezioni" },
];

export interface StoredFile {
  path: string;
  cartella: string;
  nome: string;
  sizeKb: number;
  modificato: string; // ISO
  usato: boolean;
  recente: boolean; // caricato da meno di 24 ore: protetto per sicurezza
}

/** Cartelle che un utente può ripulire, in base al ruolo. */
export function cartelleGestibili(user: User): string[] {
  if (user.role === "system_admin" || user.role === "course_manager") return CARTELLE.map((c) => c.id);
  if (user.role === "zoo_manager") return ["zoo-foto", "volantino"];
  if (user.role === "group_admin") return ["uploads"];
  return [];
}

export function puoVedereArchivio(user: User): boolean {
  return ["system_admin", "course_manager", "zoo_manager", "group_admin"].includes(user.role);
}

/** Elenca ricorsivamente i file sotto un prefisso (le cartelle hanno id nullo). */
async function listaRicorsiva(prefix: string): Promise<{ path: string; sizeKb: number; modificato: string }[]> {
  const { data, error } = await supabase().storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 });
  if (error) return [];
  const out: { path: string; sizeKb: number; modificato: string }[] = [];
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) {
      const size = (item.metadata as { size?: number } | null)?.size ?? 0;
      out.push({
        path,
        sizeKb: Math.round(size / 1024),
        modificato: item.updated_at ?? item.created_at ?? "",
      });
    } else {
      out.push(...(await listaRicorsiva(path)));
    }
  }
  return out;
}

/**
 * Stato di tutti i file del bucket.
 *
 * Un file è considerato IN USO se il suo percorso — o una qualsiasi cartella che
 * lo contiene — compare nel JSON di uno dei tre database. Il confronto è sul
 * testo completo, non su un elenco di campi noti: così un riferimento aggiunto
 * in futuro (o in un campo che qui non conosciamo) protegge comunque il file.
 * I percorsi delle cartelle servono ai pacchetti SCORM, dove il database
 * registra solo la cartella e non i singoli file al suo interno.
 */
export async function analizzaArchivio(): Promise<StoredFile[]> {
  const [academyDb, stampeDb, zooDb] = await Promise.all([getDb(), getStampeDb(), getZooDb()]);
  const riferimenti = JSON.stringify(academyDb) + JSON.stringify(stampeDb) + JSON.stringify(zooDb);
  const limiteRecente = Date.now() - 24 * 60 * 60 * 1000;

  const files = (await Promise.all(CARTELLE.map((c) => listaRicorsiva(c.id)))).flat();

  return files
    .map((f) => {
      // Il percorso completo, o una sottocartella che lo contiene, risulta citato?
      // La cartella di primo livello è esclusa: parole come "volantino" o "uploads"
      // compaiono nei dati per tante altre ragioni e renderebbero tutto "in uso".
      const parti = f.path.split("/");
      const candidati = parti.slice(1).map((_, i) => parti.slice(0, i + 2).join("/"));
      const usato = candidati.some((p) => riferimenti.includes(p));
      const ts = f.modificato ? new Date(f.modificato).getTime() : 0;
      return {
        ...f,
        cartella: parti[0],
        nome: parti.slice(1).join("/") || parti[0],
        usato,
        recente: ts > limiteRecente,
      };
    })
    .sort((a, b) => Number(a.usato) - Number(b.usato) || b.sizeKb - a.sizeKb);
}
