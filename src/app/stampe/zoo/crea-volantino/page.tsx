import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import VolantinoBuilder from "@/components/stampe/VolantinoBuilder";
import { canAccessArea, isZooEditor, resolveScope, scopesForUser } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, activeCampaign, zooImageUrl, migraVolantinoPages } from "@/lib/zoo";
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

  const campaign = db.campaigns.find((c) => c.id === sp.campagna) ?? activeCampaign(db);
  const offers = campaign
    ? db.offers
        .filter((o) => o.campaignId === campaign.id)
        .map((o) => {
          const product = db.products.find((p) => p.id === o.productId);
          const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
          const votes = db.votes.filter((v) => v.offerId === o.id);
          // articoli racchiusi dall'offerta: i "fratelli" con lo stesso padre
          const articoli = (parent
            ? db.products.filter((p) => p.parentId === parent.id)
            : product ? [product] : []
          ).map((p) => ({ ean: p.ean, descrizione: p.descrizione, marca: p.marca }));
          return {
            id: o.id, descrizione: o.descrizione, prezzo: o.prezzoPromo, prezzoListino: o.prezzoListino,
            foto: zooImageUrl(product, parent),
            voti: votes.filter((v) => v.tipo === "preferita").length,
            nonTrattati: votes.filter((v) => v.tipo === "nontrattato").length,
            scheda: campaign.schede.find((s) => s.id === o.schedaId)?.nome,
            marca: product?.marca ?? "",
            fornitore: product?.fornitore ?? "",
            caratts: parent?.caratteristiche ?? [],
            label: o.label,
            articoli,
          };
        })
        // prima le più votate, in fondo quelle segnalate non trattate
        .sort((a, b) => b.voti - a.voti || a.nonTrattati - b.nonTrattati)
    : [];
  const ANIMALI = ["Cane", "Gatto", "Roditori", "Uccelli", "Pesci"];
  const carattsProdotto = db.settings.caratteristiche.filter((c) => !ANIMALI.includes(c));
  const fmtData = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");
  const layout = campaign ? db.volantinoLayouts.find((l) => l.campaignId === campaign.id) : undefined;

  // utenti candidabili come editor extra (per il Gestore Zoo / sistema)
  const candidates = academyDb.users.filter((u) => u.active !== false && u.role !== "student");
  const editors = db.settings.volantinoEditors ?? [];

  return (
    <div>
      <div className="no-print"><StampeHeader user={user} active="crea-volantino" area="zoo" /></div>
      <div className="container">
        <div className="no-print vol-head" style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Crea Volantino</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {campaign ? `${campaign.nome} — trascina le offerte sugli spazi; ogni offerta mostra i voti dei punti vendita.` : "Nessuna campagna attiva"}
            </p>
            {campaign && (
              <span className="pill pill-amber" style={{ marginTop: 6, display: "inline-block" }}>
                Offerte valide dal {fmtData(campaign.dal)} al {fmtData(campaign.al)}
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
            Importa prima le offerte nella pagina &quot;Import offerte&quot;.
          </div>
        ) : (
          <VolantinoBuilder
            campaignId={campaign.id}
            offers={offers}
            initialPages={layout ? migraVolantinoPages(layout.pages) : []}
            excelHref={`/stampe/zoo/crea-volantino/excel?campagna=${campaign.id}`}
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
