import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import { getStampeDb, canAccessStampe, isConsortiumEditor } from "@/lib/stampe";
import { resolveReport } from "@/lib/stampe-actions";

export default async function StampeHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");

  const db = await getStampeDb();
  const academy = await getDb();
  const openReports = db.reports.filter((r) => r.status === "aperta");

  return (
    <div>
      <StampeHeader user={user} active="home" />
      <div className="container">
        <h1>🖨️ Stampe Garden Team</h1>
        <p className="subtitle">
          Cartelli con database comune del Consorzio e personalizzazioni per insegna e punto vendita.
        </p>

        <div className="grid grid-3">
          <a className="card card-link" href="/stampe/arredo/dati">
            <div style={{ fontSize: 34 }}>🪑</div>
            <h3>Cartelli Arredo Giardino</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              {db.products.length} prodotti · {db.formats.length} formati · dati dall&apos;Excel 2026 Garden Team
            </p>
            <span className="pill pill-green">Attiva</span>
          </a>
          <a className="card card-link" href="/stampe/zoo/dati">
            <div style={{ fontSize: 34 }}>🐾</div>
            <h3>Cartelli Offerte ZOO</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Database prodotti con foto, import offerte mensili, volantino con voti dei PV e cartelli promo.
            </p>
            <span className="pill pill-green">Attiva</span>
          </a>
          <div className="card" style={{ opacity: 0.55 }}>
            <div style={{ fontSize: 34 }}>🌸</div>
            <h3>Cartelli Piante</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Prevista in una fase successiva.</p>
            <span className="pill pill-gray">In preparazione</span>
          </div>
        </div>

        {isConsortiumEditor(user) && (
          <div className="section">
            <div className="section-head">
              <h2>🚩 Segnalazioni dai punti vendita ({openReports.length})</h2>
              <span className="hint">errori nei dati segnalati da insegne e PV</span>
            </div>
            <div className="card table-wrap">
              <table className="data">
                <thead><tr><th>Prodotto</th><th>Campo</th><th>Segnalazione</th><th>Da</th><th></th></tr></thead>
                <tbody>
                  {openReports.length === 0 && <tr><td colSpan={5} className="empty">Nessuna segnalazione aperta. 🎉</td></tr>}
                  {openReports.map((r) => {
                    const p = db.products.find((x) => x.id === r.productId);
                    const f = db.fields.find((x) => x.id === r.fieldId);
                    const u = academy.users.find((x) => x.id === r.userId);
                    return (
                      <tr key={r.id}>
                        <td>
                          <a href={`/stampe/arredo/dati?prodotto=${r.productId}`} style={{ color: "inherit" }}>
                            <strong>{p?.fields.titolo}</strong>
                          </a>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>{p?.codice}</div>
                        </td>
                        <td><span className="pill pill-blue">{f?.label}</span></td>
                        <td style={{ maxWidth: 300 }}>{r.message}</td>
                        <td style={{ fontSize: 13 }}>
                          {u ? `${u.firstName} ${u.lastName}` : "—"}
                          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{new Date(r.date).toLocaleDateString("it-IT")}</div>
                        </td>
                        <td>
                          <form action={resolveReport.bind(null, r.id)}>
                            <button className="btn btn-outline btn-sm" type="submit">✓ Risolta</button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
