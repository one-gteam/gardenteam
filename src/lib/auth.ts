import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "./db";
import { postLoginPath, SiteId, User, userSites } from "./types";

const COOKIE = "agt_user";

/*
 * Il biscotto di sessione porta l'id dell'utente FIRMATO con un segreto del
 * server. Prima portava l'id nudo: e gli id degli utenti si leggono in giro per
 * l'applicazione (elenchi, moduli), quindi bastava copiarne uno nel proprio
 * biscotto per diventare quella persona. Con la firma un id da solo non apre
 * più niente.
 */
function segretoSessione(): string {
  return process.env.AUTH_COOKIE_SECRET || process.env.SSO_SHARED_SECRET || "";
}

/** Il valore da scrivere nel biscotto: id più firma. */
export function valoreSessione(userId: string): string {
  const segreto = segretoSessione();
  if (!segreto) return userId; // ambiente senza segreto configurato: come prima
  return `${userId}.${createHmac("sha256", segreto).update(userId).digest("base64url")}`;
}

/** L'id dentro al biscotto, solo se la firma torna. */
function idDaBiscotto(valore: string): string | null {
  const segreto = segretoSessione();
  if (!segreto) return valore;
  const punto = valore.lastIndexOf(".");
  if (punto <= 0) return null; // biscotto senza firma: non vale più
  const id = valore.slice(0, punto);
  const firma = Buffer.from(valore.slice(punto + 1));
  const attesa = Buffer.from(createHmac("sha256", segreto).update(id).digest("base64url"));
  if (firma.length !== attesa.length || !timingSafeEqual(firma, attesa)) return null;
  return id;
}

/** Come si scrive il biscotto: solo server, solo https in produzione, un mese. */
export const OPZIONI_SESSIONE = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
};

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const valore = store.get(COOKIE)?.value;
  const id = valore ? idDaBiscotto(valore) : null;
  if (!id) return null;
  const db = await getDb();
  const user = db.users.find((u) => u.id === id) ?? null;
  if (user && user.active === false) return null; // cessato: sessione non più valida
  return user;
}

export async function requireUser(): Promise<User> {
  const u = await getCurrentUser();
  if (!u) throw new Error("NOT_AUTHENTICATED");
  return u;
}

/**
 * Utente che ha davvero accesso a una macroarea (Academy, Arredo, Zoo, Piante).
 *
 * Il controllo sul ruolo non basta: un capo reparto abilitato alle sole Offerte
 * Zoo resta un capo reparto, e senza questo passaggio si ritrovava dentro le
 * pagine dell'Academy semplicemente scrivendone l'indirizzo. Chi non ha l'area
 * viene rimandato a casa propria, non a una pagina che comunque gli è vietata.
 */
export async function requireAreaUser(site: SiteId): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!userSites(user).includes(site)) redirect(postLoginPath(user));
  return user;
}

export const AUTH_COOKIE = COOKIE;
