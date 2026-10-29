import Anthropic from "@anthropic-ai/sdk";
import { ZooProduct, ZooSettings, chiavePrezzo, REGOLE_PADRE_DI_SERIE, contenutoDa, testoContenuto, type ZooParent, type ZooOffer } from "./zoo";

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
export interface PadreCandidato { id: string; nome: string; marca: string; esempi: string[]; prezzo?: string; formati: string[]; tipologie: string[] }

/** Il formato della confezione («3 kg», «85 g»): scritto a mano sull'articolo o letto dalla descrizione; "" se non si capisce. */
export function formatoDi(p: ZooProduct): string {
  return testoContenuto(p.contenuto ?? contenutoDa(p.descrizione));
}

/**
 * La tipologia (età o esigenza) scritta nella descrizione: «Puppy/Junior», «Kitten»,
 * «Sterilised»…; "" = adult o non scritta. Adult non è una tipologia a parte: un
 * articolo senza età è quasi sempre per adulti («Stuzzy Paté con Tonno» con
 * «Stuzzy Paté Adult»), e «Adult Sterilised» va con «Sterilised».
 */
const TIPOLOGIE: [string, RegExp][] = [
  ["Puppy/Junior", /\b(puppy|junior|jun|cucciol[oi]|starter)\b/],
  ["Kitten", /\b(kitten|gattin[oi]|babycat)\b/],
  // «7+», «11+», «+7» sì; «3+1» (la promo) no
  ["Senior", /\b(senior|mature|anzian[oi]|ageing)\b|\b(7|8|9|10|11|12|15)\s*\+(?!\s*\d)|\+\s*(7|11)\b/],
  ["Sterilised", /\b(sterili[sz]ed|sterilizzat[oi]|steril|ster|st)\b/],
  ["Light", /\b(light|weight control)\b/],
];
export function tipologiaDi(descrizione: string): string {
  const t = (descrizione ?? "").toLowerCase().replace(/&/g, " ");
  return TIPOLOGIE.filter(([, re]) => re.test(t)).map(([n]) => n).join(" + ");
}

/**
 * Raggruppa per formato e tipologia. Un articolo senza formato leggibile
 * («MONGE FRESH ADULT TROTA 400» accanto a «… POLLO400GR») non fa una parte a
 * sé: va con la parte più grande della sua tipologia che il formato ce l'ha.
 */
function perFormatoETipologia<T>(voci: T[], prodotto: (v: T) => ZooProduct | undefined): { formato: string; tip: string; voci: T[] }[] {
  const parti = new Map<string, { formato: string; tip: string; voci: T[] }>();
  for (const v of voci) {
    const p = prodotto(v);
    const formato = p ? formatoDi(p) : "", tip = p ? tipologiaDi(p.descrizione) : "", k = `${formato}|${tip}`;
    if (!parti.has(k)) parti.set(k, { formato, tip, voci: [] });
    parti.get(k)!.voci.push(v);
  }
  for (const [k, senza] of [...parti].filter(([, x]) => !x.formato)) {
    const dove = [...parti.values()].filter((x) => x.formato && x.tip === senza.tip).sort((a, b) => b.voci.length - a.voci.length)[0];
    if (dove) { dove.voci.push(...senza.voci); parti.delete(k); }
  }
  return [...parti.values()];
}

/**
 * Gli articoli di un padre divisi per formato e tipologia, la parte più grande
 * per prima. Una parte sola = il padre rispetta le regole. `aggiunta` è quello
 * che distingue la parte nel titolo («Puppy/Junior 3 kg»).
 */
export function partiPerFormato(figli: ZooProduct[]): { aggiunta: string; articoli: ZooProduct[] }[] {
  const lista = perFormatoETipologia(figli, (f) => f).map((x) => ({ formato: x.formato, tip: x.tip, articoli: x.voci }));
  const formati = new Set(lista.map((x) => x.formato)), tipologie = new Set(lista.map((x) => x.tip));
  return lista
    .sort((a, b) => b.articoli.length - a.articoli.length)
    .map((x) => ({ aggiunta: [tipologie.size > 1 ? x.tip : "", formati.size > 1 ? x.formato : ""].filter(Boolean).join(" "), articoli: x.articoli }));
}

