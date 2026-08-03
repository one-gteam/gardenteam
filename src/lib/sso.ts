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

/**
 * Verifica firma e scadenza del token generato da My Rosaflor
 * (app/api/formazione/academy-sso in quel progetto). Stesso segreto
 * condiviso su entrambe le piattaforme (env SSO_SHARED_SECRET / ACADEMY_SSO_SECRET).
 */
export function verifySsoToken(token: string): SsoPayload | null {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) return null;

  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const firma = token.slice(dot + 1);

  const attesa = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(firma);
  const b = Buffer.from(attesa);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SsoPayload>;
    if (!payload.email || typeof payload.iat !== "number") return null;
    if (Math.floor(Date.now() / 1000) - payload.iat > MAX_AGE_SECONDS) return null; // link scaduto
    return payload as SsoPayload;
  } catch {
    return null;
  }
}
