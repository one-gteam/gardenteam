import { NextRequest, NextResponse } from "next/server";
import { GATE_COOKIE } from "@/lib/gate-constants";

// Varco d'ingresso: finché il sito non è pubblico, ogni pagina richiede prima
// utente/password condivisi (vedi src/lib/gate.ts), a monte del login vero
// per email+password degli utenti reali.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/varco") return NextResponse.next();

  const token = req.cookies.get(GATE_COOKIE)?.value;
  if (token && process.env.SITE_GATE_TOKEN && token === process.env.SITE_GATE_TOKEN) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/varco";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|immagini/).*)"],
};
