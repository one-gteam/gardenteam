import Link from "next/link";
import { getDb } from "@/lib/db";
import { User, userSites, gestisce, ruoloEsteso } from "@/lib/types";
import { logout } from "@/lib/actions";
import { isConsortiumEditor, isZooEditor } from "@/lib/stampe";
import HeaderMenu from "@/components/HeaderMenu";

export default async function StampeHeader({
  user, active, area = "arredo", compatta = false,
}: {
  user: User;
  active: string;
  area?: "arredo" | "zoo";
  /** Testata compatta (In reparto): il ☰ anche da computer, e la riga utente ridotta.
   *  Da cellulare il ☰ c'è comunque, in tutte le pagine: lo decide il CSS. */
  compatta?: boolean;
}) {
  const db = await getDb();
  const settings = db.settings;
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  /*
   * Il menu segue i permessi: chi gestisce l'area vede Layout, Impostazioni e il
   * resto della gestione; chi è operativo (capo reparto) vede consultazione e stampa.
   */
  const gestZoo = gestisce(user, "zoo");
  const gestArredo = gestisce(user, "arredo");
  const sites = userSites(user);

  const links = area === "zoo"
    ? [
        { href: "/stampe/zoo/dati", label: "Database prodotti", key: "dati" },
        { href: "/stampe/zoo/offerte", label: "Offerte in corso", key: "offerte" },
        { href: "/stampe/zoo/volantino", label: "Scelta offerte Volantino", key: "volantino" },
        ...(isZooEditor(user)
          ? [{ href: "/stampe/zoo/crea-volantino", label: "Crea Volantino", key: "crea-volantino" }]
          : []),
        { href: "/stampe/zoo/bozza", label: "Bozza volantino", key: "bozza" },
        ...(gestZoo ? [{ href: "/stampe/zoo/layout", label: "Layout", key: "layout" }] : []),
        { href: "/stampe/zoo/stampa", label: "Stampa cartelli", key: "stampa" },
        { href: "/stampe/zoo/reparto", label: "📱 In reparto", key: "reparto" },
        ...(isZooEditor(user) ? [{ href: "/stampe/zoo/archivio", label: "Archivio volantini", key: "archivio" }] : []),
        ...(gestZoo ? [{ href: "/stampe/zoo/focus", label: "Storico focus", key: "focus" }] : []),
        ...(gestZoo ? [{ href: "/stampe/zoo/impostazioni", label: "Impostazioni", key: "impostazioni" }] : []),
        // una voce sola per uscire: la scelta dell'area si fa in /scegli, non dal menu
        ...(sites.length > 1 ? [{ href: "/scegli", label: "⇄ Cambia area", key: "academy" }] : []),
      ]
    : [
        { href: "/stampe/arredo/dati", label: "Dati prodotti", key: "dati" },
        ...(gestArredo ? [{ href: "/stampe/arredo/layout", label: "Layout", key: "layout" }] : []),
        { href: "/stampe/arredo/stampa", label: "Stampa cartelli", key: "stampa" },
        { href: "/stampe/arredo/linee-guida", label: "Linee guida", key: "linee-guida" },
        ...(gestArredo ? [{ href: "/stampe/impostazioni", label: "Impostazioni", key: "impostazioni" }] : []),
        ...(sites.length > 1 ? [{ href: "/scegli", label: "⇄ Cambia area", key: "academy" }] : []),
      ];

  return (
    <header className={`site-header stampe-header${compatta ? " compatta" : ""}`} style={{ background: "linear-gradient(120deg, #1a2b45, #274b7a)" }}>
      <div className="site-header-inner">
        <div className="header-top">
          <Link href="/stampe" className="brand">
            <span className="brand-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={settings.logoUrl} alt="Garden Team" />
            </span>
            <span className="area-name">Stampe · {area === "zoo" ? "Offerte Zoo" : "Cartelli Arredo Giardino"}</span>
          </Link>
          <span className="tenant-chip">
            {tenant?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt={tenant.name} className="tenant-logo" />
            ) : (
              <span>{tenant ? tenant.emoji : ""}</span>
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
                {isConsortiumEditor(user) ? "Responsabile contenuti Consorzio" : ruoloEsteso(user)}
              </div>
            </div>
            <form action={logout}>
              <button className="logout-btn" type="submit">Esci</button>
            </form>
          </div>
        </div>
        <HeaderMenu voci={links} active={active} />
      </div>
    </header>
  );
}
