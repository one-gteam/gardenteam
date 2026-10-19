"use client";

import { immaginiInLinea } from "@/lib/immagini-in-linea";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CardLayout, PrintField, PrintFormat } from "@/lib/stampe";
import Cartello from "./Cartello";
import StampaPicker, { EVENTO_SELEZIONA, type StampaPickerProps } from "./StampaPicker";
import NuovoCartello, { type LayoutScelta } from "./NuovoCartello";

/** Evento del pulsante "Nuovo cartello" in cima alla pagina (sta fuori da questo riquadro). */
export const EVENTO_NUOVO_CARTELLO = "stampa-nuovo-cartello";
import PersonalizzaPannello, { type RigaPersonalizza } from "./PersonalizzaPannello";
import { duplicaCartelloInline, mettiInCoda } from "@/lib/zoo-actions";

interface Dettagli {
  scopeType: string;
  scopeLabel: string;
  cartelli: { id: string; format: PrintFormat; layout: CardLayout; values: Record<string, string> }[];
  righe: RigaPersonalizza[];
  categorieAnimali: string[];
  caratteristicheProdotto: string[];
  condizioniStandard: string[];
}

/**
 * Elenco, selezione e anteprima di Stampa cartelli, tenuti insieme dal browser.
 * Ogni cambio di selezione (o di prezzo, formato, campi) chiede al server solo
 * i dati dei cartelli scelti e li ridisegna qui: l'anteprima si aggiorna da
 * sola. I testi di un cartello si correggono dal pannello "Testi" della sua
 * riga, che si apre di lato e ridisegna il cartello a ogni salvataggio.
 */
