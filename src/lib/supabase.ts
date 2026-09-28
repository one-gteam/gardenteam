import { fondi } from "./fusione";
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

/*
 * Copia in memoria dei blob, per istanza del server. Ogni lettura chiede
 * comunque al database se il blob è cambiato (updated_at diverso da quello in
 * memoria): se sì arriva il blob nuovo, se no non arriva niente e si usa la
 * copia. Una modifica fatta da qualunque istanza si vede quindi subito, ma il
 * blob dello Zoo (~1,4 MB) non viaggia a ogni pagina. Chi legge riceve una copia
 * sua, perché il codice modifica gli oggetti letti prima di salvarli.
 */
const memoria = new Map<string, { updatedAt: string; data: unknown }>();

/*
 * Per ogni oggetto letto: la versione del database da cui viene e com'era.
 * Al salvataggio serve a capire se nel frattempo qualcun altro ha salvato e,
 * in quel caso, a unire le due modifiche invece di cancellare la sua.
 */
const letture = new WeakMap<object, { updatedAt: string; base: unknown }>();

/** Chi ricostruisce l'oggetto letto (valori di default, ecc.) gli passa la versione da cui viene. */
export function stessaLettura(letto: unknown, nuovo: object): void {
  const l = letto && typeof letto === "object" ? letture.get(letto as object) : undefined;
  if (l) letture.set(nuovo, l);
}

function consegna<T>(domain: string, updatedAt: string, data: unknown): T {
  const copia = structuredClone(data) as T;
  if (copia && typeof copia === "object") letture.set(copia as object, { updatedAt, base: data });
  return copia;
}

/** Legge il blob JSON di un dominio ('academy' | 'stampe' | 'zoo'). */
export async function readDomain<T>(domain: string, empty: T): Promise<T> {
  const noto = memoria.get(domain);
  if (noto) {
    const { data, error } = await supabase()
      .from(APP_DATA_TABLE)
      .select("data, updated_at")
      .eq("domain", domain)
      .neq("updated_at", noto.updatedAt)
      .maybeSingle();
    if (error) throw new Error(`Lettura Supabase (${domain}) fallita: ${error.message}`);
    if (!data) return consegna<T>(domain, noto.updatedAt, noto.data);
    memoria.set(domain, { updatedAt: data.updated_at as string, data: data.data });
    return consegna<T>(domain, data.updated_at as string, data.data);
  }
  const { data, error } = await supabase()
    .from(APP_DATA_TABLE)
    .select("data, updated_at")
    .eq("domain", domain)
    .maybeSingle();
  if (error) throw new Error(`Lettura Supabase (${domain}) fallita: ${error.message}`);
  if (!data) return empty;
  if (!data.updated_at) return structuredClone(data.data) as T;
  memoria.set(domain, { updatedAt: data.updated_at as string, data: data.data });
  return consegna<T>(domain, data.updated_at as string, data.data);
}

/**
 * Scrive il blob di un dominio. Se l'oggetto viene da una lettura, si scrive
 * solo se nel database c'è ancora quella versione; se nel frattempo qualcuno
 * ha salvato, si uniscono le due modifiche (lib/fusione) e si riprova. Prima
 * vinceva sempre l'ultimo e l'altra modifica spariva senza avviso.
 */
export async function writeDomain<T>(domain: string, value: T): Promise<void> {
  const letta = value && typeof value === "object" ? letture.get(value as object) : undefined;
  if (!letta) {
    const updatedAt = new Date().toISOString();
    const { error } = await supabase()
      .from(APP_DATA_TABLE)
      .upsert({ domain, data: value, updated_at: updatedAt }, { onConflict: "domain" });
    if (error) {
      memoria.delete(domain);
      throw new Error(`Scrittura Supabase (${domain}) fallita: ${error.message}`);
    }
    memoria.set(domain, { updatedAt, data: structuredClone(value) });
    return;
  }

  let daScrivere: unknown = value;
  let versione = letta.updatedAt;
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    const updatedAt = new Date().toISOString();
    const { data: scritte, error } = await supabase()
      .from(APP_DATA_TABLE)
      .update({ data: daScrivere, updated_at: updatedAt })
      .eq("domain", domain)
      .eq("updated_at", versione)
      .select("updated_at");
    if (error) {
      memoria.delete(domain);
      throw new Error(`Scrittura Supabase (${domain}) fallita: ${error.message}`);
    }
    if (scritte && scritte.length > 0) {
      memoria.set(domain, { updatedAt, data: structuredClone(daScrivere) });
      if (daScrivere !== value) {
        // chi ha in mano l'oggetto deve vedere anche le modifiche degli altri, se salva ancora
        const radice = value as Record<string, unknown>;
        for (const k of Object.keys(radice)) delete radice[k];
        Object.assign(radice, structuredClone(daScrivere));
      }
      letture.set(value as object, { updatedAt, base: structuredClone(daScrivere) });
      return;
    }
    // qualcuno ha salvato nel frattempo: si prende la sua versione e ci si riapplicano le mie modifiche
    const { data: attuale, error: errLettura } = await supabase()
      .from(APP_DATA_TABLE)
      .select("data, updated_at")
      .eq("domain", domain)
      .maybeSingle();
    if (errLettura) throw new Error(`Lettura Supabase (${domain}) fallita: ${errLettura.message}`);
    if (!attuale) {
      // la riga non c'è (dominio nuovo): si crea
      await supabase().from(APP_DATA_TABLE).upsert({ domain, data: value, updated_at: updatedAt }, { onConflict: "domain" });
      memoria.set(domain, { updatedAt, data: structuredClone(value) });
      letture.set(value as object, { updatedAt, base: structuredClone(value) });
      return;
    }
    daScrivere = fondi(letta.base, value, attuale.data);
    versione = attuale.updated_at as string;
  }
  throw new Error(`Salvataggio (${domain}) non riuscito: troppe modifiche contemporanee, riprova.`);
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

/**
 * URL firmato per caricare UN file direttamente dal browser a Supabase Storage,
 * bypassando il server: le funzioni serverless di Vercel hanno un limite di
 * dimensione del body in ingresso (pochi MB) che un caricamento massivo di foto
 * ad alta risoluzione supera facilmente. Il token è nell'URL stesso: basta un
 * PUT diretto (nessuna chiave pubblica da esporre al browser).
 */
export async function createSignedUploadUrl(path: string): Promise<string> {
  const { data, error } = await supabase().storage.from(STORAGE_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(`URL di caricamento firmato fallito (${path}): ${error.message}`);
  return data.signedUrl;
}

/** Elenca i nomi dei file presenti in una "cartella" del bucket (es. per l'associazione manuale delle foto). */
export async function listStorageFiles(prefix: string): Promise<string[]> {
  const { data, error } = await supabase().storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`Lista Supabase Storage fallita (${prefix}): ${error.message}`);
  return (data ?? []).filter((f) => f.id).map((f) => f.name);
}
