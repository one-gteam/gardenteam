import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
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
/*
 * Il segreto è SOLO di GT One (AUTH_COOKIE_SECRET). Prima, in sua mancanza, si
 * usava quello condiviso con my.rosaflor per l'SSO: chi aveva quello poteva
 * fabbricarsi un biscotto di accesso di GT One per qualsiasi utente. Quello
 * vecchio resta solo per leggere ciò che era stato firmato o cifrato prima
 * (link di disiscrizione già spediti, password della casella email).
 */
function segretoSessione(): string {
  return process.env.AUTH_COOKIE_SECRET || "";
}

function segretoPrecedente(): string {
  return process.env.SSO_SHARED_SECRET || "";
}

/*
 * La firma comprende anche un'impronta della password attuale: quando la
 * password cambia (reimpostazione, attivazione), tutte le sessioni aperte
 * prima smettono di valere. Prima un biscotto restava buono per sempre.
 */
function impronta(passwordHash?: string): string {
  return createHash("sha256").update(passwordHash ?? "").digest("base64url").slice(0, 16);
}

function firmaSessione(segreto: string, userId: string, passwordHash?: string): string {
  return createHmac("sha256", segreto).update(`${userId}|${impronta(passwordHash)}`).digest("base64url");
}

/** Il valore da scrivere nel biscotto: id più firma (legata alla password di adesso). */
export function valoreSessione(userId: string, passwordHash?: string): string {
  const segreto = segretoSessione();
  if (!segreto) throw new Error("Manca il segreto delle sessioni (AUTH_COOKIE_SECRET/SSO_SHARED_SECRET)");
  return `${userId}.${firmaSessione(segreto, userId, passwordHash)}`;
}

/** L'id dentro al biscotto, se la firma torna con la password attuale dell'utente. */
function idDaBiscotto(valore: string, passwordHashDi: (id: string) => string | undefined): string | null {
  const segreto = segretoSessione();
  if (!segreto) return null; // senza segreto nessuna sessione vale: meglio fuori che aperti a tutti
  const punto = valore.lastIndexOf(".");
  if (punto <= 0) return null; // biscotto senza firma: non vale più
  const id = valore.slice(0, punto);
  const firma = Buffer.from(valore.slice(punto + 1));
  const attesa = Buffer.from(firmaSessione(segreto, id, passwordHashDi(id)));
  if (firma.length !== attesa.length || !timingSafeEqual(firma, attesa)) return null;
  return id;
}

/*
 * Firma per uno scopo preciso ("disiscrivi", …): stesso segreto della sessione
 * ma col nome dello scopo davanti, così un link spedito per email non vale mai
 * come biscotto di accesso (e viceversa).
 */
export function firmaPer(scopo: string, valore: string): string {
  const segreto = segretoSessione();
  if (!segreto) return "";
  return createHmac("sha256", `${scopo}:${segreto}`).update(valore).digest("base64url");
}

export function firmaValida(scopo: string, valore: string, firma: string): boolean {
  if (!firma) return false;
  const b = Buffer.from(firma);
  const uguale = (attesa: string) => {
    if (!attesa) return false;
    const a = Buffer.from(attesa);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  // anche i link firmati prima del cambio di segreto (es. disiscrizione nelle newsletter già spedite)
  const vecchio = segretoPrecedente();
  return uguale(firmaPer(scopo, valore))
    || (!!vecchio && uguale(createHmac("sha256", `${scopo}:${vecchio}`).update(valore).digest("base64url")));
}

/** Confronto di un segreto ricevuto (intestazione di un cron, di un webhook) senza rivelarne la lunghezza o i caratteri giusti. */
export function segretoUguale(ricevuto: string | null | undefined, atteso: string | undefined): boolean {
  if (!ricevuto || !atteso) return false;
  const a = createHash("sha256").update(ricevuto).digest();
  const b = createHash("sha256").update(atteso).digest();
  return timingSafeEqual(a, b);
}

/*
 * Cifratura dei segreti salvati nel database (la password della casella email
 * degli articoli): AES-256-GCM con una chiave ricavata dal segreto del server.
 * Chi legge il database senza il segreto non legge la password.
 */
function chiaveCifratura(segreto = segretoSessione()): Buffer {
  if (!segreto) throw new Error("Manca AUTH_COOKIE_SECRET: impossibile cifrare");
  return createHash("sha256").update(`cifratura:${segreto}`).digest();
}

export function cifra(testo: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chiaveCifratura(), iv);
  const dati = Buffer.concat([c.update(testo, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${dati.toString("base64url")}`;
}

export function decifra(cifrato: string): string {
  const [v, iv, tag, dati] = cifrato.split(".");
  if (v !== "v1" || !iv || !tag || !dati) throw new Error("Formato cifrato sconosciuto");
  const prova = (chiave: Buffer) => {
    const d = createDecipheriv("aes-256-gcm", chiave, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dati, "base64url")), d.final()]).toString("utf8");
  };
  try {
    return prova(chiaveCifratura());
  } catch (e) {
    // cifrato prima del segreto dedicato: si legge con quello vecchio (e al prossimo salvataggio si ricifra)
    const vecchio = segretoPrecedente();
    if (!vecchio) throw e;
    return prova(chiaveCifratura(vecchio));
  }
}

/*
 * Gettone per reimpostare la password: porta l'id e la scadenza, firmati con un
 * segreto del server insieme alla password di adesso. Così il link vale una
 * volta sola (appena la password cambia, la firma non torna più) e non serve
 * salvare niente nel database.
 */
const ORE_REIMPOSTA = 2;

export function tokenReimposta(userId: string, passwordHash?: string, ore = ORE_REIMPOSTA): string {
  const segreto = segretoSessione();
  if (!segreto) return "";
  const corpo = Buffer.from(`${userId}.${Date.now() + ore * 3600_000}`).toString("base64url");
  return `${corpo}.${createHmac("sha256", segreto + (passwordHash ?? "senza")).update(corpo).digest("base64url")}`;
}

/** L'id dentro al gettone, se la firma torna e non è scaduto. */
export function idDaTokenReimposta(token: string, passwordHashDi: (id: string) => string | undefined): string | null {
  const segreto = segretoSessione();
  const punto = token.lastIndexOf(".");
  if (!segreto || punto <= 0) return null;
  const corpo = token.slice(0, punto);
  const [id, scadenza] = Buffer.from(corpo, "base64url").toString().split(".");
  if (!id || !scadenza || Number(scadenza) < Date.now()) return null;
  const firma = Buffer.from(token.slice(punto + 1));
  const attesa = Buffer.from(
    createHmac("sha256", segreto + (passwordHashDi(id) ?? "senza")).update(corpo).digest("base64url")
  );
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
  if (!valore) return null;
  const db = await getDb();
  const id = idDaBiscotto(valore, (x) => db.users.find((u) => u.id === x)?.passwordHash);
  if (!id) return null;
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
