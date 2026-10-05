import Link from "next/link";
import { Newspaper } from "lucide-react";
import { getDb } from "@/lib/db";
import { ROLE_LABELS, User } from "@/lib/types";
import { logout } from "@/lib/actions";
import HeaderMenu from "@/components/HeaderMenu";

/** Barra dell'area Articoli: elenco, nuovo articolo (per chi pubblica), gestione (per chi gestisce). */
export default async function ArticoliHeader({
  user, active, pubblica, gestisce,
}: {
  user: User;
  active: "articoli" | "nuovo" | "gestione" | "statistiche";
  pubblica: boolean;
  gestisce: boolean;
}) {
  const db = await getDb();
  const voci = [
    { href: "/articoli", label: "Articoli", key: "articoli" },
    ...(pubblica ? [{ href: "/articoli/nuovo", label: "＋ Nuovo articolo", key: "nuovo" }] : []),
    ...(pubblica ? [{ href: "/articoli/statistiche", label: "Statistiche", key: "statistiche" }] : []),
    ...(gestisce ? [{ href: "/articoli/gestione", label: "Gestione", key: "gestione" }] : []),
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
              <Newspaper size={16} /> Articoli
            </span>
          </Link>
          <Link href="/scegli" className="cambia-area">⇄ Cambia area</Link>
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
