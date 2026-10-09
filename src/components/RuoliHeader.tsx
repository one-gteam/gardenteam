import Link from "next/link";
import { Users } from "lucide-react";
import { getDb } from "@/lib/db";
import { permessoRuolo, ROLE_LABELS, User } from "@/lib/types";
import { logout } from "@/lib/actions";
import HeaderMenu from "@/components/HeaderMenu";

/**
 * Barra dell'area "Utenti e ruoli": vale per la tabella dei ruoli e per
 * l'Organizzazione (insegne, punti vendita, reparti, gruppi), che sono la stessa
 * materia — chi c'è e come è strutturato il consorzio — e stanno insieme invece
 * che sparse fra le aree.
 */
export default async function RuoliHeader({ user, active }: { user: User; active: "ruoli" | "organizzazione" | "permessi" | "email" }) {
  const db = await getDb();
  // chi ha solo l'incarico "gestisce utenti" non tocca insegne, reparti e parole segrete
  const voci = [
    { href: "/ruoli", label: "Utenti e ruoli", key: "ruoli" as const },
    ...(["system_admin", "group_admin", "store_admin"].includes(user.role) && permessoRuolo(user.role, "organizzazione")
      ? [{ href: "/ruoli/organizzazione", label: "Organizzazione", key: "organizzazione" as const }]
      : []),
    { href: "/ruoli/permessi", label: "Permessi", key: "permessi" as const },
    // l'email di benvenuto GT One: il Consorzio quella comune, insegna e PV la loro versione
    ...(user.role === "system_admin" || (["group_admin", "store_admin"].includes(user.role) && permessoRuolo(user.role, "modelliEmail"))
      ? [{ href: "/ruoli/email", label: "Email", key: "email" as const }]
      : []),
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
          <Link href="/scegli" className="cambia-area">{user.ruoliExtra?.length ? "⇄ Cambia ruolo o area" : "⇄ Cambia area"}</Link>
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
        <HeaderMenu voci={voci} active={active} />
      </div>
    </header>
  );
}
