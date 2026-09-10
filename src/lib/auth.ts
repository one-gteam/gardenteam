import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { postLoginPath, SiteId, User, userSites } from "./types";

const COOKIE = "agt_user";

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;
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
