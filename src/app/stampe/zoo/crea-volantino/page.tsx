import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import VolantinoBuilder from "@/components/stampe/VolantinoBuilder";
import { canAccessArea, isZooEditor, resolveScope, scopesForUser } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, campagnaInLavorazione, zooImageUrl, migraVolantinoPages, effectiveParentText } from "@/lib/zoo";
import { saveVolantinoEditors } from "@/lib/zoo-actions";

/**
 * Crea Volantino: composizione delle pagine trascinando le offerte scelte.
 * Riservata a sistema/Gestore Offerte Zoo e agli utenti da loro autorizzati.
 */
export default async function CreaVolantinoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

  const db = await getZooDb();
  const editor = isZooEditor(user);
  const allowed = editor || (db.settings.volantinoEditors ?? []).includes(user.id);
  if (!allowed) redirect("/stampe/zoo/volantino");

  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  void scopesForUser; // scope unico: il volantino è del Consorzio

  // solo il volantino IN LAVORAZIONE: si compone su pagine pulite
  const campaign = campagnaInLavorazione(db);

  /*
   * La lista di sinistra presenta i PRODOTTI PADRE, non i singoli articoli: le
   * offerte che condividono un padre (stesso prodotto in gusti/formati diversi)
   * diventano una voce sola, con il testo e la foto del padre e l'elenco degli
   * articoli che contiene, apribile dalla lista. Le offerte senza padre — che
   * sono tante, non tutti gli articoli hanno simili — restano una voce a sé.
   */
  const offers = campaign
    ? (() => {
        const campOffers = db.offers.filter((o) => o.campaignId === campaign.id);
        const gruppi = new Map<string, typeof campOffers>();
        for (const o of campOffers) {
          const product = db.products.find((p) => p.id === o.productId);
          const key = product?.parentId ? `p:${product.parentId}` : `o:${o.id}`;
          gruppi.set(key, [...(gruppi.get(key) ?? []), o]);
        }
        return [...gruppi.entries()]
          .map(([key, gruppo]) => {
            const primo = gruppo[0];
            const product = db.products.find((p) => p.id === primo.productId);
            const parent = key.startsWith("p:") ? db.parents.find((x) => x.id === key.slice(2)) : undefined;
            const votes = db.votes.filter((v) => gruppo.some((g) => g.id === v.offerId));
            // articoli racchiusi: i figli del padre, o il singolo articolo dell'offerta
            const articoli = (parent
              ? db.products.filter((p) => p.parentId === parent.id)
              : product ? [product] : []
            ).map((p) => ({ ean: p.ean, descrizione: p.descrizione, marca: p.marca }));
            const prezzi = [...new Set(gruppo.map((g) => g.prezzoPromo).filter(Boolean))];
            return {
              id: primo.id,
              offerIds: gruppo.map((g) => g.id),
              descrizione: parent
                ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value || parent.nome
                : primo.descrizione,
              // con più prezzi diversi nel gruppo si mostra il più basso, con "da"
              prezzo: prezzi.length > 1 ? `da ${[...prezzi].sort()[0]}` : primo.prezzoPromo,
              prezzoListino: primo.prezzoListino,
              foto: zooImageUrl(product, parent),
              voti: votes.filter((v) => v.tipo === "preferita").length,
              nonTrattati: votes.filter((v) => v.tipo === "nontrattato").length,
              scheda: campaign.schede.find((s) => s.id === primo.schedaId)?.nome,
              marca: product?.marca ?? "",
              fornitore: product?.fornitore ?? "",
              caratts: parent?.caratteristiche ?? [],
              label: primo.label,
              padre: parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : undefined,
              articoli,
            };
          })
          // prima le più votate, in fondo quelle segnalate non trattate
          .sort((a, b) => b.voti - a.voti || a.nonTrattati - b.nonTrattati);
      })()
    : [];
  const ANIMALI = db.settings.categorieAnimali;
  const carattsProdotto = db.settings.caratteristicheProdotto;
  const fmtData = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");
  const layout = campaign ? db.volantinoLayouts.find((l) => l.campaignId === campaign.id) : undefined;

  // utenti candidabili come editor extra (per il Gestore Zoo / sistema)
  const candidates = academyDb.users.filter((u) => u.active !== false && u.role !== "student");
  const editors = db.settings.volantinoEditors ?? [];

  return (
    <div>
      <div className="no-print"><StampeHeader user={user} active="crea-volantino" area="zoo" /></div>
      <div className="container">
        <div className="no-print vol-head" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <h1>Crea Volantino</h1>
            <span className="subtitle">{campaign ? campaign.nome : "Nessun volantino in lavorazione"}</span>
            {campaign && (
              <span className="pill pill-amber">
                Valide dal {fmtData(campaign.dal)} al {fmtData(campaign.al)}
              </span>
            )}
          </div>
          {editor && (
            <details>
              <summary className="btn btn-outline btn-sm" style={{ display: "inline-block", cursor: "pointer" }}>
                Chi può creare il volantino
              </summary>
              <form action={saveVolantinoEditors.bind(null, scopeParam)} className="card" style={{ position: "absolute", zIndex: 10, marginTop: 6, width: 300, maxHeight: 300, overflowY: "auto" }}>
                <p className="hint" style={{ margin: "0 0 8px" }}>Oltre a sistema e Gestore Offerte Zoo:</p>
                {candidates.map((u) => (
                  <label key={u.id} className="checkbox-row" style={{ margin: "4px 0" }}>
                    <input type="checkbox" name="editor" value={u.id} defaultChecked={editors.includes(u.id)} />
                    {u.lastName} {u.firstName}
                  </label>
                ))}
                <button className="btn btn-sm" type="submit">Salva</button>
              </form>
            </details>
          )}
        </div>
        {sp.salvato && <div className="alert alert-green no-print">✓ Autorizzazioni salvate.</div>}

        {!campaign ? (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            Nessun volantino in lavorazione: aprine uno e importa le offerte nella pagina{" "}
            <a href="/stampe/zoo/offerte">Import offerte</a>.
          </div>
        ) : (
          <VolantinoBuilder
            campaignId={campaign.id}
            offers={offers}
            initialPages={layout ? migraVolantinoPages(layout.pages) : []}
            excelHref={`/stampe/zoo/crea-volantino/excel?campagna=${campaign.id}`}
            fotoZipHref={`/stampe/zoo/crea-volantino/foto?campagna=${campaign.id}`}
            animali={ANIMALI}
            caratts={carattsProdotto}
            labels={db.settings.labels}
            marche={[...new Set(offers.map((o) => o.marca).filter(Boolean))].sort()}
            fornitori={[...new Set(offers.map((o) => o.fornitore).filter(Boolean))].sort()}
          />
        )}
      </div>
    </div>
  );
}
