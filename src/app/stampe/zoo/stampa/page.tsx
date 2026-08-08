import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import Cartello from "@/components/stampe/Cartello";
import StampaPicker from "@/components/stampe/StampaPicker";
import { canAccessArea, scopesForUser, resolveScope } from "@/lib/stampe";
import {
  getZooDb, effectiveZooLayout, zooCartelloValues, pvPriceFor, isZooHidden,
  campagneStampabili, campagnaInCorso, campagnaInLavorazione, campaignStato,
  ZOO_FIELDS, ZOO_FORMATS,
} from "@/lib/zoo";

/** Stampa cartelli Offerte Zoo: stesso impianto dell'Arredo (selezione, formati per riga, stampa 1:1). */
export default async function ZooStampaPage({
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
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;

  /*
   * Si stampano i cartelli di due periodi promozionali: quello IN CORSO a scaffale
   * e quello IN PREPARAZIONE (i cartelli si stampano prima che le offerte partano).
   * Di default si apre quello in corso, che è il caso di tutti i giorni.
   */
  const stampabili = campagneStampabili(db);
  const campaign =
    stampabili.find((c) => c.id === sp.campagna) ?? campagnaInCorso(db) ?? campagnaInLavorazione(db);
  const allOffers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];
  const etichettaPeriodo = (c: (typeof stampabili)[number]) => {
    const p = campaignStato(c) === "lavorazione" ? "in preparazione" : "in corso";
    const d = (x: string) => (x ? new Date(`${x}T00:00:00`).toLocaleDateString("it-IT") : "—");
    return `${c.nome} (${p}: ${d(c.dal)} → ${d(c.al)})`;
  };
  const q = (sp.q ?? "").toLowerCase();
  const visible = allOffers.filter((o) => {
    const product = db.products.find((p) => p.id === o.productId);
    if (product && isZooHidden(db, scope, product, academyDb)) return false;
    if (sp.scheda && o.schedaId !== sp.scheda) return false;
    if (sp.marca && product?.marca !== sp.marca) return false;
    if (q && !`${o.descrizione} ${o.ean} ${product?.marca ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const marche = [...new Set(allOffers.map((o) => db.products.find((p) => p.id === o.productId)?.marca).filter(Boolean) as string[])].sort();

  const selectedIds = (sp.sel ?? "").split(",").filter(Boolean);
  const selected = selectedIds.map((id) => allOffers.find((o) => o.id === id)).filter(Boolean) as typeof allOffers;
  const globalFormatId = sp.formato ?? ZOO_FORMATS[0].id;
  const formatFor = (oid: string) => ZOO_FORMATS.find((f) => f.id === (sp[`formato_${oid}`] ?? globalFormatId)) ?? ZOO_FORMATS[0];

  const valuesFor = (o: (typeof allOffers)[number]) => {
    const vals = zooCartelloValues(db, o);
    const pv = pvPriceFor(db, scope, o.ean, academyDb);
    if (pv) vals.prezzoPromo = `€ ${pv}`;
    const customPrice = sp[`prezzo_${o.id}`];
    if (customPrice !== undefined && customPrice !== "") vals.prezzoPromo = `€ ${customPrice}`;
    if (sp[`noprezzo_${o.id}`] === "1") {
      delete vals.prezzoPromo;
      delete vals.prezzoListino;
    }
    for (const fid of (sp[`nascondi_${o.id}`] ?? "").split(",").filter(Boolean)) delete vals[fid];
    return vals;
  };

  const qsBack = () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "print") params.set(k, v);
    return params.toString();
  };

  const scalePrint = 3.7795; // 1 mm = 3.7795 px a 96 dpi → stampa a dimensione reale
  const doppio = sp.doppio === "1";

  if (sp.print === "1" && selected.length > 0) {
    const toPrint = selected.flatMap((o) => (doppio && formatFor(o.id).id === "za5" ? [o, o] : [o]));
    return (
      <div>
        <div className="no-print" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", background: "var(--green-50)", flexWrap: "wrap" }}>
          <strong>Anteprima di stampa — {toPrint.length} cartelli</strong>
          <a className="btn btn-outline btn-sm" href={`/stampe/zoo/stampa?${qsBack()}`}>← Torna alla selezione</a>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Usa il pulsante Stampa del browser (Ctrl+P) e scegli &quot;Salva come PDF&quot;.
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {toPrint.map((o, i) => (
            <div key={`${o.id}_${i}`} style={{ pageBreakInside: "avoid" }}>
              <Cartello
                format={formatFor(o.id)}
                layout={{ ...effectiveZooLayout(db, scope, formatFor(o.id).id), tipologie: [] }}
                fields={ZOO_FIELDS}
                values={valuesFor(o)}
                scale={scalePrint}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <StampeHeader user={user} active="stampa" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Stampa cartelli</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {campaign ? `${campaign.nome} · versione dati e layout di: ` : "Nessun volantino da stampare · ambito: "}
              <strong>{scope.label}</strong>
            </p>
          </div>
          {/* periodo promozionale: quello in corso a scaffale o quello in preparazione */}
          {stampabili.length > 1 && (
            <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <input type="hidden" name="scope" value={scopeParam} />
              <label className="field" style={{ marginBottom: 0 }}>
                Periodo promozionale
                <select name="campagna" defaultValue={campaign?.id ?? ""}>
                  {stampabili.map((c) => (
                    <option key={c.id} value={c.id}>{etichettaPeriodo(c)}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-sm" type="submit">Cambia</button>
            </form>
          )}
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            {Object.entries(sp).map(([k, v]) => (k !== "scope" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <label className="field" style={{ marginBottom: 0 }}>
              Insegna / PV
              <select name="scope" defaultValue={scopeParam}>
                {scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <form method="get" style={{ display: "grid", gridTemplateColumns: "2fr 2fr 2fr auto", gap: 10, alignItems: "end" }}>
            <input type="hidden" name="scope" value={scopeParam} />
            <input type="hidden" name="sel" value={sp.sel ?? ""} />
            {campaign && <input type="hidden" name="campagna" value={campaign.id} />}
            <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="descrizione, EAN, marca" /></label>
            <label className="field" style={{ marginBottom: 0 }}>
              Scheda volantino
              <select name="scheda" defaultValue={sp.scheda ?? ""}>
                <option value="">Tutte le offerte</option>
                {(campaign?.schede ?? []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Marca
              <select name="marca" defaultValue={sp.marca ?? ""}>
                <option value="">Tutte</option>
                {marche.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">Filtra</button>
          </form>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 300px", gap: 16, alignItems: "start" }}>
          <StampaPicker
            products={visible.slice(0, 150).map((o) => {
              const product = db.products.find((p) => p.id === o.productId);
              return {
                id: o.id,
                titolo: o.descrizione,
                codice: o.ean,
                prezzo: pvPriceFor(db, scope, o.ean, academyDb) ?? o.prezzoPromo,
                tipologia: product?.marca ?? "",
              };
            })}
            formats={ZOO_FORMATS.map((f) => ({ id: f.id, name: f.name }))}
            scopeParam={scopeParam}
            filters={{ q: sp.q ?? "", scheda: sp.scheda ?? "", marca: sp.marca ?? "", campagna: campaign?.id ?? "" }}
            initialSelected={selectedIds}
            initialFormats={Object.fromEntries(
              selectedIds.map((id) => [id, sp[`formato_${id}`] ?? globalFormatId]).filter(([, v]) => v)
            )}
            initialPrices={Object.fromEntries(selectedIds.map((id) => [id, sp[`prezzo_${id}`] ?? ""]).filter(([, v]) => v))}
            initialNoPrice={Object.fromEntries(selectedIds.map((id) => [id, sp[`noprezzo_${id}`] === "1"]))}
            initialHidden={Object.fromEntries(
              selectedIds.map((id) => [id, (sp[`nascondi_${id}`] ?? "").split(",").filter(Boolean)])
            )}
            fields={ZOO_FIELDS.map((f) => ({ id: f.id, label: f.label }))}
            globalFormat={globalFormatId}
            baseUrl="/stampe/zoo/stampa"
          />

          {/* anteprima */}
          <div>
            {selected.slice(0, 2).map((o) => (
              <div key={o.id} style={{ marginBottom: 12 }}>
                <Cartello
                  format={formatFor(o.id)}
                  layout={{ ...effectiveZooLayout(db, scope, formatFor(o.id).id), tipologie: [] }}
                  fields={ZOO_FIELDS}
                  values={valuesFor(o)}
                  scale={formatFor(o.id).w > 150 ? 1.6 : 2.4}
                />
              </div>
            ))}
            {selected.length === 0 && (
              <div className="card"><p className="empty">L&apos;anteprima appare dopo &quot;Aggiorna anteprima&quot;.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
