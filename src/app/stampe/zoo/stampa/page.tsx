import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import ZooCartello, { ZooCartelloData } from "@/components/stampe/ZooCartello";
import { canAccessStampe, isConsortiumEditor, scopesForUser, resolveScope, insegnaLogoUrl } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { DB } from "@/lib/types";
import {
  getZooDb, activeCampaign, zooImageUrl, effectiveParentText, isZooHidden, pvPriceFor, ZooOffer, ZooDB,
} from "@/lib/zoo";
import { importPvPrices, sendZooSuggestion, toggleZooHidden } from "@/lib/zoo-actions";
import { Scope } from "@/lib/stampe";

function fmtDate(d?: string) {
  if (!d) return "";
  const [y, m, g] = d.split("-");
  return `${g}/${m}/${y}`;
}

function cartelloData(db: ZooDB, scope: Scope, o: ZooOffer, validita: string, academyDb: DB): ZooCartelloData {
  const product = db.products.find((p) => p.id === o.productId);
  const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
  const prezzo = pvPriceFor(db, scope, o.ean, academyDb) ?? o.prezzoPromo;
  return {
    titolo: parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : (product?.descrizione ?? o.descrizione),
    descrizione: parent ? effectiveParentText(db, scope, parent, "descCartello", academyDb).value || o.descrizione : o.descrizione,
    prezzo,
    prezzoListino: o.prezzoListino,
    condizioni: o.condizioni,
    marca: product?.marca,
    ean: o.ean,
    image: zooImageUrl(product, parent),
    label: o.label,
    validita,
    logoInsegna: insegnaLogoUrl(scope, academyDb),
  };
}

