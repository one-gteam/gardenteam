"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { LayoutItem, PrintField, PrintFormat, StickerStyle } from "@/lib/stampe";
import { LAYOUT_FONTS, layoutFontCss } from "@/lib/layout-fonts";
import { saveLayout } from "@/lib/stampe-actions";
import { saveZooLayout } from "@/lib/zoo-actions";
import { stickerShapeStyle } from "./stickerStyle";

/** Editor drag & drop del layout cartello: trascina i campi, ridimensionali dall'angolo, si salva da solo. */
export default function LayoutEditor({
  format,
  fields,
  initialLayoutId,
  initialNome,
  initialItems,
  initialItemsNoPhoto,
  initialMargin,
  scopeParam,
  initialTipologie,
  tipologieDisponibili,
  sampleValues,
  canEdit,
  images = [],
  area = "arredo",
}: {
  format: PrintFormat;
  fields: PrintField[];
  /** Id del layout aperto: assente = non ancora salvato, il primo salvataggio ne crea uno. */
  initialLayoutId?: string;
  initialNome?: string;
  initialItems: LayoutItem[];
  /** Foglio alternativo per quando manca la foto: se assente si parte da una copia del foglio normale. */
  initialItemsNoPhoto?: LayoutItem[];
  /** Margine dai bordi del foglio, in mm. */
  initialMargin?: number;
  scopeParam: string;
  initialTipologie: string[];
  tipologieDisponibili: string[];
  sampleValues: Record<string, string>;
  canEdit: boolean;
  images?: { name: string; url: string }[];
  area?: "arredo" | "zoo"; // dove salvare il layout (default: arredo)
}) {
  const [layoutId, setLayoutId] = useState(initialLayoutId ?? "");
  const [nome, setNome] = useState(initialNome ?? "");
  const [dupName, setDupName] = useState("");
  const [items, setItems] = useState<LayoutItem[]>(initialItems);
  const [itemsNoPhoto, setItemsNoPhoto] = useState<LayoutItem[]>(initialItemsNoPhoto ?? initialItems);
  // due fogli, due modalità: quello che si vede/trascina è sempre quello attivo
  const [mode, setMode] = useState<"normal" | "noPhoto">("normal");
  const activeItems = mode === "normal" ? items : itemsNoPhoto;
  const setActiveItems = mode === "normal" ? setItems : setItemsNoPhoto;
  const [margin, setMargin] = useState(initialMargin ?? 0);
  const [tipologie, setTipologie] = useState<string[]>(initialTipologie);
  const [selected, setSelected] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; mode: "move" | "resize"; startX: number; startY: number; orig: LayoutItem } | null>(null);
  // cronologia per annulla/ripristina: una per foglio, così non si mescolano
  const history = useRef<LayoutItem[][]>([initialItems]);
  const historyPos = useRef(0);
  const historyNoPhoto = useRef<LayoutItem[][]>([initialItemsNoPhoto ?? initialItems]);
  const historyPosNoPhoto = useRef(0);
  const activeHistory = mode === "normal" ? history : historyNoPhoto;
  const activeHistoryPos = mode === "normal" ? historyPos : historyPosNoPhoto;
  const [, forceHistory] = useState(0);

  const switchMode = (next: "normal" | "noPhoto") => {
    setMode(next);
    setSelected(null);
  };

  const pushHistory = (next: LayoutItem[]) => {
    activeHistory.current = [...activeHistory.current.slice(0, activeHistoryPos.current + 1), next].slice(-40);
    activeHistoryPos.current = activeHistory.current.length - 1;
    forceHistory((n) => n + 1);
  };
  const undo = () => {
    if (activeHistoryPos.current > 0) {
      activeHistoryPos.current -= 1;
      setActiveItems(activeHistory.current[activeHistoryPos.current]);
      forceHistory((n) => n + 1);
    }
  };
  const redo = () => {
    if (activeHistoryPos.current < activeHistory.current.length - 1) {
      activeHistoryPos.current += 1;
      setActiveItems(activeHistory.current[activeHistoryPos.current]);
      forceHistory((n) => n + 1);
    }
  };

  // zoom di lavoro: il cartello reale è piccolo, ingrandirlo mentre si lavora aiuta a posizionare i campi con precisione
  const [zoom, setZoom] = useState(1.5);
  const scale = 2.4 * zoom; // px per mm
  const W = format.w * scale;
  const H = format.h * scale;

  const isImageField = (fieldId: string) => {
    const meta = fields.find((f) => f.id === fieldId);
    return fieldId === "__img" || fieldId === "foto" || fieldId === "logoAzienda" || fieldId === "logoInsegna" || meta?.type === "image";
  };
  const isPriceField = (fieldId: string) => fieldId === "prezzo" || fieldId === "prezzoPromo";
  // sul foglio "senza foto" l'anteprima non deve mostrare una foto che in stampa non ci sarebbe
  const previewValues = mode === "noPhoto"
    ? Object.fromEntries(Object.entries(sampleValues).map(([k, v]) => (isImageField(k) ? [k, ""] : [k, v])))
    : sampleValues;

  // conversione % del cartello ↔ millimetri reali, per mostrare/impostare le misure sul foglio
  const mmX = (pct: number) => (pct / 100) * format.w;
  const mmY = (pct: number) => (pct / 100) * format.h;
  const pctFromMmX = (mm: number) => (mm / format.w) * 100;
  const pctFromMmY = (mm: number) => (mm / format.h) * 100;
  // le misure si possono leggere e scrivere in mm o in cm, a scelta
  const [unita, setUnita] = useState<"mm" | "cm">("mm");
  const inUnita = (mm: number) => (unita === "cm" ? (mm / 10).toFixed(2) : mm.toFixed(1));
  const daUnita = (v: string) => (unita === "cm" ? (Number(v) || 0) * 10 : Number(v) || 0);
  const passo = unita === "cm" ? 0.05 : 0.5;

  const onMouseDown = (e: React.MouseEvent, index: number, mode: "move" | "resize") => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(index);
    drag.current = { index, mode, startX: e.clientX, startY: e.clientY, orig: { ...activeItems[index] } };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const { index, mode, startX, startY, orig } = drag.current;
    const dx = ((e.clientX - startX) / W) * 100;
    const dy = ((e.clientY - startY) / H) * 100;
    setActiveItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        if (mode === "move") {
          return {
            ...it,
            x: Math.max(0, Math.min(100 - it.w, orig.x + dx)),
            y: Math.max(0, Math.min(100 - it.h, orig.y + dy)),
          };
        }
        return {
          ...it,
          w: Math.max(4, Math.min(100 - it.x, orig.w + dx)),
          h: Math.max(2, Math.min(100 - it.y, orig.h + dy)),
        };
      })
    );
  };

  const endDrag = () => {
    if (drag.current) {
      drag.current = null;
      pushHistory(activeItems);
    }
  };

  const addField = (fieldId: string) => {
    if (!canEdit) return;
    const next = [...activeItems, { fieldId, x: 10, y: 10, w: 40, h: 8 }];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  const addImage = (url: string) => {
    if (!canEdit) return;
    const next = [...activeItems, { fieldId: "__img", imageUrl: url, x: 10, y: 10, w: 25, h: 10 }];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  const addSticker = () => {
    if (!canEdit) return;
    const next: LayoutItem[] = [
      ...activeItems,
      {
        fieldId: fields.find((f) => f.id === "novita")?.id ?? fields[0].id,
        x: 65, y: 8, w: 22, h: 12,
        color: "#ffffff",
        sticker: { shape: "stella", bg: "#e8481c", rotation: -12, size: 16 },
      },
    ];
    setActiveItems(next);
    pushHistory(next);
    setSelected(activeItems.length);
  };

  const updateSelected = (patch: Partial<LayoutItem> | { sticker: Partial<StickerStyle> }) => {
    if (selected === null) return;
    const next = activeItems.map((it, i) => {
      if (i !== selected) return it;
      if ("sticker" in patch && it.sticker) {
        return { ...it, sticker: { ...it.sticker, ...(patch.sticker as Partial<StickerStyle>) } };
      }
      return { ...it, ...(patch as Partial<LayoutItem>) };
    });
    setActiveItems(next);
    pushHistory(next);
  };

  const selItem = selected !== null ? activeItems[selected] : null;

  const removeSelected = () => {
    if (selected === null) return;
    const next = activeItems.filter((_, i) => i !== selected);
    setActiveItems(next);
    pushHistory(next);
    setSelected(null);
  };

  const layoutUrlBase = `/stampe/${area}/layout?formato=${format.id}&scope=${scopeParam}`;

  const doSave = () => {
    if (!canEdit) return;
    startTransition(async () => {
      const save = area === "zoo" ? saveZooLayout : saveLayout;
      const res = await save(
        layoutId, format.id, scopeParam, nome, tipologie.join(","), JSON.stringify(items), String(margin), JSON.stringify(itemsNoPhoto)
      );
      if (res.ok && res.id && res.id !== layoutId) {
        setLayoutId(res.id);
        // il primo salvataggio di un layout nuovo gli dà un id: si aggiorna l'URL senza ricaricare,
        // così un aggiornamento della pagina ritrova lo stesso layout invece di crederlo assente
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("layout", res.id);
          window.history.replaceState(null, "", url.toString());
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  // autosalvataggio: ogni modifica si salva da sola poco dopo, niente pulsante da ricordarsi di premere
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;
  const skipFirstSave = useRef(true);
  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    if (!canEdit) return;
    const t = setTimeout(() => doSaveRef.current(), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, itemsNoPhoto, margin, tipologie, nome]);

  /** Crea un nuovo layout a partire dal contenuto attuale (duplica quello aperto, o lo salva con un nuovo nome). */
  const doDuplicate = () => {
    if (!canEdit) return;
    startTransition(async () => {
      const save = area === "zoo" ? saveZooLayout : saveLayout;
      const finalName = dupName.trim() || `${nome || format.name} (copia)`;
      const res = await save(
        "", format.id, scopeParam, finalName, tipologie.join(","), JSON.stringify(items), String(margin), JSON.stringify(itemsNoPhoto)
      );
      if (res.ok && res.id) window.location.href = `${layoutUrlBase}&layout=${res.id}`;
    });
  };

  const usedFields = new Set(activeItems.map((i) => i.fieldId));

  return (
    <div className="layout-editor">
      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ margin: "2px 6px 10px" }}>Campi disponibili</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {fields.map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn btn-outline btn-sm"
              style={{ textAlign: "left", opacity: usedFields.has(f.id) ? 0.45 : 1 }}
              onClick={() => addField(f.id)}
              disabled={!canEdit}
              title={usedFields.has(f.id) ? "Già nel cartello (puoi aggiungerlo di nuovo)" : "Aggiungi al cartello"}
            >
              ＋ {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 10, width: "100%" }} onClick={addSticker} disabled={!canEdit}>
          Aggiungi sticker / bollino
        </button>
        {images.length > 0 && (
          <>
            <h3 style={{ margin: "14px 6px 8px" }}>Le tue immagini</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {images.map((img) => (
                <button key={img.url} type="button" className="btn btn-outline btn-sm" style={{ textAlign: "left" }} onClick={() => addImage(img.url)} disabled={!canEdit}>
                  {img.name}
                </button>
              ))}
            </div>
          </>
        )}
        {selected !== null && canEdit && (
          <button type="button" className="btn btn-sm" style={{ marginTop: 12, background: "var(--red)" }} onClick={removeSelected}>
            Rimuovi elemento selezionato
          </button>
        )}
      </div>

      <div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" className={`btn btn-sm ${mode === "normal" ? "" : "btn-outline"}`} onClick={() => switchMode("normal")}>
              Foglio normale
            </button>
            <button type="button" className={`btn btn-sm ${mode === "noPhoto" ? "" : "btn-outline"}`} onClick={() => switchMode("noPhoto")}
              title="Cosa stampare quando il prodotto non ha una foto caricata">
              Foglio senza foto
            </button>
          </div>
          {canEdit && (
            <>
              <button type="button" className="btn btn-outline btn-sm" onClick={undo} disabled={activeHistoryPos.current === 0} title="Annulla (indietro)">↶ Indietro</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={redo} disabled={activeHistoryPos.current >= activeHistory.current.length - 1} title="Ripristina (avanti)">↷ Avanti</button>
            </>
          )}
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: canEdit ? 10 : 0 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.2).toFixed(1)))} title="Rimpicciolisci">－</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)", minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setZoom((z) => Math.min(2.6, +(z + 0.2).toFixed(1)))} title="Ingrandisci">＋</button>
          </div>
        </div>
        {mode === "noPhoto" && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
            Questo foglio si stampa al posto di quello normale solo quando il prodotto non ha una foto caricata:
            di solito conviene allargare gli altri campi per riempire lo spazio che lascerebbe libero la foto.
          </p>
        )}
        <div style={{ maxHeight: "82vh", overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "#f4f5f2" }}>
        <div
          ref={canvasRef}
          className="cartello editor-canvas"
          style={{
            width: W, height: H,
            backgroundImage: format.background ? `url(${format.background})` : undefined, backgroundSize: "cover",
            boxSizing: "border-box",
            padding: margin > 0 ? margin * scale : undefined,
          }}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onMouseDown={() => setSelected(null)}
        >
          {margin > 0 && (
            // guida visiva del margine: i campi sono già posizionati rispetto a quest'area (vedi il padding sopra)
            <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", outline: "1px dashed #274b7a", pointerEvents: "none", boxSizing: "border-box" }} />
          )}
          {activeItems.map((item, i) => {
            const meta = fields.find((f) => f.id === item.fieldId);
            if (item.sticker) {
              return (
                <div
                  key={i}
                  className={`editor-item ${selected === i ? "selected" : ""}`}
                  style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%`, cursor: canEdit ? "move" : "default", overflow: "visible", transform: `rotate(${item.sticker.rotation}deg)` }}
                  onMouseDown={(e) => onMouseDown(e, i, "move")}
                >
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: item.color ?? "#fff", fontWeight: 800, fontSize: ((item.sticker.size ?? 16) * scale) / 2.4, lineHeight: 1.05, ...stickerShapeStyle(item.sticker) }}>
                    {previewValues[item.fieldId] || meta?.label || "Sticker"}
                  </div>
                  {canEdit && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                </div>
              );
            }
            const isImage = isImageField(item.fieldId);
            const imgSrc = item.fieldId === "__img" ? item.imageUrl : previewValues[item.fieldId];
            if (isImage) {
              return (
                <div
                  key={i}
                  className={`editor-item ${selected === i ? "selected" : ""}`}
                  style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%`, cursor: canEdit ? "move" : "default" }}
                  onMouseDown={(e) => onMouseDown(e, i, "move")}
                >
                  {imgSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imgSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "left top", pointerEvents: "none", mixBlendMode: "multiply" }} />
                  ) : (
                    <span style={{ fontSize: 11, color: "#999" }}>{meta?.label ?? "Immagine"}</span>
                  )}
                  {canEdit && selected === i && (
                    <span style={{ position: "absolute", left: 0, top: -18, fontSize: 10.5, color: "#274b7a", background: "#fff", padding: "0 4px", border: "1px solid var(--line)", borderRadius: 3, whiteSpace: "nowrap" }}>
                      {inUnita(mmX(item.w))} × {inUnita(mmY(item.h))} {unita}
                    </span>
                  )}
                  {canEdit && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                </div>
              );
            }
            const isPrice = isPriceField(item.fieldId);
            const fontSize = ((item.size ?? meta?.size ?? 11) * scale) / 2.4;
            const raw = previewValues[item.fieldId] ?? "";
            // il valore arriva già con "€" quando previsto (es. offerte Zoo): non va riaggiunto,
            // basta separare i centesimi per renderli più piccoli e allineati in alto. Non un <sup>
            // con vertical-align: dentro un contenitore posizionato, e soprattutto in stampa, quel
            // calcolo dipende dai metrici del font e può finire in basso invece che in alto — con
            // un flex "allineati in alto" la posizione non dipende dal motore di rendering.
            const [intPart, centPart] = raw.split(",");
            return (
              <div
                key={i}
                className={`editor-item ${selected === i ? "selected" : ""}`}
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  width: `${item.w}%`,
                  height: `${item.h}%`,
                  fontSize,
                  fontWeight: (item.bold ?? meta?.bold) ? 800 : 400,
                  fontStyle: item.italic ? "italic" : "normal",
                  fontFamily: item.font !== undefined ? layoutFontCss(item.font) : undefined,
                  color: isPrice ? "#c2410c" : "#1c2b21",
                  textAlign: item.align ?? (isPrice ? "right" : "left"),
                  cursor: canEdit ? "move" : "default",
                }}
                onMouseDown={(e) => onMouseDown(e, i, "move")}
              >
                {isPrice ? (
                  raw ? (
                    <span style={{ display: "inline-flex", alignItems: "flex-start" }}>
                      <span>{intPart}</span>
                      {centPart !== undefined && <span style={{ fontSize: "0.5em", marginLeft: "0.05em" }}>,{centPart}</span>}
                    </span>
                  ) : ""
                ) : (
                  raw || meta?.label
                )}
                {canEdit && selected === i && (
                  <span style={{ position: "absolute", left: 0, top: -18, fontSize: 10.5, color: "#274b7a", background: "#fff", padding: "0 4px", border: "1px solid var(--line)", borderRadius: 3, whiteSpace: "nowrap" }}>
                    {inUnita(mmX(item.w))} × {inUnita(mmY(item.h))} {unita}
                  </span>
                )}
                {canEdit && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
              </div>
            );
          })}
        </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
          Anteprima con un prodotto di esempio · trascina i campi, ridimensiona dall&apos;angolo in basso a destra.
        </p>
      </div>

      <div className="card" style={{ padding: 14 }}>
        {/* identità del layout: nome, e come farne una copia */}
        {canEdit && (
          <div style={{ borderBottom: "1.5px dashed var(--line)", paddingBottom: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Layout</h3>
            <label className="field" style={{ marginBottom: 8 }}>
              Nome
              <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="es. Cartello Gatto" />
            </label>
            <label className="field" style={{ marginBottom: 4 }}>
              Duplica come nuovo layout
              <input type="text" value={dupName} onChange={(e) => setDupName(e.target.value)} placeholder={`${nome || format.name} (copia)`} />
            </label>
            <button type="button" className="btn btn-outline btn-sm" style={{ width: "100%" }} onClick={doDuplicate} disabled={pending}>
              Crea copia
            </button>
          </div>
        )}
        {/* proprietà del foglio: valgono per tutto il cartello, non per il campo selezionato */}
        {canEdit && (
          <div style={{ borderBottom: "1.5px dashed var(--line)", paddingBottom: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Foglio ({format.w}×{format.h} mm)</h3>
            <label className="field" style={{ marginBottom: 0 }}>
              Margine dai bordi ({unita})
              <input
                type="number" step={passo} min={0} value={inUnita(margin)}
                onChange={(e) => setMargin(Math.max(0, Math.min(30, daUnita(e.target.value))))}
              />
            </label>
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 0" }}>
              Spazio ai bordi del foglio in cui i campi non devono entrare (utile per il taglio della stampa).
            </p>
          </div>
        )}
        {selItem?.sticker && canEdit && (
          <div style={{ borderBottom: "1.5px dashed var(--line)", paddingBottom: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Sticker selezionato</h3>
            <label className="field">
              Campo associato
              <select value={selItem.fieldId} onChange={(e) => updateSelected({ fieldId: e.target.value })}>
                {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label className="field">
                Forma
                <select value={selItem.sticker.shape} onChange={(e) => updateSelected({ sticker: { shape: e.target.value as StickerStyle["shape"] } })}>
                  <option value="cerchio">Cerchio</option>
                  <option value="quadrato">Quadrato</option>
                  <option value="stella">Stella/burst</option>
                  <option value="nastro">Nastro</option>
                </select>
              </label>
              <label className="field">
                Font
                <select value={selItem.sticker.font ?? ""} onChange={(e) => updateSelected({ sticker: { font: e.target.value === "cn" ? "cn" : undefined } })}>
                  <option value="">Avenir</option>
                  <option value="cn">Avenir Condensed</option>
                </select>
              </label>
              <label className="field">
                Colore sfondo
                <input type="color" value={selItem.sticker.bg} onChange={(e) => updateSelected({ sticker: { bg: e.target.value } })} style={{ width: "100%", height: 34, padding: 2 }} />
              </label>
              <label className="field">
                Colore testo
                <input type="color" value={selItem.color ?? "#ffffff"} onChange={(e) => updateSelected({ color: e.target.value })} style={{ width: "100%", height: 34, padding: 2 }} />
              </label>
            </div>
            <label className="field">
              Rotazione: {selItem.sticker.rotation}°
              <input type="range" min={-180} max={180} value={selItem.sticker.rotation} onChange={(e) => updateSelected({ sticker: { rotation: Number(e.target.value) } })} style={{ width: "100%" }} />
            </label>
            <label className="field">
              Dimensione testo: {selItem.sticker.size}
              <input type="range" min={6} max={60} value={selItem.sticker.size} onChange={(e) => updateSelected({ sticker: { size: Number(e.target.value) } })} style={{ width: "100%" }} />
            </label>
          </div>
        )}
        {selItem && !selItem.sticker && !isImageField(selItem.fieldId) && canEdit && (
          <div style={{ borderBottom: "1.5px dashed var(--line)", paddingBottom: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Campo selezionato</h3>
            <label className="field">
              Carattere
              <select value={selItem.font ?? ""} onChange={(e) => updateSelected({ font: e.target.value })}>
                {LAYOUT_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label className="field">
              Dimensione font: {selItem.size ?? fields.find((f) => f.id === selItem.fieldId)?.size ?? 11}
              <input
                type="range" min={6} max={80}
                value={selItem.size ?? fields.find((f) => f.id === selItem.fieldId)?.size ?? 11}
                onChange={(e) => updateSelected({ size: Number(e.target.value) })}
                style={{ width: "100%" }}
              />
            </label>
            <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={selItem.bold ?? fields.find((f) => f.id === selItem.fieldId)?.bold ?? false}
                  onChange={(e) => updateSelected({ bold: e.target.checked })}
                />
                Grassetto
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" checked={selItem.italic ?? false} onChange={(e) => updateSelected({ italic: e.target.checked })} />
                Corsivo
              </label>
            </div>
            <label className="field" style={{ marginBottom: 10 }}>
              Allineamento del testo
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`btn btn-sm ${(selItem.align ?? (isPriceField(selItem.fieldId) ? "right" : "left")) === a ? "" : "btn-outline"}`}
                    style={{ flex: 1 }}
                    onClick={() => updateSelected({ align: a })}
                    title={a === "left" ? "Sinistra" : a === "center" ? "Centro" : "Destra"}
                  >
                    {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
                  </button>
                ))}
              </div>
            </label>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>
              Misure sul foglio — {unita === "cm" ? "centimetri" : "millimetri"}{" "}
              <button type="button" className="btn btn-outline btn-sm" style={{ padding: "0 6px", fontSize: 11 }}
                onClick={() => setUnita((u) => (u === "cm" ? "mm" : "cm"))}>
                passa a {unita === "cm" ? "mm" : "cm"}
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                X ({unita})
                <input type="number" step={passo} value={inUnita(mmX(selItem.x))}
                  onChange={(e) => updateSelected({ x: Math.max(0, Math.min(100 - selItem.w, pctFromMmX(daUnita(e.target.value)))) })} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Y ({unita})
                <input type="number" step={passo} value={inUnita(mmY(selItem.y))}
                  onChange={(e) => updateSelected({ y: Math.max(0, Math.min(100 - selItem.h, pctFromMmY(daUnita(e.target.value)))) })} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Largh. ({unita})
                <input type="number" step={passo} value={inUnita(mmX(selItem.w))}
                  onChange={(e) => updateSelected({ w: Math.max(3, Math.min(100 - selItem.x, pctFromMmX(daUnita(e.target.value)))) })} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Alt. ({unita})
                <input type="number" step={passo} value={inUnita(mmY(selItem.h))}
                  onChange={(e) => updateSelected({ h: Math.max(2, Math.min(100 - selItem.y, pctFromMmY(daUnita(e.target.value)))) })} />
              </label>
            </div>
            <label className="field" style={{ marginBottom: 0 }}>
              Allinea sul foglio
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginTop: 4 }}>
                <button type="button" className="btn btn-outline btn-sm" title="Sinistra" onClick={() => updateSelected({ x: 0 })}>⇤ Sx</button>
                <button type="button" className="btn btn-outline btn-sm" title="Centro orizzontale" onClick={() => updateSelected({ x: (100 - selItem.w) / 2 })}>↔ Centro</button>
                <button type="button" className="btn btn-outline btn-sm" title="Destra" onClick={() => updateSelected({ x: 100 - selItem.w })}>⇥ Dx</button>
                <button type="button" className="btn btn-outline btn-sm" title="Alto" onClick={() => updateSelected({ y: 0 })}>⇡ Alto</button>
                <button type="button" className="btn btn-outline btn-sm" title="Centro verticale" onClick={() => updateSelected({ y: (100 - selItem.h) / 2 })}>↕ Centro</button>
                <button type="button" className="btn btn-outline btn-sm" title="Basso" onClick={() => updateSelected({ y: 100 - selItem.h })}>⇣ Basso</button>
              </div>
            </label>
          </div>
        )}
        <h3 style={{ marginTop: 0 }}>Collega a tipologie</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Nessuna selezione = layout valido per tutti i prodotti di questo formato.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
          {tipologieDisponibili.map((t) => (
            <label key={t} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={tipologie.includes(t)}
                disabled={!canEdit}
                onChange={(e) =>
                  setTipologie((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))
                }
              />
              {t}
            </label>
          ))}
        </div>
        {canEdit ? (
          <>
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "14px 0 6px", textAlign: "center" }}>
              Le modifiche si salvano da sole poco dopo ogni cambiamento.
            </p>
            <button type="button" className="btn btn-outline btn-sm" style={{ width: "100%" }} onClick={doSave} disabled={pending}>
              {pending ? "Salvataggio…" : "Salva ora"}
            </button>
            {saved && !pending && <p style={{ color: "var(--green-700)", fontWeight: 700, fontSize: 13, textAlign: "center", margin: "8px 0 0" }}>✓ Salvato</p>}
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
            Stai vedendo il layout del Consorzio: seleziona la tua insegna/PV in alto per personalizzarlo.
          </p>
        )}
      </div>
    </div>
  );
}
