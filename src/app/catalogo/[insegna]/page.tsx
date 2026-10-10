import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import CatalogoCliente, { type VoceCatalogo } from "@/components/catalogo/CatalogoCliente";
import {
  getStampeDb, catalogoDi, prodottiCatalogo, productImageUrl, effectiveValue, disponibilitaPV, etichettaDisponibilita, prezzoNumero, type Scope,
} from "@/lib/stampe";

/*
 * Il catalogo pubblico di un'insegna: tutta la selezione Arredo accesa per
 * quell'insegna, con prezzi e disponibilità del punto vendita che il cliente
 * sceglie. Ogni tessera porta alla scheda del prodotto (quella del QR).
 */

type Params = Promise<{ insegna: string }>;
type Search = Promise<{ pv?: string }>;

async function carica(params: Params) {
  const { insegna } = await params;
  const [db, academyDb] = await Promise.all([getStampeDb(), getDb()]);
  const tenant = academyDb.tenants.find((t) => t.id === insegna);
  if (!tenant) return null;
  const pref = catalogoDi(db, tenant.id);
  if (!pref.attivo) return null;
  return { db, academyDb, tenant, pref };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const dati = await carica(params);
  if (!dati) return { title: "Catalogo non disponibile", robots: { index: false } };
  return { title: `${dati.pref.titolo || "Catalogo arredo giardino"} · ${dati.tenant.name}`, description: `Tavoli, sedie, lounge e ombrelloni: la selezione di ${dati.tenant.name}` };
}

export default async function CatalogoPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const dati = await carica(params);
  if (!dati) notFound();
  const { db, academyDb, tenant, pref } = dati;
  const sp = await searchParams;
  const stores = academyDb.stores.filter((s) => s.tenantId === tenant.id);
  const pvIniziale = stores.some((s) => s.id === sp.pv) ? sp.pv! : stores.length === 1 ? stores[0].id : "";
  const scopeInsegna: Scope = { type: "tenant", id: tenant.id, label: tenant.name };
  const scopeDi = (storeId: string): Scope => ({ type: "store", id: storeId, label: stores.find((s) => s.id === storeId)?.name ?? "" });

  const voci: VoceCatalogo[] = prodottiCatalogo(db, tenant.id).map((p) => {
    const stati: VoceCatalogo["stati"] = {}; const etichette: VoceCatalogo["etichette"] = {};
    for (const s of stores) { const d = disponibilitaPV(db, pref, s.id, p); stati[s.id] = d.stato; etichette[s.id] = etichettaDisponibilita(d); }
    // il prezzo dell'insegna: quello del PV scelto può differire e lo dice la scheda
    const scope = pvIniziale ? scopeDi(pvIniziale) : scopeInsegna;
    const promo = effectiveValue(db, scope, p, "prezzoPromo", academyDb).value;
    const prezzo = promo || effectiveValue(db, scope, p, "prezzo", academyDb).value;
    return {
      id: p.id, codice: p.codice,
      titolo: effectiveValue(db, scope, p, "titolo", academyDb).value || p.fields.titolo || p.codice,
      sotto: effectiveValue(db, scope, p, "sottotitolo", academyDb).value,
      marca: p.marca, tipologia: p.tipologia, foto: productImageUrl(p),
      prezzo, listino: promo ? effectiveValue(db, scope, p, "prezzoListino", academyDb).value || effectiveValue(db, scope, p, "prezzo", academyDb).value : "",
      novita: !!effectiveValue(db, scope, p, "novita", academyDb).value,
      prezzoNum: prezzoNumero(db, scope, p, academyDb), stati, etichette,
    };
  });
  const tipologie = [...new Set(voci.map((v) => v.tipologia))].sort((a, b) => a.localeCompare(b, "it"));
  const aggiornato: Record<string, string> = {};
  for (const g of db.giacenze) if (g.aggiornatoIl) aggiornato[g.storeId] = new Date(g.aggiornatoIl).toLocaleString("it-IT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
  const logo = tenant.logoUrl ?? academyDb.settings.logoUrl ?? "/loghi/gardenteam.png";

  return (
    <div className="cp" style={{ ["--insegna" as string]: tenant.color ?? "#00652e" }}>
      <header className="scheda-testata">
        <div className="scheda-testata-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={tenant.name} className="scheda-logo" />
          <div className="scheda-insegna"><strong>{tenant.name}</strong><span>{pref.titolo || "Catalogo arredo giardino"}</span></div>
        </div>
      </header>
      <CatalogoCliente
        voci={voci} tipologie={tipologie}
        puntiVendita={stores.map((s) => ({ id: s.id, nome: s.name, citta: s.city }))}
        pvIniziale={pvIniziale} slugInsegna={tenant.id}
        gestioneQuantita={!!pref.gestioneQuantita} esauritiNascosti={!!pref.esauritiNascosti}
        banner={{ url: pref.bannerUrl, occhiello: pref.bannerOcchiello, testo: pref.bannerTesto }}
        aggiornato={aggiornato}
      />
      <footer className="scheda-piede"><span>{tenant.name}</span><span>Garden Team · Arredo Giardino</span></footer>
    </div>
  );
}
