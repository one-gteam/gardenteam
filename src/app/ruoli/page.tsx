import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import RolesPanel from "@/components/RolesPanel";
import RuoliHeader from "@/components/RuoliHeader";
import NuovoUtente from "@/components/NuovoUtente";
import { assignableRolesFor, canManageUsers, livelloGestioneUtenti, RUOLI_AMMINISTRATORE, scopeUsers } from "@/lib/logic";
import { userSites, PERMESSI_RUOLO, ROLE_LABELS, permessoRuolo, PERMESSI_PREDEFINITI, type Role } from "@/lib/types";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { salvaPermessoRuolo, ripristinaPermessiRuoli } from "@/lib/actions";

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
  // amministratori e chi ha l'incarico "gestisce utenti"; il PV solo se l'insegna glielo consente
  const livello = livelloGestioneUtenti(db, user);
  if (!livello) redirect("/scegli");
  // l'incarico lo danno solo gli amministratori
  const puoDelegare = RUOLI_AMMINISTRATORE.includes(user.role);
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
      editabile: canManage && u.id !== user.id && (u.role !== "system_admin" || user.role === "system_admin")
        && (puoDelegare || !RUOLI_AMMINISTRATORE.includes(u.role)),
      gestioneUtenti: !!u.gestioneUtenti,
      amministratore: RUOLI_AMMINISTRATORE.includes(u.role),
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
          {livello === "consorzio" && (
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
              .filter((s) => livello === "consorzio" || (livello === "insegna" ? s.tenantId === user.tenantId : s.id === user.storeId))
              .map((s) => ({ id: s.id, nome: s.name, tenantId: s.tenantId }))}
            reparti={db.departments.map((d) => ({ id: d.id, nome: d.name }))}
            mostraInsegna={livello === "consorzio"}
            mostraPuntoVendita={livello !== "pv"}
          />
        )}

        {/* permessi dei ruoli: solo l'amministratore di sistema, che li ha sempre tutti */}
        {user.role === "system_admin" && (() => {
          const ruoli: Role[] = ["group_admin", "store_admin", "manager", "dept_head", "student"];
          const cambiati = PERMESSI_RUOLO.some((p) => ruoli.some((r) => permessoRuolo(r, p.chiave) !== PERMESSI_PREDEFINITI[r][p.chiave]));
          return (
            <details className="card" style={{ marginBottom: 18, padding: 14 }} open={cambiati}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                🔐 Permessi dei ruoli {cambiati && <span className="pill pill-amber" style={{ marginLeft: 6 }}>personalizzati</span>}
              </summary>
              <p className="hint" style={{ margin: "8px 0 10px" }}>
                Cosa può fare ogni ruolo, sempre dentro il suo ambito (Consorzio, insegna o punto vendita, secondo dove è collocata la persona).
                Le aree a cui accede e l&apos;incarico personale «gestisce utenti» restano per persona, nella tabella qui sotto.
                Le spunte si salvano da sole; l&apos;amministratore di sistema ha sempre tutto.
              </p>
              <div className="table-wrap">
                <table className="data permessi-ruoli">
                  <thead>
                    <tr>
                      <th>Permesso</th>
                      {ruoli.map((r) => <th key={r} style={{ textAlign: "center" }}>{ROLE_LABELS[r]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMESSI_RUOLO.map((p) => (
                      <tr key={p.chiave}>
                        <td><strong>{p.etichetta}</strong><div className="hint" style={{ fontSize: 11.5, maxWidth: 420 }}>{p.spiegazione}</div></td>
                        {ruoli.map((r) => {
                          const acceso = permessoRuolo(r, p.chiave);
                          const diverso = acceso !== PERMESSI_PREDEFINITI[r][p.chiave];
                          return (
                            <td key={r} style={{ textAlign: "center", background: diverso ? "#fff7e6" : undefined }}
                              title={diverso ? "Diverso dal predefinito" : undefined}>
                              <ModuloAutoSalva azione={salvaPermessoRuolo.bind(null, r, p.chiave)} style={{ display: "inline-block" }}>
                                <input type="checkbox" name="v" defaultChecked={acceso} aria-label={`${p.etichetta} — ${ROLE_LABELS[r]}`} />
                              </ModuloAutoSalva>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cambiati && (
                <div style={{ marginTop: 10 }}>
                  <PulsanteAzione azione={ripristinaPermessiRuoli} conferma="Tornare ai permessi predefiniti per tutti i ruoli?">
                    Ripristina i permessi predefiniti
                  </PulsanteAzione>
                </div>
              )}
            </details>
          );
        })()}

        <RolesPanel
          users={users}
          assignableRoles={assignableRolesFor(user)}
          deleghe={deleghe}
          showInsegna={livello === "consorzio"}
          puoDelegare={puoDelegare}
        />
      </div>
    </div>
  );
}
