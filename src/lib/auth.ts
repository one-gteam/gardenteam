import { cookies } from "next/headers";
import { getDb } from "./db";
import { User } from "./types";

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

export const AUTH_COOKIE = COOKIE;
