import { getDb } from "@/lib/db";
import { loginWithPassword } from "@/lib/actions";
import { SITE_NAME } from "@/lib/types";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disattivato?: string; errore?: string; attivato?: string; minuti?: string; reimpostata?: string }>;
}) {
  const { disattivato, errore, attivato, minuti, reimpostata } = await searchParams;
  const db = await getDb();

  return (
    <div>
      <div className="login-hero">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={db.settings.logoUrl} alt={SITE_NAME} style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>{SITE_NAME}</span>
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
            Email o password non corretti. Se l&apos;hai dimenticata, <a href="/reimposta">te ne mandiamo una nuova per email</a>.
          </div>
        )}
        {errore === "troppi" && (
          <div className="alert alert-amber">
            <strong>Troppi tentativi sbagliati.</strong> Per sicurezza l&apos;accesso è bloccato per{" "}
            {minuti ?? "qualche"} minut{minuti === "1" ? "o" : "i"}. Se hai dimenticato la password,{" "}
            <a href="/reimposta">fattene mandare una nuova per email</a>.
          </div>
        )}
        {attivato && (
          <div className="alert alert-green">✓ Account attivato! Ora accedi con la tua email e la password appena scelta.</div>
        )}
        {reimpostata && (
          <div className="alert alert-green">✓ Password cambiata. Entra con quella nuova.</div>
        )}

        <div className="card login-accedi">
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
          <div className="login-aiuti">
            <a href="/reimposta">Password dimenticata</a>
            <span>·</span>
            <a href="/attiva">Primo accesso</a>
            <span>·</span>
            <a href="/registrati">Chiedi la registrazione</a>
          </div>
        </div>
      </div>
    </div>
  );
}
