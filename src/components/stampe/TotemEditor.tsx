"use client";

import { useRouter } from "next/navigation";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import CaricaMedia from "@/components/stampe/CaricaMedia";
import QrSvg from "@/components/stampe/QrSvg";
import { salvaTotem, registraMediaTotem, rimuoviMediaTotem, eliminaTotem, rigeneraChiaveTotem } from "@/lib/stampe-actions";
import type { Totem } from "@/lib/stampe";

/** La scheda di un totem: modalità, categorie, foto e video, tempi; con l'indirizzo e il QR da aprire sul totem. */
export default function TotemEditor({ totem, scopeParam, tipologie, url, canEdit }: { totem: Totem; scopeParam: string; tipologie: string[]; url: string; canEdit: boolean }) {
  const router = useRouter();
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <ModuloAutoSalva azione={salvaTotem.bind(null, totem.id)}>
            <fieldset disabled={!canEdit} style={{ border: "none", padding: 0, margin: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label className="field">Nome del totem<input type="text" name="nome" defaultValue={totem.nome} maxLength={60} /></label>
                <label className="field">Modalità
                  <select name="modo" defaultValue={totem.modo}>
                    <option value="attesa">Attesa con foto o video, catalogo al tocco</option>
                    <option value="prodotti">Sempre prodotti, con banner in mezzo</option>
                  </select>
                </label>
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, margin: "6px 0 4px" }}>Categorie mostrate <span className="hint" style={{ fontWeight: 500 }}>nessuna spunta = tutte</span></div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
                {tipologie.map((t) => <label key={t} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" name="categorie" value={t} defaultChecked={totem.categorie.includes(t)} /> {t}</label>)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 8 }}>
                <label className="field">Occhiello<input type="text" name="occhiello" defaultValue={totem.occhiello ?? ""} placeholder="ESTATE 2026" maxLength={60} /></label>
                <label className="field">Frase grande<input type="text" name="frase" defaultValue={totem.frase ?? ""} placeholder="Il giardino è la stanza più grande." maxLength={120} /></label>
              </div>
              <label className="field">Sotto la frase<input type="text" name="sottotitolo" defaultValue={totem.sottotitolo ?? ""} placeholder="Tavoli, lounge e ombrelloni: tutta la collezione, con i prezzi di questo negozio." maxLength={160} /></label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                <label className="field">Secondi per foto<input type="number" name="secondiMedia" defaultValue={totem.secondiMedia} min={3} max={120} /></label>
                <label className="field">Torna in attesa dopo (s)<input type="number" name="secondiInattivita" defaultValue={totem.secondiInattivita} min={10} max={900} /></label>
                <label className="field">Secondi per prodotto<input type="number" name="secondiProdotto" defaultValue={totem.secondiProdotto} min={3} max={120} /></label>
                <label className="field">Banner ogni N prodotti<input type="number" name="bannerOgni" defaultValue={totem.bannerOgni} min={1} max={50} /></label>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" name="mostraPrezzi" defaultChecked={totem.mostraPrezzi} /> Mostra i prezzi</label>
            </fieldset>
          </ModuloAutoSalva>

          <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <strong style={{ fontSize: 13, flex: 1 }}>Foto e video <span className="hint" style={{ fontWeight: 500 }}>{totem.modo === "attesa" ? "in ciclo nell'attesa e nel banner del catalogo" : "i banner fra i prodotti"} · senza nulla si usano le foto d'ambiente dei prodotti</span></strong>
              {canEdit && <CaricaMedia scopeParam={scopeParam} cartella={`totem-${totem.id}`} accetta="image/*,video/mp4,video/webm,video/quicktime" etichetta="＋ Foto o video"
                onCaricati={async (m) => { await registraMediaTotem(totem.id, m); router.refresh(); }} />}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {totem.media.map((m) => (
                <span key={m.url} className="sx-foto">
                  {m.tipo === "video" ? <video src={m.url} muted playsInline preload="metadata" /> : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" />
                  )}
                  {m.tipo === "video" && <i>video</i>}
                  {canEdit && <button type="button" aria-label="Togli" onClick={() => rimuoviMediaTotem(totem.id, m.url).then(() => router.refresh())}>×</button>}
                </span>
              ))}
              {totem.media.length === 0 && <span className="hint">nessuna foto o video</span>}
            </div>
            <p className="hint" style={{ margin: "6px 0 0" }}>Video brevi (10–20 s) e leggeri (sotto i 20 MB): il totem li tiene in cache, ma un file pesante rallenta il primo avvio.</p>
          </div>
        </div>

        <div style={{ width: 230, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
          <QrSvg testo={url} style={{ width: 120, height: 120, border: "1px solid var(--line)", borderRadius: 8 }} />
          <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm">Apri lo schermo</a>
          <span className="hint" style={{ wordBreak: "break-all", fontSize: 11 }}>{url}</span>
          <span className="hint" style={{ fontSize: 11 }}>Sul totem: apri questo indirizzo in Chrome a tutto schermo (modalità chiosco). Le modifiche fatte qui arrivano da sole entro un minuto.</span>
          {canEdit && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              <PulsanteAzione azione={rigeneraChiaveTotem.bind(null, totem.id)} className="mini-btn" conferma="Nuova chiave: l'indirizzo cambia e il totem va riaperto con quello nuovo. Procedere?">nuova chiave</PulsanteAzione>
              <PulsanteAzione azione={eliminaTotem.bind(null, totem.id)} className="mini-btn" conferma={`Eliminare il totem «${totem.nome}»?`}>elimina</PulsanteAzione>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
