"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { getZooDb, saveZooDb } from "./zoo";

/*
 * La chiave API Claude comune (Zoo "Associa con AI", descrizioni degli
 * Articoli): la imposta solo l'amministratore di sistema, da Utenti e ruoli →
 * Organizzazione. Si salva solo dopo che Anthropic l'ha accettata, così una
 * chiave sbagliata non arriva a rompere i pulsanti AI; dal browser non torna
 * mai indietro (si vedono solo le ultime cifre).
 */

type Esito = { ok: boolean; error?: string };

/** Le prova con Anthropic: risponde con l'esito in parole. */
async function verifica(chiave: string): Promise<Esito> {
  try {
    // la stessa chiamata dei pulsanti AI, ridotta all'osso (un token): prova davvero quello che serve
    const client = new Anthropic({ apiKey: chiave });
    await client.messages.create({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "ok" }] });
    return { ok: true, error: "Chiave valida: Claude risponde." };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) return { ok: false, error: "Anthropic rifiuta la chiave (non valida o revocata): copiala di nuovo dalla console Anthropic." };
    if (err.status === 403) return { ok: false, error: "La chiave è valida ma non ha i permessi necessari (403)." };
    if (err.status === 429) return { ok: true, error: "Chiave accettata, ma al momento ha raggiunto il limite di richieste." };
    if (/not scoped to a workspace/i.test(err.message ?? "")) {
      return { ok: false, error: "Questa chiave non appartiene a nessun workspace, e Anthropic la rifiuta per le richieste a Claude. Nella console Anthropic apri un workspace (anche «Default»), crea lì una chiave API e incollala qui." };
    }
    if (err.status === 400 && /credit balance/i.test(err.message ?? "")) return { ok: false, error: "Chiave valida ma senza credito: ricarica il credito nella console Anthropic (Billing)." };
    return { ok: false, error: `Non riesco a verificarla: ${(err.message ?? String(e)).slice(0, 160)}` };
  }
}

export async function salvaChiaveClaude(fd: FormData): Promise<Esito> {
  const user = await requireUser();
  if (user.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema imposta la chiave." };
  const chiave = String(fd.get("chiave") ?? "").trim();
  if (!chiave) return { ok: true }; // campo vuoto = tieni quella salvata
  if (!/^sk-ant-/.test(chiave)) return { ok: false, error: "Non sembra una chiave Anthropic: inizia con «sk-ant-»." };
  const esito = await verifica(chiave);
  if (!esito.ok) return esito;
  const db = await getZooDb();
  db.settings.apiKey = chiave;
  await saveZooDb(db);
  revalidatePath("/ruoli/organizzazione");
  revalidatePath("/stampe/zoo/impostazioni");
  return { ok: true, error: `Salvata. ${esito.error ?? ""}`.trim() };
}

export async function provaChiaveClaude(): Promise<Esito> {
  const user = await requireUser();
  if (user.role !== "system_admin") return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const chiave = db.settings.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!chiave) return { ok: false, error: "Nessuna chiave impostata." };
  return verifica(chiave);
}

export async function togliChiaveClaude(): Promise<Esito> {
  const user = await requireUser();
  if (user.role !== "system_admin") return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  db.settings.apiKey = undefined;
  await saveZooDb(db);
  revalidatePath("/ruoli/organizzazione");
  revalidatePath("/stampe/zoo/impostazioni");
  return { ok: true };
}