export default function StampaWorkspace({
  picker, dettagliUrl, fields, scopeParam, scopeLabel, condizioniStandard, layouts,
}: {
  /** Layout che si possono scegliere per un cartello proprio. */
  layouts: LayoutScelta[];
  picker: Omit<StampaPickerProps, "onChange" | "onQueue" | "onPersonalizza" | "onDuplica" | "nuovoCartello">;
  /** Nome dell'ambito e condizioni pronte: servono al pannello "Nuovo cartello". */
  scopeLabel: string;
  condizioniStandard: string[];
  /** Indirizzo dell'anteprima dal vivo (senza parametri). */
  dettagliUrl: string;
  fields: PrintField[];
  scopeParam: string;
}) {
  const [query, setQuery] = useState<string>("");
  const [dati, setDati] = useState<Dettagli | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [personalizzaId, setPersonalizzaId] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState(false);
  const [avviso, setAvviso] = useState("");
  /*
   * PDF scaricato direttamente: i cartelli si disegnano a grandezza reale fuori
   * dallo schermo, si «fotografano» uno per uno e vanno in un PDF, una pagina
   * per cartello nel suo formato. Niente anteprima di stampa da aprire.
   */
  const [pdfLavoro, setPdfLavoro] = useState<{ nome: string; cartelli: Dettagli["cartelli"] } | null>(null);
  const [pdfStato, setPdfStato] = useState("");
  const pdfRef = useRef<HTMLDivElement>(null);
  const salvaPdf = useCallback(async (nome: string, q: string) => {
    setPdfStato("Preparo il PDF…");
    try {
      const r = await fetch(`${dettagliUrl}?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as Dettagli;
      if (!d.cartelli.length) { setPdfStato("Nessun cartello da salvare."); return; }
      // le copie scelte nella colonna «Copie»: il cartello si ripete
      const qp = new URLSearchParams(q);
      const cartelli = d.cartelli.flatMap((c) => Array.from({ length: Math.max(1, Math.min(99, Number(qp.get(`copie_${c.id}`)) || 1)) }, () => c));
      setPdfLavoro({ nome, cartelli });
    } catch {
      setPdfStato("PDF non preparato: riprova.");
    }
  }, [dettagliUrl]);
  useEffect(() => {
    if (!pdfLavoro) return;
    let annullato = false;
    (async () => {
      try {
        const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
        // si aspetta che le foto dei cartelli siano caricate (al massimo 8 secondi)
        const t0 = Date.now();
        while (!annullato && Date.now() - t0 < 8000) {
          const imgs = Array.from(pdfRef.current?.querySelectorAll("img") ?? []);
          if (imgs.every((i) => i.complete)) break;
          await new Promise((res) => setTimeout(res, 150));
        }
        await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
        // foto e testate dal bucket: messe come dati, altrimenti html2canvas le salta
        await immaginiInLinea(pdfRef.current);
        const fogli = Array.from(pdfRef.current?.querySelectorAll<HTMLElement>("[data-cartello-pdf]") ?? []);
        // un PDF per formato: in stampa ogni formato va col suo foglio (e la stampante col suo cassetto)
        const docs = new Map<string, { nome: string; doc: InstanceType<typeof jsPDF>; n: number }>();
        const formati = [...new Set(pdfLavoro.cartelli.map((c) => c.format.id))];
        for (let i = 0; i < fogli.length && !annullato; i++) {
          const c = pdfLavoro.cartelli[i];
          setPdfStato(`Preparo il PDF… ${i + 1} di ${fogli.length}`);
          const canvas = await html2canvas(fogli[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true });
          const orient = c.format.w > c.format.h ? "landscape" : "portrait";
          let voce = docs.get(c.format.id);
          if (!voce) {
            const nomeFormato = c.format.name.replace(/\s*\(.*\)\s*/, "").trim() || c.format.id;
            voce = { nome: formati.length > 1 ? `${pdfLavoro.nome} - ${nomeFormato}` : pdfLavoro.nome, doc: new jsPDF({ unit: "mm", format: [c.format.w, c.format.h], orientation: orient }), n: 0 };
            docs.set(c.format.id, voce);
          } else voce.doc.addPage([c.format.w, c.format.h], orient);
          voce.doc.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, c.format.w, c.format.h);
          voce.n++;
        }
        if (!annullato && docs.size) {
          for (const v of docs.values()) {
            v.doc.save(`${v.nome}.pdf`);
            await new Promise((res) => setTimeout(res, 400)); // un attimo fra un file e l'altro: il browser li scarica tutti
          }
          setPdfStato(`✓ Scaricat${docs.size === 1 ? "o" : "i"} ${[...docs.values()].map((v) => `«${v.nome}.pdf» (${v.n})`).join(", ")}`);
        }
      } catch (e) {
        console.error("PDF dei cartelli", e);
        setPdfStato(`PDF non riuscito (${e instanceof Error ? e.message.slice(0, 100) : "errore"}).`);
      } finally {
        if (!annullato) setPdfLavoro(null);
      }
    })();
    return () => { annullato = true; };
  }, [pdfLavoro]);
  const router = useRouter();
  const ultimaRichiesta = useRef(0);

  const carica = useCallback(async (q: string) => {
    if (!q) { setDati(null); return; }
    const n = ++ultimaRichiesta.current;
    setCaricamento(true);
    try {
      const r = await fetch(`${dettagliUrl}?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as Dettagli;
      if (n === ultimaRichiesta.current) setDati(d);
    } catch {
      if (n === ultimaRichiesta.current) setDati(null);
    } finally {
      if (n === ultimaRichiesta.current) setCaricamento(false);
    }
  }, [dettagliUrl]);

  // la selezione cambia spesso (clic, Shift+clic, un prezzo digitato): si aspetta un attimo prima di chiedere
  useEffect(() => {
    const t = setTimeout(() => carica(query), 350);
    return () => clearTimeout(t);
  }, [query, carica]);

  const anteprima = dati?.cartelli.slice(0, 2) ?? [];
  // chiudendo il pannello si aggiorna l'elenco (un titolo corretto, un cartello condiviso)
  const chiudiPannello = useCallback(() => { setPersonalizzaId(null); router.refresh(); }, [router]);
  const chiudiNuovo = useCallback(() => setNuovo(false), []);

  /** Un cartello proprio appena nato entra fra i selezionati e si apre coi suoi testi. */
  const appenaCreato = (id: string, al?: string, formato?: string) => {
    window.dispatchEvent(new CustomEvent(EVENTO_SELEZIONA, { detail: { id, al, formato } }));
    setPersonalizzaId(id);
    // dopo che la selezione è finita nell'indirizzo: il server deve sapere che il nuovo cartello è scelto
    setTimeout(() => router.refresh(), 150);
  };
  const duplica = async (id: string) => {
    setAvviso("");
    const r = await duplicaCartelloInline(id, scopeParam).catch(() => ({ ok: false, id: undefined }));
    if (r.ok && r.id) appenaCreato(r.id, id);
    else setAvviso("Non sono riuscito a duplicare il cartello.");
  };

  useEffect(() => {
    const apri = () => setNuovo(true);
    window.addEventListener(EVENTO_NUOVO_CARTELLO, apri);
    return () => window.removeEventListener(EVENTO_NUOVO_CARTELLO, apri);
  }, []);

  return (
    <>
      <div className="stampa-griglia">
        <StampaPicker {...picker} onChange={(q) => setQuery(q)}
          onQueue={(stato, voci) => mettiInCoda(scopeParam, stato, voci)}
          onPersonalizza={(id) => setPersonalizzaId(id)}
          onDuplica={duplica}
          onPdf={salvaPdf} />
        <div>
          {anteprima.map((c) => (
            <div key={c.id} style={{ marginBottom: 12, overflow: "hidden" }}>
              {/* la colonna è stretta: il cartello si scala per starci, qualunque formato sia */}
              <Cartello format={c.format} layout={c.layout} fields={fields} values={c.values}
                scale={Math.min(2.4, 280 / c.format.w)} />
            </div>
          ))}
          {anteprima.length === 0 && (
            <div className="card">
              <p className="empty">
                {caricamento ? "Preparo l’anteprima…" : "L’anteprima compare appena selezioni un prodotto e si aggiorna da sola."}
              </p>
            </div>
          )}
          {pdfStato && <p className="hint" style={{ fontWeight: 700, color: pdfStato.startsWith("✓") ? "var(--green-700)" : undefined }}>{pdfStato}</p>}
          {/* i cartelli del PDF, a grandezza reale e fuori dallo schermo */}
          {pdfLavoro && (
            <div ref={pdfRef} aria-hidden style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}>
              {pdfLavoro.cartelli.map((c, i) => (
                <div key={`${c.id}_${i}`} data-cartello-pdf style={{ width: c.format.w * 3.7795, height: c.format.h * 3.7795, background: "#fff" }}>
                  <Cartello format={c.format} layout={c.layout} fields={fields} values={c.values} scale={3.7795} />
                </div>
              ))}
            </div>
          )}
          {anteprima.length > 0 && (
            <p className="hint">
              {(dati?.cartelli.length ?? 0) > 2 ? `Anteprima dei primi 2 cartelli su ${dati!.cartelli.length}: in stampa escono tutti. ` : ""}
              Si aggiorna da sola a ogni modifica{caricamento ? "…" : "."}
            </p>
          )}
        </div>
      </div>

      {personalizzaId && (
        <PersonalizzaPannello
          riga={dati?.righe.find((r) => r.id === personalizzaId)}
          cartello={dati?.cartelli.find((c) => c.id === personalizzaId)}
          fields={fields}
          scopeType={dati?.scopeType ?? ""}
          scopeLabel={dati?.scopeLabel ?? ""}
          scopeParam={scopeParam}
          categorieAnimali={dati?.categorieAnimali ?? []}
          caratteristicheProdotto={dati?.caratteristicheProdotto ?? []}
          condizioniStandard={dati?.condizioniStandard ?? []}
          onRefresh={() => carica(query)}
          onClose={chiudiPannello}
          onDuplica={duplica}
          layouts={layouts}
          onEliminato={(id) => window.dispatchEvent(new CustomEvent(EVENTO_SELEZIONA, { detail: { id, togli: true } }))}
        />
      )}
      {nuovo && (
        <NuovoCartello
          scopeParam={scopeParam}
          scopeLabel={scopeLabel}
          consorzio={scopeParam.startsWith("system")}
          condizioniStandard={condizioniStandard}
          layouts={layouts}
          formats={picker.formats}
          formatoIniziale={picker.globalFormat}
          onClose={chiudiNuovo}
          onCreato={(id, formato) => { setNuovo(false); appenaCreato(id, undefined, formato); }}
        />
      )}
      {avviso && <div className="alert alert-amber" style={{ marginTop: 10 }}>{avviso}</div>}
    </>
  );
}
