import { activateAccount } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { SITE_NAME } from "@/lib/types";

const ERRORS: Record<string, string> = {
  corta: "La password deve avere almeno 8 caratteri.",
  diverse: "Le due password non coincidono.",
  nontrovato: "Nessun account trovato con questa email. Se non sei ancora stato inserito dal tuo punto vendita, usa la registrazione.",
  giaattivo: "Questo account è già attivo: torna al login e inserisci la tua password.",
};

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string; minuti?: string; inviata?: string }>;
}) {
  const { errore, minuti, inviata } = await searchParams;
  const { settings } = await getDb();

  return (
    <div>
      <div className="login-hero">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.logoUrl} alt={SITE_NAME} style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>{SITE_NAME}</span>
        </div>
        <p>Attiva il tuo account</p>
      </div>
      <div className="login-cards" style={{ maxWidth: 560 }}>
        {errore && (
          <div className="alert alert-amber">
            {errore === "troppi"
              ? `Troppi tentativi sbagliati: riprova fra ${minuti ?? "qualche"} minut${minuti === "1" ? "o" : "i"}.`
              : ERRORS[errore] ?? "Errore imprevisto, riprova."}
          </div>
        )}

        {inviata && (
          <div className="alert alert-green">
            Se l&apos;email è registrata in GT One, ti abbiamo mandato un link per scegliere la password: aprilo entro due ore.
            Controlla anche la posta indesiderata.
          </div>
        )}
        <div className="card">
          <h2>Attiva utente</h2>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Il tuo punto vendita ti ha già inserito in GT One: inserisci la tua email di lavoro,
            ti mandiamo un link per scegliere la password.
          </p>
          <form action={activateAccount}>
            <label className="field">
              Email (quella comunicata al punto vendita)
              <input type="email" name="email" required placeholder="nome@insegna.it" />
            </label>
            <button className="btn" type="submit" style={{ width: "100%" }}>Mandami il link</button>
          </form>
          <p style={{ textAlign: "center", marginTop: 14, fontSize: 14 }}>
            <a href="/login">← Torna al login</a> · <a href="/registrati">Non sei stato inserito? Registrati</a>
          </p>
        </div>
      </div>
    </div>
  );
}
