"use server";

// Varco d'ingresso al sito: una coppia utente/password condivisa che protegge
// l'intero prototipo (non ancora pubblico), distinta dal login vero per
// email+password degli utenti reali gestito in actions.ts/auth.ts. Da
// rimuovere quando il sito andrà davvero in produzione.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GATE_COOKIE } from "./gate-constants";

export async function gateLogin(formData: FormData) {
  const user = String(formData.get("user") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/login");

  const okUser = user === process.env.SITE_GATE_USER;
  const okPassword = password === process.env.SITE_GATE_PASSWORD;
  const token = process.env.SITE_GATE_TOKEN;
  if (!okUser || !okPassword || !token) {
    redirect(`/varco?errore=1&next=${encodeURIComponent(next)}`);
  }

  const store = await cookies();
  store.set(GATE_COOKIE, token!, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 giorni
  });
  redirect(next.startsWith("/") ? next : "/login");
}
