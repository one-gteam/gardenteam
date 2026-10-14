import { NextResponse, type NextRequest } from "next/server";

/*
 * Insegna/PV scelta nelle pagine Stampe (?scope=tenant:t1): si ricorda in un
 * biscotto e resta passando da una pagina all'altra. Una pagina aperta senza
 * ?scope riprende l'ultima scelta (redirect con lo stesso indirizzo più lo
 * scope). Il valore non dà nessun permesso: ogni pagina lo controlla con
 * resolveScope, che ripiega sul primo ambito ammesso se non vale.
 * Alle pagine si passa anche come intestazione, per la testata.
 */
export const SCOPE_COOKIE = "gt_scope";
const VALIDO = /^(system|tenant|store):[A-Za-z0-9_-]*$/;

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const dalla = url.searchParams.get("scope");
  const ricordato = req.cookies.get(SCOPE_COOKIE)?.value;

  if (!dalla && ricordato && VALIDO.test(ricordato) && req.method === "GET") {
    const dest = url.clone();
    dest.searchParams.set("scope", ricordato);
    return NextResponse.redirect(dest);
  }

  const headers = new Headers(req.headers);
  if (dalla && VALIDO.test(dalla)) headers.set("x-gt-scope", dalla);
  headers.set("x-gt-path", url.pathname);
  const res = NextResponse.next({ request: { headers } });
  if (dalla && VALIDO.test(dalla) && dalla !== ricordato) {
    res.cookies.set(SCOPE_COOKIE, dalla, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
}

export const config = {
  // le pagine Stampe (Arredo e Zoo), non le API né i file
  matcher: ["/stampe/:path*"],
};
