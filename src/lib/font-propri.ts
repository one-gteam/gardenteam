import type { DB } from "./types";
import { parentScopes, type Scope } from "./stampe";

/*
 * Font caricati da un'insegna o da un punto vendita (o dal Consorzio) per i
 * propri cartelli. Si registrano una volta per tutto il sito con @font-face
 * (app/layout.tsx), così valgono uguali nell'editor dei layout, nelle
 * anteprime, nella stampa e nel PDF. Nel layout un campo li usa con la chiave
 * «u_<id>», come i caratteri di serie di lib/layout-fonts.
 */

export interface FontProprio {
  id: string; // u_ + lettere e numeri
  nome: string;
  url: string;
  formato: "woff2" | "woff" | "truetype" | "opentype";
  scopeType: "system" | "tenant" | "store";
  scopeId: string;
  caricatoIl: string;
}

export const ID_FONT = /^u_[a-z0-9]{4,24}$/;

/** I font che un ambito può usare: i suoi, quelli della sua insegna e quelli del Consorzio. */
export function fontPerAmbito(db: DB, scope: Scope): FontProprio[] {
  const catena = parentScopes(scope, db);
  return (db.settings.fontPropri ?? []).filter((f) => catena.some((c) => c.type === f.scopeType && c.id === f.scopeId));
}

/** Il CSS @font-face di tutti i font caricati (solo indirizzi del nostro archivio, id controllati). */
export function cssFontPropri(db: DB, origineArchivio: string): string {
  return (db.settings.fontPropri ?? [])
    .filter((f) => ID_FONT.test(f.id) && f.url.startsWith(origineArchivio) && !/["'()\\\s]/.test(f.url))
    .map((f) => `@font-face{font-family:"GTF ${f.id}";src:url("${f.url}") format("${f.formato}");font-display:swap;}`)
    .join("");
}
