import Link from "next/link";
import { getDb } from "@/lib/db";
import { permessoRuolo, User, userSites, isAcademyAdmin, ruoloEsteso } from "@/lib/types";
import { logout } from "@/lib/actions";
import HeaderMenu from "@/components/HeaderMenu";

export default async function Header({ user, active }: { user: User; active: string }) {
  const db = await getDb();
  const settings = db.settings;
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  const store = db.stores.find((s) => s.id === user.storeId);

  /*
   * Il menu mostra solo quello che la persona può davvero aprire: i gestori
   * delle altre aree (Zoo, Piante) qui sono corsisti, e il capo reparto non
   * gestisce i percorsi formativi.
   */
  const gestisceAcademy = isAcademyAdmin(user);
  const links = gestisceAcademy
    ? [
        { href: "/admin", label: "Dashboard", key: "admin" },
        { href: "/admin/utenti", label: "Collaboratori", key: "utenti" },
        { href: "/admin/corsi", label: "Corsi", key: "corsi" },
        ...(user.role === "dept_head" && !permessoRuolo("dept_head", "percorsi") ? [] : [{ href: "/admin/percorsi", label: "Percorsi", key: "percorsi" }]),
        { href: "/admin/email", label: "Email", key: "email" },
        { href: "/admin/report", label: "Report", key: "report" },
        { href: "/studente", label: "Vista studente", key: "studente" },
      ]
    : [
        { href: "/studente", label: "I miei corsi", key: "studente" },
      ];

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="header-top">
          <Link href={gestisceAcademy ? "/admin" : "/studente"} className="brand">
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
              <span>{tenant ? tenant.emoji : ""}</span>
            )}
            {tenant ? ` ${tenant.name}` : " Consorzio Garden Team"}
            {store?.city ? ` · ${store.city}` : ""}
          </span>
          {/* il cambio di area sta qui in alto, come nelle altre aree: lascia spazio alle voci del menu */}
          {(userSites(user).length > 1 || (user.ruoliExtra?.length ?? 0) > 0) && <Link href="/scegli" className="cambia-area">{user.ruoliExtra?.length ? "⇄ Cambia ruolo o area" : "⇄ Cambia area"}</Link>}
          <div className="user-chip">
            <div className="avatar">
              {user.firstName[0]}
              {user.lastName[0]}
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>
                {user.firstName} {user.lastName}
              </div>
              <div style={{ opacity: 0.75, fontSize: 11 }}>{ruoloEsteso(user)}</div>
            </div>
            <form action={logout}>
              <button className="logout-btn" type="submit">
                Esci
              </button>
            </form>
          </div>
        </div>
        <HeaderMenu voci={links} active={active} />
      </div>
    </header>
  );
}
