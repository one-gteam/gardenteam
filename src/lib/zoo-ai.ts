import Anthropic from "@anthropic-ai/sdk";
import { ZooProduct, ZooSettings, chiavePrezzo, REGOLE_PADRE_DI_SERIE, type ZooParent, type ZooOffer } from "./zoo";

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
  /** Contenuto di ogni articolo (per il prezzo al chilo/litro): ean → quantità in kg o l. */
  contenuti?: { ean: string; quantita: number; unita: "kg" | "l" }[];
  /**
   * Id di un padre GIÀ esistente a cui aggiungere questi articoli (un gusto o un
   * formato nuovo di una linea che c'era): nome e testi del padre non si toccano.
   * Vuoto = padre nuovo.
   */
  padreEsistente?: string;
}

/** Un padre già nel catalogo da proporre a Claude, con qualche articolo d'esempio e il prezzo nel volantino. */
export interface PadreCandidato { id: string; nome: string; marca: string; esempi: string[]; prezzo?: string }

/**
 * Il prezzo di ogni articolo nel volantino che si sta preparando: la chiave
 * per confrontarlo (promo|partenza|meccanica|sconto, come chiavePrezzo) e il
 * testo da far leggere a Claude. In un padre stanno articoli con lo stesso prezzo.
 */
export type PrezziVolantino = Map<string, { chiave: string; testo: string }>;
export function prezziDelVolantino(offers: ZooOffer[], campaignId: string | undefined): PrezziVolantino {
  const m: PrezziVolantino = new Map();
  if (!campaignId) return m;
  for (const o of offers) {
    if (o.campaignId !== campaignId || o.scopeType || !o.productId) continue;
    const testo = [o.prezzoPromo && `€ ${o.prezzoPromo}`, o.prezzoListino && `da € ${o.prezzoListino}`, o.meccanica, o.scontoPerc && `-${o.scontoPerc}%`].filter(Boolean).join(" ") || "senza prezzo";
    m.set(o.productId, { chiave: chiavePrezzo(o), testo });
  }
  return m;
}

const PAROLE_VUOTE = new Set(["per", "con", "the", "and", "gusto", "gusti", "varie", "vari", "specialita", "specialità", "formato", "formati", "adult", "adulto", "cane", "cani", "gatto", "gatti", "pz", "conf"]);
function parole(t: string): string[] {
  return (t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+[.,]?\d*\s*(kg|g|gr|ml|l|lt|cl|pz|x)?\b/g, " ").replace(/[^a-z]+/g, " ")
    .split(" ").filter((w) => w.length > 2 && !PAROLE_VUOTE.has(w));
}

/**
 * I padri già esistenti che potrebbero accogliere questi articoli: stessa marca
 * o stesso fornitore di almeno un loro articolo, e qualche parola del nome in
 * comune. Al massimo 3 per articolo e `massimo` in tutto, i più simili prima.
 */
