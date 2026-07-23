import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase lato server (service_role): usato SOLO dentro Server Components,
 * Server Actions e Route Handlers — mai importato da codice che finisce nel bundle
 * del browser. La service_role key bypassa la Row Level Security della tabella
 * app_data, quindi ogni pagina/azione deve già filtrare l'accesso a livello
 * applicativo (come fa oggi con canAccessStampe/isConsortiumEditor eccetera):
 * questo client non introduce un secondo livello di permessi.
 */
let client: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti: copia .env.example in .env.local e compila con i valori del progetto Supabase (Project Settings → API)."
    );
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export const STORAGE_BUCKET = "academy-gt";

/** Nome fisso della tabella dove viene salvato l'intero oggetto JSON di ogni dominio. */
export const APP_DATA_TABLE = "app_data";

/** Legge il blob JSON di un dominio ('academy' | 'stampe' | 'zoo'). */
export async function readDomain<T>(domain: string, empty: T): Promise<T> {
  const { data, error } = await supabase()
    .from(APP_DATA_TABLE)
    .select("data")
    .eq("domain", domain)
    .maybeSingle();
  if (error) throw new Error(`Lettura Supabase (${domain}) fallita: ${error.message}`);
  return (data?.data as T) ?? empty;
}

/** Scrive (sovrascrivendo) il blob JSON di un dominio. */
export async function writeDomain<T>(domain: string, value: T): Promise<void> {
  const { error } = await supabase()
    .from(APP_DATA_TABLE)
    .upsert({ domain, data: value, updated_at: new Date().toISOString() }, { onConflict: "domain" });
  if (error) throw new Error(`Scrittura Supabase (${domain}) fallita: ${error.message}`);
}

/** Carica un file nel bucket condiviso e ritorna l'URL pubblico. */
export async function uploadPublicFile(path: string, bytes: Buffer, contentType: string): Promise<string> {
  const { error } = await supabase()
    .storage.from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Upload Supabase Storage fallito (${path}): ${error.message}`);
  return publicUrlFor(path);
}

/** URL pubblico di un file già caricato nel bucket, senza ricaricarlo. */
export function publicUrlFor(path: string): string {
  const { data } = supabase().storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Elenca i nomi dei file presenti in una "cartella" del bucket (es. per l'associazione manuale delle foto). */
export async function listStorageFiles(prefix: string): Promise<string[]> {
  const { data, error } = await supabase().storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`Lista Supabase Storage fallita (${prefix}): ${error.message}`);
  return (data ?? []).filter((f) => f.id).map((f) => f.name);
}
