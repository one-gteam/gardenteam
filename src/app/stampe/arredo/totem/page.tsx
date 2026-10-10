import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { gestisce } from "@/lib/types";
import StampeHeader from "@/components/stampe/StampeHeader";
import TotemEditor from "@/components/stampe/TotemEditor";
import { ModuloInvio } from "@/components/AzioneSenzaRicarica";
import { getStampeDb, canAccessArea, gestisceArea, scopesForUser, resolveScope, isStoreBlocked, catalogoDi, prodottiCatalogo } from "@/lib/stampe";
import { creaTotem } from "@/lib/stampe-actions";

/*
 * I totem del punto vendita: ciascuno con la sua modalità, le categorie, le
 * foto e i video e i tempi. Lo schermo si apre dal suo indirizzo con la chiave.
 */
export default async function TotemGestionePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "arredo")) redirect("/studente");
  if (!gestisce(user, "arredo")) redirect("/stampe/arredo/stampa");
  const sp = await searchParams;
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb).filter((s) => s.type !== "system");
  const scope = resolveScope(user, sp.scope ?? (scopes[0] ? `${scopes[0].type}:${scopes[0].id}` : undefined), academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const canEdit = !isStoreBlocked(db, scope) && gestisceArea(user, "arredo", scope, academyDb);
  const store = scope.type === "store" ? academyDb.stores.find((s) => s.id === scope.id) : undefined;
  const tenant = academyDb.tenants.find((t) => t.id === (scope.type === "tenant" ? scope.id : store?.tenantId));
  const base = (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
  const tipologie = tenant ? [...new Set(prodottiCatalogo(db, tenant.id).map((p) => p.tipologia))].sort((a, b) => a.localeCompare(b, "it")) : [];
  const totem = store ? db.totem.filter((t) => t.storeId === store.id) : tenant ? db.totem.filter((t) => academyDb.stores.some((s) => s.id === t.storeId && s.tenantId === tenant.id)) : [];
  const catalogoAcceso = tenant ? !!catalogoDi(db, tenant.id).attivo : false;

  return (
    <div>
      <StampeHeader user={user} active="totem" />
      <div className="container">
        <div className="stampa-testata">
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Totem</h1>
            <p className="subtitle">Lo schermo verticale in negozio: foto o video in attesa e il catalogo al tocco, oppure sempre prodotti. {store ? <>Totem di <strong>{store.name}</strong>.</> : "Scegli un punto vendita per crearne uno."}</p>
          </div>
          <form method="get">
            <label className="field">Insegna / PV
              <select name="scope" defaultValue={scopeParam}>{scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}</select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>
        {tenant && !catalogoAcceso && <div className="alert alert-amber">Il catalogo online di {tenant.name} è spento: il totem mostra i prodotti lo stesso, ma il QR «portalo sul telefono» porterà a una pagina non disponibile. Si accende da <a href={`/stampe/arredo/catalogo?scope=tenant:${tenant.id}`}>Catalogo online</a>.</div>}
        {totem.length === 0 && <div className="card" style={{ marginBottom: 14 }}><p className="empty">Nessun totem ancora{store ? "" : " per questi punti vendita"}.</p></div>}
        {totem.map((t) => {
          const s = academyDb.stores.find((x) => x.id === t.storeId);
          const suo = { type: "store" as const, id: t.storeId, label: s?.name ?? "" };
          return (
            <div key={t.id}>
              {!store && <div className="hint" style={{ margin: "0 0 4px" }}>{s?.name}</div>}
              <TotemEditor totem={t} scopeParam={`store:${t.storeId}`} tipologie={tipologie} url={`${base}/totem/${t.id}?k=${t.chiave}`}
                canEdit={gestisceArea(user, "arredo", suo, academyDb) && !isStoreBlocked(db, suo)} />
            </div>
          );
        })}
        {store && canEdit && (
          <div className="card">
            <strong>Nuovo totem</strong>
            <ModuloInvio azione={creaTotem.bind(null, scopeParam)} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
              <input type="text" name="nome" placeholder="es. Reparto barbecue" style={{ marginTop: 0, width: 240 }} />
              <button className="btn btn-sm" type="submit">Crea</button>
            </ModuloInvio>
          </div>
        )}
      </div>
    </div>
  );
}