export function candidatiPadri(
  db: { parents: ZooParent[]; products: ZooProduct[] }, articoli: ZooProduct[], massimo = 60, prezzi?: PrezziVolantino,
): PadreCandidato[] {
  const figliDi = new Map<string, ZooProduct[]>();
  for (const p of db.products) if (p.parentId) figliDi.set(p.parentId, [...(figliDi.get(p.parentId) ?? []), p]);
  const punti = new Map<string, number>();
  for (const a of articoli) {
    const mie = new Set(parole(a.descrizione));
    const marca = (a.marca || "").toLowerCase().trim(), forn = (a.fornitore || "").toLowerCase().trim();
    const voti: [string, number][] = [];
    for (const par of db.parents) {
      const figli = figliDi.get(par.id) ?? [];
      if (!figli.length || figli.some((f) => f.scopeType !== a.scopeType || f.scopeId !== a.scopeId)) continue;
      const stessaDitta = figli.some((f) => (marca && (f.marca || "").toLowerCase().trim() === marca) || (forn && (f.fornitore || "").toLowerCase().trim() === forn));
      if (!stessaDitta) continue;
      // stesso prezzo nel volantino: se gli articoli del padre ci sono e costano diverso, non è il suo padre
      const mio = prezzi?.get(a.id)?.chiave;
      const loroPrezzi = new Set(figli.map((f) => prezzi?.get(f.id)?.chiave).filter(Boolean));
      if (mio && loroPrezzi.size && !loroPrezzi.has(mio)) continue;
      const loro = new Set([...parole(par.nome), ...figli.slice(0, 6).flatMap((f) => parole(f.descrizione))]);
      const comuni = [...mie].filter((w) => loro.has(w)).length;
      if (comuni >= 1) voti.push([par.id, comuni]);
    }
    voti.sort((x, y) => y[1] - x[1]);
    for (const [id, v] of voti.slice(0, 3)) punti.set(id, Math.max(punti.get(id) ?? 0, v));
  }
  return [...punti.entries()].sort((x, y) => y[1] - x[1]).slice(0, massimo).map(([id]) => {
    const par = db.parents.find((x) => x.id === id)!;
    const figli = figliDi.get(id) ?? [];
    const conPrezzo = figli.find((f) => prezzi?.get(f.id));
    return { id, nome: par.nome, marca: figli[0]?.marca || figli[0]?.fornitore || "", esempi: figli.slice(0, 3).map((f) => f.descrizione), prezzo: conPrezzo ? prezzi!.get(conPrezzo.id)!.testo : undefined };
  });
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
          padreEsistente: { type: "string", description: "Id di un padre gia' esistente (dall'elenco PADRI ESISTENTI) a cui aggiungere questi articoli; stringa vuota per un padre nuovo" },
          contenuti: {
            type: "array",
            description: "Per ogni articolo, quanto contiene la confezione, gia' convertito in chili o litri (multipack = totale). Solo gli articoli di cui si capisce il contenuto.",
            items: {
              type: "object",
              properties: {
                ean: { type: "string" },
                quantita: { type: "number", description: "in kg oppure in litri, es. 0.07 per 70 g" },
                unita: { type: "string", enum: ["kg", "l"] },
              },
              required: ["ean", "quantita", "unita"],
              additionalProperties: false,
            },
          },
        },
        required: ["nome", "descVolantino", "descCartello", "caratteristiche", "eans", "contenuti", "padreEsistente"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
} as const;

function productLine(p: ZooProduct, prezzi?: PrezziVolantino): string {
  const prezzo = prezzi?.get(p.id)?.testo;
  return `EAN ${p.ean} | ${p.codice} | ${p.marca} | ${p.fornitore} | ${p.categoria ?? ""} | ${p.descrizione}${prezzo ? ` | prezzo nel volantino: ${prezzo}` : ""}`;
}

function buildPrompt(products: ZooProduct[], settings: ZooSettings, singleGroup: boolean, candidati: PadreCandidato[] = [], prezzi?: PrezziVolantino): string {
  const esistenti = candidati.length && !singleGroup ? [
    "",
    "PADRI ESISTENTI. Nel catalogo ci sono già questi prodotti padre (id | titolo | marca | articoli d'esempio).",
    "Se alcuni degli articoli qui sotto sono varianti (gusto, formato, taglia) della STESSA linea di uno di questi padri,",
    "fai un gruppo con padreEsistente = quell'id: lascia nome, descVolantino e descCartello vuoti e caratteristiche [],",
    "gli articoli si aggiungono a quel padre e i suoi testi restano. Solo se è proprio la stessa linea di prodotto:",
    "nel dubbio, o se è un'altra linea della stessa marca, crea un padre nuovo con padreEsistente = \"\".",
    "Nello stesso padre stanno articoli con lo STESSO prezzo nel volantino: un padre esistente col prezzo diverso non va usato.",
    ...candidati.map((c) => `PADRE ${c.id} | ${c.nome} | ${c.marca} | ${c.esempi.join("; ")}${c.prezzo ? ` | prezzo nel volantino: ${c.prezzo}` : ""}`),
    "",
  ] : [];
  return [
    singleGroup
      ? "Questi articoli sono varianti (gusto/formato) dello STESSO prodotto. Restituisci UN SOLO gruppo che li contiene tutti."
      : ["Raggruppa questi articoli zoo/pet in prodotti \"padre\" seguendo queste REGOLE DEL PADRE:", settings.regolePadre?.trim() || REGOLE_PADRE_DI_SERIE].join("\n"),
    "",
    "Per ogni gruppo genera CINQUE campi. Anche con una descrizione di partenza povera (es. solo \"Tonnetto\"),",
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
    "   (\"Rettili\" = tartarughe, iguane, gechi, draghi barbuti, serpenti, terrari e i loro accessori e mangimi;",
    "   \"Roditori\" = conigli, criceti, cavie, cincillà; \"Pesci\" = acquariologia)",
    `   caratteristiche di prodotto → ${settings.caratteristicheProdotto.join(", ")}`,
    "   Includi ALMENO una categoria di animale E ALMENO una caratteristica di prodotto quando pertinenti all'articolo",
    "   (es. un croccantino per gatti è insieme \"Gatto\" e \"Secco\"; un accessorio generico può avere solo la caratteristica di prodotto).",
    "",
    "5) \"contenuti\": per ogni articolo di cui la descrizione dice quanto contiene la confezione (70 g, 1,5 kg, 250 ml, 4x85 g),",
    "   la quantità già convertita in chili (kg) o litri (l): 70 g → 0.07 kg, 4x85 g → 0.34 kg, 250 ml → 0.25 l.",
    "   Serve per il prezzo al chilo/litro sul cartello. Gli articoli senza contenuto leggibile (accessori, pezzi) non vanno elencati.",
    "",
    ...esistenti,
    "Articoli:",
    ...(prezzi?.size ? ["(Anche fra gli articoli nuovi: nello stesso gruppo solo articoli con lo stesso prezzo nel volantino.)"] : []),
    ...products.map((p) => productLine(p, prezzi)),
  ].join("\n");
}

