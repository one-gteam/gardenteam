/**
 * Invio email transazionali tramite Resend (https://resend.com).
 *
 * Configurazione (solo variabili d'ambiente, mai dall'interfaccia: la chiave
 * non deve poter finire nel database né nel bundle del browser):
 *
 *   RESEND_API_KEY   chiave API del progetto Resend
 *   EMAIL_FROM       mittente verificato, es. "Academy GT <noreply@academy.gardenteam.biz>"
 *   EMAIL_REPLY_TO   (opzionale) dove finiscono le risposte, es. formazione@rosaflor.it
 *   EMAIL_TEST_TO    (opzionale) rete di sicurezza: se valorizzata TUTTE le email
 *                    vengono dirottate su questo indirizzo invece che ai destinatari
 *                    veri, con l'indirizzo originale scritto in cima al testo.
 *
 * Se chiave o mittente mancano, l'invio reale è disattivato: l'email viene solo
 * registrata nel registro invii (stato "in_coda"), com'era nel prototipo.
 */

const API_URL = "https://api.resend.com/emails";

export interface MailerConfig {
  enabled: boolean;
  from?: string;
  replyTo?: string;
  testTo?: string;
}

export function mailerConfig(): MailerConfig {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  return {
    enabled: !!key && !!from,
    from,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
    testTo: process.env.EMAIL_TEST_TO?.trim() || undefined,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** I testi dei modelli sono testo semplice: li rende in HTML mantenendo a capo e link. */
function textToHtml(body: string): string {
  return escapeHtml(body)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#00652e">$1</a>')
    .replace(/\n/g, "<br>");
}

/*
 * Il marchio della mail: "Academy GT" per chi usa solo la formazione, "GT One"
 * (il portale del Consorzio) per tutti gli altri. Prima tutte le mail uscivano
 * come "Academy GT", anche per chi lavora solo con i cartelli o gli articoli.
 */
export type Marchio = "academy" | "gtone";
const MARCHI: Record<Marchio, { nome: string; piede: string }> = {
  academy: { nome: "Academy GT", piede: "Messaggio automatico della piattaforma di formazione Academy GT. Non rispondere a questo indirizzo." },
  gtone: { nome: "GT One", piede: "Messaggio automatico di GT One, il portale del Consorzio Garden Team. Non rispondere a questo indirizzo." },
};
export function nomeMarchio(m: Marchio): string {
  return MARCHI[m].nome;
}

function wrap(subject: string, body: string, marchio: Marchio = "academy"): string {
  return `<!doctype html><html lang="it"><body style="margin:0;padding:24px;background:#f4faeb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6f4d5">
    <tr><td style="background:linear-gradient(120deg,#003d1c,#00652e);padding:18px 24px;color:#fff;font-weight:700;font-size:17px">${MARCHI[marchio].nome}</td></tr>
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 14px;font-size:18px;line-height:1.35;color:#003d1c">${escapeHtml(subject)}</h1>
      <div style="font-size:15px;line-height:1.6">${textToHtml(body)}</div>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f4faeb;font-size:12px;color:#6b7280">
      ${MARCHI[marchio].piede}
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Resend accetta 2 richieste al secondo sul piano base: distanzia gli invii
 * consecutivi dello stesso processo (es. il giro promemoria, che manda decine
 * di email di fila) per non farsi rifiutare con un 429.
 */
let lastSentAt = 0;
async function throttle() {
  const wait = 550 - (Date.now() - lastSentAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSentAt = Date.now();
}

export interface SendResult {
  /** true = consegnata a Resend; false = errore; null = invio reale non configurato. */
  sent: boolean | null;
  error?: string;
  id?: string;
}

/** Opzioni in più: HTML già composto (newsletter), nome del mittente, intestazioni. */
export interface OpzioniMail {
  html?: string;
  /** Il nome che si legge come mittente ("GT One"); l'indirizzo resta quello di EMAIL_FROM. */
  nomeMittente?: string;
  /** Intestazione e piede della mail (e mittente, se nomeMittente non c'è). */
  marchio?: Marchio;
  headers?: Record<string, string>;
}

/** "Academy GT <noreply@x>" con un altro nome davanti: l'indirizzo verificato non cambia. */
function mittenteCon(from: string, nome?: string): string {
  if (!nome) return from;
  const m = /<([^>]+)>/.exec(from);
  const indirizzo = (m ? m[1] : from).trim();
  return `${nome.replace(/[<>"]/g, "")} <${indirizzo}>`;
}

/** Invia una singola email. Non solleva mai: gli errori tornano nel risultato. */
export async function sendMail(to: string, subject: string, body: string, opzioni: OpzioniMail = {}): Promise<SendResult> {
  const cfg = mailerConfig();
  if (!cfg.enabled) return { sent: null };

  const realTo = cfg.testTo ?? to;
  const text = cfg.testTo ? `[PROVA — destinatario reale: ${to}]\n\n${body}` : body;

  try {
    await throttle();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mittenteCon(cfg.from!, opzioni.nomeMittente ?? (opzioni.marchio ? MARCHI[opzioni.marchio].nome : undefined)),
        to: [realTo],
        subject,
        text,
        html: opzioni.html
          ? (cfg.testTo ? opzioni.html.replace("<body", `<body data-prova="${escapeHtml(to)}"`) : opzioni.html)
          : wrap(subject, text, opzioni.marchio),
        ...(opzioni.headers ? { headers: opzioni.headers } : {}),
        ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { sent: false, error: data.message || data.name || `HTTP ${res.status}` };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
