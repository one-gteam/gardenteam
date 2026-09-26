import { getDb } from "./db";
import { sendMail } from "./mailer";
import { articoloPer, dataItaliana, getArticoliDb, newsletterDovuta, saveArticoliDb, soloTesto } from "./articoli";

/*
 * La newsletter degli articoli: a chi si è iscritto, gli articoli pubblicati
 * dall'ultimo invio che può vedere. Parte dal cron (una volta al giorno) e
 * dal pulsante "Manda adesso" di chi gestisce l'area. Si manda solo se gli
 * articoli nuovi sono almeno il minimo impostato.
 */
function siteUrl(): string {
  return (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
}

export async function inviaNewsletterArticoli(forzata = false): Promise<{ inviate: number; nota?: string }> {
  const db = await getArticoliDb();
  const n = db.newsletter;
  if (!forzata && !newsletterDovuta(n)) return { inviate: 0, nota: "non ancora dovuta" };
  const academy = await getDb();
  const da = n.ultimoInvio ?? "";
  const nuovi = db.articoli.filter((a) => a.stato === "pubblicato" && (a.pubblicato ?? a.creato) > da && !a.inNewsletter);
  if (nuovi.length < n.minimo) return { inviate: 0, nota: `${nuovi.length} articoli nuovi, minimo ${n.minimo}` };

  const base = siteUrl();
  let inviate = 0;
  for (const id of n.iscritti) {
    const u = academy.users.find((x) => x.id === id);
    if (!u || u.active === false) continue;
    const suoi = nuovi.filter((a) => articoloPer(u, a, db));
    if (suoi.length === 0) continue;
    const righe = suoi.map((a) => {
      const cat = db.categorie.find((c) => c.id === a.categoriaId);
      return `• ${a.titolo}${cat ? ` [${cat.nome}]` : ""}\n  ${dataItaliana(a.pubblicato ?? a.creato)} · ${a.autoreNome}\n  ${soloTesto(a.testo, 180)}\n  ${base}/articoli/${a.id}`;
    });
    const oggetto = n.oggetto?.trim() || `📰 ${suoi.length === 1 ? "Un articolo nuovo" : `${suoi.length} articoli nuovi`} su GT One`;
    const corpo = `Ciao ${u.firstName},\n\nquesti sono gli articoli pubblicati di recente:\n\n${righe.join("\n\n")}\n\nTutti gli articoli: ${base}/articoli\nPer non riceverla più togli la spunta "Ricevi la newsletter" nella pagina Articoli.`;
    const r = await sendMail(u.email, oggetto, corpo);
    if (r.sent !== false) inviate++;
  }
  const adesso = new Date().toISOString();
  n.ultimoInvio = adesso;
  for (const a of nuovi) a.inNewsletter = adesso;
  await saveArticoliDb(db);
  return { inviate };
}
