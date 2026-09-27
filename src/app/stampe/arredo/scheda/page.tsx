import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { gestisce } from "@/lib/types";
import StampeHeader from "@/components/stampe/StampeHeader";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import QrSvg from "@/components/stampe/QrSvg";
import {
  getStampeDb, canAccessArea, gestisceArea, scopesForUser, resolveScope, isStoreBlocked, fieldsForScope, visibilitaCampo,
  schedaOnlinePer, schedaUrl, insegnaDiScope,
} from "@/lib/stampe";
import { elencoGruppi, gruppoDi, isImageField } from "@/lib/cartello-campi";
import { salvaSchedaOnline, salvaVisibilitaCampo, salvaVisibilitaGruppo } from "@/lib/stampe-actions";

/*
 * Scheda online: cosa vede il cliente inquadrando il QR code del cartello.
 * Per ogni campo si decide se sta sul cartello stampato, sulla scheda online
 * o su entrambi — anche per gruppo intero ("tutte le misure solo online").
 * Le scelte valgono per l'ambito in alto e discendono ai suoi punti vendita.
 */
export default async function SchedaOnlinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "arredo")) redirect("/studente");
  if (!gestisce(user, "arredo")) redirect("/stampe/arredo/stampa");
  const sp = await searchParams;

  const db = await getStampeDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const canEdit = !isStoreBlocked(db, scope) && gestisceArea(user, "arredo", scope, academyDb);

  const pref = schedaOnlinePer(db, scope, academyDb);
  const campi = fieldsForScope(db, scope, academyDb).filter((f) => !isImageField(f, f.id));
  const gruppi = elencoGruppi(campi);
  const insegna = insegnaDiScope(scope, academyDb);
  const esempio = db.products[0];
  const urlEsempio = esempio ? schedaUrl(scope, esempio) : "";
  const soloOnline = campi.filter((f) => { const v = visibilitaCampo(db, scope, f.id, academyDb); return v.online && !v.cartello; });
  const soloCartello = campi.filter((f) => { const v = visibilitaCampo(db, scope, f.id, academyDb); return !v.online && v.cartello; });

  return (
    <div>
      <StampeHeader user={user} active="scheda" />
      <div className="container">
        <div className="stampa-testata">
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Scheda online</h1>
            <p className="subtitle">
              Cosa vede il cliente inquadrando il QR code del cartello di <strong>{scope.label}</strong>
              {insegna ? <> — la pagina porta il logo e i colori di <strong>{insegna.name}</strong></> : " — la pagina porta il marchio Garden Team"}.
            </p>
          </div>
          <form method="get">
            <label className="field">
              Insegna / PV
              <select name="scope" defaultValue={scopeParam}>
                {scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {!canEdit && (
          <div className="alert alert-amber">Stai vedendo le scelte in vigore per {scope.label}: per cambiarle seleziona un ambito che gestisci.</div>
        )}

        <div className="grid grid-2" style={{ alignItems: "start", marginBottom: 18 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>La scheda</h3>
            <ModuloAutoSalva azione={salvaSchedaOnline.bind(null, scopeParam)}>
              <fieldset disabled={!canEdit} style={{ border: "none", padding: 0, margin: 0 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, marginBottom: 10 }}>
                  <input type="checkbox" name="attiva" defaultChecked={pref.attiva} />
                  Scheda online accesa (il QR code esce sui cartelli)
                </label>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Online si vede</div>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                  <input type="radio" name="modo" value="tutto" defaultChecked={pref.modo === "tutto"} style={{ marginTop: 3 }} />
                  <span>tutta la scheda: i campi ammessi online qui sotto, compresi quelli già stampati<br /><span className="hint">es. tutto tranne il prezzo, che resta solo sul cartello</span></span>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
                  <input type="radio" name="modo" value="extra" defaultChecked={pref.modo === "extra"} style={{ marginTop: 3 }} />
                  <span>solo gli approfondimenti: i campi che non stanno sul cartello<br /><span className="hint">titolo e foto ci sono sempre, così il cliente sa di cosa si parla</span></span>
                </label>
                <label className="field">
                  Frase in testa alla scheda (facoltativa)
                  <input type="text" name="benvenuto" defaultValue={pref.benvenuto} placeholder="es. Grazie per averci scelto! Ecco tutto quello che c'è da sapere." maxLength={200} />
                </label>
              </fieldset>
            </ModuloAutoSalva>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Come funziona</h3>
            <ol style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>
              <li>Nella pagina <a href={`/stampe/arredo/layout?scope=${scopeParam}`}>Layout</a> aggiungi l&apos;elemento «QR code scheda online» al cartello (almeno 15 mm di lato).</li>
              <li>Qui sotto decidi campo per campo cosa va sul cartello e cosa online.</li>
              <li>Il cliente inquadra il codice e apre la scheda dal cellulare: niente PDF, si legge e si condivide come una pagina.</li>
            </ol>
            {esempio && (
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <QrSvg testo={urlEsempio} style={{ width: 96, height: 96, border: "1px solid var(--line)", borderRadius: 8 }} />
                <div style={{ fontSize: 13 }}>
                  <div className="hint">Esempio con «{esempio.fields.titolo}»</div>
                  <a href={urlEsempio} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{urlEsempio}</a>
                  <div className="hint" style={{ marginTop: 4 }}>Ogni prodotto ha il suo indirizzo, uno per insegna o PV: il cliente di {insegna?.name ?? "Garden Team"} vede la scheda di {insegna?.name ?? "Garden Team"}.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="section-head">
          <h2>Dove si vede ogni campo</h2>
          <span className="hint">
            {soloOnline.length > 0 && <>solo online: {soloOnline.map((f) => f.label).join(", ")} · </>}
            {soloCartello.length > 0 && <>solo sul cartello: {soloCartello.map((f) => f.label).join(", ")} · </>}
            i gruppi si cambiano in Impostazioni
          </span>
        </div>
        {gruppi.map((g) => (
          <div className="card" key={g} style={{ marginBottom: 12, padding: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <h3 style={{ margin: 0, flex: 1 }}>{g}</h3>
              {canEdit && (
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="hint">tutto il gruppo:</span>
                  <PulsanteAzione azione={salvaVisibilitaGruppo.bind(null, g, scopeParam, "entrambi")}>cartello + online</PulsanteAzione>
                  <PulsanteAzione azione={salvaVisibilitaGruppo.bind(null, g, scopeParam, "online")}>solo online</PulsanteAzione>
                  <PulsanteAzione azione={salvaVisibilitaGruppo.bind(null, g, scopeParam, "cartello")}>solo cartello</PulsanteAzione>
                </span>
              )}
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Campo</th><th style={{ width: 300 }}>Dove si vede</th><th>Effetto</th></tr></thead>
                <tbody>
                  {campi.filter((f) => gruppoDi(f) === g).map((f) => {
                    const v = visibilitaCampo(db, scope, f.id, academyDb);
                    const effetto = v.cartello && v.online ? "cartello e scheda" : v.cartello ? "solo sul cartello stampato" : v.online ? "solo online, dal QR code" : "da nessuna parte";
                    return (
                      <tr key={f.id}>
                        <td><strong>{f.label}</strong>{f.nota && <div className="hint">{f.nota}</div>}</td>
                        <td>
                          {canEdit ? (
                            <ModuloAutoSalva azione={salvaVisibilitaCampo.bind(null, f.id, scopeParam)} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" name="cartello" defaultChecked={v.cartello} /> sul cartello</label>
                              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" name="online" defaultChecked={v.online} /> online</label>
                            </ModuloAutoSalva>
                          ) : (
                            <span style={{ fontSize: 13 }}>{v.cartello ? "✓ cartello" : "— cartello"} · {v.online ? "✓ online" : "— online"}</span>
                          )}
                        </td>
                        <td className="hint">{effetto}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="hint">
          «Sul cartello» è la stessa scelta della spunta «nascondi» nella pagina Dati prodotti: nascosto lì = non sul cartello qui.
          In fase di stampa si può comunque togliere un campo da un singolo cartello.
        </p>
      </div>
    </div>
  );
}