async function callClaude(apiKey: string, prompt: string): Promise<AiGroup[]> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-5-5",
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
  singleGroup = false,
  /** Padri già nel catalogo a cui Claude può aggiungere gli articoli (vedi candidatiPadri). */
  candidati: PadreCandidato[] = [],
  /** Prezzi degli articoli nel volantino in lavorazione: nello stesso padre lo stesso prezzo. */
  prezzi?: PrezziVolantino,
): Promise<{ groups: AiGroup[]; usedAi: boolean; error?: string }> {
  if (apiKey) {
    try {
      const groups = await callClaude(apiKey, buildPrompt(products, settings, singleGroup, candidati, prezzi));
      // sicurezza: tieni solo EAN realmente selezionati, e solo padri esistenti fra quelli proposti
      const validEans = new Set(products.map((p) => p.ean));
      const validi = new Map(candidati.map((c) => [c.id, c]));
      for (const g of groups) {
        g.eans = g.eans.filter((e) => validEans.has(e));
        if (g.padreEsistente && !validi.has(g.padreEsistente)) g.padreEsistente = "";
        // un padre nuovo senza titolo (Claude l'ha lasciato vuoto pensando a un esistente): il nome dell'articolo
        if (!g.padreEsistente && !g.nome.trim()) g.nome = products.find((p) => g.eans.includes(p.ean))?.descrizione.split(/\s+/).slice(0, 4).join(" ") ?? "Nuovo padre";
      }
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
  opts: { batchSize?: number; maxProducts?: number; catalogo?: { parents: ZooParent[]; products: ZooProduct[] }; prezzi?: PrezziVolantino } = {}
): Promise<{ groups: AiGroup[]; usedAi: boolean; error?: string; restanti: number }> {
  const batchSize = opts.batchSize ?? 40;
  const maxProducts = opts.maxProducts ?? 160;
  const toProcess = products.slice(0, maxProducts);
  const groups: AiGroup[] = [];
  let usedAi = toProcess.length > 0;
  let error: string | undefined;
  for (let i = 0; i < toProcess.length; i += batchSize) {
    const lotto = toProcess.slice(i, i + batchSize);
    const res = await groupAndDescribe(apiKey, lotto, settings, false, opts.catalogo ? candidatiPadri(opts.catalogo, lotto, 60, opts.prezzi) : [], opts.prezzi);
    groups.push(...res.groups);
    if (!res.usedAi) usedAi = false;
    if (res.error && !error) error = res.error;
  }
  return { groups, usedAi, error, restanti: products.length - toProcess.length };
}

/**
 * Gli articoli che si possono davvero aggiungere a un padre esistente: quelli
 * con lo stesso prezzo dei suoi articoli nel volantino (o tutti, se il padre in
 * questo volantino non ha articoli con un prezzo). Gli altri restano senza padre.
 */
export function stessoPrezzoDelPadre(
  db: { products: ZooProduct[] }, padreId: string, figli: ZooProduct[], prezzi?: PrezziVolantino,
): { si: ZooProduct[]; no: ZooProduct[] } {
  if (!prezzi?.size) return { si: figli, no: [] };
  const loro = new Set(db.products.filter((p) => p.parentId === padreId).map((p) => prezzi.get(p.id)?.chiave).filter(Boolean));
  if (!loro.size) return { si: figli, no: [] };
  const si: ZooProduct[] = [], no: ZooProduct[] = [];
  for (const f of figli) { const k = prezzi.get(f.id)?.chiave; (k && !loro.has(k) ? no : si).push(f); }
  return { si, no };
}
