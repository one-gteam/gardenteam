import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessStampe, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, activeCampaign, zooImageUrl } from "@/lib/zoo";

/** Raccolta foto delle offerte selezionate: da consegnare al grafico insieme all'Excel. */
export default async function ZooFotoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;

  const campaign = db.campaigns.find((c) => c.id === sp.campagna) ?? activeCampaign(db);
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id && o.selezionata) : [];

  return (
    <div>
      <StampeHeader user={user} active="volantino" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0 }}>📷 Raccolta foto — {campaign?.nome ?? "volantino"}</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              Foto delle {offers.length} offerte selezionate. Clic destro → &quot;Salva immagine&quot; oppure stampa/salva in PDF per il grafico.
            </p>
          </div>
          <a className="btn btn-outline btn-sm" href={`/stampe/zoo/volantino?scope=${scopeParam}`}>← Torna al volantino</a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
          {offers.map((o) => {
            const p = db.products.find((x) => x.id === o.productId);
            const parent = p?.parentId ? db.parents.find((x) => x.id === p.parentId) : undefined;
            const src = zooImageUrl(p, parent);
            return (
              <div key={o.id} className="card" style={{ padding: 10, textAlign: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={o.descrizione} style={{ width: "100%", height: 150, objectFit: "contain", background: "#fff" }} />
                <div style={{ fontSize: 11.5, marginTop: 6, fontWeight: 700 }}>{o.descrizione}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted)" }}>EAN {o.ean} · {src.split("/").pop()}</div>
                {src === "/immagini/mancante.jpg" && <span className="pill pill-orange" style={{ marginTop: 4 }}>foto mancante</span>}
              </div>
            );
          })}
          {offers.length === 0 && <p style={{ color: "var(--muted)" }}>Nessuna offerta selezionata per il volantino.</p>}
        </div>
      </div>
    </div>
  );
}
