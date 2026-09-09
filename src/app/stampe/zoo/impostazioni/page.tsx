import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, hiddenEntriesFor, pvPromoCodesFor } from "@/lib/zoo";
import InlineEdit from "@/components/stampe/InlineEdit";
import {
  saveZooSettings, saveZooApiKey, saveFormatoRegola, toggleZooHidden, importPvPromo, rinominaPvPromoCode,
} from "@/lib/zoo-actions";

export default async function ZooImpostazioniPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  if (!["system_admin", "course_manager", "group_admin", "store_admin"].includes(user.role)) redirect("/stampe/zoo/dati");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isZooEditor(user);
  const hiddenHere = hiddenEntriesFor(db, scope);
  // codici promozione dell'ambito e quanti articoli ne hanno uno
  const codiciPromo = scope.type === "system" ? [] : pvPromoCodesFor(db, scope);
  const chiavePropria = db.scopeApiKeys.find((k) => k.scopeType === scope.type && k.scopeId === scope.id)?.key;
  const promoPerCodice = new Map<string, number>();
  for (const p of db.pvPromos) {
    if (p.scopeType !== scope.type || p.scopeId !== scope.id) continue;
    promoPerCodice.set(p.codice, (promoPerCodice.get(p.codice) ?? 0) + 1);
  }

  return (
    <div>
      <StampeHeader user={user} active="impostazioni" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Impostazioni — Cartelli ZOO</h1>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>
              Ambito{" "}
              <select name="scope" defaultValue={scopeParam} style={{ marginTop: 2 }}>
                {scopes.map((s) => (
                  <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {sp.salvate && <div className="alert alert-green">✓ Impostazioni salvate.</div>}
        {sp.chiave === "1" && <div className="alert alert-green">✓ Chiave API Claude salvata: il pulsante &quot;Associa con AI&quot; ora genera testi reali.</div>}
        {sp.chiave === "0" && <div className="alert alert-green">Chiave API rimossa: si torna al raggruppamento automatico con testi bozza.</div>}

        {consortium && (
          <>
            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <h2 style={{ marginTop: 0 }}>Impostazioni del Consorzio</h2>
              <form action={saveZooSettings.bind(null, scopeParam)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  Categorie di animale (una per riga: es. cane, gatto, roditori…)
                  <textarea name="categorieAnimali" rows={5} defaultValue={db.settings.categorieAnimali.join("\n")} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Caratteristiche di prodotto (una per riga: es. umido, secco, snack…)
                  <textarea name="caratteristicheProdotto" rows={5} defaultValue={db.settings.caratteristicheProdotto.join("\n")} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Etichette per le offerte del volantino (una per riga)
                  <textarea name="labels" rows={5} defaultValue={db.settings.labels.join("\n")} />
                </label>
                <div />
                <label className="field" style={{ marginBottom: 0 }}>
                  Schede standard del volantino (struttura di partenza per ogni campagna)
                  <textarea name="schedeDefault" rows={4} defaultValue={db.settings.schedeDefault.join("\n")} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Condizioni pronte per i cartelli (una per riga)
                  <textarea name="condizioniStandard" rows={4} defaultValue={db.settings.condizioniStandard.join("\n")}
                    placeholder={"Offerta valida fino a esaurimento scorte\nMassimo 3 pezzi per cliente"} />
                  <span className="hint">
                    Ogni insegna può poi scegliere la propria condizione sul singolo cartello, in Stampa cartelli.
                  </span>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Validità sui cartelli
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <input type="checkbox" name="condizioniConValidita" value="1"
                      defaultChecked={db.settings.condizioniConValidita ?? true} />
                    <span style={{ fontSize: 13 }}>
                      Aggiungi alle condizioni la validità del volantino
                    </span>
                  </span>
                  <span className="hint">
                    Es. «Promozione valida dal 17 settembre al 18 ottobre», costruita dalle date del volantino in
                    corso. In alternativa si può posizionare il campo <strong>Validità</strong> in un riquadro suo,
                    dalla pagina Layout.
                  </span>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Istruzioni per i testi del VOLANTINO (guidano anche l&apos;AI)
                  <textarea name="istruzioniVolantino" rows={4} defaultValue={db.settings.istruzioniVolantino} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Istruzioni per i testi dei CARTELLI (guidano anche l&apos;AI)
                  <textarea name="istruzioniCartello" rows={4} defaultValue={db.settings.istruzioniCartello} />
                </label>
                <div>
                  <button className="btn" type="submit">Salva impostazioni</button>
                </div>
              </form>
            </div>

            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <h2 style={{ marginTop: 0 }}>Formati consigliati per caratteristica</h2>
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
                Associa un formato di stampa a una caratteristica (es. Accessori → A5, Secco → A4).
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {db.settings.caratteristiche.map((c) => {
                  const rule = db.settings.formatoRegole.find((r) => r.caratteristica === c);
                  return (
                    <form key={c} action={saveFormatoRegola.bind(null, scopeParam)} style={{ display: "flex", gap: 6, alignItems: "center", border: "1px solid #eee", borderRadius: 8, padding: "6px 10px" }}>
                      <input type="hidden" name="caratteristica" value={c} />
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{c}</span>
                      <select name="formatId" defaultValue={rule?.formatId ?? ""} style={{ fontSize: 12 }}>
                        <option value="">—</option>
                        <option value="a5">A5</option>
                        <option value="a4">A4</option>
                      </select>
                      <button className="btn btn-outline btn-sm" type="submit">OK</button>
                    </form>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* chiave API propria dell'insegna/PV: per raggruppare i propri articoli con l'AI */}
        {scope.type !== "system" && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <h2 style={{ marginTop: 0 }}>Chiave API Claude di {scope.label}</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
              Serve al pulsante &quot;Associa con AI&quot; per raggruppare i <strong>vostri</strong> articoli in prodotti
              padre e scriverne i testi, usando il vostro credito invece di quello del Consorzio. Se non la mettete
              vale quella comune, se configurata. Stato:{" "}
              {chiavePropria
                ? <span className="pill pill-green">vostra chiave (…{chiavePropria.slice(-6)})</span>
                : db.settings.apiKey
                  ? <span className="pill pill-blue">si usa quella del Consorzio</span>
                  : <span className="pill pill-gray">nessuna chiave — raggruppamento automatico con testi bozza</span>}
            </p>
            <form action={saveZooApiKey.bind(null, scopeParam)} style={{ display: "flex", gap: 8 }}>
              <input type="password" name="apiKey" placeholder="sk-ant-…  (vuoto per rimuovere)" style={{ flex: 1, maxWidth: 420 }} />
              <button className="btn btn-sm" type="submit">Salva chiave</button>
            </form>
          </div>
        )}

        {/* chiave API: SOLO amministratore di sistema */}
        {user.role === "system_admin" && (
          <div className="card" style={{ padding: 14, marginBottom: 14, border: "2px solid #6d3fa7" }}>
            <h2 style={{ marginTop: 0 }}>Chiave API Claude (solo amministratore di sistema)</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
              Usata dal pulsante &quot;Associa con AI&quot; per raggruppare gli articoli e generare le descrizioni di volantino e cartelli
              secondo le istruzioni qui sopra. Stato attuale:{" "}
              {db.settings.apiKey
                ? <span className="pill pill-green">configurata (…{db.settings.apiKey.slice(-6)})</span>
                : <span className="pill pill-gray">non configurata — raggruppamento automatico con testi bozza</span>}
            </p>
            <form action={saveZooApiKey.bind(null, scopeParam)} style={{ display: "flex", gap: 8 }}>
              <input type="password" name="apiKey" placeholder="sk-ant-…  (vuoto per rimuovere)" style={{ flex: 1, maxWidth: 420 }} />
              <button className="btn btn-sm" type="submit">Salva chiave</button>
            </form>
          </div>
        )}

        {/* promozioni proprie dell'insegna/PV, caricate dal loro gestionale */}
        {scope.type !== "system" && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <h2 style={{ marginTop: 0 }}>Le promozioni di {scope.label}</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
              Carica il file del tuo gestionale: dice quali articoli tieni in assortimento e che promozione applichi
              a ciascuno. Le tue promozioni possono essere diverse da quelle del Consorzio — i cartelli seguiranno
              le tue. Colonne lette: <strong>barcode</strong>, <strong>assortimento</strong> (si/no),
              {" "}<strong>cod promo</strong>, <strong>prezzo fisso</strong>, data inizio e data fine.
            </p>
            {sp.promo !== undefined && (
              <div className="alert alert-green">
                ✓ Caricate {sp.promo} promozioni ({sp.prezzi} con prezzo fisso). {sp.nontenuti} articoli segnati come
                non tenuti: spariscono dai tuoi cartelli.
              </div>
            )}
            {sp.promoerr === "file" && <div className="alert alert-amber">Nessun file selezionato.</div>}
            {sp.promoerr === "consorzio" && <div className="alert alert-amber">Scegli prima la tua insegna o il tuo punto vendita qui in alto.</div>}
            <form action={importPvPromo.bind(null, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
              <button className="btn btn-sm" type="submit">Carica promozioni</button>
              <span className="hint">Ogni caricamento sostituisce il precedente: il file è la fotografia di adesso.</span>
            </form>

            <div style={{ marginTop: 14 }}>
              <strong style={{ fontSize: 13 }}>Come si chiamano i tuoi codici promozione</strong>
              <p className="hint" style={{ margin: "2px 0 8px" }}>
                Il nome è quello che finisce sul cartello, ed è anche la tipologia a cui puoi agganciare un layout
                dedicato (pagina Layout → «Quando usare questo layout»).
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th style={{ width: 120 }}>Codice</th><th>Nome sul cartello</th><th style={{ width: 130 }}>Articoli</th></tr></thead>
                  <tbody>
                    {codiciPromo.length === 0 && (
                      <tr><td colSpan={3} className="empty">Nessun codice ancora: carica il file qui sopra.</td></tr>
                    )}
                    {codiciPromo.map((c) => (
                      <tr key={c.codice}>
                        <td><strong>{c.codice}</strong></td>
                        <td>
                          <InlineEdit value={c.etichetta} placeholder="es. 20%"
                            onSave={rinominaPvPromoCode.bind(null, c.codice, scopeParam)} />
                        </td>
                        <td>{promoPerCodice.get(c.codice) ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* nascondi fornitori/marchi per insegna/PV */}
        {scope.type !== "system" && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <h2 style={{ marginTop: 0 }}>Elementi nascosti da {scope.label}</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
              Fornitori, marchi e articoli che questo ambito non tratta: non compaiono nelle pagine di stampa.
              Puoi gestirli anche dalla pagina Database prodotti.
            </p>
            {hiddenHere.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Nessun elemento nascosto.</p>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {hiddenHere.map((h) => (
                <form key={`${h.kind}_${h.value}`} action={toggleZooHidden.bind(null, scopeParam, h.kind, h.value, "/stampe/zoo/impostazioni")}>
                  <button type="submit" className="pill pill-gray" style={{ cursor: "pointer", border: "none" }} title="Clicca per rendere di nuovo visibile">
                    ✕ {h.kind}: {h.value}
                  </button>
                </form>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
