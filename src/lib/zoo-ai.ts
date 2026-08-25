import Anthropic from "@anthropic-ai/sdk";
import { ZooProduct, ZooSettings } from "./zoo";

/* ================== Integrazione Claude API (Associa con AI) ==================
 * La chiave API è impostata dall'amministratore di sistema nelle Impostazioni Zoo.
 * Senza chiave si usa un raggruppamento euristico con testi bozza, da rivedere a mano.
 */

export interface AiGroup {
  nome: string;
  descVolantino: string;
  descCartello: string;
  caratteristiche: string[];
  eans: string[];
}

const GROUPS_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome commerciale del prodotto padre (senza gusto/formato)" },
          descVolantino: { type: "string" },
          descCartello: { type: "string" },
          caratteristiche: { type: "array", items: { type: "string" } },
          eans: { type: "array", items: { type: "string" }, description: "EAN degli articoli che appartengono a questo padre" },
        },
        required: ["nome", "descVolantino", "descCartello", "caratteristiche", "eans"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
} as const;

function productLine(p: ZooProduct): string {
  return `EAN ${p.ean} | ${p.codice} | ${p.marca} | ${p.fornitore} | ${p.categoria ?? ""} | ${p.descrizione}`;
}

function buildPrompt(products: ZooProduct[], settings: ZooSettings, singleGroup: boolean): string {
  return [
    singleGroup
      ? "Questi articoli sono varianti (gusto/formato) dello STESSO prodotto. Restituisci UN SOLO gruppo che li contiene tutti."
      : "Raggruppa questi articoli zoo/pet in prodotti \"padre\": stesse linee di prodotto che differiscono solo per gusto, formato o taglia vanno nello stesso gruppo. Non unire marche o linee diverse.",
    "",
    "Per ogni gruppo genera QUATTRO campi. Anche con una descrizione di partenza povera (es. solo \"Tonnetto\"),",
    "usa marca/fornitore/categoria dell'articolo per scrivere comunque un testo commerciale completo: non limitarti",
    "a ripetere la marca da sola.",
    "",
    `1) "nome" = il TITOLO del prodotto padre, massimo 20 caratteri, senza gusto/formato. Regole e esempi (sezione TITOLO):`,
    settings.istruzioniVolantino,
    "",
    `2) "descVolantino" = la DESCRIZIONE per il volantino, massimo 75 caratteri. Regole e esempi (sezione DESCRIZIONE, stesso testo sopra).`,
    "",
    `3) "descCartello" = la descrizione per il cartello in punto vendita (testo autonomo, non ripetere descVolantino). Regole:`,
    settings.istruzioniCartello,
    "",
    "4) \"caratteristiche\": scegli SOLO tra questi valori, in italiano esatti come scritti:",
    `   categorie di animale → ${settings.categorieAnimali.join(", ")}`,
    `   caratteristiche di prodotto → ${settings.caratteristicheProdotto.join(", ")}`,
    "   Includi ALMENO una categoria di animale E ALMENO una caratteristica di prodotto quando pertinenti all'articolo",
    "   (es. un croccantino per gatti è insieme \"Gatto\" e \"Secco\"; un accessorio generico può avere solo la caratteristica di prodotto).",
    "",
    "Articoli:",
    ...products.map(productLine),
  ].join("\n");
}

async function callClaude(apiKey: string, prompt: string): Promise<AiGroup[]> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system:
      "Sei l'assistente del Consorzio Garden Team per il database prodotti zoo. Rispondi solo con JSON valido secondo lo schema richiesto, testi in italiano.",
    output_config: { format: { type: "json_schema", schema: GROUPS_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Richiesta rifiutata dal modello");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Risposta vuota");
  return (JSON.parse(text.text) as { groups: AiGroup[] }).groups;
}

/* ---------- Fallback euristico (senza chiave API) ---------- */

function normKey(p: ZooProduct): string {
  const words = p.descrizione
    .toLowerCase()
    .replace(/\d+[.,]?\d*\s*(kg|g|gr|ml|l|lt|pz|x)?/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return `${p.marca.toLowerCase()}|${words.slice(0, 3).join(" ")}`;
}

function heuristicGroups(products: ZooProduct[], settings: ZooSettings, singleGroup: boolean): AiGroup[] {
  const buckets = new Map<string, ZooProduct[]>();
  for (const p of products) {
    const key = singleGroup ? "unico" : normKey(p);
    buckets.set(key, [...(buckets.get(key) ?? []), p]);
  }
  return Array.from(buckets.values()).map((items) => {
    const first = items[0];
    const nome = first.descrizione.split(/\s+/).slice(0, 5).join(" ");
    const carat = settings.caratteristiche.filter((c) =>
      items.some((p) => `${p.descrizione} ${p.categoria ?? ""}`.toLowerCase().includes(c.toLowerCase()))
    );
    return {
      nome,
      descVolantino: `${nome} — ${first.marca} (bozza automatica: modifica il testo o imposta la chiave API per generarlo con l'AI)`,
      descCartello: `${first.descrizione}. Marca ${first.marca}. (bozza automatica: modifica il testo o imposta la chiave API per generarlo con l'AI)`,
      caratteristiche: carat,
      eans: items.map((p) => p.ean),
    };
  });
}

/** Raggruppa e genera i testi: con l'AI se c'è la chiave, altrimenti euristica + bozze. */
export async function groupAndDescribe(
  apiKey: string | undefined,
  products: ZooProduct[],
  settings: ZooSettings,
  singleGroup = false
): Promise<{ groups: AiGroup[]; usedAi: boolean; error?: string }> {
  if (apiKey) {
    try {
      const groups = await callClaude(apiKey, buildPrompt(products, settings, singleGroup));
      // sicurezza: tieni solo EAN realmente selezionati
      const validEans = new Set(products.map((p) => p.ean));
      for (const g of groups) g.eans = g.eans.filter((e) => validEans.has(e));
      return { groups: groups.filter((g) => g.eans.length > 0), usedAi: true };
    } catch (e) {
      return {
        groups: heuristicGroups(products, settings, singleGroup),
        usedAi: false,
        error: e instanceof Error ? e.message : "Errore chiamata AI",
      };
    }
  }
  return { groups: heuristicGroups(products, settings, singleGroup), usedAi: false };
}

/**
 * Come `groupAndDescribe`, ma a lotti: un'unica chiamata Claude con centinaia di
 * articoli rischia di superare il tempo massimo di una funzione serverless (Vercel
 * termina la funzione senza che il codice possa nemmeno intercettare l'errore, quindi
 * senza salvare nulla). Elabora al massimo `maxProducts` articoli, in lotti da
 * `batchSize`, e riporta quanti restano per un giro successivo.
 */
export async function groupAndDescribeBatched(
  apiKey: string | undefined,
  products: ZooProduct[],
  settings: ZooSettings,
  opts: { batchSize?: number; maxProducts?: number } = {}
): Promise<{ groups: AiGroup[]; usedAi: boolean; error?: string; restanti: number }> {
  const batchSize = opts.batchSize ?? 40;
  const maxProducts = opts.maxProducts ?? 160;
  const toProcess = products.slice(0, maxProducts);
  const groups: AiGroup[] = [];
  let usedAi = toProcess.length > 0;
  let error: string | undefined;
  for (let i = 0; i < toProcess.length; i += batchSize) {
    const res = await groupAndDescribe(apiKey, toProcess.slice(i, i + batchSize), settings);
    groups.push(...res.groups);
    if (!res.usedAi) usedAi = false;
    if (res.error && !error) error = res.error;
  }
  return { groups, usedAi, error, restanti: products.length - toProcess.length };
}
