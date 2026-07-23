import { activateAccount } from "@/lib/actions";
import { getDb } from "@/lib/db";

const ERRORS: Record<string, string> = {
  corta: "La password deve avere almeno 8 caratteri.",
  diverse: "Le due password non coincidono.",
  nontrovato: "Nessun account trovato con questa email. Se non sei ancora stato inserito dal tuo punto vendita, usa la registrazione.",
  giaattivo: "Questo account è già attivo: torna al login e inserisci la tua password.",
};

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string }>;
}) {
  const { errore } = await searchParams;
  const { settings } = await getDb();

  return (
    <div>
      <div className="login-hero">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.logoUrl} alt={settings.portalName} style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>{settings.portalName}</span>
        </div>
        <p>Attiva il tuo account</p>
      </div>
      <div className="login-cards" style={{ maxWidth: 560 }}>
        {errore && <div className="alert alert-amber">⚠️ {ERRORS[errore] ?? "Errore imprevisto, riprova."}</div>}

        <div className="card">
          <h2>🔑 Attiva utente</h2>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Il tuo punto vendita ti ha già inserito in Academy GT: inserisci la tua email di lavoro e
            scegli una password per attivare l&apos;account.
          </p>
          <form action={activateAccount}>
            <label className="field">
              Email (quella comunicata al punto vendita)
              <input type="email" name="email" required placeholder="nome@insegna.it" />
            </label>
            <label className="field">
              Nuova password (minimo 8 caratteri)
              <input type="password" name="password" required minLength={8} />
            </label>
            <label className="field">
              Ripeti la password
              <input type="password" name="password2" required minLength={8} />
            </label>
            <button className="btn" type="submit" style={{ width: "100%" }}>Attiva e vai al login</button>
          </form>
          <p style={{ textAlign: "center", marginTop: 14, fontSize: 14 }}>
            <a href="/login">← Torna al login</a> · <a href="/registrati">Non sei stato inserito? Registrati</a>
          </p>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center", marginTop: 14 }}>
          In produzione: verifica dell&apos;email con link di conferma prima dell&apos;attivazione.
        </p>
      </div>
    </div>
  );
}
