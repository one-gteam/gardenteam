import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import Cartello from "@/components/stampe/Cartello";
import StampaPicker from "@/components/stampe/StampaPicker";
import {
  getStampeDb,
  canAccessStampe,
  scopesForUser,
  resolveScope,
  effectiveLayout,
  filterProducts,
  cartelloValues,
  backgroundFor,
  fieldsForScope,
} from "@/lib/stampe";

export default async function StampaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");
  const sp = await searchParams;

  const db = await getStampeDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;

  const filtered = filterProducts(db, sp);
  const tipologie = [...new Set(db.products.map((p) => p.tipologia))].sort();
  const marche = [...new Set(db.products.map((p) => p.marca))].sort();

  const selectedIds = (sp.sel ?? "").split(",").filter(Boolean);
  const selected = selectedIds.map((id) => db.products.find((p) => p.id === id)).filter(Boolean) as typeof db.products;
  const globalFormatId = sp.formato ?? db.formats[0]?.id;
  const formatFor = (pid: string) => {
    const f = db.formats.find((x) => x.id === (sp[`formato_${pid}`] ?? globalFormatId)) ?? db.formats[0];
    return { ...f, background: backgroundFor(db, f, scope, academyDb) };
  };
  const doppio = sp.doppio === "1";

  const valuesFor = (p: (typeof db.products)[number]) => {
    const vals = cartelloValues(db, scope, p, academyDb);
    const customPrice = sp[`prezzo_${p.id}`];
    if (customPrice !== undefined && customPrice !== "") vals.prezzo = customPrice;
    if (sp[`noprezzo_${p.id}`] === "1") {
      delete vals.prezzo;
      delete vals.prezzoPromo;
    }
    // campi nascosti per questo cartello (scelta in fase di stampa)
    for (const fid of (sp[`nascondi_${p.id}`] ?? "").split(",").filter(Boolean)) {
      delete vals[fid];
    }
    return vals;
  };

  const qsBack = () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "print") params.set(k, v);
    return params.toString();
  };

  const scalePrint = 3.7795; // 1 mm = 3.7795 px a 96 dpi → stampa a dimensione reale

  if (sp.print === "1" && selected.length > 0) {
    // in stampa: ogni cartello con il suo formato; opzione A5 doppia copia
    const toPrint = selected.flatMap((p) =>
      doppio && formatFor(p.id).id === "a5" ? [p, p] : [p]
    );
    return (
      <div>
        <div className="no-print" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", background: "var(--green-50)", flexWrap: "wrap" }}>
          <strong>Anteprima di stampa — {toPrint.length} cartelli</strong>
          <a className="btn btn-outline btn-sm" href={`/stampe/arredo/stampa?${qsBack()}`}>← Torna alla selezione</a>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Usa il pulsante Stampa del browser (Ctrl+P) e scegli &quot;Salva come PDF&quot;.
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {toPrint.map((p, i) => (
            <div key={`${p.id}_${i}`} style={{ pageBreakInside: "avoid" }}>
              <Cartello
                format={formatFor(p.id)}
                layout={effectiveLayout(db, scope, formatFor(p.id).id, academyDb, p.tipologia)}
                fields={db.fields}
                values={valuesFor(p)}
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
      <StampeHeader user={user} active="stampa" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Stampa cartelli</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              Versione dati e layout di: <strong>{scope.label}</strong>
            </p>
          </div>
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
            <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} /></label>
            <label className="field" style={{ marginBottom: 0 }}>
              Tipologia
              <select name="tipologia" defaultValue={sp.tipologia ?? ""}>
                <option value="">Tutte</option>
                {tipologie.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Marca
              <select name="marca" defaultValue={sp.marca ?? ""}>
                <option value="">Tutte</option>
                {marche.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">🔍 Filtra</button>
          </form>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 300px", gap: 16, alignItems: "start" }}>
          <StampaPicker
            products={filtered.slice(0, 150).map((p) => ({
              id: p.id,
              titolo: p.fields.titolo ?? "",
              codice: p.codice,
              prezzo: p.fields.prezzo ?? "",
              tipologia: p.tipologia,
            }))}
            formats={db.formats.map((f) => ({ id: f.id, name: f.name }))}
            scopeParam={scopeParam}
            filters={{ q: sp.q ?? "", tipologia: sp.tipologia ?? "", marca: sp.marca ?? "" }}
            initialSelected={selectedIds}
            initialFormats={Object.fromEntries(
              selectedIds.map((id) => [id, sp[`formato_${id}`] ?? globalFormatId]).filter(([, v]) => v)
            )}
            initialPrices={Object.fromEntries(
              selectedIds.map((id) => [id, sp[`prezzo_${id}`] ?? ""]).filter(([, v]) => v)
            )}
            initialNoPrice={Object.fromEntries(selectedIds.map((id) => [id, sp[`noprezzo_${id}`] === "1"]))}
            initialHidden={Object.fromEntries(
              selectedIds.map((id) => [id, (sp[`nascondi_${id}`] ?? "").split(",").filter(Boolean)])
            )}
            fields={fieldsForScope(db, scope, academyDb)
              .filter((f) => !["codice"].includes(f.id))
              .map((f) => ({ id: f.id, label: f.label }))}
            globalFormat={globalFormatId}
          />

          {/* anteprima */}
          <div>
            {selected.slice(0, 2).map((p) => (
              <div key={p.id} style={{ marginBottom: 12 }}>
                <Cartello
                  format={formatFor(p.id)}
                  layout={effectiveLayout(db, scope, formatFor(p.id).id, academyDb, p.tipologia)}
                  fields={db.fields}
                  values={valuesFor(p)}
                  scale={formatFor(p.id).w > 150 ? 1.35 : 2}
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
