import { createHmac, timingSafeEqual } from "crypto";

/** Dati di un collaboratore trasmessi da My Rosaflor al momento del login SSO. */
export interface SsoPayload {
  email: string;
  nome: string;
  cognome: string;
  reparto?: string;
  assunzione?: string; // yyyy-mm-dd, se noto in My Rosaflor
  iat: number; // secondi Unix di emissione
}

const MAX_AGE_SECONDS = 90; // il link è pensato per l'uso immediato, non per essere salvato

/** Le insegne con una chiave SSO propria e accesa (area Connettori). */
export function insegneSso(tenants: { id: string; ssoSecret?: string; ssoAttivo?: boolean }[]): { id: string; secret: string }[] {
  return tenants.filter((t) => t.ssoSecret && t.ssoAttivo !== false).map((t) => ({ id: t.id, secret: t.ssoSecret! }));
}

/**
 * Verifica firma e scadenza del token. La firma può essere quella condivisa
 * con My Rosaflor (env SSO_SHARED_SECRET / ACADEMY_SSO_SECRET: tenantId
 * assente, valgono le impostazioni di sistema) oppure quella di un'insegna
 * (chiave generata nei Connettori: tenantId = l'insegna).
 */
export function verifySsoToken(token: string, insegne: { id: string; secret: string }[] = []): { payload: SsoPayload; tenantId?: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const firma = token.slice(dot + 1);
  const a = Buffer.from(firma);

  const candidati: { id?: string; secret: string }[] = [
    ...(process.env.SSO_SHARED_SECRET ? [{ secret: process.env.SSO_SHARED_SECRET }] : []),
    ...insegne,
  ];
  let tenantId: string | undefined;
  let valida = false;
  for (const c of candidati) {
    const b = Buffer.from(createHmac("sha256", c.secret).update(body).digest("base64url"));
    if (a.length === b.length && timingSafeEqual(a, b)) { valida = true; tenantId = c.id; break; }
  }
  if (!valida) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SsoPayload>;
    if (!payload.email || typeof payload.iat !== "number") return null;
    if (Math.floor(Date.now() / 1000) - payload.iat > MAX_AGE_SECONDS) return null; // link scaduto
    return { payload: payload as SsoPayload, tenantId };
  } catch {
    return null;
  }
}
