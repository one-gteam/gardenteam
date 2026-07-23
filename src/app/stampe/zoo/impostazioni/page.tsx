import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessStampe, isConsortiumEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, hiddenEntriesFor } from "@/lib/zoo";
import { saveZooSettings, saveZooApiKey, saveFormatoRegola, toggleZooHidden } from "@/lib/zoo-actions";

export default async function ZooImpostazioniPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");
  if (!["system_admin", "course_manager", "group_admin", "store_admin"].includes(user.role)) redirect("/stampe/zoo/dati");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isConsortiumEditor(user);
  const hiddenHere = hiddenEntriesFor(db, scope);

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
              <h2 style={{ marginTop: 0 }}>🏛️ Impostazioni del Consorzio</h2>
              <form action={saveZooSettings.bind(null, scopeParam)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  Caratteristiche prodotto (una per riga: es. umido, secco, cane, gatto…)
                  <textarea name="caratteristiche" rows={5} defaultValue={db.settings.caratteristiche.join("\n")} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Etichette per le offerte del volantino (una per riga)
                  <textarea name="labels" rows={5} defaultValue={db.settings.labels.join("\n")} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Schede standard del volantino (struttura di partenza per ogni campagna)
                  <textarea name="schedeDefault" rows={4} defaultValue={db.settings.schedeDefault.join("\n")} />
                </label>
                <div />
                <label className="field" style={{ marginBottom: 0 }}>
                  Istruzioni per i testi del VOLANTINO (guidano anche l&apos;AI)
                  <textarea name="istruzioniVolantino" rows={4} defaultValue={db.settings.istruzioniVolantino} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Istruzioni per i testi dei CARTELLI (guidano anche l&apos;AI)
                  <textarea name="istruzioniCartello" rows={4} defaultValue={db.settings.istruzioniCartello} />
                </label>
                <div>
                  <button className="btn" type="submit">💾 Salva impostazioni</button>
                </div>
              </form>
            </div>

            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <h2 style={{ marginTop: 0 }}>📐 Formati consigliati per caratteristica</h2>
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

        {/* chiave API: SOLO amministratore di sistema */}
        {user.role === "system_admin" && (
          <div className="card" style={{ padding: 14, marginBottom: 14, border: "2px solid #6d3fa7" }}>
            <h2 style={{ marginTop: 0 }}>🔑 Chiave API Claude (solo amministratore di sistema)</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
              Usata dal pulsante &quot;✨ Associa con AI&quot; per raggruppare gli articoli e generare le descrizioni di volantino e cartelli
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

        {/* nascondi fornitori/marchi per insegna/PV */}
        {scope.type !== "system" && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <h2 style={{ marginTop: 0 }}>🙈 Elementi nascosti da {scope.label}</h2>
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
