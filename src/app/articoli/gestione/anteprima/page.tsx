import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArticoliHeader from "@/components/articoli/ArticoliHeader";
import { getArticoliDb, gestisceArticoli, articoliVisibili } from "@/lib/articoli";
import { htmlNewsletter } from "@/lib/articoli-newsletter";

/** Come arriverà la newsletter: con gli ultimi articoli che vede chi guarda, senza spedire niente. */
export default async function AnteprimaNewsletterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [db, academy] = await Promise.all([getArticoliDb(), getDb()]);
  if (!gestisceArticoli(user, db)) redirect("/articoli");
  const ultimi = articoliVisibili(user, db).slice(0, 4);
  const base = (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
  const logo = /^https?:/.test(academy.settings.logoUrl) ? academy.settings.logoUrl : `${base}${academy.settings.logoUrl}`;
  const oggetto = db.newsletter.oggetto?.trim() || (ultimi.length === 1 ? `📰 ${ultimi[0]?.titolo}` : `📰 ${ultimi.length} articoli nuovi`);
  return (
    <div>
      <ArticoliHeader user={user} active="gestione" pubblica gestisce />
      <div className="container" style={{ maxWidth: 760 }}>
        <div style={{ marginBottom: 8 }}><a href="/articoli/gestione">← Gestione</a></div>
        <h1 style={{ marginBottom: 4 }}>Anteprima newsletter</h1>
        <p className="subtitle">
          Mittente <strong>GT One</strong> · oggetto «{oggetto}». Con gli ultimi {ultimi.length} articoli che vedi tu: ognuno riceve solo i suoi.
        </p>
        {ultimi.length === 0 ? (
          <div className="card"><p className="empty" style={{ margin: 0 }}>Nessun articolo pubblicato da mostrare.</p></div>
        ) : (
          <iframe title="Anteprima newsletter" srcDoc={htmlNewsletter(user, ultimi, db, logo, oggetto)}
            style={{ width: "100%", height: 1100, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} />
        )}
      </div>
    </div>
  );
}
