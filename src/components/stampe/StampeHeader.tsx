import Link from "next/link";
import { getDb } from "@/lib/db";
import { ROLE_LABELS, User, userSites } from "@/lib/types";
import { logout } from "@/lib/actions";
import { isConsortiumEditor } from "@/lib/stampe";

export default async function StampeHeader({ user, active, area = "arredo" }: { user: User; active: string; area?: "arredo" | "zoo" }) {
  const db = await getDb();
  const settings = db.settings;
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  const isAdmin = ["system_admin", "course_manager", "group_admin", "store_admin"].includes(user.role);

  const links = area === "zoo"
    ? [
        { href: "/stampe/zoo/dati", label: "Database prodotti", key: "dati" },
        { href: "/stampe/zoo/offerte", label: "Import offerte", key: "offerte" },
        { href: "/stampe/zoo/volantino", label: "Volantino", key: "volantino" },
        { href: "/stampe/zoo/stampa", label: "Stampa cartelli", key: "stampa" },
        ...(isAdmin ? [{ href: "/stampe/zoo/impostazioni", label: "Impostazioni", key: "impostazioni" }] : []),
        { href: "/stampe/arredo/dati", label: "⇄ Arredo Giardino", key: "arredo" },
        ...(userSites(user).includes("academy") ? [{ href: "/scegli", label: "⇄ Cambia area", key: "academy" }] : []),
      ]
    : [
        { href: "/stampe/arredo/dati", label: "Dati prodotti", key: "dati" },
        { href: "/stampe/arredo/layout", label: "Layout", key: "layout" },
        { href: "/stampe/arredo/stampa", label: "Stampa cartelli", key: "stampa" },
        { href: "/stampe/arredo/linee-guida", label: "Linee guida", key: "linee-guida" },
        ...(isAdmin ? [{ href: "/stampe/impostazioni", label: "Impostazioni", key: "impostazioni" }] : []),
        { href: "/stampe/zoo/dati", label: "⇄ Offerte ZOO", key: "zoo" },
        ...(userSites(user).includes("academy") ? [{ href: "/scegli", label: "⇄ Cambia area", key: "academy" }] : []),
      ];

  return (
    <header className="site-header" style={{ background: "linear-gradient(120deg, #1a2b45, #274b7a)" }}>
      <div className="site-header-inner">
        <div className="header-top">
          <Link href="/stampe" className="brand">
            <span className="brand-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={settings.logoUrl} alt="Garden Team" />
            </span>
            <span className="area-name">Stampe · {area === "zoo" ? "Cartelli Offerte ZOO" : "Cartelli Arredo Giardino"}</span>
          </Link>
          <span className="tenant-chip">
            {tenant?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt={tenant.name} className="tenant-logo" />
            ) : (
              <span>{tenant ? tenant.emoji : "🏛️"}</span>
            )}
            {tenant ? ` ${tenant.name}` : " Consorzio Garden Team"}
          </span>
          <div className="user-chip">
            <div className="avatar">
              {user.firstName[0]}
              {user.lastName[0]}
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>
                {user.firstName} {user.lastName}
              </div>
              <div style={{ opacity: 0.75, fontSize: 11 }}>
                {isConsortiumEditor(user) ? "Responsabile contenuti Consorzio" : ROLE_LABELS[user.role]}
              </div>
            </div>
            <form action={logout}>
              <button className="logout-btn" type="submit">Esci</button>
            </form>
          </div>
        </div>
        <div className="header-nav-row">
          <nav className="nav">
            {links.map((l) => (
              <Link key={l.key} href={l.href} className={active === l.key ? "active" : ""}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
