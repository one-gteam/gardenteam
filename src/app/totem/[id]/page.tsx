import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import TotemSchermo, { type VoceTotem } from "@/components/totem/TotemSchermo";
import {
  getStampeDb, catalogoDi, prodottiCatalogo, productImageUrl, effectiveValue, disponibilitaPV, etichettaDisponibilita, schedaExtraPer, schedaUrl, type Scope,
} from "@/lib/stampe";

/*
 * Lo schermo del totem di un punto vendita: pubblico, ma si apre solo con la
 * chiave nell'indirizzo (/totem/<id>?k=<chiave>). Legge il catalogo
 * dell'insegna, le quantità del PV e la configurazione del totem.
 */
export const metadata: Metadata = { title: "Totem", robots: { index: false, follow: false } };

export default async function TotemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const { k } = await searchParams;
  const [db, academyDb] = await Promise.all([getStampeDb(), getDb()]);
  const totem = db.totem.find((t) => t.id === id);
  if (!totem || !k || k !== totem.chiave) notFound();
  const store = academyDb.stores.find((s) => s.id === totem.storeId);
  const tenant = store ? academyDb.tenants.find((t) => t.id === store.tenantId) : undefined;
  if (!store || !tenant) notFound();
  const pref = catalogoDi(db, tenant.id);
  const scope: Scope = { type: "store", id: store.id, label: store.name };
  const voci: VoceTotem[] = prodottiCatalogo(db, tenant.id)
    .filter((p) => totem.categorie.length === 0 || totem.categorie.includes(p.tipologia))
    .map((p) => {
      const d = disponibilitaPV(db, pref, store.id, p);
      const promo = effectiveValue(db, scope, p, "prezzoPromo", academyDb).value;
      const extra = schedaExtraPer(db, scope, p.id, academyDb);
      return {
        id: p.id, codice: p.codice,
        titolo: effectiveValue(db, scope, p, "titolo", academyDb).value || p.fields.titolo || p.codice,
        sotto: effectiveValue(db, scope, p, "sottotitolo", academyDb).value,
        marca: p.marca, tipologia: p.tipologia, foto: productImageUrl(p),
        prezzo: promo || effectiveValue(db, scope, p, "prezzo", academyDb).value,
        listino: promo ? effectiveValue(db, scope, p, "prezzoListino", academyDb).value || effectiveValue(db, scope, p, "prezzo", academyDb).value : "",
        novita: !!effectiveValue(db, scope, p, "novita", academyDb).value,
        stato: pref.esauritiNascosti && d.stato === "esaurito" ? "esaurito" : d.stato, etichetta: etichettaDisponibilita(d),
        amb: extra.emozionali.filter((m) => m.tipo === "foto").map((m) => m.url),
        href: schedaUrl(scope, p, false),
      };
    })
    .filter((v) => !(pref.esauritiNascosti && v.stato === "esaurito"));
  const tipologie = [...new Set(voci.map((v) => v.tipologia))].sort((a, b) => a.localeCompare(b, "it"));
  const base = (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
  return (
    <TotemSchermo
      config={{ modo: totem.modo, media: totem.media, occhiello: totem.occhiello, frase: totem.frase, sottotitolo: totem.sottotitolo, secondiMedia: totem.secondiMedia, secondiInattivita: totem.secondiInattivita, secondiProdotto: totem.secondiProdotto, bannerOgni: totem.bannerOgni, mostraPrezzi: totem.mostraPrezzi }}
      voci={voci} tipologie={tipologie} insegna={tenant.name} negozio={store.name}
      logo={tenant.logoUrl ?? academyDb.settings.logoUrl ?? "/loghi/gardenteam.png"} colore={tenant.color ?? "#00652e"}
      urlCatalogo={`${base}/catalogo/${tenant.id}?pv=${store.id}`}
    />
  );
}
