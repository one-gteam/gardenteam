"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QrSvg from "@/components/stampe/QrSvg";

export interface VoceTotem {
  id: string; codice: string; titolo: string; sotto: string; marca: string; tipologia: string; foto: string;
  prezzo: string; listino: string; novita: boolean; stato: "ok" | "pochi" | "esaurito" | "nd"; etichetta: string;
  /** foto d'ambiente del prodotto (dalla scheda online) */
  amb: string[];
  href: string;
}
export interface ConfigTotem {
  modo: "attesa" | "prodotti";
  media: { url: string; tipo: "foto" | "video" }[];
  occhiello?: string; frase?: string; sottotitolo?: string;
  secondiMedia: number; secondiInattivita: number; secondiProdotto: number; bannerOgni: number; mostraPrezzi: boolean;
}

/**
 * Lo schermo del totem. «Attesa»: foto o video in ciclo, al tocco il catalogo
 * (categorie, tessere, un banner in mezzo, QR per portarlo sul telefono),
 * dopo un po' senza tocchi torna all'attesa. «Sempre prodotti»: un prodotto
 * alla volta a tutto schermo, con le sue foto d'ambiente in alternanza e i
 * banner ogni tanti prodotti; il tocco ferma e apre la scheda.
 * La configurazione si rilegge da sola ogni minuto, in attesa.
 */
