import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { getDb } from "@/lib/db";
import { ROLE_LABELS, User } from "@/lib/types";
import { logout } from "@/lib/actions";

/**
 * Barra dell'area "Utenti e ruoli": vale per la tabella dei ruoli e per
 * l'Organizzazione (insegne, punti vendita, reparti, gruppi), che sono la stessa
 * materia — chi c'è e come è strutturato il consorzio — e stanno insieme invece
 * che sparse fra le aree.
 */
export default async function RuoliHeader({ user, active }: { user: User; active: "ruoli" | "organizzazione" }) {
  const db = await getDb();
  const voci = [
    { href: "/ruoli", label: "Utenti e ruoli", key: "ruoli" as const },
    { href: "/ruoli/organizzazione", label: "Organizzazione", key: "organizzazione" as const },
  ];

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="header-top">
          <Link href="/scegli" className="brand">
            <span className="brand-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={db.settings.logoUrl} alt="Garden Team" />
            </span>
            <span className="area-name" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Users size={16} /> Utenti e ruoli
            </span>
          </Link>
          <Link href="/scegli" style={{ color: "#e8f3ea", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ArrowLeft size={14} /> Cambia area
          </Link>
          <div className="user-chip">
            <div className="avatar">{user.firstName[0]}{user.lastName[0]}</div>
            <div>
              <div style={{ fontWeight: 700 }}>{user.firstName} {user.lastName}</div>
              <div style={{ opacity: 0.75, fontSize: 11 }}>{ROLE_LABELS[user.role]}</div>
            </div>
            <form action={logout}>
              <button className="logout-btn" type="submit">Esci</button>
            </form>
          </div>
        </div>
        <nav className="header-nav">
          {voci.map((v) => (
            <Link key={v.key} href={v.href} className={`nav-link ${active === v.key ? "active" : ""}`}>
              {v.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
