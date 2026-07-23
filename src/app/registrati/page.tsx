import { getDb } from "@/lib/db";
import { registerRequest } from "@/lib/actions";

const ERRORS: Record<string, string> = {
  segreta: "Parola segreta non corretta per il punto vendita selezionato. Chiedila al tuo responsabile.",
  pv: "Seleziona il tuo punto vendita.",
  dati: "Compila tutti i dati richiesti.",
  esiste: "Esiste già un account con questa email: usa il login o Attiva utente.",
  incorso: "Hai già una richiesta in attesa di approvazione per questa email.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string; inviata?: string }>;
}) {
  const { errore, inviata } = await searchParams;
  const db = await getDb();

  return (
    <div>
      <div className="login-hero">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={db.settings.logoUrl} alt={db.settings.portalName} style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>{db.settings.portalName}</span>
        </div>
        <p>Richiesta di registrazione</p>
      </div>
      <div className="login-cards" style={{ maxWidth: 640 }}>
        {inviata ? (
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48 }}>📨</div>
            <h2>Richiesta inviata!</h2>
            <p style={{ color: "var(--muted)" }}>
              Il responsabile del tuo punto vendita riceverà la richiesta e, una volta approvata,
              potrai attivare l&apos;account dalla pagina <strong>Attiva utente</strong> impostando la tua password.
            </p>
            <a className="btn" href="/login">Torna al login</a>
          </div>
        ) : (
          <div className="card">
            <h2>📝 Registrati</h2>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              Se non sei ancora stato inserito dal tuo punto vendita, compila la richiesta. Ti servirà la{" "}
              <strong>parola segreta</strong> del tuo negozio (chiedila al responsabile): serve a evitare
              registrazioni estranee. La richiesta verrà poi approvata dal punto vendita.
            </p>
            {errore && <div className="alert alert-amber">⚠️ {ERRORS[errore] ?? "Errore imprevisto, riprova."}</div>}
            <form action={registerRequest}>
              <div style={{ background: "var(--green-50)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  🔑 Parola segreta del punto vendita
                  <input type="text" name="secret" required placeholder="fornita dal tuo responsabile" />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px", gap: 12 }}>
                <label className="field">Nome<input type="text" name="firstName" required /></label>
                <label className="field">Cognome<input type="text" name="lastName" required /></label>
                <label className="field">
                  Genere
                  <select name="gender" defaultValue="">
                    <option value="">—</option>
                    <option value="f">Femminile</option>
                    <option value="m">Maschile</option>
                  </select>
                </label>
              </div>
              <label className="field">Email personale o di lavoro<input type="email" name="email" required /></label>
              <label className="field">
                Punto vendita
                <select name="storeId" required defaultValue="">
                  <option value="" disabled>— Seleziona insegna e punto vendita —</option>
                  {db.tenants.map((t) => (
                    <optgroup key={t.id} label={t.name}>
                      {db.stores.filter((s) => s.tenantId === t.id).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ""}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <label className="field">Data di nascita<input type="date" name="birthDate" required /></label>
                <label className="field">Codice fiscale<input type="text" name="taxCode" required minLength={16} maxLength={16} style={{ textTransform: "uppercase" }} /></label>
                <label className="field">
                  Reparto
                  <select name="departmentId" defaultValue="">
                    <option value="">— Non so / da definire —</option>
                    {db.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              </div>
              <button className="btn" type="submit" style={{ width: "100%" }}>Invia richiesta di registrazione</button>
            </form>
            <p style={{ textAlign: "center", marginTop: 14, fontSize: 14 }}>
              <a href="/login">← Torna al login</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
