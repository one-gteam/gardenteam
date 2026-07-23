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
    "Per ogni gruppo genera:",
    `- descVolantino → regole: ${settings.istruzioniVolantino}`,
    `- descCartello → regole: ${settings.istruzioniCartello}`,
    `- caratteristiche → scegli SOLO tra: ${settings.caratteristiche.join(", ")}`,
    "- nome → nome commerciale del padre, in italiano, senza gusto/formato.",
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
