import { getDb } from "@/lib/db";
import { loginWithPassword } from "@/lib/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disattivato?: string; errore?: string; attivato?: string }>;
}) {
  const { disattivato, errore, attivato } = await searchParams;
  const db = await getDb();

  return (
    <div>
      <div className="login-hero">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={db.settings.logoUrl} alt="Garden Team" style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>Garden Team</span>
        </div>
        <p>
          Il portale unico dei servizi del Consorzio: un solo accesso per tutte le macroaree.
        </p>
      </div>
      <div className="login-cards">
        {disattivato && (
          <div className="alert alert-amber">
            <strong>Accesso non consentito:</strong> questo account risulta cessato ed è stato disattivato.
            Contatta il tuo responsabile se ritieni sia un errore.
          </div>
        )}
        {errore === "credenziali" && (
          <div className="alert alert-amber">
            Email o password non corretti. Se non hai ancora impostato la password, usa <a href="/attiva">Attiva utente</a>.
          </div>
        )}
        {attivato && (
          <div className="alert alert-green">✓ Account attivato! Ora accedi con la tua email e la password appena scelta.</div>
        )}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "stretch" }}>
          <div className="card">
            <h2>Accedi</h2>
            <form action={loginWithPassword}>
              <label className="field">
                Email
                <input type="text" name="email" required placeholder="nome@insegna.it" />
              </label>
              <label className="field">
                Password
                <input type="password" name="password" required />
              </label>
              <button className="btn" type="submit" style={{ width: "100%" }}>Entra</button>
            </form>
          </div>

          <div className="card">
            <h2>Primo accesso?</h2>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              <strong>Sei già stato inserito dal tuo punto vendita?</strong>
              <br />
              Attiva il tuo account impostando la password.
            </p>
            <a className="btn btn-outline" href="/attiva" style={{ display: "block", marginBottom: 14 }}>
              Attiva utente
            </a>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              <strong>Non sei ancora stato inserito?</strong>
              <br />
              Registrati con la parola segreta del tuo punto vendita: la richiesta verrà approvata dal responsabile.
            </p>
            <a className="btn btn-outline" href="/registrati" style={{ display: "block" }}>
              Richiedi la registrazione
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}
