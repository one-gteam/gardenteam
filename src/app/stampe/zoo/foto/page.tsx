import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, isZooEditor, resolveScope } from "@/lib/stampe";
import FotoTrascinabile from "@/components/stampe/FotoTrascinabile";
import FotoGruppo, { type RigaFotoGruppo } from "@/components/stampe/FotoGruppo";
import { getDb } from "@/lib/db";
import { getZooDb, activeCampaign, zooImageUrl, NO_VOLANTINO, type ZooOffer } from "@/lib/zoo";

const MANCANTE = "/immagini/mancante.jpg";

/**
 * Raccolta foto delle offerte: da consegnare al grafico insieme all'Excel.
 * Due scelte in alto:
 *  - quali: solo quelle che vanno a volantino (predefinito), o tutte le offerte;
 *  - vista: per padre (una scheda per prodotto padre o voce unita, coi suoi
 *    articoli sotto: la foto caricata su un articolo diventa quella del padre)
 *    oppure una scheda per articolo, come prima.
 * Più «solo senza foto», per vedere cosa manca.
 */
export default async function ZooFotoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;

  const campaign = db.campaigns.find((c) => c.id === sp.campagna) ?? activeCampaign(db);
  const editor = isZooEditor(user);
  const quali = sp.quali === "tutte" ? "tutte" : "volantino";
  const vista = sp.vista === "articoli" ? "articoli" : "padri";
  const soloSenza = sp.senzafoto === "1";

  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));
  const offers = campaign
    ? db.offers.filter((o) => o.campaignId === campaign.id && !o.scopeType
      && (quali === "tutte" || (o.selezionata && o.paginaId !== NO_VOLANTINO)))
    : [];

  /* ---------- gruppi: voce unita, poi padre, poi offerta da sola ---------- */
  type Gruppo = { key: string; tipo: "padre" | "unione" | "articolo"; titolo: string; sotto: string; foto: string; righe: RigaFotoGruppo[] };
  const perChiave = new Map<string, ZooOffer[]>();
  for (const o of offers) {
    const pid = prodById.get(o.productId ?? "")?.parentId;
    const k = o.unioneVolantino ? `u:${o.unioneVolantino}` : pid ? `p:${pid}` : `o:${o.id}`;
    perChiave.set(k, [...(perChiave.get(k) ?? []), o]);
  }
  const gruppi: Gruppo[] = [...perChiave.entries()].map(([key, offs]) => {
    const prima = offs[0];
    if (key.startsWith("u:")) {
      const unione = db.unioniVolantino.find((u) => `u:${u.id}` === key);
      // una riga per padre (o per articolo senza padre): ognuno ha la sua foto
      const perPadre = new Map<string, ZooOffer>();
      for (const o of offs) {
        const pid = prodById.get(o.productId ?? "")?.parentId;
        if (!perPadre.has(pid ?? o.id)) perPadre.set(pid ?? o.id, o);
      }
      const righe = [...perPadre.values()].map((o) => {
        const p = prodById.get(o.productId ?? "");
        const par = p?.parentId ? parentById.get(p.parentId) : undefined;
        const f = par?.image ?? p?.image;
        return { offerId: o.id, etichetta: par?.nome ?? o.descrizione, sotto: `EAN ${o.ean}`, foto: f };
      });
      return {
        key, tipo: "unione" as const,
        titolo: unione?.titolo || righe.map((r) => r.etichetta).join(" + "),
        sotto: `${offs.length} articoli · ${righe.length} padri`,
        foto: unione?.foto?.[0] ?? righe.find((r) => r.foto)?.foto ?? MANCANTE,
        righe,
      };
    }
    if (key.startsWith("p:")) {
      const parent = parentById.get(key.slice(2));
      const righe = offs.map((o) => {
        const p = prodById.get(o.productId ?? "");
        return { offerId: o.id, etichetta: p?.descrizione ?? o.descrizione, sotto: `EAN ${o.ean}`, foto: p?.image };
      });
      // la foto di riferimento: quella del padre, altrimenti la prima di un suo articolo
      const foto = parent?.image ?? righe.find((r) => r.foto)?.foto ?? MANCANTE;
      return { key, tipo: "padre" as const, titolo: parent?.nome ?? prima.descrizione, sotto: `${offs.length} ${offs.length === 1 ? "articolo" : "articoli"}`, foto, righe };
    }
    const p = prodById.get(prima.productId ?? "");
    return {
      key, tipo: "articolo" as const, titolo: prima.descrizione, sotto: `EAN ${prima.ean} · senza padre`,
      foto: zooImageUrl(p, undefined), righe: [{ offerId: prima.id, etichetta: prima.descrizione, sotto: `EAN ${prima.ean}` }],
    };
  }).filter((g) => !soloSenza || g.foto === MANCANTE)
    .sort((a, b) => a.titolo.localeCompare(b.titolo, "it"));

  const articoli = offers.filter((o) => {
    if (!soloSenza) return true;
    const p = prodById.get(o.productId ?? "");
    return zooImageUrl(p, p?.parentId ? parentById.get(p.parentId) : undefined, db) === MANCANTE;
  });

  const link = (cambia: Record<string, string>) => {
    const q = new URLSearchParams({ scope: scopeParam, ...(campaign ? { campagna: campaign.id } : {}), quali, vista, ...(soloSenza ? { senzafoto: "1" } : {}), ...cambia });
    if (q.get("senzafoto") === "0") q.delete("senzafoto");
    return `/stampe/zoo/foto?${q.toString()}`;
  };
  const pill = (attiva: boolean, href: string, testo: string) =>
    <a className={`pill ${attiva ? "pill-blue" : "pill-gray"}`} href={href}>{testo}</a>;
  const nSenza = gruppi.filter((g) => g.foto === MANCANTE).length;

  return (
    <div>
      <StampeHeader user={user} active="volantino" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>Raccolta foto — {campaign?.nome ?? "volantino"}</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {vista === "padri"
                ? <>{gruppi.length} {gruppi.length === 1 ? "voce" : "voci"} ({offers.length} articoli){!soloSenza && nSenza > 0 ? `, ${nSenza} senza foto` : ""}. Una scheda per prodotto padre: la foto caricata su uno qualsiasi dei suoi articoli <strong>diventa quella del padre</strong>, ed è quella che va nel volantino.</>
                : <>Foto di {articoli.length} articoli. Clic destro → &quot;Salva immagine&quot; oppure stampa/salva in PDF per il grafico.</>}
              {editor && <> Per cambiare una foto <strong>trascina un&apos;immagine dal computer sopra la scheda</strong>.</>}
            </p>
          </div>
          <a className="btn btn-outline btn-sm" href={`/stampe/zoo/volantino?scope=${scopeParam}`}>← Torna al volantino</a>
        </div>

        <div className="no-print" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 14, fontSize: 13 }}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <strong>Quali:</strong>
            {pill(quali === "volantino", link({ quali: "volantino" }), "Solo a volantino")}
            {pill(quali === "tutte", link({ quali: "tutte" }), "Tutte le offerte")}
          </span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <strong>Vista:</strong>
            {pill(vista === "padri", link({ vista: "padri" }), "Per padre / voce unita")}
            {pill(vista === "articoli", link({ vista: "articoli" }), "Per articolo")}
          </span>
          {pill(soloSenza, link({ senzafoto: soloSenza ? "0" : "1" }), soloSenza ? "✓ Solo senza foto" : "Solo senza foto")}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${vista === "padri" ? 240 : 200}px, 1fr))`, gap: 14, alignItems: "start" }}>
          {vista === "padri"
            ? gruppi.map((g) => (
              <FotoGruppo key={g.key} titolo={g.titolo} sottotitolo={g.sotto} foto={g.foto} righe={g.righe} tipo={g.tipo} puoCaricare={editor} />
            ))
            : articoli.map((o) => {
              const p = prodById.get(o.productId ?? "");
              const parent = p?.parentId ? parentById.get(p.parentId) : undefined;
              return (
                <FotoTrascinabile key={o.id} offerId={o.id} src={zooImageUrl(p, parent, db)} puoCaricare={editor}
                  titolo={parent ? `${parent.nome} · ${o.descrizione}` : o.descrizione} sottotitolo={`EAN ${o.ean}`} />
              );
            })}
          {(vista === "padri" ? gruppi.length : articoli.length) === 0 && (
            <p style={{ color: "var(--muted)" }}>
              {soloSenza ? "Nessuna voce senza foto: ci sono tutte." : quali === "volantino" ? "Nessuna offerta scelta per il volantino." : "Nessuna offerta in questo volantino."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
