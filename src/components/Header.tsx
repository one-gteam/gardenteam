import Link from "next/link";
import { getDb } from "@/lib/db";
import { ROLE_LABELS, User, userSites } from "@/lib/types";
import { logout } from "@/lib/actions";

export default async function Header({ user, active }: { user: User; active: string }) {
  const db = await getDb();
  const settings = db.settings;
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  const store = db.stores.find((s) => s.id === user.storeId);
  const isAdmin = user.role !== "student";

  const canOrg = ["system_admin", "group_admin", "store_admin"].includes(user.role);
  const links = isAdmin
    ? [
        { href: "/admin", label: "Dashboard", key: "admin" },
        { href: "/admin/utenti", label: "Utenti", key: "utenti" },
        { href: "/admin/corsi", label: "Corsi", key: "corsi" },
        ...(canOrg ? [{ href: "/admin/organizzazione", label: "Organizzazione", key: "organizzazione" }] : []),
        { href: "/admin/email", label: "Email", key: "email" },
        { href: "/admin/report", label: "Report", key: "report" },
        { href: "/studente", label: "Vista studente", key: "studente" },
        ...(userSites(user).includes("stampe") ? [{ href: "/scegli", label: "⇄ Cambia area", key: "stampe" }] : []),
      ]
    : [{ href: "/studente", label: "I miei corsi", key: "studente" }];

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="header-top">
          <Link href={isAdmin ? "/admin" : "/studente"} className="brand">
            <span className="brand-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={settings.logoUrl} alt={settings.portalName} />
            </span>
            <span className="area-name">{settings.portalName}</span>
          </Link>
          <span className="tenant-chip">
            {tenant?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt={tenant.name} className="tenant-logo" />
            ) : (
              <span>{tenant ? tenant.emoji : "🏛️"}</span>
            )}
            {tenant ? ` ${tenant.name}` : " Consorzio Garden Team"}
            {store?.city ? ` · ${store.city}` : ""}
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
              <div style={{ opacity: 0.75, fontSize: 11 }}>{ROLE_LABELS[user.role]}</div>
            </div>
            <form action={logout}>
              <button className="logout-btn" type="submit">
                Esci
              </button>
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
