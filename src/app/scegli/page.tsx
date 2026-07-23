import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { userSites, postLoginPath } from "@/lib/types";
import { logout } from "@/lib/actions";

export default async function ScegliPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sites = userSites(user);
  if (sites.length === 1) redirect(postLoginPath(user));

  const { settings } = await getDb();
  const academyHome = user.role === "student" ? "/studente" : "/admin";

  return (
    <div>
      <div className="login-hero" style={{ paddingBottom: 130 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.logoUrl} alt="Garden Team" style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>Garden Team</span>
        </div>
        <p>
          Ciao {user.firstName}! Dove vuoi andare oggi?
        </p>
      </div>
      <div className="login-cards" style={{ maxWidth: 900 }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {sites.includes("academy") && (
            <a className="card card-link" href={academyHome} style={{ textAlign: "center", padding: 28 }}>
              <div style={{ fontSize: 44 }}>🎓</div>
              <h3>Academy</h3>
              <p style={{ fontSize: 13, color: "var(--muted)" }}>Formazione del personale</p>
              <span className="pill pill-green">Entra →</span>
            </a>
          )}
          {sites.includes("stampe") && (
            <>
              <a className="card card-link" href="/stampe/arredo/dati" style={{ textAlign: "center", padding: 28 }}>
                <div style={{ fontSize: 44 }}>🪑</div>
                <h3>Stampa Cartelli Arredo</h3>
                <p style={{ fontSize: 13, color: "var(--muted)" }}>Cartelli arredo giardino</p>
                <span className="pill pill-green">Entra →</span>
              </a>
              <a className="card card-link" href="/stampe/zoo/dati" style={{ textAlign: "center", padding: 28 }}>
                <div style={{ fontSize: 44 }}>🐾</div>
                <h3>Stampa Cartelli Offerte Zoo</h3>
                <p style={{ fontSize: 13, color: "var(--muted)" }}>Volantino e cartelli promo</p>
                <span className="pill pill-green">Entra →</span>
              </a>
              <div className="card" style={{ textAlign: "center", padding: 28, opacity: 0.5 }}>
                <div style={{ fontSize: 44 }}>🌸</div>
                <h3>Stampa Cartelli Piante</h3>
                <p style={{ fontSize: 13, color: "var(--muted)" }}>In preparazione</p>
                <span className="pill pill-gray">Presto</span>
              </div>
            </>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <form action={logout} style={{ display: "inline" }}>
            <button className="btn btn-outline btn-sm" type="submit">Esci</button>
          </form>
        </div>
        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, marginTop: 18 }}>
          In produzione: questa scelta vive su <strong>one.gardenteam.biz</strong>; chi arriva direttamente da
          academy.gardenteam.biz o stampe.gardenteam.biz entra senza passare di qui.
        </p>
      </div>
    </div>
  );
}
