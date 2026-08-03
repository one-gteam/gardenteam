import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/lib/auth";
import { verifySsoToken } from "@/lib/sso";
import { provisionSsoUser } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { postLoginPath } from "@/lib/types";

/**
 * Punto d'ingresso del link firmato generato da My Rosaflor
 * (app/api/formazione/academy-sso in quel progetto): verifica il token,
 * crea l'account al primo accesso o fa login su quello esistente (stesso
 * meccanismo di sessione del login normale), poi porta l'utente nella sua area.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const payload = verifySsoToken(token);
  if (!payload) return NextResponse.redirect(new URL("/login?errore=sso", req.url));

  const result = await provisionSsoUser(payload);
  if (!result.ok) return NextResponse.redirect(new URL("/login?errore=disattivato", req.url));

  const db = await getDb();
  const user = db.users.find((u) => u.id === result.userId)!;

  const store = await cookies();
  store.set(AUTH_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/" });
  return NextResponse.redirect(new URL(postLoginPath(user), req.url));
}
