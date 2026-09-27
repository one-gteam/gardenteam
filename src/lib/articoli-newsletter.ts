import { getDb } from "./db";
import { sendMail } from "./mailer";
import { firmaPer } from "./auth";
import {
  articoloPer, dataItaliana, getArticoliDb, newsletterDovuta, saveArticoliDb, soloTesto, uscito,
  type Articolo, type ArticoliDB,
} from "./articoli";
import type { User } from "./types";

/*
 * La newsletter degli articoli: a chi si è iscritto, gli articoli usciti
 * dall'ultimo invio che può vedere. Parte dal cron (una volta al giorno) e
 * dal pulsante "Manda adesso" di chi gestisce l'area. Si manda solo se gli
 * articoli nuovi sono almeno il minimo impostato. Mittente: GT One.
 */
function siteUrl(): string {
  return (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const assoluto = (url: string | undefined, base: string) => (!url ? "" : /^https?:\/\//.test(url) ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`);

/** Il link per disiscriversi: firmato, così vale senza fare l'accesso ma solo per quella persona. */
export function linkDisiscrizione(userId: string): string {
  return `${siteUrl()}/articoli/disiscriviti?u=${encodeURIComponent(userId)}&t=${firmaPer("disiscrivi-newsletter", userId)}`;
}

/**
 * La mail: testata verde con il logo, un'apertura col nome, una scheda per
 * articolo (foto, categoria, titolo, due righe, pulsante), i piedi con la
 * disiscrizione. Tabelle e stili in linea: i programmi di posta (Outlook in
 * testa) ignorano i fogli di stile.
 */
export function htmlNewsletter(u: User, articoli: Articolo[], db: ArticoliDB, logoUrl: string, oggetto: string): string {
  const base = siteUrl();
  const schede = articoli.map((a) => {
    const cat = db.categorie.find((c) => c.id === a.categoriaId);
    const foto = assoluto(a.copertina, base);
    const link = `${base}/articoli/${a.id}`;
    return `
      <tr><td style="padding:0 0 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e3eadb;border-radius:14px;overflow:hidden">
          ${foto ? `<tr><td><a href="${link}"><img src="${esc(foto)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;max-height:240px;object-fit:cover;border:0"></a></td></tr>` : ""}
          <tr><td style="padding:18px 22px 20px">
            ${cat ? `<div style="display:inline-block;background:#e6f4d5;color:#00652e;font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;margin-bottom:8px">${esc(`${cat.emoji ? `${cat.emoji} ` : ""}${cat.nome}`)}</div>` : ""}
            ${a.inEvidenza ? `<div style="display:inline-block;background:#fdebd8;color:#9a4f0f;font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;margin:0 0 8px 4px">In evidenza</div>` : ""}
            <div style="font-size:19px;line-height:1.3;font-weight:800;color:#12301c;margin:2px 0 6px"><a href="${link}" style="color:#12301c;text-decoration:none">${esc(a.titolo)}</a></div>
            <div style="font-size:12.5px;color:#7a8578;margin-bottom:10px">${esc(dataItaliana(a.pubblicato ?? a.creato))} · ${esc(a.autoreNome)}${a.allegati.length ? ` · 📎 ${a.allegati.length}` : ""}</div>
            <div style="font-size:14.5px;line-height:1.6;color:#333">${esc(soloTesto(a.testo, 230))}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="background:#00652e;border-radius:999px">
              <a href="${link}" style="display:inline-block;padding:9px 20px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">Leggi l'articolo →</a>
            </td></tr></table>
          </td></tr>
        </table>
      </td></tr>`;
  }).join("");

  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(oggetto)}</title></head>
<body style="margin:0;padding:0;background:#eef3e8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${esc(articoli.map((a) => a.titolo).join(" · ").slice(0, 150))}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3e8"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
      <tr><td style="background:#003d1c;background-image:linear-gradient(120deg,#003d1c,#00652e);border-radius:16px 16px 0 0;padding:22px 26px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle">${logoUrl ? `<span style="display:inline-block;background:#ffffff;border-radius:10px;padding:6px 10px"><img src="${esc(logoUrl)}" alt="Garden Team" height="30" style="display:block;height:30px;border:0"></span>` : ""}</td>
          <td style="vertical-align:middle;text-align:right;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:.3px">GT One</td>
        </tr></table>
        <div style="color:#cfe8bf;font-size:13px;margin-top:14px;text-transform:uppercase;letter-spacing:1.2px;font-weight:700">Articoli · ${esc(new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" }))}</div>
        <div style="color:#ffffff;font-size:24px;font-weight:800;line-height:1.25;margin-top:4px">${articoli.length === 1 ? "Un articolo nuovo per te" : `${articoli.length} articoli nuovi per te`}</div>
      </td></tr>
      <tr><td style="background:#f7faf3;padding:22px 20px 6px;border-radius:0 0 16px 16px">
        <div style="font-size:15px;color:#333;margin:0 4px 18px">Ciao ${esc(u.firstName)}, ecco cosa è uscito di recente.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${schede}</table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px"><tr><td align="center">
          <a href="${base}/articoli" style="display:inline-block;border:2px solid #00652e;border-radius:999px;padding:9px 22px;color:#00652e;font-weight:700;font-size:14px;text-decoration:none">Tutti gli articoli</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:18px 16px 8px;text-align:center;font-size:12px;line-height:1.6;color:#7a8578">
        Ricevi questa email perché ti sei iscritto alla newsletter degli articoli di GT One, il portale del Consorzio Garden Team.<br>
        <a href="${linkDisiscrizione(u.id)}" style="color:#7a8578">Non voglio più riceverla</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function inviaNewsletterArticoli(forzata = false): Promise<{ inviate: number; nota?: string }> {
  const db = await getArticoliDb();
  const n = db.newsletter;
  if (!forzata && !newsletterDovuta(n)) return { inviate: 0, nota: "non ancora dovuta" };
  const academy = await getDb();
  const da = n.ultimoInvio ?? "";
  const oggi = new Date();
  // i programmati entrano solo quando sono usciti
  const nuovi = db.articoli.filter((a) => uscito(a, oggi) && (a.pubblicato ?? a.creato) > da && !a.inNewsletter);
  if (nuovi.length < n.minimo) return { inviate: 0, nota: `${nuovi.length} articoli nuovi, minimo ${n.minimo}` };

  const base = siteUrl();
  const logo = assoluto(academy.settings.logoUrl, base);
  let inviate = 0;
  for (const id of n.iscritti) {
    const u = academy.users.find((x) => x.id === id);
    if (!u || u.active === false) continue;
    const suoi = nuovi.filter((a) => articoloPer(u, a, db, oggi))
      .sort((a, b) => Number(!!b.inEvidenza) - Number(!!a.inEvidenza) || (b.pubblicato ?? "").localeCompare(a.pubblicato ?? ""));
    if (suoi.length === 0) continue;
    const oggetto = n.oggetto?.trim() || (suoi.length === 1 ? `📰 ${suoi[0].titolo}` : `📰 ${suoi.length} articoli nuovi: ${suoi[0].titolo} e altri`);
    const testo = `Ciao ${u.firstName},\n\ngli articoli nuovi su GT One:\n\n${suoi.map((a) => `• ${a.titolo}\n  ${base}/articoli/${a.id}`).join("\n\n")}\n\nPer non riceverla più: ${linkDisiscrizione(u.id)}`;
    const r = await sendMail(u.email, oggetto, testo, {
      nomeMittente: "GT One",
      html: htmlNewsletter(u, suoi, db, logo, oggetto),
      headers: { "List-Unsubscribe": `<${linkDisiscrizione(u.id)}>` },
    });
    if (r.sent !== false) inviate++;
  }
  const adesso = new Date().toISOString();
  n.ultimoInvio = adesso;
  for (const a of nuovi) a.inNewsletter = adesso;
  await saveArticoliDb(db);
  return { inviate };
}
