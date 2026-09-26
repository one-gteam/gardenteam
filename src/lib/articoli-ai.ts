import Anthropic from "@anthropic-ai/sdk";
import { getZooDb } from "./zoo";

/*
 * "Scrivi la descrizione con l'AI": dal titolo, da quello che c'è già scritto
 * e dagli allegati (PDF e immagini letti direttamente dal modello) esce un
 * testo breve, pronto da correggere. La chiave è quella del Consorzio, la
 * stessa delle Offerte Zoo.
 */

interface Documento {
  nome: string;
  tipo: string;
  bytes: Buffer;
}

type Blocco =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title?: string };

const IMMAGINI = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_BYTES = 20 * 1024 * 1024;

export async function descrizioneConAi(dati: {
  titolo: string;
  testo?: string;
  link?: string[];
  documenti?: Documento[];
}): Promise<{ ok: true; testo: string } | { ok: false; errore: string }> {
  // la chiave delle Impostazioni Zoo; in mancanza, quella dell'ambiente (ANTHROPIC_API_KEY su Vercel)
  const zoo = await getZooDb();
  const apiKey = zoo.settings.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, errore: "Manca la chiave API Claude: la imposta l'amministratore di sistema nelle Impostazioni Zoo." };

  const blocchi: Blocco[] = [];
  for (const d of dati.documenti ?? []) {
    if (d.bytes.length > MAX_BYTES) continue;
    if (d.tipo === "application/pdf") {
      blocchi.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d.bytes.toString("base64") }, title: d.nome });
    } else if (IMMAGINI.has(d.tipo)) {
      blocchi.push({ type: "image", source: { type: "base64", media_type: d.tipo as "image/jpeg", data: d.bytes.toString("base64") } });
    }
  }
  const richiesta = [
    `Titolo dell'articolo: ${dati.titolo || "(senza titolo)"}`,
    dati.testo ? `Appunti già scritti dall'autore:\n${dati.testo}` : "",
    dati.link?.length ? `Link collegati:\n${dati.link.join("\n")}` : "",
    "",
    "Scrivi la descrizione dell'articolo per il portale interno del Consorzio Garden Team (garden center, personale dei punti vendita).",
    "Regole: italiano, tono chiaro e diretto, 60-140 parole, niente saluti né firme, niente frasi di apertura tipo \"questo articolo\".",
    "Di' cosa contiene il documento e perché serve a chi lavora in negozio; se ci sono date, scadenze, prezzi o numeri importanti, riportali.",
    "Rispondi solo con il testo, in HTML semplice: paragrafi <p>, eventuale elenco <ul><li>, grassetto <b> per le cose da non perdere. Niente titoli.",
  ].filter(Boolean).join("\n");
  blocchi.push({ type: "text", text: richiesta });

  try {
    const client = new Anthropic({ apiKey });
    const risposta = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 800,
      system: "Sei l'assistente del Consorzio Garden Team. Scrivi testi brevi e utili per il personale dei garden center.",
      messages: [{ role: "user", content: blocchi as never }],
    });
    const text = risposta.content.find((b) => b.type === "text");
    if (!text || text.type !== "text" || !text.text.trim()) return { ok: false, errore: "Il modello non ha risposto." };
    return { ok: true, testo: text.text.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `Chiamata all'AI non riuscita: ${msg.slice(0, 200)}` };
  }
}
