import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import Condividi from "@/components/scheda/Condividi";
import {
  getStampeDb, scopeDaSlug, schedaOnlinePer, campiScheda, productImageUrl, aziendaLogoUrl, insegnaDiScope, effectiveValue,
} from "@/lib/stampe";
import { elencoGruppi, gruppoDi } from "@/lib/cartello-campi";
import { testoStampato } from "@/components/stampe/cartelloStyle";

/*
 * La scheda del prodotto che il cliente apre dal QR code del cartello:
 * pubblica (niente accesso), intestata all'insegna che ha stampato il
 * cartello — logo, colore, nome — e con i soli campi che quell'insegna ha
 * deciso di mostrare online. È una pagina, non un PDF: si legge dal
 * cellulare e si condivide con un tocco.
 */

type Params = Promise<{ ambito: string; codice: string }>;

async function carica(params: Params) {
  const { ambito, codice } = await params;
  const [db, academyDb] = await Promise.all([getStampeDb(), getDb()]);
  const scope = scopeDaSlug(ambito, academyDb);
  if (!scope) return null;
  if (!schedaOnlinePer(db, scope, academyDb).attiva) return null;
  const cod = decodeURIComponent(codice);
  const product = db.products.find((p) => p.codice === cod || p.id === cod);
  if (!product) return null;
  return { db, academyDb, scope, product };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const dati = await carica(params);
  if (!dati) return { title: "Scheda non disponibile", robots: { index: false } };
  const { db, academyDb, scope, product } = dati;
  const insegna = insegnaDiScope(scope, academyDb);
  const titolo = effectiveValue(db, scope, product, "titolo", academyDb).value || product.fields.titolo || product.codice;
  const sottotitolo = effectiveValue(db, scope, product, "sottotitolo", academyDb).value;
  const base = (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
  const foto = productImageUrl(product);
  return {
    title: `${titolo} · ${insegna?.name ?? "Garden Team"}`,
    description: sottotitolo || `Scheda prodotto ${titolo}`,
    openGraph: {
      title: titolo,
      description: sottotitolo || undefined,
      images: foto.includes("mancante") ? undefined : [`${base}${foto}`],
      siteName: insegna?.name ?? "Garden Team",
    },
  };
}

export default async function SchedaPubblicaPage({ params }: { params: Params }) {
  const dati = await carica(params);
  if (!dati) notFound();
  const { db, academyDb, scope, product } = dati;
  const insegna = insegnaDiScope(scope, academyDb);
  const pref = schedaOnlinePer(db, scope, academyDb);
  const colore = insegna?.color ?? "#00652e";
  const logo = insegna?.logoUrl ?? academyDb.settings.logoUrl ?? "/loghi/gardenteam.png";
  const nome = insegna?.name ?? "Garden Team";

  const campi = campiScheda(db, scope, product, academyDb);
  const valore = (id: string) => campi.find((c) => c.field.id === id)?.value ?? "";
  // titolo e sottotitolo stanno sempre in testa, anche in modalità "solo approfondimenti"
  const titolo = effectiveValue(db, scope, product, "titolo", academyDb).value || product.fields.titolo || product.codice;
  const sottotitolo = effectiveValue(db, scope, product, "sottotitolo", academyDb).value;
  const inTesta = new Set(["titolo", "sottotitolo", "prezzo", "prezzoListino", "prezzoPromo", "novita", "codice", "codiceInterno"]);
  const prezzo = valore("prezzo");
  const prezzoPromo = valore("prezzoPromo");
  const listino = valore("prezzoListino");
  const novita = valore("novita");
  const codici = [valore("codiceInterno") || valore("codice")].filter(Boolean);
  const restanti = campi.filter((c) => !inTesta.has(c.field.id));
  const gruppi = elencoGruppi(restanti.map((c) => c.field));
  const foto = productImageUrl(product);
  const logoAzienda = aziendaLogoUrl(product.marca);
  const euro = (v: string) => (v.trim().startsWith("€") ? v.trim() : `€ ${v.trim()}`);

  return (
    <div className="scheda-pubblica" style={{ ["--insegna" as string]: colore }}>
      <header className="scheda-testata">
        <div className="scheda-testata-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={nome} className="scheda-logo" />
          <div className="scheda-insegna">
            <strong>{nome}</strong>
            {scope.type === "store" && <span>{scope.label}</span>}
          </div>
          <Condividi titolo={titolo} testo={`${titolo}${sottotitolo ? ` — ${sottotitolo}` : ""} · ${nome}`} />
        </div>
      </header>

      <main className="scheda-corpo">
        {pref.benvenuto && <p className="scheda-benvenuto">{pref.benvenuto}</p>}
        <section className="scheda-hero">
          <div className="scheda-foto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={foto} alt={titolo} />
            {novita && <span className="scheda-novita">{novita}</span>}
          </div>
          <div className="scheda-titoli">
            {logoAzienda && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoAzienda} alt={product.marca} className="scheda-marca" />
            )}
            <h1>{titolo}</h1>
            {sottotitolo && <p className="scheda-sottotitolo">{sottotitolo}</p>}
            {(prezzoPromo || prezzo) && (
              <div className="scheda-prezzo">
                {listino && <span className="scheda-listino">{euro(listino)}</span>}
                <span className="scheda-prezzo-num">{euro(prezzoPromo || prezzo)}</span>
              </div>
            )}
            {codici.length > 0 && <div className="scheda-codice">Cod. {codici.join(" · ")}</div>}
          </div>
        </section>

        {restanti.length === 0 ? (
          <p className="scheda-vuota">Per questo prodotto non ci sono approfondimenti online: chiedi pure in negozio.</p>
        ) : (
          gruppi.map((g) => (
            <section className="scheda-gruppo" key={g}>
              <h2>{g}</h2>
              <dl>
                {restanti.filter((c) => gruppoDi(c.field) === g).map((c) => (
                  <div className="scheda-voce" key={c.field.id}>
                    <dt>{c.field.label}</dt>
                    <dd>{testoStampato(c.value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))
        )}
      </main>

      <footer className="scheda-piede">
        <span>{nome}{scope.type === "store" ? ` · ${scope.label}` : ""}</span>
        <span>Garden Team · Cartelli Arredo Giardino</span>
      </footer>
    </div>
  );
}
