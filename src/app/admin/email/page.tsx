import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import {
  runReminders,
  saveTemplate,
  resetTemplate,
  saveCustomTemplate,
  deleteCustomTemplate,
  saveAutomationSettings,
} from "@/lib/actions";
import { scopeUsers } from "@/lib/logic";
import { EMAIL_TYPE_LABELS, EmailType } from "@/lib/types";

const AUTOMATIONS = [
  { emoji: "👋", title: "Email di benvenuto", desc: "Inviata automaticamente quando un collaboratore viene creato o importato da CSV/gestionale.", trigger: "Alla creazione dell'utente" },
  { emoji: "⏰", title: "Promemoria corsi da completare", desc: "Ricorda i corsi obbligatori non ancora completati, in base al profilo dello studente.", trigger: "Job giornaliero (cron)" },
  { emoji: "🚨", title: "Avviso corso in scadenza", desc: "Quando mancano meno di 7 giorni alla scadenza (o è già superata), il promemoria diventa urgente.", trigger: "Job giornaliero (cron)" },
  { emoji: "🎉", title: "Corso completato", desc: "Congratulazioni e riepilogo punti al completamento di ogni corso.", trigger: "Al completamento" },
  { emoji: "📜", title: "Certificato emesso", desc: "Notifica con link al certificato quando viene rilasciato.", trigger: "All'emissione" },
] as const;

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ promemoria?: string; template?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student") redirect("/studente");
  const { promemoria, template } = await searchParams;

  const db = await getDb();
  const userIds = new Set(scopeUsers(db, user).map((u) => u.id));
  // email "di sistema" (es. notifiche di registrazione, senza utente): visibili all'admin di sistema
  // e a insegna/PV solo se indirizzate alla loro email di approvazione
  const myApprovalEmails = new Set(
    [
      ...(user.role === "system_admin" || user.role === "course_manager"
        ? [...db.tenants.map((t) => t.approvalEmail), ...db.stores.map((s) => s.approvalEmail)]
        : user.role === "group_admin"
          ? [
              db.tenants.find((t) => t.id === user.tenantId)?.approvalEmail,
              ...db.stores.filter((s) => s.tenantId === user.tenantId).map((s) => s.approvalEmail),
            ]
          : [db.stores.find((s) => s.id === user.storeId)?.approvalEmail]),
    ].filter(Boolean) as string[]
  );
  const emails = db.emails
    .filter((e) => (e.userId ? userIds.has(e.userId) : myApprovalEmails.has(e.to)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60);

  const isGlobalEditor = user.role === "system_admin" || user.role === "course_manager";
  const isStoreEditor = user.role === "store_admin";
  const canEditTemplates = isGlobalEditor || user.role === "group_admin" || isStoreEditor;
  const myCustomTemplates = db.customTemplates.filter((ct) =>
    isGlobalEditor ||
    (user.role === "group_admin" && (!ct.tenantId || ct.tenantId === user.tenantId)) ||
    (isStoreEditor && (!ct.tenantId || ct.tenantId === user.tenantId) && (!ct.storeId || ct.storeId === user.storeId))
  );
  const canTouchCustom = (ct: { tenantId?: string; storeId?: string }) =>
    isGlobalEditor ||
    (user.role === "group_admin" && ct.tenantId === user.tenantId) ||
    (isStoreEditor && ct.storeId === user.storeId);
  const templateTypes = Object.keys(EMAIL_TYPE_LABELS) as EmailType[];
  const effectiveTemplate = (type: EmailType) => {
    const global = db.templates.find((t) => t.type === type && !t.tenantId && !t.storeId)!;
    if (isGlobalEditor) return { tpl: global, isOverride: false, global };
    const override = isStoreEditor
      ? db.templates.find((t) => t.type === type && t.storeId === user.storeId)
      : db.templates.find((t) => t.type === type && t.tenantId === user.tenantId && !t.storeId);
    return { tpl: override ?? global, isOverride: !!override, global };
  };

  return (
    <div>
      <Header user={user} active="email" />
      <div className="container">
        <h1>Email e automazioni</h1>
        <p className="subtitle">
          Le comunicazioni automatiche verso i collaboratori. In questo prototipo le email vengono registrate ma non
          spedite: in produzione l&apos;invio avverrà tramite un provider transazionale (es. Resend o Brevo) e il
          controllo promemoria girerà ogni notte in automatico.
        </p>

        {promemoria !== undefined && (
          <div className={`alert ${Number(promemoria) > 0 ? "alert-green" : "alert-amber"}`}>
            {Number(promemoria) > 0
              ? `✓ Controllo eseguito: generati ${promemoria} promemoria.`
              : "Controllo eseguito: nessun nuovo promemoria da inviare (già inviati oggi o nessun ritardo)."}
          </div>
        )}

        {template && <div className="alert alert-green">✓ Modello email salvato.</div>}

        <div className="section-head" style={{ marginTop: 10 }}>
          <h2>⚙️ Automazioni</h2>
        </div>
        <div className="grid grid-3">
          {AUTOMATIONS.map((a) => (
            <div className="card" key={a.title}>
              <div style={{ fontSize: 26 }}>{a.emoji}</div>
              <h3 style={{ margin: "6px 0 4px" }}>{a.title}</h3>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{a.desc}</p>
              <span className="pill pill-gray">{a.trigger}</span>
            </div>
          ))}
        </div>

        {canEditTemplates && (
          <div className="section">
            <div className="section-head">
              <h2>✍️ Modelli email</h2>
              <span className="hint">
                {isGlobalEditor
                  ? "modelli di sistema, validi per tutto il consorzio"
                  : isStoreEditor
                    ? "personalizza i testi per il tuo punto vendita (altrimenti vale il modello di insegna/sistema)"
                    : "personalizza i testi per la tua insegna (altrimenti vale il modello di sistema)"}
                {" · variabili: {{nome}} {{cognome}} {{corso}} {{punti}} {{elenco}} · genere: [benvenuto|benvenuta]"}
              </span>
            </div>
            <div className="grid grid-2">
              {templateTypes.map((type) => {
                const { tpl, isOverride, global } = effectiveTemplate(type);
                const meta = EMAIL_TYPE_LABELS[type];
                const save = saveTemplate.bind(null, type);
                const reset = resetTemplate.bind(null, type);
                return (
                  <div className="card" key={type}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <strong style={{ flex: 1 }}>{meta.emoji} {meta.label}</strong>
                      {global.enabled ? <span className="pill pill-green">Attiva</span> : <span className="pill pill-red">Disattivata</span>}
                      {isOverride && (
                        <span className="pill pill-blue">
                          {isStoreEditor ? "Personalizzato punto vendita" : "Personalizzato insegna"}
                        </span>
                      )}
                    </div>
                    <form action={save}>
                      <label className="field">
                        Oggetto
                        <input type="text" name="subject" defaultValue={tpl.subject} required />
                      </label>
                      <label className="field">
                        Testo
                        <textarea name="body" rows={3} defaultValue={tpl.body} required />
                      </label>
                      {isGlobalEditor ? (
                        <label className="checkbox-row">
                          <input type="checkbox" name="enabled" defaultChecked={global.enabled} /> Automazione attiva
                        </label>
                      ) : (
                        <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 10px" }}>
                          L&apos;attivazione dell&apos;automazione è gestita dall&apos;amministratore di sistema.
                        </p>
                      )}
                      <button className="btn btn-sm" type="submit">💾 Salva modello</button>
                    </form>
                    {(isOverride || isGlobalEditor) && (
                      <form action={reset} style={{ marginTop: 8 }}>
                        <button className="btn btn-outline btn-sm" type="submit">
                          {isGlobalEditor ? "↺ Ripristina testo predefinito" : "↺ Torna al modello di sistema"}
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="section">
          <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3 style={{ margin: 0 }}>▶ Esegui ora il controllo promemoria</h3>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
                Simula il job notturno: analizza tutti i collaboratori attivi e genera i promemoria per i corsi
                obbligatori non completati (max 1 email al giorno per persona).
              </p>
            </div>
            <form action={runReminders}>
              <button className="btn" type="submit">Esegui controllo</button>
            </form>
          </div>
        </div>

        {user.role === "system_admin" && (
          <div className="section">
            <div className="section-head">
              <h2>🎛️ Impostazioni automazioni</h2>
              <span className="hint">solo amministratore di sistema</span>
            </div>
            <div className="card" style={{ maxWidth: 560 }}>
              <form action={saveAutomationSettings} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <label className="field" style={{ marginBottom: 0, maxWidth: 280 }}>
                  Avviso urgente quando mancano meno di (giorni)
                  <input type="text" name="urgentDays" defaultValue={String(db.settings.urgentDays ?? 7)} />
                </label>
                <button className="btn btn-sm" type="submit">💾 Salva</button>
              </form>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "10px 0 0" }}>
                Sotto questa soglia il promemoria diventa &quot;Corso in scadenza&quot; (urgente). L&apos;attivazione
                delle singole automazioni si gestisce con l&apos;interruttore di ogni modello qui sopra.
              </p>
            </div>
          </div>
        )}

        {canEditTemplates && (
          <div className="section">
            <div className="section-head">
              <h2>➕ Modelli aggiuntivi ({myCustomTemplates.length})</h2>
              <span className="hint">
                email extra collegate a un&apos;automazione — es. un secondo messaggio di benvenuto con le regole del negozio
              </span>
            </div>
            <div className="grid grid-2">
              {myCustomTemplates.map((ct) => {
                const editable = canTouchCustom(ct);
                const scopeName = ct.storeId
                  ? db.stores.find((s) => s.id === ct.storeId)?.name
                  : ct.tenantId
                    ? db.tenants.find((t) => t.id === ct.tenantId)?.name
                    : "Sistema";
                const meta = EMAIL_TYPE_LABELS[ct.trigger];
                return (
                  <div className="card" key={ct.id}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                      <strong style={{ flex: 1 }}>{ct.name}</strong>
                      <span className="pill pill-gray">{scopeName}</span>
                      {ct.enabled ? <span className="pill pill-green">Attivo</span> : <span className="pill pill-red">Spento</span>}
                    </div>
                    {editable ? (
                      <>
                        <form action={saveCustomTemplate.bind(null, ct.id)}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <label className="field">Nome<input type="text" name="name" defaultValue={ct.name} required /></label>
                            <label className="field">
                              Collegato all&apos;automazione
                              <select name="trigger" defaultValue={ct.trigger}>
                                {templateTypes.map((t) => (
                                  <option key={t} value={t}>{EMAIL_TYPE_LABELS[t].emoji} {EMAIL_TYPE_LABELS[t].label}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <label className="field">Oggetto<input type="text" name="subject" defaultValue={ct.subject} required /></label>
                          <label className="field">Testo<textarea name="body" rows={3} defaultValue={ct.body} required /></label>
                          <label className="checkbox-row">
                            <input type="checkbox" name="enabled" defaultChecked={ct.enabled} /> Modello attivo
                          </label>
                          <button className="btn btn-sm" type="submit">💾 Salva</button>
                        </form>
                        <form action={deleteCustomTemplate.bind(null, ct.id)} style={{ marginTop: 8 }}>
                          <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>🗑 Elimina</button>
                        </form>
                      </>
                    ) : (
                      <p style={{ fontSize: 13, color: "var(--muted)" }}>
                        {meta.emoji} {meta.label} — «{ct.subject}» (gestito da {scopeName})
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="card" style={{ background: "var(--green-50)" }}>
                <h3 style={{ marginTop: 0 }}>➕ Nuovo modello aggiuntivo</h3>
                <form action={saveCustomTemplate.bind(null, null)}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label className="field">Nome<input type="text" name="name" required placeholder="es. Regole del negozio" /></label>
                    <label className="field">
                      Collegato all&apos;automazione
                      <select name="trigger" defaultValue="benvenuto">
                        {templateTypes.map((t) => (
                          <option key={t} value={t}>{EMAIL_TYPE_LABELS[t].emoji} {EMAIL_TYPE_LABELS[t].label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="field">Oggetto<input type="text" name="subject" required placeholder="es. [Benvenuto|Benvenuta] {{nome}}, ecco le regole del negozio" /></label>
                  <label className="field">Testo<textarea name="body" rows={3} required placeholder="Testo dell'email — puoi usare le variabili e la declinazione [maschile|femminile]" /></label>
                  <label className="checkbox-row">
                    <input type="checkbox" name="enabled" defaultChecked /> Modello attivo
                  </label>
                  <button className="btn btn-sm" type="submit">Crea modello</button>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
                    Verrà inviato in aggiunta al modello principale, quando scatta l&apos;automazione scelta,{" "}
                    {isGlobalEditor ? "a tutto il consorzio." : isStoreEditor ? "solo al tuo punto vendita." : "solo alla tua insegna."}
                  </p>
                </form>
              </div>
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-head">
            <h2>📤 Registro invii ({emails.length})</h2>
            <span className="hint">ultime 60 email nel tuo ambito</span>
          </div>
          <div className="card table-wrap">
            <table className="data">
              <thead>
                <tr><th>Data</th><th>Destinatario</th><th>Tipo</th><th>Oggetto</th><th>Stato</th></tr>
              </thead>
              <tbody>
                {emails.length === 0 && (
                  <tr><td colSpan={5} className="empty">Nessuna email ancora registrata nel tuo ambito.</td></tr>
                )}
                {emails.map((e) => {
                  const u = db.users.find((x) => x.id === e.userId);
                  const t = EMAIL_TYPE_LABELS[e.type];
                  return (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {new Date(e.date).toLocaleDateString("it-IT")}{" "}
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>
                          {new Date(e.date).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td>
                        <strong>{u ? `${u.firstName} ${u.lastName}` : "—"}</strong>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{e.to}</div>
                      </td>
                      <td><span className="pill pill-blue">{t.emoji} {t.label}</span></td>
                      <td>
                        {e.subject}
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{e.body.slice(0, 90)}{e.body.length > 90 ? "…" : ""}</div>
                      </td>
                      <td><span className="pill pill-green">✓ {e.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
