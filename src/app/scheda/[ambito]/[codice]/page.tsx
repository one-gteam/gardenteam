import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import Condividi from "@/components/scheda/Condividi";
import IntroEmozionale from "@/components/scheda/IntroEmozionale";
import Galleria from "@/components/scheda/Galleria";
import {
  getStampeDb, scopeDaSlug, schedaOnlinePer, campiScheda, productImageUrl, aziendaLogoUrl, insegnaDiScope, effectiveValue,
  schedaExtraPer, galleriaProdotto, schedaUrl, type PrintProduct, type Scope, type StampeDB,
} from "@/lib/stampe";
import type { DB } from "@/lib/types";
import { elencoGruppi, gruppoDi } from "@/lib/cartello-campi";
import { testoStampato } from "@/components/stampe/cartelloStyle";

/*
 * La scheda del prodotto che il cliente apre dal QR code del cartello:
 * pubblica (niente accesso), intestata all'insegna che ha stampato il
 * cartello — logo, colore, nome — e con i soli campi che quell'insegna ha
 * deciso di mostrare online. Si apre, se il prodotto ne ha, con foto o video
 * d'ambiente a tutto schermo; poi galleria, prezzo, «in breve», la tabella
 * dei dati, gli accessori e i prodotti simili.
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

const euro = (v: string) => (v.trim().startsWith("€") ? v.trim() : `€ ${v.trim()}`);

/** Una tessera di un altro prodotto (accessorio o simile), con il prezzo come lo vede questo ambito. */
function tessera(db: StampeDB, scope: Scope, academyDb: DB, p: PrintProduct) {
  const titolo = effectiveValue(db, scope, p, "titolo", academyDb).value || p.fields.titolo || p.codice;
  const prezzo = effectiveValue(db, scope, p, "prezzoPromo", academyDb).value || effectiveValue(db, scope, p, "prezzo", academyDb).value;
  const sotto = effectiveValue(db, scope, p, "sottotitolo", academyDb).value;
  return { id: p.id, href: schedaUrl(scope, p, false), foto: productImageUrl(p), titolo, prezzo, sotto, marca: p.marca };
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
    openGraph: { title: titolo, description: sottotitolo || undefined, images: foto.includes("mancante") ? undefined : [foto.startsWith("http") ? foto : `${base}${foto}`], siteName: insegna?.name ?? "Garden Team" },
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
  const extra = schedaExtraPer(db, scope, product.id, academyDb);

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
  // «In breve»: la descrizione, letta per intera; il resto va in tabella, gruppo per gruppo
  const descrizione = restanti.find((c) => gruppoDi(c.field) === "Descrizione" && c.value.length > 60);
  const inTabella = restanti.filter((c) => c !== descrizione);
  const gruppi = elencoGruppi(inTabella.map((c) => c.field));
  const foto = galleriaProdotto(product, extra);
  const logoAzienda = aziendaLogoUrl(product.marca);
  const risparmio = (() => {
    const n = (v: string) => parseFloat(v.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", "."));
    const a = n(listino), b = n(prezzoPromo || prezzo);
    return Number.isFinite(a) && Number.isFinite(b) && a > b ? `-${Math.round(((a - b) / a) * 100)}%` : "";
  })();
  const prodottoDi = (id: string) => db.products.find((p) => p.id === id);
  const accessori = extra.accessori.map(prodottoDi).filter((p): p is PrintProduct => !!p).map((p) => tessera(db, scope, academyDb, p));
  const simili = extra.correlati.map(prodottoDi).filter((p): p is PrintProduct => !!p).map((p) => tessera(db, scope, academyDb, p));
  const testoCondivisione = `${titolo}${sottotitolo ? ` — ${sottotitolo}` : ""} · ${nome}`;

  return (
    <div className="scheda-pubblica sp" style={{ ["--insegna" as string]: colore }}>
      {extra.emozionali.length > 0 && <IntroEmozionale media={extra.emozionali} occhiello={extra.occhiello} frase={extra.frase} titolo={titolo} insegna={nome} />}

      <header className="scheda-testata">
        <div className="scheda-testata-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={nome} className="scheda-logo" />
          <div className="scheda-insegna">
            <strong>{nome}</strong>
            {scope.type === "store" && <span>{scope.label}</span>}
          </div>
          <Condividi titolo={titolo} testo={testoCondivisione} />
        </div>
      </header>

      <main className="sp-corpo">
        {pref.benvenuto && <p className="scheda-benvenuto">{pref.benvenuto}</p>}
        <div className="sp-colonne">
          <Galleria foto={foto} alt={titolo} novita={novita || undefined} />

          <div className="sp-destra">
            <section className="sp-tessera sp-prezzo-box">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="sp-marca">{product.marca}{product.tipologia ? ` · ${product.tipologia}` : ""}</span>
                {logoAzienda && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoAzienda} alt={product.marca} className="scheda-marca" style={{ marginLeft: "auto", height: 26 }} />
                )}
              </div>
              <h1 className="sp-titolo">{titolo}</h1>
              {sottotitolo && <p className="sp-sotto">{sottotitolo}</p>}
              {(prezzoPromo || prezzo) && (
                <div className="sp-riga-prezzo">
                  <span className="sp-prezzo-grande">{euro(prezzoPromo || prezzo)}</span>
                  {listino && <span className="scheda-listino">{euro(listino)}</span>}
                  {risparmio && <span className="sp-risparmio">{risparmio}</span>}
                </div>
              )}
              {codici.length > 0 && <span className="scheda-codice">Cod. {codici.join(" · ")}</span>}
            </section>

            {(descrizione || inTabella.length > 0) && (
              <section className="sp-tessera">
                <h2>In breve</h2>
                {descrizione && <p className="sp-descr">{testoStampato(descrizione.value)}</p>}
                {gruppi.map((g) => (
                  <table className="sp-tabella" key={g}>
                    <tbody>
                      {gruppi.length > 1 && <tr className="sp-gruppo"><td colSpan={2}>{g}</td></tr>}
                      {inTabella.filter((c) => gruppoDi(c.field) === g).map((c) => (
                        <tr key={c.field.id}><td>{c.field.label}</td><td>{testoStampato(c.value)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </section>
            )}
            {!descrizione && inTabella.length === 0 && <p className="scheda-vuota">Per questo prodotto non ci sono approfondimenti online: chiedi pure in negozio.</p>}

            {accessori.length > 0 && (
              <section className="sp-tessera">
                <h2>Completa il set</h2>
                {accessori.map((a) => (
                  <a className="sp-acc" href={a.href} key={a.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.foto} alt="" />
                    <span className="t"><strong>{a.titolo}</strong>{a.sotto && <span>{a.sotto}</span>}</span>
                    {a.prezzo && <span className="sp-prezzo">{euro(a.prezzo)}</span>}
                  </a>
                ))}
              </section>
            )}
          </div>
        </div>

        {simili.length > 0 && (
          <section style={{ marginTop: 16 }}>
            <h2 className="sp-h2">Simili a questo</h2>
            <div className="sp-simili">
              {simili.map((s) => (
                <a href={s.href} key={s.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.foto} alt="" loading="lazy" />
                  <strong>{s.titolo}</strong>
                  {s.prezzo && <span className="sp-prezzo" style={{ fontSize: 13 }}>{euro(s.prezzo)}</span>}
                </a>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="scheda-piede">
        <span>{nome}{scope.type === "store" ? ` · ${scope.label}` : ""}</span>
        <span>Garden Team · Cartelli Arredo Giardino</span>
      </footer>
    </div>
  );
}
