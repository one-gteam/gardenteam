import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { gestisce } from "@/lib/types";
import StampeHeader from "@/components/stampe/StampeHeader";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { ModuloInvio, PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import QrSvg from "@/components/stampe/QrSvg";
import CatalogoProdotti from "@/components/stampe/CatalogoProdotti";
import BannerCatalogo from "@/components/stampe/BannerCatalogo";
import {
  getStampeDb, canAccessArea, gestisceArea, scopesForUser, resolveScope, isStoreBlocked, catalogoDi, productImageUrl,
} from "@/lib/stampe";
import { salvaCatalogo, importaQuantitaExcel, rigeneraTokenGiacenze } from "@/lib/stampe-actions";

/*
 * Catalogo online: l'insegna lo accende, sceglie i prodotti e come contano le
 * quantità; ogni punto vendita carica le sue quantità (gestionale, Excel o a
 * mano). Il cliente lo apre da /catalogo/<insegna> e dalla scheda del QR.
 */
export default async function CatalogoGestionePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
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
  const tenantId = scope.type === "tenant" ? scope.id : store?.tenantId;
  const tenant = academyDb.tenants.find((t) => t.id === tenantId);
  const base = (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");

  if (!tenant) {
    return (
      <div>
        <StampeHeader user={user} active="catalogo" />
        <div className="container"><h1>Catalogo online</h1><div className="card"><p className="empty">Il catalogo è di un&apos;insegna: scegli un&apos;insegna o un punto vendita in alto a destra.</p>
          <form method="get" style={{ marginTop: 8 }}><select name="scope" defaultValue={scopeParam}>{scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}</select> <button className="btn btn-sm" type="submit">OK</button></form></div></div>
      </div>
    );
  }
  const pref = catalogoDi(db, tenant.id);
  const spenti = new Set(pref.spenti ?? []);
  const giac = store ? db.giacenze.find((g) => g.storeId === store.id) : undefined;
  const righe = db.products.filter((p) => !p.variantOf).map((p) => {
    const varianti = db.products.filter((v) => v.variantOf === p.id);
    const q = giac ? [p, ...varianti].reduce<number | undefined>((t, x) => (giac.quantita[x.codice] === undefined ? t : (t ?? 0) + giac.quantita[x.codice]), undefined) : undefined;
    return { id: p.id, codice: p.codice, titolo: p.fields.titolo ?? p.codice, marca: p.marca, tipologia: p.tipologia, foto: productImageUrl(p), acceso: !spenti.has(p.id), quantita: q, varianti: varianti.length };
  });
  const urlCatalogo = `${base}/catalogo/${tenant.id}${store ? `?pv=${store.id}` : ""}`;
  const quando = giac?.aggiornatoIl ? new Date(giac.aggiornatoIl).toLocaleString("it-IT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }) : "";
  const fonte = { api: "dal gestionale", excel: "da Excel", mano: "a mano" }[giac?.fonte ?? "mano"];

  return (
    <div>
      <StampeHeader user={user} active="catalogo" />
      <div className="container">
        <div className="stampa-testata">
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Catalogo online</h1>
            <p className="subtitle">
              La selezione Arredo di <strong>{tenant.name}</strong> come la vede il cliente{store ? <>, con le quantità di <strong>{store.name}</strong></> : null}.
              {pref.attivo ? <> Indirizzo: <a href={urlCatalogo} target="_blank" rel="noreferrer">{urlCatalogo}</a></> : " Spento: il cliente non lo trova finché non lo accendi."}
            </p>
          </div>
          <form method="get">
            <label className="field">Insegna / PV
              <select name="scope" defaultValue={scopeParam}>{scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}</select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>
        {!canEdit && <div className="alert alert-amber">Stai guardando {scope.label}: per cambiare qualcosa scegli un ambito che gestisci.</div>}

        <div className="grid grid-2" style={{ alignItems: "start", marginBottom: 18 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Il catalogo di {tenant.name}</h3>
            {scope.type !== "tenant" && <p className="hint">Queste scelte le fa l&apos;insegna: qui le vedi soltanto.</p>}
            <ModuloAutoSalva azione={salvaCatalogo.bind(null, scopeParam)}>
              <fieldset disabled={!(canEdit && scope.type === "tenant")} style={{ border: "none", padding: 0, margin: 0 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, marginBottom: 10 }}>
                  <input type="checkbox" name="attivo" defaultChecked={!!pref.attivo} /> Catalogo online acceso
                </label>
                <label className="field">Titolo <input type="text" name="titolo" defaultValue={pref.titolo ?? ""} placeholder="Catalogo arredo giardino" maxLength={60} /></label>
                <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0 4px" }}>Banner in testa (facoltativo)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                  <label className="field">Occhiello<input type="text" name="bannerOcchiello" defaultValue={pref.bannerOcchiello ?? ""} placeholder="SALDI DI FINE STAGIONE" maxLength={60} /></label>
                  <label className="field">Testo<input type="text" name="bannerTesto" defaultValue={pref.bannerTesto ?? ""} placeholder="Lounge e divani fino al -30%" maxLength={120} /></label>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0 4px" }}>Quantità dei punti vendita</div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <input type="checkbox" name="gestioneQuantita" defaultChecked={!!pref.gestioneQuantita} /> Le quantità contano: il cliente vede «Disponibile», «Ultimi 2», «Su ordinazione» per il negozio scelto
                </label>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="esauriti" value="ordinazione" defaultChecked={!pref.esauritiNascosti} /> a zero: «su ordinazione»</label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="esauriti" value="nascosti" defaultChecked={!!pref.esauritiNascosti} /> a zero: nascosto</label>
                </div>
                <p className="hint" style={{ margin: "8px 0 0" }}>Un prodotto spento resta spento anche se ha quantità. Senza gestione quantità, tutto è «disponibile in negozio».</p>
              </fieldset>
            </ModuloAutoSalva>
            <div style={{ marginTop: 8 }}><BannerCatalogo scopeParam={scopeParam} url={pref.bannerUrl} canEdit={canEdit && scope.type === "tenant"} /></div>
          </div>

          <div className="card">
            {store ? (
              <>
                <h3 style={{ marginTop: 0 }}>Quantità di {store.name}</h3>
                <p className="hint" style={{ margin: "0 0 8px" }}>{quando ? <>Ultimo aggiornamento <strong>{quando}</strong> ({fonte}), {Object.keys(giac?.quantita ?? {}).length} codici.</> : "Nessuna quantità ancora caricata."}{!pref.gestioneQuantita && " L'insegna non ha acceso la gestione quantità: si salvano ma il cliente non le vede."}</p>
                <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0 4px" }}>1. Dal gestionale (Linfa o altro)</div>
                {giac?.token ? (
                  <div style={{ fontSize: 12.5 }}>
                    <code style={{ display: "block", wordBreak: "break-all", background: "#f6f8f4", padding: 6, borderRadius: 6 }}>{giac.token}</code>
                    <div className="hint" style={{ marginTop: 4 }}>POST {base}/api/arredo-giacenze · <code>Authorization: Bearer &lt;chiave&gt;</code> · JSON <code>{"{ righe: [{ codice, quantita }] }"}</code> oppure CSV <code>codice;quantita</code>. Sostituisce tutto; con <code>modo: &quot;aggiorna&quot;</code> tocca solo i codici mandati.</div>
                  </div>
                ) : <p className="hint" style={{ margin: 0 }}>Nessuna chiave ancora.</p>}
                {canEdit && <PulsanteAzione azione={rigeneraTokenGiacenze.bind(null, scopeParam)} className="btn btn-outline btn-sm" conferma={giac?.token ? "Generare una nuova chiave? Quella vecchia smette di funzionare: va cambiata anche nel gestionale." : undefined}>{giac?.token ? "Nuova chiave" : "Genera la chiave"}</PulsanteAzione>}
                <div style={{ fontWeight: 600, fontSize: 13, margin: "12px 0 4px" }}>2. Da un file Excel</div>
                <p className="hint" style={{ margin: "0 0 4px" }}>Colonne «codice» e «quantità» (o le prime due), un prodotto per riga. Sostituisce tutte le quantità del negozio.</p>
                {canEdit && (
                  <ModuloInvio azione={importaQuantitaExcel.bind(null, scopeParam)} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="file" name="file" accept=".xlsx,.xls,.csv" required style={{ marginTop: 0, fontSize: 12, maxWidth: 240 }} />
                    <button className="btn btn-sm" type="submit">Carica</button>
                  </ModuloInvio>
                )}
                <div style={{ fontWeight: 600, fontSize: 13, margin: "12px 0 4px" }}>3. A mano</div>
                <p className="hint" style={{ margin: 0 }}>Nell&apos;elenco qui sotto, colonna quantità.</p>
              </>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>Punti vendita</h3>
                <p className="hint">Le quantità le carica ogni negozio dalla sua pagina (scegli il PV in alto a destra). Da qui si vede a che punto sono.</p>
                <table className="data"><thead><tr><th>Negozio</th><th>Codici</th><th>Aggiornato</th><th></th></tr></thead><tbody>
                  {academyDb.stores.filter((s) => s.tenantId === tenant.id).map((s) => { const g = db.giacenze.find((x) => x.storeId === s.id); return (
                    <tr key={s.id}><td>{s.name}</td><td>{Object.keys(g?.quantita ?? {}).length}</td><td style={{ fontSize: 12 }}>{g?.aggiornatoIl ? new Date(g.aggiornatoIl).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }) : "—"}</td><td><a className="mini-btn" href={`/stampe/arredo/catalogo?scope=store:${s.id}`}>apri</a></td></tr>
                  ); })}
                </tbody></table>
              </>
            )}
            {pref.attivo && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                <QrSvg testo={urlCatalogo} style={{ width: 80, height: 80, border: "1px solid var(--line)", borderRadius: 8 }} />
                <div style={{ fontSize: 12.5 }}><strong>Il QR del catalogo</strong><div className="hint">Da mettere in negozio o sul totem: porta a {urlCatalogo}</div></div>
              </div>
            )}
          </div>
        </div>

        <CatalogoProdotti righe={righe} scopeParam={scopeParam} puoAccendere={canEdit && scope.type === "tenant"} puoQuantita={canEdit && scope.type === "store"} gestioneQuantita={!!pref.gestioneQuantita || !!store} />
      </div>
    </div>
  );
}