export default function TotemSchermo({ config, voci, tipologie, insegna, negozio, logo, colore, urlCatalogo }: {
  config: ConfigTotem; voci: VoceTotem[]; tipologie: string[]; insegna: string; negozio: string; logo: string; colore: string; urlCatalogo: string;
}) {
  const router = useRouter();
  const [schermo, setSchermo] = useState<"attesa" | "catalogo" | "prodotti">(config.modo === "prodotti" ? "prodotti" : "attesa");
  const [ora, setOra] = useState("");
  useEffect(() => {
    const t = () => setOra(new Date().toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }));
    t(); const i = setInterval(t, 30000); return () => clearInterval(i);
  }, []);
  // schermo intero e cursore nascosto: il totem è un chiosco
  useEffect(() => { document.documentElement.classList.add("tt-chiosco"); return () => document.documentElement.classList.remove("tt-chiosco"); }, []);
  // aggiornamenti: la configurazione e i prodotti si rileggono ogni minuto quando nessuno tocca; ogni 6 ore ricarica tutto
  useEffect(() => {
    const i = setInterval(() => { if (schermo !== "catalogo") router.refresh(); }, 60000);
    const r = setTimeout(() => location.reload(), 6 * 3600 * 1000);
    return () => { clearInterval(i); clearTimeout(r); };
  }, [schermo, router]);

  /* ---- attesa ---- */
  const media = config.media.length ? config.media : voci.slice(0, 4).map((v) => ({ url: v.amb[0] ?? v.foto, tipo: "foto" as const }));
  const [k, setK] = useState(0);
  useEffect(() => {
    if (schermo !== "attesa" || media.length < 2 || media[k % media.length]?.tipo === "video") return;
    const t = setTimeout(() => setK((x) => (x + 1) % media.length), config.secondiMedia * 1000);
    return () => clearTimeout(t);
  }, [schermo, k, media, config.secondiMedia]);

  /* ---- catalogo al tocco, con ritorno per inattività ---- */
  const [restano, setRestano] = useState(config.secondiInattivita);
  const [cat, setCat] = useState("");
  const ultimoTocco = useRef(Date.now());
  const apriCatalogo = () => { ultimoTocco.current = Date.now(); setRestano(config.secondiInattivita); setSchermo("catalogo"); };
  useEffect(() => {
    if (schermo !== "catalogo") return;
    const i = setInterval(() => {
      const r = config.secondiInattivita - Math.floor((Date.now() - ultimoTocco.current) / 1000);
      setRestano(r);
      if (r <= 0) { setSchermo("attesa"); setCat(""); setK(0); }
    }, 1000);
    const tocco = () => { ultimoTocco.current = Date.now(); };
    for (const ev of ["pointerdown", "touchstart", "wheel", "scroll", "keydown"]) document.addEventListener(ev, tocco, true);
    return () => { clearInterval(i); for (const ev of ["pointerdown", "touchstart", "wheel", "scroll", "keydown"]) document.removeEventListener(ev, tocco, true); };
  }, [schermo, config.secondiInattivita]);
  const lista = voci.filter((v) => !cat || v.tipologia === cat);

  /* ---- sempre prodotti ---- */
  const [idx, setIdx] = useState(0);
  const [fotoIdx, setFotoIdx] = useState(0);
  const [fermo, setFermo] = useState(false);
  const [banner, setBanner] = useState(false);
  const passo = useCallback(() => {
    const p = voci[idx % Math.max(1, voci.length)];
    if (!p) return;
    const nImm = 1 + p.amb.length;
    if (banner) { setBanner(false); return; }
    if (fotoIdx + 1 < nImm) { setFotoIdx(fotoIdx + 1); return; }
    const prossimo = idx + 1;
    setFotoIdx(0); setIdx(prossimo);
    if (config.bannerOgni > 0 && prossimo % config.bannerOgni === 0 && (config.media.length > 0 || config.frase)) setBanner(true);
  }, [voci, idx, fotoIdx, banner, config.bannerOgni, config.media.length, config.frase]);
  useEffect(() => {
    if (schermo !== "prodotti" || fermo || voci.length === 0) return;
    const t = setTimeout(passo, config.secondiProdotto * 1000);
    return () => clearTimeout(t);
  }, [schermo, fermo, passo, config.secondiProdotto, voci.length]);
  const p = voci[idx % Math.max(1, voci.length)];
  const immagini = p ? [p.foto, ...p.amb] : [];
  const bannerMedia = config.media[Math.floor(idx / Math.max(1, config.bannerOgni)) % Math.max(1, config.media.length)];

  const euro = (v: string) => (v.startsWith("€") ? v : `€ ${v}`);
  const tessera = (v: VoceTotem) => (
    <a key={v.id} href={v.href} className="tt-tessera">
      <span className="foto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={v.foto} alt="" loading="lazy" />
        {v.novita && <span className="pill nero">NOVITÀ</span>}
      </span>
      <span className="marca">{v.marca}</span>
      <strong>{v.titolo}</strong>
      {config.mostraPrezzi && v.prezzo && <span className="prezzo">{euro(v.prezzo)}{v.listino && <s>{euro(v.listino)}</s>}</span>}
      {v.stato !== "nd" && <span className={`stato ${v.stato}`}>{v.stato === "esaurito" ? "○" : "●"} {v.etichetta}{v.stato !== "esaurito" ? " qui" : ""}</span>}
    </a>
  );

  return (
    <div className="tt" style={{ ["--insegna" as string]: colore }}>
      {/* ---------- attesa ---------- */}
      {schermo === "attesa" && (
        <section className="tt-attesa" onClick={apriCatalogo}>
          {media.map((m, i) => m.tipo === "video"
            ? <video key={m.url} className={`tt-media${i === k % media.length ? " on" : ""}`} src={m.url} autoPlay muted loop playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : <img key={m.url} className={`tt-media${i === k % media.length ? " on" : ""}`} src={m.url} alt="" />)}
          <div className="tt-velo" />
          <div className="tt-alto">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="" className="tt-logo" />
              <div className="tt-nome"><strong>{insegna}</strong><span>{negozio}</span></div>
            </div>
            <span className="tt-ora">{ora}</span>
          </div>
          <div className="tt-claim">
            {config.occhiello && <span className="occhiello">{config.occhiello.toUpperCase()}</span>}
            <h1>{config.frase || "Il giardino è la stanza più grande."}</h1>
            {config.sottotitolo && <p>{config.sottotitolo}</p>}
          </div>
          <div className="tt-basso">
            {media.length > 1 && <div className="tt-barre">{media.map((m, i) => <span key={m.url} className={i < k % media.length ? "fatta" : i === k % media.length ? "on" : ""}><i style={{ animationDuration: `${config.secondiMedia}s` }} /></span>)}</div>}
            <button type="button" className="tt-tocca" onClick={apriCatalogo}>
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1.5a1.5 1.5 0 0 1 3 0V12m0-.5a1.5 1.5 0 0 1 3 0V13m0 0a1.5 1.5 0 0 1 3 0v3a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.5 15a1.5 1.5 0 0 1 2.4-1.8L8 14.5" /></svg>
              Tocca per esplorare
            </button>
            <span className="hint">Catalogo arredo giardino · {config.mostraPrezzi ? "prezzi e " : ""}disponibilità di {negozio}</span>
          </div>
        </section>
      )}

      {/* ---------- catalogo al tocco ---------- */}
      {schermo === "catalogo" && (
        <section className="tt-cat">
          <div className="testa">
            <button type="button" className="casa" aria-label="Torna all'inizio" onClick={() => { setSchermo("attesa"); setCat(""); }}>
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M3 11 12 4l9 7M5 10v10h14V10" /></svg>
            </button>
            <div className="nome"><strong>Arredo giardino</strong><span>{insegna} {negozio} · {lista.length} prodotti</span></div>
            <span className="conto">torna all&apos;inizio fra {restano} s</span>
          </div>
          <div className="categorie">
            <button type="button" className={cat === "" ? "on" : ""} onClick={() => setCat("")}>Tutti</button>
            {tipologie.map((t) => <button key={t} type="button" className={cat === t ? "on" : ""} onClick={() => setCat(t)}>{t}</button>)}
          </div>
          <div className="scorri">
            <div className="griglia">{lista.slice(0, 4).map(tessera)}</div>
            {lista.length > 4 && (config.frase || config.media[0]) && (
              <div className="tt-banner" style={config.media[0]?.tipo === "foto" ? { backgroundImage: `url(${config.media[0].url})` } : undefined}>
                {config.occhiello && <span className="occhiello">{config.occhiello.toUpperCase()}</span>}
                <strong>{config.frase || "Il giardino è la stanza più grande."}</strong>
              </div>
            )}
            <div className="griglia">{lista.slice(4).map(tessera)}</div>
            {lista.length === 0 && <p className="hint" style={{ textAlign: "center", padding: 40 }}>Nessun prodotto in questa categoria.</p>}
          </div>
          <div className="piede">
            <QrSvg testo={urlCatalogo} style={{ width: 76, height: 76, flex: "none" }} />
            <div><strong>Portalo sul telefono</strong><span>Inquadra il QR: tutto il catalogo, anche da casa.</span></div>
          </div>
        </section>
      )}

      {/* ---------- sempre prodotti ---------- */}
      {schermo === "prodotti" && p && (
        <section className="tt-prod">
          <div className="testa">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" className="tt-logo piccolo" />
            <div className="nome"><strong>{cat || (tipologie.length === 1 ? tipologie[0] : "Arredo giardino")}</strong><span>{insegna} {negozio}</span></div>
            <span className="conto">{(idx % voci.length) + 1} / {voci.length}</span>
          </div>
          {banner ? (
            <div className="scena banner-scena" onClick={passo}>
              {bannerMedia?.tipo === "video"
                ? <video className="tt-media on" src={bannerMedia.url} autoPlay muted loop playsInline />
                // eslint-disable-next-line @next/next/no-img-element
                : bannerMedia ? <img className="tt-media on" src={bannerMedia.url} alt="" /> : null}
              <div className="tt-velo" />
              {config.occhiello && <span className="occhiello">{config.occhiello.toUpperCase()}</span>}
              <h1>{config.frase || "Il giardino è la stanza più grande."}</h1>
              {config.sottotitolo && <p>{config.sottotitolo}</p>}
            </div>
          ) : (
            <div className="scena" onClick={() => setFermo((f) => !f)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={immagini[fotoIdx % immagini.length]} className="tt-media on" src={immagini[fotoIdx % immagini.length]} alt="" style={{ objectFit: fotoIdx % immagini.length === 0 ? "contain" : "cover", background: "#fff" }} />
              {fotoIdx % immagini.length !== 0 && <div className="tt-velo" />}
              {p.novita && <span className="pill nero">NOVITÀ</span>}
              {immagini.length > 1 && <div className="punti">{immagini.map((u, j) => <span key={u} className={j === fotoIdx % immagini.length ? "on" : ""} />)}</div>}
              <div className={`testo${fotoIdx % immagini.length === 0 ? " scuro" : ""}`}>
                <span className="occhiello">{p.marca} · {fotoIdx % immagini.length === 0 ? "FOTO DI CATALOGO" : `FOTO AMBIENTATA ${fotoIdx % immagini.length} DI ${immagini.length - 1}`}</span>
                <h1>{p.titolo}</h1>
                {p.sotto && <p>{p.sotto}</p>}
              </div>
            </div>
          )}
          {!banner && (
            <div className="prezzo-riga">
              {config.mostraPrezzi && p.prezzo ? (
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                  {p.listino && <span className="barrato">{euro(p.listino)}</span>}
                  <span className="grande">{euro(p.prezzo)}</span>
                </div>
              ) : <span className="hint">cod. {p.codice}</span>}
              <div className="destra">
                {p.stato !== "nd" && <span className={`stato ${p.stato}`}>{p.stato === "esaurito" ? "○" : "●"} {p.etichetta}{p.stato !== "esaurito" ? " qui" : ""}</span>}
                {config.mostraPrezzi && p.prezzo && <span className="hint">cod. {p.codice}</span>}
              </div>
            </div>
          )}
          <div className="azioni">
            <a className="tt-btn" href={p.href}>Tocca per i dettagli</a>
            <button type="button" className="tt-btn chiaro" onClick={() => setFermo((f) => !f)}>{fermo ? "Riprendi" : "Ferma"}</button>
          </div>
          <div className="prossimi">
            {Array.from({ length: Math.min(5, voci.length - 1) }, (_, j) => voci[(idx + j + 1) % voci.length]).map((v, j) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${v.id}_${j}`} src={v.foto} alt="" />
            ))}
          </div>
          <div className="piede"><span>Cambia prodotto ogni <b>{config.secondiProdotto} s</b>{config.bannerOgni ? <> · banner ogni <b>{config.bannerOgni}</b> prodotti</> : null}</span><span>{fermo ? <b>Fermo</b> : <><b>Tocca</b> per fermare</>}</span></div>
        </section>
      )}
      {schermo === "prodotti" && !p && <p className="hint" style={{ padding: 40, textAlign: "center" }}>Nessun prodotto da mostrare: controlla le categorie del totem e i prodotti accesi nel catalogo.</p>}
    </div>
  );
}
