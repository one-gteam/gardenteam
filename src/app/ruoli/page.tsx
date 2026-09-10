import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import RolesPanel from "@/components/RolesPanel";
import RuoliHeader from "@/components/RuoliHeader";
import NuovoUtente from "@/components/NuovoUtente";
import { assignableRolesFor, canManageUsers, scopeUsers } from "@/lib/logic";
import { userSites } from "@/lib/types";

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
      manages: u.manages ?? [],
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
      <RuoliHeader user={user} active="ruoli" />
      <div className="container">
        <h1>Utenti e ruoli</h1>
        <p className="subtitle">
          Chi può fare cosa, in tutte le aree del portale. Ruolo, aree e stato si modificano direttamente in tabella.
        </p>
        <p className="hint" style={{ margin: "-4px 0 16px" }}>
          Per anagrafica, reparto e formazione clicca sul nome di un collaboratore
          {userSites(user).includes("academy") && (
            <> — oppure vai ai <a href="/admin/utenti">Collaboratori</a> di Academy</>
          )}
          .
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

        {canManage && (
          <NuovoUtente
            ruoli={assignableRolesFor(user)}
            insegne={db.tenants.map((t) => ({ id: t.id, nome: t.name }))}
            puntiVendita={db.stores
              .filter((s) => user.role === "system_admin" || s.tenantId === user.tenantId)
              .map((s) => ({ id: s.id, nome: s.name, tenantId: s.tenantId }))}
            reparti={db.departments.map((d) => ({ id: d.id, nome: d.name }))}
            mostraInsegna={user.role === "system_admin"}
            mostraPuntoVendita={user.role !== "store_admin"}
          />
        )}

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
