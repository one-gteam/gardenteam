import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import RolesPanel from "@/components/RolesPanel";
import { assignableRolesFor, canManageUsers, scopeUsers } from "@/lib/logic";
import { ROLE_LABELS, userSites } from "@/lib/types";
import { logout } from "@/lib/actions";

/**
 * Gestione Ruoli: area a sé, raggiunta dalla scelta area. A cascata:
 * - il Consorzio gestisce ruoli/aree/stato per tutto il gruppo;
 * - l'insegna per i propri, e decide se delegare la stessa gestione ai suoi PV;
 * - il PV per i propri, solo se la sua insegna glielo consente.
 */
export default async function RuoliPage({
  searchParams,
}: {
  searchParams: Promise<{ insegna?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const canManage = canManageUsers(db, user);
  const allowed =
    user.role === "system_admin" || user.role === "group_admin" || (user.role === "store_admin" && canManage);
  if (!allowed) redirect("/scegli");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();

  const users = scopeUsers(db, user)
    .filter((u) => !sp.insegna || u.tenantId === sp.insegna)
    .filter((u) => !q || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q))
    .sort((a, b) => a.lastName.localeCompare(b.lastName))
    .map((u) => ({
      id: u.id,
      nome: `${u.lastName} ${u.firstName}`,
      ruolo: u.role,
      insegna: db.tenants.find((t) => t.id === u.tenantId)?.name ?? "Consorzio",
      pv: db.stores.find((s) => s.id === u.storeId)?.name ?? "—",
      attivo: u.active !== false,
      sites: userSites(u),
      editabile: canManage && u.id !== user.id && (u.role !== "system_admin" || user.role === "system_admin"),
    }));

  // deleghe mostrate: al Consorzio tutte le insegne, all'insegna solo la propria
  const deleghe =
    user.role === "system_admin"
      ? db.tenants.map((t) => ({ id: t.id, nome: t.name, delegata: t.pvGestioneUtenti !== false }))
      : user.role === "group_admin" && user.tenantId
        ? db.tenants
            .filter((t) => t.id === user.tenantId)
            .map((t) => ({ id: t.id, nome: t.name, delegata: t.pvGestioneUtenti !== false }))
        : [];

  return (
    <div>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="header-top">
            <Link href="/scegli" className="brand">
              <span className="brand-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={db.settings.logoUrl} alt="Garden Team" />
              </span>
              <span className="area-name" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Users size={16} /> Gestione Ruoli
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
        </div>
      </header>
      <div className="container" style={{ maxWidth: 1100 }}>
        <h1>Utenti e ruoli</h1>
        <p className="subtitle">
          Chi può fare cosa, in tutte le aree del portale. Ruolo, aree e stato si modificano direttamente in tabella.
        </p>

        <form method="get" style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 16, flexWrap: "wrap" }}>
          <label className="field" style={{ marginBottom: 0, width: 260 }}>
            Cerca
            <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="nome o email" />
          </label>
          {user.role === "system_admin" && (
            <label className="field" style={{ marginBottom: 0, width: 220 }}>
              Insegna
              <select name="insegna" defaultValue={sp.insegna ?? ""}>
                <option value="">Tutte</option>
                {db.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          <button className="btn btn-sm" type="submit">Filtra</button>
        </form>

        <RolesPanel
          users={users}
          assignableRoles={assignableRolesFor(user)}
          deleghe={deleghe}
          showInsegna={user.role === "system_admin"}
        />
      </div>
    </div>
  );
}
