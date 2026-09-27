import { getDb } from "@/lib/db";
import { firmaValida } from "@/lib/auth";
import { getArticoliDb, saveArticoliDb } from "@/lib/articoli";
import { SITE_NAME } from "@/lib/types";
import { redirect } from "next/navigation";

/*
 * Disiscrizione dalla newsletter dal link in fondo all'email: vale senza fare
 * l'accesso perché il link è firmato per quella persona. Si conferma con un
 * pulsante: i programmi di posta aprono da soli i link per controllarli, e un
 * link che disiscrive al primo tocco disiscriverebbe tutti.
 */
async function disiscrivi(formData: FormData) {
  "use server";
  const u = String(formData.get("u") ?? "");
  const t = String(formData.get("t") ?? "");
  if (!firmaValida("disiscrivi-newsletter", u, t)) redirect("/articoli/disiscriviti?esito=link");
  const db = await getArticoliDb();
  db.newsletter.iscritti = db.newsletter.iscritti.filter((id) => id !== u);
  await saveArticoliDb(db);
  redirect("/articoli/disiscriviti?esito=ok");
}

export default async function DisiscrivitiPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; t?: string; esito?: string }>;
}) {
  const { u, t, esito } = await searchParams;
  const academy = await getDb();
  const valido = !!u && !!t && firmaValida("disiscrivi-newsletter", u, t);
  const persona = valido ? academy.users.find((x) => x.id === u) : undefined;
  return (
    <div>
      <div className="login-hero">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={academy.settings.logoUrl} alt={SITE_NAME} style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>{SITE_NAME}</span>
        </div>
        <p>Newsletter degli articoli</p>
      </div>
      <div className="login-cards login-stretto">
        <div className="card">
          {esito === "ok" ? (
            <>
              <h2>Fatto</h2>
              <p style={{ fontSize: 14 }}>Non riceverai più la newsletter. Puoi riattivarla quando vuoi dalla pagina Articoli.</p>
              <a className="btn btn-outline" href="/articoli">Vai agli articoli</a>
            </>
          ) : esito === "link" || !valido ? (
            <>
              <h2>Link non valido</h2>
              <p style={{ fontSize: 14 }}>Questo link non funziona. Puoi togliere l&apos;iscrizione dalla pagina Articoli, togliendo la spunta &laquo;Ricevi la newsletter&raquo;.</p>
              <a className="btn btn-outline" href="/articoli">Vai agli articoli</a>
            </>
          ) : (
            <>
              <h2>Non vuoi più la newsletter?</h2>
              <p style={{ fontSize: 14 }}>
                {persona ? <>Per <strong>{persona.email}</strong>. </> : null}
                Gli articoli restano sempre consultabili su GT One.
              </p>
              <form action={disiscrivi}>
                <input type="hidden" name="u" value={u} />
                <input type="hidden" name="t" value={t} />
                <button className="btn" type="submit" style={{ width: "100%" }}>Sì, non mandarmela più</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
