import { getDb } from "@/lib/db";
import { richiediReimposta, reimpostaPassword } from "@/lib/actions";
import { idDaTokenReimposta } from "@/lib/auth";
import { SITE_NAME } from "@/lib/types";

const ERRORI: Record<string, string> = {
  corta: "La password deve avere almeno 8 caratteri.",
  diverse: "Le due password non coincidono.",
  scaduto: "Questo link non è più valido: era valido due ore, oppure la password è già stata cambiata. Chiedine un altro.",
};

/**
 * "Ho dimenticato la password": senza gettone chiede l'email e manda il link,
 * col gettone fa scegliere la password nuova. Il gettone è firmato e scade,
 * quindi la pagina non ha bisogno di sessione.
 */
export default async function ReimpostaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; errore?: string; inviata?: string; minuti?: string }>;
}) {
  const { token, errore, inviata, minuti } = await searchParams;
  const db = await getDb();
  const utente = token
    ? (() => {
        const id = idDaTokenReimposta(token, (x) => db.users.find((u) => u.id === x)?.passwordHash);
        return id ? db.users.find((u) => u.id === id) : undefined;
      })()
    : undefined;

  return (
    <div>
      <div className="login-hero">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={db.settings.logoUrl} alt={SITE_NAME} style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>{SITE_NAME}</span>
        </div>
        <p>La tua password, di nuovo tua.</p>
      </div>
      <div className="login-cards login-stretto">
        {errore === "troppi" && (
          <div className="alert alert-amber">
            <strong>Troppe richieste.</strong> Riprova fra {minuti ?? "qualche"} minut{minuti === "1" ? "o" : "i"}.
          </div>
        )}
        {errore && errore !== "troppi" && <div className="alert alert-amber">{ERRORI[errore] ?? "Errore imprevisto, riprova."}</div>}

        {inviata && (
          <div className="card">
            <h2>Controlla la posta</h2>
            <p style={{ fontSize: 14 }}>
              Se quell&apos;indirizzo è di un account GT One, ti è arrivata un&apos;email con il link per scegliere la password.
              Vale due ore. Se non arriva, guarda nella posta indesiderata o chiedi al tuo responsabile.
            </p>
            <a className="btn btn-outline" href="/login">Torna all&apos;accesso</a>
          </div>
        )}

        {!inviata && token && utente && (
          <div className="card">
            <h2>Scegli la nuova password</h2>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              Per <strong>{utente.email}</strong>. Almeno 8 caratteri.
            </p>
            <form action={reimpostaPassword}>
              <input type="hidden" name="token" value={token} />
              <label className="field">
                Nuova password
                <input type="password" name="password" required minLength={8} autoFocus />
              </label>
              <label className="field">
                Ripetila
                <input type="password" name="password2" required minLength={8} />
              </label>
              <button className="btn" type="submit" style={{ width: "100%" }}>Salva ed entra</button>
            </form>
          </div>
        )}

        {!inviata && token && !utente && (
          <div className="card">
            <h2>Link non più valido</h2>
            <p style={{ fontSize: 14 }}>
              Il link vale due ore e una volta sola. Scrivi qui la tua email e te ne mando un altro.
            </p>
            <form action={richiediReimposta}>
              <label className="field">
                Email
                <input type="text" name="email" required placeholder="nome@insegna.it" />
              </label>
              <button className="btn" type="submit" style={{ width: "100%" }}>Mandami il link</button>
            </form>
          </div>
        )}

        {!inviata && !token && (
          <div className="card">
            <h2>Password dimenticata</h2>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              Scrivi l&apos;email del tuo account: ti mando un link per scegliere una password nuova. Vale due ore.
            </p>
            <form action={richiediReimposta}>
              <label className="field">
                Email
                <input type="text" name="email" required placeholder="nome@insegna.it" autoFocus />
              </label>
              <button className="btn" type="submit" style={{ width: "100%" }}>Mandami il link</button>
            </form>
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12, marginBottom: 0 }}>
              Entri da my.rosaflor? Lì la password è quella di my.rosaflor: entra come sempre da quel portale.
            </p>
            <a className="btn btn-outline btn-sm" href="/login" style={{ marginTop: 10 }}>Torna all&apos;accesso</a>
          </div>
        )}
      </div>
    </div>
  );
}