/** Quanti padri mescolano formati o tipologie (per il pulsante «Dividi» del Database prodotti). */
export function padriMisti(db: { parents: ZooParent[]; products: ZooProduct[] }): string[] {
  const figli = new Map<string, ZooProduct[]>();
  for (const p of db.products) if (p.parentId) figli.set(p.parentId, [...(figli.get(p.parentId) ?? []), p]);
  return db.parents.filter((par) => partiPerFormato(figli.get(par.id) ?? []).length > 1).map((par) => par.id);
}

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
      // formato e tipologia diversi (3 kg / 12 kg, Puppy / Adult): non è il suo padre
      const mioFormato = formatoDi(a), mieTip = tipologiaDi(a.descrizione);
      const loroFormati = new Set(figli.map(formatoDi).filter(Boolean));
      if (mioFormato && loroFormati.size && !loroFormati.has(mioFormato)) continue;
      if (figli.some((f) => tipologiaDi(f.descrizione) !== mieTip)) continue;
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
    return {
      id, nome: par.nome, marca: figli[0]?.marca || figli[0]?.fornitore || "", esempi: figli.slice(0, 3).map((f) => f.descrizione),
      prezzo: conPrezzo ? prezzi!.get(conPrezzo.id)!.testo : undefined,
      formati: [...new Set(figli.map(formatoDi).filter(Boolean))], tipologie: [...new Set(figli.map((f) => tipologiaDi(f.descrizione)))],
    };
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
  const formato = formatoDi(p);
  return `EAN ${p.ean} | ${p.codice} | ${p.marca} | ${p.fornitore} | ${p.categoria ?? ""} | ${p.descrizione}${formato ? ` | formato: ${formato}` : ""}${prezzo ? ` | prezzo nel volantino: ${prezzo}` : ""}`;
}

/**
 * La rete di sicurezza sulle regole del padre: un gruppo con formati o
 * tipologie diversi (3 kg e 12 kg, Puppy e Adult) si divide in più padri, col
 * formato o la tipologia aggiunti al titolo. Un padre esistente proposto da
 * Claude resta solo alla parte che ha il suo stesso formato e la sua tipologia.
 */
function dividiPerFormato(g: AiGroup, products: ZooProduct[], candidati: PadreCandidato[]): AiGroup[] {
  const perEan = new Map(products.map((p) => [p.ean, p]));
  const parti = perFormatoETipologia(g.eans, (e) => perEan.get(e));
  if (parti.length <= 1) return [g];
  const formati = new Set(parti.map((x) => x.formato));
  const tipologie = new Set(parti.map((x) => x.tip));
  const cand = candidati.find((c) => c.id === g.padreEsistente);
  const base = g.nome.trim() || cand?.nome || "";
  return parti.map(({ formato, tip, voci: eans }) => {
    const aggiunta = [
      tipologie.size > 1 && tip && !base.toLowerCase().includes(tip.toLowerCase()) ? tip : "",
      formati.size > 1 && formato && !base.toLowerCase().includes(formato.toLowerCase()) ? formato : "",
    ].filter(Boolean).join(" ");
    const resta = !!cand && (!formato || !cand.formati.length || cand.formati.includes(formato)) && cand.tipologie.includes(tip);
    return {
      ...g, eans,
      nome: resta ? g.nome : [base, aggiunta].filter(Boolean).join(" "),
      padreEsistente: resta ? g.padreEsistente : "",
      contenuti: g.contenuti?.filter((c) => eans.includes(c.ean)),
    };
  });
}

function buildPrompt(products: ZooProduct[], settings: ZooSettings, singleGroup: boolean, candidati: PadreCandidato[] = [], prezzi?: PrezziVolantino): string {
  const esistenti = candidati.length && !singleGroup ? [
    "",
    "PADRI ESISTENTI. Nel catalogo ci sono già questi prodotti padre (id | titolo | marca | articoli d'esempio | formato).",
    "Se alcuni degli articoli qui sotto sono varianti (gusto, colore) della STESSA linea, STESSA tipologia e STESSO formato di uno di questi padri,",
    "fai un gruppo con padreEsistente = quell'id: lascia nome, descVolantino e descCartello vuoti e caratteristiche [],",
    "gli articoli si aggiungono a quel padre e i suoi testi restano. Solo se è proprio la stessa linea di prodotto:",
    "nel dubbio, o se è un'altra linea della stessa marca, crea un padre nuovo con padreEsistente = \"\".",
    "Un padre esistente con un formato diverso (3 kg / 12 kg) o una tipologia diversa (Puppy / Adult) non va usato.",
    "Se il prezzo nel volantino è diverso, controlla bene: spesso vuol dire formato o tipologia diversi.",
    ...candidati.map((c) => `PADRE ${c.id} | ${c.nome} | ${c.marca} | ${c.esempi.join("; ")}${c.formati.length ? ` | formato: ${c.formati.join(", ")}` : ""}${c.prezzo ? ` | prezzo nel volantino: ${c.prezzo}` : ""}`),
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
    "(Nello stesso gruppo solo articoli con lo stesso formato e la stessa tipologia. Un prezzo diverso molte volte",
    " indica un formato o una tipologia diversi: in quel caso gruppi diversi.)",
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
  return `${p.marca.toLowerCase()}|${words.slice(0, 3).join(" ")}|${formatoDi(p)}|${tipologiaDi(p.descrizione)}`;
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
  /** Prezzi degli articoli nel volantino in lavorazione: Claude li legge come indizio (prezzo diverso = spesso formato diverso). */
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
      }
      // le regole del padre anche se Claude sbaglia: formati e tipologie diversi = padri diversi (non con "un solo gruppo")
      if (!singleGroup) groups.splice(0, groups.length, ...groups.flatMap((g) => dividiPerFormato(g, products, candidati)));
      for (const g of groups) {
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
