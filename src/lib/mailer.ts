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

function wrap(subject: string, body: string): string {
  return `<!doctype html><html lang="it"><body style="margin:0;padding:24px;background:#f4faeb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6f4d5">
    <tr><td style="background:linear-gradient(120deg,#003d1c,#00652e);padding:18px 24px;color:#fff;font-weight:700;font-size:17px">Academy GT</td></tr>
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 14px;font-size:18px;line-height:1.35;color:#003d1c">${escapeHtml(subject)}</h1>
      <div style="font-size:15px;line-height:1.6">${textToHtml(body)}</div>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f4faeb;font-size:12px;color:#6b7280">
      Messaggio automatico della piattaforma di formazione Academy GT. Non rispondere a questo indirizzo.
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

/** Invia una singola email. Non solleva mai: gli errori tornano nel risultato. */
export async function sendMail(to: string, subject: string, body: string): Promise<SendResult> {
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
        from: cfg.from,
        to: [realTo],
        subject,
        text,
        html: wrap(subject, text),
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
