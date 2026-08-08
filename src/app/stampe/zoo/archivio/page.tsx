import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, isZooEditor, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, campagnaInLavorazione, campagnaInCorso, campagneArchiviate } from "@/lib/zoo";
import {
  archiviaVolantino, recuperaVolantino, eliminaDatiVolantino, eliminaVolantino,
} from "@/lib/zoo-actions";

/**
 * Archivio volantini: che fine hanno fatto i volantini passati e come liberare
 * spazio. Le foto dei prodotti non vengono toccate qui — restano nel database
 * condiviso finché servono; quelle che nessun volantino usa più compaiono come
 * "non usate" nella pagina Archivio file, da dove si eliminano.
 */
export default async function ZooArchivioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  if (!isZooEditor(user)) redirect("/stampe/zoo/volantino");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;

  const inLavorazione = campagnaInLavorazione(db);
  const inCorso = campagnaInCorso(db);
  const archiviate = campagneArchiviate(db);

  const fmt = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");
  const fmtTs = (d?: string) => (d ? new Date(d).toLocaleDateString("it-IT") : "—");
  const conta = (id: string) => db.offers.filter((o) => o.campaignId === id).length;
  const pagine = (id: string) => db.volantinoLayouts.find((l) => l.campaignId === id)?.pages.length ?? 0;

  return (
    <div>
      <StampeHeader user={user} active="archivio" area="zoo" />
      <div className="container">
        <h1 style={{ margin: 0 }}>Archivio volantini</h1>
        <p className="subtitle" style={{ margin: "4px 0 14px" }}>
          Ogni volantino passa da <strong>in lavorazione</strong> a <strong>chiuso</strong> (offerte in corso, cartelli
          ancora stampabili) e infine <strong>archiviato</strong>, quando se ne apre uno nuovo.
        </p>

        {sp.recuperato && <div className="alert alert-green">✓ Volantino recuperato: torna disponibile in Stampa cartelli.</div>}
        {sp.svuotato && <div className="alert alert-green">✓ Offerte e voti eliminati. È rimasto lo schema delle pagine, riutilizzabile come modello.</div>}
        {sp.eliminato && <div className="alert alert-green">✓ Volantino eliminato definitivamente.</div>}

        {/* volantini correnti */}
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <strong>Volantini correnti</strong>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {inLavorazione ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="pill pill-blue">in lavorazione</span>
                <strong>{inLavorazione.nome}</strong>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {fmt(inLavorazione.dal)} → {fmt(inLavorazione.al)} · {conta(inLavorazione.id)} offerte
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Nessun volantino in lavorazione: aprine uno da <a href="/stampe/zoo/offerte">Import offerte</a>.
              </div>
            )}
            {inCorso && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="pill pill-green">chiuso · offerte in corso</span>
                <strong>{inCorso.nome}</strong>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {fmt(inCorso.dal)} → {fmt(inCorso.al)} · {conta(inCorso.id)} offerte · chiuso il {fmtTs(inCorso.chiusaIl)}
                </span>
                <form action={archiviaVolantino.bind(null, inCorso.id, scopeParam)}>
                  <button className="btn btn-outline btn-sm" type="submit">Archivia adesso</button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* archiviati */}
        <div className="card table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Volantino</th>
                <th>Validità</th>
                <th>Offerte</th>
                <th>Schema pagine</th>
                <th>Archiviato il</th>
                <th style={{ width: 320 }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {archiviate.length === 0 && (
                <tr><td colSpan={6} className="empty">Nessun volantino archiviato.</td></tr>
              )}
              {archiviate.map((c) => {
                const n = conta(c.id);
                const svuotato = Boolean(c.svuotataIl);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong style={{ fontSize: 13 }}>{c.nome}</strong>
                      {svuotato && (
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          dati eliminati il {fmtTs(c.svuotataIl)}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{fmt(c.dal)} → {fmt(c.al)}</td>
                    <td>{svuotato ? <span className="pill pill-gray">—</span> : n}</td>
                    <td style={{ fontSize: 12.5 }}>{pagine(c.id) > 0 ? `${pagine(c.id)} pagine` : "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{fmtTs(c.archiviataIl)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {!svuotato && (
                          <form action={recuperaVolantino.bind(null, c.id, scopeParam)}>
                            <button className="btn btn-outline btn-sm" type="submit" title="Torna fra i volantini stampabili">
                              Recupera
                            </button>
                          </form>
                        )}
                        {!svuotato && n > 0 && (
                          <form action={eliminaDatiVolantino.bind(null, c.id, scopeParam)}>
                            <button
                              className="btn btn-outline btn-sm" type="submit"
                              title="Elimina offerte e voti, conserva lo schema delle pagine come modello"
                            >
                              Elimina offerte, tieni lo schema
                            </button>
                          </form>
                        )}
                        <form action={eliminaVolantino.bind(null, c.id, scopeParam)}>
                          <button className="btn btn-outline btn-sm danger" type="submit" title="Elimina tutto, schema compreso">
                            Elimina tutto
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 12 }}>
          Prodotti e prodotti padre non vengono mai eliminati da qui: sono il database condiviso e servono ai volantini
          futuri. Le foto che non risultano più usate da nessun volantino si eliminano dalla pagina{" "}
          <a href="/file">Archivio file</a>.
        </p>
      </div>
    </div>
  );
}