export default async function ZooStampaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");
  const spRaw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(spRaw)) sp[k] = Array.isArray(v) ? v[v.length - 1] : v;
  const selIds = Array.isArray(spRaw.sel) ? spRaw.sel : spRaw.sel ? [spRaw.sel] : [];

  const db = await getZooDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isConsortiumEditor(user);

  const campaign = activeCampaign(db);
  const allSelected = campaign ? db.offers.filter((o) => o.campaignId === campaign.id && o.selezionata) : [];
  // il PV non vede i prodotti di fornitori/marchi/articoli che ha nascosto
  const visible = allSelected.filter((o) => {
    const product = db.products.find((p) => p.id === o.productId);
    return !product || scope.type === "system" || !isZooHidden(db, scope, product, academyDb);
  });
  const hiddenCount = allSelected.length - visible.length;

  const formato = (sp.formato === "a4" ? "a4" : "a5") as "a5" | "a4";
  const doppio = sp.doppio === "1";
  const printMode = sp.print === "1";
  const validita = campaign?.dal ? `dal ${fmtDate(campaign.dal)} al ${fmtDate(campaign.al)}` : "";
  const selected = visible.filter((o) => selIds.includes(o.id));

  /* ---------- modalità stampa: solo cartelli a dimensione reale ---------- */
  if (printMode) {
    const printScale = 3.7795; // 1 mm = 3.7795 px → dimensione reale
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
        {selected.map((o) => {
          const data = cartelloData(db, scope, o, validita, academyDb);
          if (formato === "a5" && doppio) {
            // 2 copie identiche affiancate su A4 orizzontale, da piegare fronte/retro
            return (
              <div key={o.id} style={{ display: "flex", pageBreakAfter: "always" }}>
                <ZooCartello data={data} formato="a5" scale={printScale} />
                <ZooCartello data={data} formato="a5" scale={printScale} />
              </div>
            );
          }
          return (
            <div key={o.id} style={{ pageBreakAfter: "always" }}>
              <ZooCartello data={data} formato={formato} scale={printScale} />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <StampeHeader user={user} active="stampa" area="zoo" />
      <div className="container" style={{ maxWidth: 1400 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Stampa cartelli promozionali — ZOO</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {campaign ? `${campaign.nome} · promo in corso ${validita}` : "Nessuna campagna attiva"}
              {hiddenCount > 0 && ` · ${hiddenCount} offerte nascoste dal tuo ambito`}
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>
              Insegna / PV{" "}
              <select name="scope" defaultValue={scopeParam} style={{ marginTop: 2 }}>
                {scopes.map((s) => (
                  <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {sp.prezzi !== undefined && <div className="alert alert-green">✓ Caricati {sp.prezzi} prezzi personalizzati del tuo punto vendita.</div>}

        {/* prezzi propri del PV */}
        {scope.type !== "system" && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <strong>💶 Prezzi del tuo punto vendita</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
              Carica un Excel con colonne EAN (o CODICE FORNITORE) e PREZZO: i cartelli useranno i tuoi prezzi al posto di quelli promo del Consorzio.{" "}
              <a href={`/stampe/zoo/excel?prezzi=1&scope=${scopeParam}`}>Scarica il modello con le offerte in corso</a>
            </p>
            <form action={importPvPrices.bind(null, scopeParam)} style={{ display: "flex", gap: 8 }}>
              <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
              <button className="btn btn-sm" type="submit">Carica prezzi</button>
            </form>
          </div>
        )}

        <form method="get">
          <input type="hidden" name="scope" value={scopeParam} />
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, alignItems: "start" }}>
            {/* sinistra: promo del volantino in corso */}
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12.5, fontWeight: 700 }}>
                  Formato{" "}
                  <select name="formato" defaultValue={formato}>
                    <option value="a5">A5 (148×210)</option>
                    <option value="a4">A4 (210×297)</option>
                  </select>
                </label>
                <label style={{ fontSize: 12.5 }} title="Stampa 2 copie identiche A5 su un A4, da piegare fronte/retro">
                  <input type="checkbox" name="doppio" value="1" defaultChecked={doppio} /> doppio A5 su A4
                </label>
                <button className="btn btn-sm" type="submit">Aggiorna anteprima</button>
                {selected.length > 0 && (
                  <a
                    className="btn btn-sm" target="_blank"
                    href={`/stampe/zoo/stampa?${new URLSearchParams([
                      ["scope", scopeParam], ["formato", formato], ...(doppio ? [["doppio", "1"]] : []),
                      ["print", "1"], ...selected.map((o) => ["sel", o.id]),
                    ] as [string, string][]).toString()}`}
                  >
                    🖨️ Stampa {selected.length} cartelli
                  </a>
                )}
              </div>
              <div className="card table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}></th>
                      <th>Promo del volantino</th>
                      <th>Prezzo</th>
                      {scope.type !== "system" && <th className="no-print"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 && (
                      <tr><td colSpan={4} className="empty">Nessuna promo selezionata per il volantino: il Consorzio deve prima fare la selezione nella pagina Volantino.</td></tr>
                    )}
                    {visible.map((o) => {
                      const product = db.products.find((p) => p.id === o.productId);
                      const ownPrice = pvPriceFor(db, scope, o.ean, academyDb);
                      return (
                        <tr key={o.id}>
                          <td><input type="checkbox" name="sel" value={o.id} defaultChecked={selIds.includes(o.id)} /></td>
                          <td>
                            <strong style={{ fontSize: 13 }}>{o.descrizione}</strong>
                            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{product?.marca} · EAN {o.ean}</div>
                          </td>
                          <td>
                            <strong>€ {ownPrice ?? o.prezzoPromo}</strong>
                            {ownPrice && <div style={{ fontSize: 11, color: "#2c7a2c" }}>prezzo tuo PV</div>}
                          </td>
                          {scope.type !== "system" && (
                            <td className="no-print">
                              <button
                                className="btn btn-outline btn-sm" type="submit" title="Non ho in vendita questo prodotto: nascondilo"
                                formAction={toggleZooHidden.bind(null, scopeParam, "articolo", o.ean, "/stampe/zoo/stampa")}
                              >
                                🙈
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

            </div>

            {/* destra: anteprima */}
            <div>
              <strong style={{ fontSize: 13 }}>Anteprima ({selected.length} selezionati)</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                {selected.length === 0 && (
                  <div className="card" style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>
                    Seleziona a sinistra le promo da stampare e premi &quot;Aggiorna anteprima&quot;.
                  </div>
                )}
                {selected.slice(0, 8).map((o) => (
                  <ZooCartello key={o.id} data={cartelloData(db, scope, o, validita, academyDb)} formato={formato} scale={formato === "a4" ? 1.7 : 2.1} />
                ))}
                {selected.length > 8 && <p className="hint">…e altri {selected.length - 8} cartelli (visibili in stampa).</p>}
              </div>
            </div>
          </div>
        </form>

        {/* proposta di correzione al Consorzio (fuori dal form di selezione) */}
        <div className="card" style={{ marginTop: 14, padding: 12 }}>
          <strong style={{ fontSize: 13 }}>🚩 Proponi una correzione al Consorzio</strong>
          <SuggestionForm scopeParam={scopeParam} offers={visible} />
        </div>
      </div>
    </div>
  );
}

function SuggestionForm({ scopeParam, offers }: { scopeParam: string; offers: { id: string; descrizione: string }[] }) {
  return (
    <form action={sendZooSuggestion.bind(null, scopeParam)} style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "end", flexWrap: "wrap" }}>
      <input type="hidden" name="back" value="/stampe/zoo/stampa" />
      <label className="field" style={{ marginBottom: 0 }}>
        Offerta
        <select name="offerId">
          <option value="">— generale —</option>
          {offers.map((o) => <option key={o.id} value={o.id}>{o.descrizione.slice(0, 50)}</option>)}
        </select>
      </label>
      <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
        Messaggio
        <input type="text" name="message" placeholder="es. il prezzo listino è sbagliato, la foto non corrisponde…" required />
      </label>
      <button className="btn btn-outline btn-sm" type="submit">Invia</button>
    </form>
  );
}
