"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePath, deletePath, togglePathCourse, movePathCourse } from "@/lib/actions";
import { LearningPath, LEVEL_LABELS } from "@/lib/types";

interface CourseLite { id: string; title: string; emoji: string; level: string; tenantId?: string }
interface Named { id: string; name: string; emoji?: string }

/**
 * Gestione dei percorsi formativi: sequenze ordinate di corsi assegnate per
 * livello/insegna/reparto/neoassunti. L'editor salva senza ricaricare la pagina.
 */
export default function PathsPanel({
  paths,
  courses,
  tenants,
  departments,
  canSystem,
  fixedTenantId,
}: {
  paths: LearningPath[];
  courses: CourseLite[];
  tenants: Named[];
  departments: Named[];
  canSystem: boolean;
  fixedTenantId?: string; // group_admin: percorsi vincolati alla propria insegna
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => { await fn(); router.refresh(); });

  async function onSave(pathId: string | null, fd: FormData) {
    const res = await savePath(pathId, fd);
    setMsg(res.ok ? "✓ Percorso salvato." : `${res.error}`);
    if (res.ok) setEditing(null);
    router.refresh();
    setTimeout(() => setMsg(""), 3500);
  }

  const PathForm = ({ p }: { p?: LearningPath }) => {
    const selected = p?.courseIds ?? [];
    const inScope = courses.filter((c) => canSystem || c.level !== "sistema");
    const notSelected = inScope.filter((c) => !selected.includes(c.id));
    return (
      <form action={(fd) => onSave(p?.id ?? null, fd)}>
        <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12 }}>
          <label className="field">Emoji<input type="text" name="emoji" defaultValue={p?.emoji ?? ""} maxLength={4} /></label>
          <label className="field">Titolo del percorso<input type="text" name="title" defaultValue={p?.title ?? ""} required placeholder="es. Onboarding neoassunti" /></label>
        </div>
        <label className="field">Descrizione<textarea name="description" rows={2} defaultValue={p?.description ?? ""} /></label>
        <div style={{ display: "grid", gridTemplateColumns: canSystem ? "1fr 1fr" : "1fr", gap: 12 }}>
          {canSystem ? (
            <>
              <label className="field">
                Livello / ambito
                <select name="level" defaultValue={p?.level ?? "sistema"}>
                  <option value="sistema">Tutto il consorzio</option>
                  <option value="insegna">Una singola insegna</option>
                </select>
              </label>
              <label className="field">
                Insegna (se ambito «insegna»)
                <select name="tenantId" defaultValue={p?.tenantId ?? ""}>
                  <option value="">—</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
                </select>
              </label>
            </>
          ) : (
            <input type="hidden" name="level" value="insegna" />
          )}
          {!canSystem && fixedTenantId && <input type="hidden" name="tenantId" value={fixedTenantId} />}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", margin: "6px 0 10px" }}>
          <label className="checkbox-row" style={{ margin: 0 }}>
            <input type="checkbox" name="onlyNewHires" defaultChecked={p?.onlyNewHires} /> Solo neoassunti (ultimi 90 giorni)
          </label>
          {departments.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Limita a reparti…</summary>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                {departments.map((d) => (
                  <label key={d.id} className="checkbox-row" style={{ margin: 0 }}>
                    <input type="checkbox" name="departments" value={d.id} defaultChecked={p?.departments?.includes(d.id)} /> {d.name}
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* corsi del percorso, in ordine */}
        <strong style={{ fontSize: 13 }}>Corsi del percorso ({selected.length})</strong>
        <p className="hint" style={{ margin: "2px 0 8px" }}>
          {p ? "Usa ↑ ↓ per l'ordine e − per togliere; sotto puoi aggiungerne altri." : "Salva prima il percorso, poi aggiungi i corsi in ordine."}
        </p>
        {p && (
          <>
            {selected.length === 0 && <p className="empty">Ancora nessun corso in questo percorso.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {selected.map((cid, i) => {
                const c = courses.find((x) => x.id === cid);
                if (!c) return null;
                return (
                  <div key={cid} className="lesson-item" style={{ padding: "6px 10px" }}>
                    <span className="lesson-check">{i + 1}</span>
                    <span style={{ flex: 1 }}>{c.emoji} {c.title}</span>
                    <button type="button" className="btn btn-outline btn-sm" disabled={i === 0 || pending}
                      onClick={() => run(() => movePathCourse(p.id, cid, -1))}>↑</button>
                    <button type="button" className="btn btn-outline btn-sm" disabled={i === selected.length - 1 || pending}
                      onClick={() => run(() => movePathCourse(p.id, cid, 1))}>↓</button>
                    <button type="button" className="btn btn-outline btn-sm danger" disabled={pending}
                      onClick={() => run(() => togglePathCourse(p.id, cid))}>−</button>
                  </div>
                );
              })}
            </div>
            {notSelected.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Aggiungi un corso</summary>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {notSelected.map((c) => (
                    <button key={c.id} type="button" className="btn btn-outline btn-sm" disabled={pending}
                      onClick={() => run(() => togglePathCourse(p.id, c.id))}>
                      + {c.emoji} {c.title.slice(0, 30)}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm" type="submit">{p ? "Salva percorso" : "Crea percorso"}</button>
          {p && <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(null)}>Chiudi</button>}
        </div>
      </form>
    );
  };

  return (
    <div>
      {msg && <div className={`alert ${msg.startsWith("✓") ? "alert-green" : "alert-amber"}`}>{msg}</div>}

      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 10 }}>
        {paths.map((p) => {
          const open = editing === p.id;
          const tenant = tenants.find((t) => t.id === p.tenantId);
          return (
            <div key={p.id} className="card">
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 15 }}>{p.emoji} {p.title}</strong>
                <span className="pill pill-blue">{LEVEL_LABELS[p.level]}</span>
                {tenant && <span className="pill pill-gray">{tenant.emoji} {tenant.name}</span>}
                {p.onlyNewHires && <span className="pill pill-amber">neoassunti</span>}
                <span className="pill pill-gray">{p.courseIds.length} corsi</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(open ? null : p.id)}>
                    {open ? "Chiudi" : "Modifica"}
                  </button>
                  <button className="btn btn-outline btn-sm danger" type="button" disabled={pending} title="Elimina il percorso"
                    onClick={() => { if (confirm(`Eliminare il percorso «${p.title}»? I corsi restano, si toglie solo il percorso.`)) run(() => deletePath(p.id)); }}>✕</button>
                </span>
              </div>
              {open && <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}><PathForm p={p} /></div>}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 14, background: "var(--green-50)" }}>
        <h3 style={{ marginTop: 0 }}>Nuovo percorso formativo</h3>
        <PathForm />
      </div>
    </div>
  );
}
