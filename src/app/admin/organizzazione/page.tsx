import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import InsegnaLogo from "@/components/InsegnaLogo";
import {
  saveDepartment,
  deleteDepartment,
  saveGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
} from "@/lib/actions";

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ salvato?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student" || user.role === "dept_head" || user.role === "course_manager") redirect("/admin");
  const { salvato } = await searchParams;

  const db = await getDb();

  const canEditScope = (x: { tenantId?: string; storeId?: string }) =>
    user.role === "system_admin" ||
    (user.role === "group_admin" && !!x.tenantId && x.tenantId === user.tenantId) ||
    (user.role === "store_admin" && !!x.storeId && x.storeId === user.storeId);

  const scopeLabel = (x: { tenantId?: string; storeId?: string }) => {
    if (x.storeId) return db.stores.find((s) => s.id === x.storeId)?.name ?? "PV";
    if (x.tenantId) return db.tenants.find((t) => t.id === x.tenantId)?.name ?? "Insegna";
    return "Sistema";
  };

  const visibleDepts = db.departments.filter(
    (d) =>
      user.role === "system_admin" ||
      !d.tenantId && !d.storeId ||
      d.tenantId === user.tenantId ||
      (!!d.storeId && d.storeId === user.storeId)
  );
  const visibleGroups = db.groups.filter(
    (g) =>
      user.role === "system_admin" ||
      (!g.tenantId && !g.storeId) ||
      g.tenantId === user.tenantId ||
      (!!g.storeId && g.storeId === user.storeId)
  );
  const memberPool =
    user.role === "system_admin"
      ? db.users
      : user.role === "group_admin"
        ? db.users.filter((u) => u.tenantId === user.tenantId)
        : db.users.filter((u) => u.storeId === user.storeId);
  const tenants =
    user.role === "system_admin" ? db.tenants : db.tenants.filter((t) => t.id === user.tenantId);
  const stores =
    user.role === "system_admin"
      ? db.stores
      : user.role === "group_admin"
        ? db.stores.filter((s) => s.tenantId === user.tenantId)
        : db.stores.filter((s) => s.id === user.storeId);

  return (
    <div>
      <Header user={user} active="organizzazione" />
      <div className="container">
        <h1>Organizzazione</h1>
        <p className="subtitle">
          Personalizza insegne e punti vendita: branding, messaggi di benvenuto, parola segreta per
          l&apos;auto-registrazione, email di approvazione, reparti e gruppi.
        </p>

        {salvato && <div className="alert alert-green">✓ Modifiche salvate.</div>}

        {user.role === "system_admin" && (
          <a className="card card-link" href="/admin/organizzazione/consorzio" style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 14, border: "2px solid var(--green-500)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={db.settings.logoUrl} alt={db.settings.portalName} style={{ height: 40, maxWidth: 130, objectFit: "contain" }} />
            <div style={{ flex: 1 }}>
              <strong>🏛️ Scheda Consorzio — {db.settings.portalName}</strong>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                Branding globale del portale: nome, logo, colori e messaggio per tutti gli studenti
              </div>
            </div>
            <span className="pill pill-green">Personalizza →</span>
          </a>
        )}

        {(user.role === "system_admin" || user.role === "group_admin") && (
          <>
            <div className="section-head">
              <h2>🏬 Insegne ({tenants.length})</h2>
            </div>
            <div className="grid grid-3">
              {tenants.map((t) => {
                const pvCount = db.stores.filter((s) => s.tenantId === t.id).length;
                const staff = db.users.filter((u) => u.tenantId === t.id).length;
                return (
                  <a key={t.id} className="card card-link" href={`/admin/organizzazione/insegna/${t.id}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {t.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.logoUrl} alt={t.name} style={{ height: 38, maxWidth: 110, objectFit: "contain" }} />
                      ) : (
                        <span style={{ fontSize: 30 }}>{t.emoji}</span>
                      )}
                      <div>
                        <strong>{t.name}</strong>
                        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                          {pvCount} PV · {staff} collaboratori
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className="pill" style={{ background: t.color, color: "#fff" }}>{t.color}</span>
                      {t.secretWord ? <span className="pill pill-green">🔑 Parola segreta</span> : <span className="pill pill-gray">🔑 Nessuna parola segreta</span>}
                      {t.approvalEmail ? <span className="pill pill-green">✉️ {t.approvalEmail}</span> : <span className="pill pill-gray">✉️ Email approvazione mancante</span>}
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        )}

        <div className="section">
          <div className="section-head">
            <h2>📍 Punti vendita ({stores.length})</h2>
          </div>
          <div className="grid grid-3">
            {stores.map((s) => {
              const t = db.tenants.find((x) => x.id === s.tenantId)!;
              const staff = db.users.filter((u) => u.storeId === s.id).length;
              return (
                <a key={s.id} className="card card-link" href={`/admin/organizzazione/pv/${s.id}`}>
                  <strong style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <InsegnaLogo tenant={t} height={20} /> {s.name}
                  </strong>
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {t.name}{s.city ? ` · ${s.city}` : ""} · {staff} collaboratori
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {s.secretWord ? <span className="pill pill-green">🔑 Parola segreta</span> : <span className="pill pill-gray">🔑 Usa quella di insegna</span>}
                    {s.approvalEmail ? <span className="pill pill-green">✉️ {s.approvalEmail}</span> : <span className="pill pill-gray">✉️ Usa quella di insegna</span>}
                  </div>
                </a>
              );
            })}
          </div>
        </div>

        {/* ---------- Reparti ---------- */}
        <div className="section">
          <div className="section-head">
            <h2>🏷️ Reparti ({visibleDepts.length})</h2>
            <span className="hint">
              {user.role === "system_admin"
                ? "i reparti di sistema valgono per tutto il consorzio"
                : "puoi aggiungere reparti specifici per il tuo ambito; quelli di sistema non sono modificabili"}
            </span>
          </div>
          <div className="grid grid-3">
            {visibleDepts.map((d) => {
              const editable = canEditScope(d);
              const inUse = db.users.filter((u) => u.departmentId === d.id).length;
              return (
                <div className="card" key={d.id}>
                  {editable ? (
                    <form action={saveDepartment.bind(null, d.id)}>
                      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8 }}>
                        <label className="field">Emoji<input type="text" name="emoji" defaultValue={d.emoji} maxLength={4} /></label>
                        <label className="field">Nome reparto<input type="text" name="name" defaultValue={d.name} required /></label>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button className="btn btn-sm" type="submit">💾 Salva</button>
                        <span className="pill pill-gray">{scopeLabel(d)}</span>
                        <span className="pill pill-blue">{inUse} persone</span>
                      </div>
                    </form>
                  ) : (
                    <div>
                      <strong>{d.emoji} {d.name}</strong>
                      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                        <span className="pill pill-gray">{scopeLabel(d)}</span>
                        <span className="pill pill-blue">{inUse} persone</span>
                      </div>
                    </div>
                  )}
                  {editable && (
                    <form action={deleteDepartment.bind(null, d.id)} style={{ marginTop: 8 }}>
                      <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>
                        🗑 Elimina reparto
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
            <div className="card" style={{ background: "var(--green-50)" }}>
              <h3 style={{ marginTop: 0 }}>➕ Nuovo reparto</h3>
              <form action={saveDepartment.bind(null, null)}>
                <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8 }}>
                  <label className="field">Emoji<input type="text" name="emoji" placeholder="🏷️" maxLength={4} /></label>
                  <label className="field">Nome reparto<input type="text" name="name" required placeholder="es. Vivaio esterno" /></label>
                </div>
                <button className="btn btn-sm" type="submit">Crea reparto</button>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
                  {user.role === "system_admin" ? "Sarà un reparto di sistema (tutte le insegne)." : user.role === "group_admin" ? "Sarà un reparto della tua insegna." : "Sarà un reparto del tuo punto vendita."}
                </p>
              </form>
            </div>
          </div>
        </div>

        {/* ---------- Gruppi ---------- */}
        <div className="section">
          <div className="section-head">
            <h2>👥 Gruppi di persone ({visibleGroups.length})</h2>
            <span className="hint">gruppi trasversali ai reparti (es. referenti sicurezza) — utilizzabili come destinatari dei corsi</span>
          </div>
          <div className="grid grid-2">
            {visibleGroups.map((g) => {
              const editable = canEditScope(g);
              const members = db.users.filter((u) => u.groupIds?.includes(g.id));
              const addable = memberPool.filter((u) => !u.groupIds?.includes(g.id) && u.active !== false);
              return (
                <div className="card" key={g.id}>
                  {editable ? (
                    <form action={saveGroup.bind(null, g.id)}>
                      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "end" }}>
                        <label className="field" style={{ marginBottom: 0 }}>Emoji<input type="text" name="emoji" defaultValue={g.emoji} maxLength={4} /></label>
                        <label className="field" style={{ marginBottom: 0 }}>Nome gruppo<input type="text" name="name" defaultValue={g.name} required /></label>
                        <button className="btn btn-sm" type="submit">💾</button>
                      </div>
                    </form>
                  ) : (
                    <strong>{g.emoji} {g.name}</strong>
                  )}
                  <div style={{ margin: "8px 0", display: "flex", gap: 8 }}>
                    <span className="pill pill-gray">{scopeLabel(g)}</span>
                    <span className="pill pill-blue">{members.length} membri</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {members.map((m) => (
                      <div key={m.id} className="rank-row" style={{ padding: "5px 0" }}>
                        <span style={{ flex: 1, fontSize: 13.5 }}>
                          {m.firstName} {m.lastName}
                          <span style={{ color: "var(--muted)", fontSize: 12 }}> · {db.stores.find((s) => s.id === m.storeId)?.name ?? "Consorzio"}</span>
                        </span>
                        {editable && (
                          <form action={removeGroupMember.bind(null, g.id, m.id)}>
                            <button className="btn btn-outline btn-sm" type="submit" title="Rimuovi dal gruppo">✕</button>
                          </form>
                        )}
                      </div>
                    ))}
                    {members.length === 0 && <span className="empty">Nessun membro.</span>}
                  </div>
                  {editable && (
                    <>
                      <form action={addGroupMember.bind(null, g.id)} style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <select name="userId" required defaultValue="" style={{ flex: 1, marginTop: 0 }}>
                          <option value="" disabled>— Aggiungi una persona —</option>
                          {addable.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.lastName} {u.firstName} ({db.stores.find((s) => s.id === u.storeId)?.name ?? "Consorzio"})
                            </option>
                          ))}
                        </select>
                        <button className="btn btn-sm" type="submit">➕</button>
                      </form>
                      <form action={deleteGroup.bind(null, g.id)} style={{ marginTop: 8 }}>
                        <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>
                          🗑 Elimina gruppo
                        </button>
                      </form>
                    </>
                  )}
                </div>
              );
            })}
            <div className="card" style={{ background: "var(--green-50)" }}>
              <h3 style={{ marginTop: 0 }}>➕ Nuovo gruppo</h3>
              <form action={saveGroup.bind(null, null)}>
                <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8 }}>
                  <label className="field">Emoji<input type="text" name="emoji" placeholder="👥" maxLength={4} /></label>
                  <label className="field">Nome gruppo<input type="text" name="name" required placeholder="es. Referenti sicurezza" /></label>
                </div>
                <button className="btn btn-sm" type="submit">Crea gruppo</button>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
                  {user.role === "system_admin" ? "Sarà un gruppo di sistema (tutte le insegne)." : user.role === "group_admin" ? "Sarà un gruppo della tua insegna." : "Sarà un gruppo del tuo punto vendita."}
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
