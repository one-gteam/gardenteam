import { redirect } from "next/navigation";
import { GraduationCap, Armchair, PawPrint, Flower2, Users, ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { userSites, postLoginPath } from "@/lib/types";
import { canManageUsers } from "@/lib/logic";
import { logout } from "@/lib/actions";

/** Schede delle macroaree, con fotografia di copertina in stile My Rosaflor. */
export default async function ScegliPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const sites = userSites(user);

  // la Gestione Ruoli è un'area a sé: sistema e insegna sempre; PV solo se delegato
  const showRuoli =
    user.role === "system_admin" ||
    user.role === "group_admin" ||
    (user.role === "store_admin" && canManageUsers(db, user));

  if (sites.length === 1 && !showRuoli) redirect(postLoginPath(user));

  const academyHome = user.role === "student" ? "/studente" : "/admin";

  const aree = [
    ...(sites.includes("academy")
      ? [{
          href: academyHome, foto: "/immagini/aree/formazione.jpg", icona: <GraduationCap size={18} />,
          titolo: "Academy", desc: "Formazione del personale", attiva: true,
        }]
      : []),
    ...(sites.includes("arredo")
      ? [{
          href: "/stampe/arredo/dati", foto: "/immagini/aree/arredo.jpg", icona: <Armchair size={18} />,
          titolo: "Cartelli Arredo", desc: "Cartelli arredo giardino", attiva: true,
        }]
      : []),
    ...(sites.includes("zoo")
      ? [{
          href: "/stampe/zoo/dati", foto: "/immagini/aree/zoo.jpg", icona: <PawPrint size={18} />,
          titolo: "Offerte Zoo", desc: "Volantino e cartelli promo", attiva: true,
        }]
      : []),
    ...(sites.includes("piante")
      ? [{
          href: "#", foto: "/immagini/aree/piante.jpg", icona: <Flower2 size={18} />,
          titolo: "Cartelli Piante", desc: "In preparazione", attiva: false,
        }]
      : []),
    ...(showRuoli
      ? [{
          href: "/ruoli", foto: "/immagini/aree/ruoli.jpg", icona: <Users size={18} />,
          titolo: "Gestione Ruoli", desc: "Utenti, ruoli e accessi alle aree", attiva: true,
        }]
      : []),
  ];

  const { settings } = db;

  return (
    <div>
      <div className="login-hero" style={{ paddingBottom: 130 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.logoUrl} alt="Garden Team" style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>Garden Team</span>
        </div>
        <p>Ciao {user.firstName}! Dove vuoi andare oggi?</p>
      </div>
      <div className="login-cards" style={{ maxWidth: 1180 }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {aree.map((a) =>
            a.attiva ? (
              <a key={a.titolo} className="area-card" href={a.href}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.foto} alt="" className="area-photo" />
                <span className="area-body">
                  <span className="area-title">{a.icona} {a.titolo}</span>
                  <span className="area-desc">{a.desc}</span>
                  <span className="area-cta">Entra <ArrowRight size={14} /></span>
                </span>
              </a>
            ) : (
              <div key={a.titolo} className="area-card disabled">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.foto} alt="" className="area-photo" />
                <span className="area-body">
                  <span className="area-title">{a.icona} {a.titolo}</span>
                  <span className="area-desc">{a.desc}</span>
                  <span className="pill pill-gray" style={{ alignSelf: "flex-start" }}>Presto</span>
                </span>
              </div>
            )
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
