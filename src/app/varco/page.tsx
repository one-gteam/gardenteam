import { gateLogin } from "@/lib/gate";

export default async function VarcoPage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string; next?: string }>;
}) {
  const { errore, next } = await searchParams;

  return (
    <div>
      <div className="login-hero">
        <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>Garden Team</span>
        <p>Prototipo in lavorazione — accesso riservato.</p>
      </div>
      <div className="login-cards">
        {errore && (
          <div className="alert alert-amber">Utente o password non corretti.</div>
        )}
        <div className="card" style={{ maxWidth: 380, margin: "0 auto" }}>
          <h2>Accesso riservato</h2>
          <form action={gateLogin}>
            <input type="hidden" name="next" value={next ?? "/login"} />
            <label className="field">
              Utente
              <input type="text" name="user" required autoFocus />
            </label>
            <label className="field">
              Password
              <input type="password" name="password" required />
            </label>
            <button className="btn" type="submit" style={{ width: "100%" }}>Entra</button>
          </form>
        </div>
      </div>
    </div>
  );
}
