"use client";

import { useRef, useState, useTransition } from "react";
import type { LayoutItem, PrintField, PrintFormat, StickerStyle } from "@/lib/stampe";
import { saveLayout } from "@/lib/stampe-actions";
import { stickerShapeStyle } from "./stickerStyle";

/** Editor drag & drop del layout cartello: trascina i campi, ridimensionali dall'angolo. */
export default function LayoutEditor({
  format,
  fields,
  initialItems,
  scopeParam,
  initialTipologie,
  tipologieDisponibili,
  sampleValues,
  canEdit,
  images = [],
}: {
  format: PrintFormat;
  fields: PrintField[];
  initialItems: LayoutItem[];
  scopeParam: string;
  initialTipologie: string[];
  tipologieDisponibili: string[];
  sampleValues: Record<string, string>;
  canEdit: boolean;
  images?: { name: string; url: string }[];
}) {
  const [items, setItems] = useState<LayoutItem[]>(initialItems);
  const [tipologie, setTipologie] = useState<string[]>(initialTipologie);
  const [selected, setSelected] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; mode: "move" | "resize"; startX: number; startY: number; orig: LayoutItem } | null>(null);
  // cronologia per annulla/ripristina
  const history = useRef<LayoutItem[][]>([initialItems]);
  const historyPos = useRef(0);
  const [, forceHistory] = useState(0);

  const pushHistory = (next: LayoutItem[]) => {
    history.current = [...history.current.slice(0, historyPos.current + 1), next].slice(-40);
    historyPos.current = history.current.length - 1;
    forceHistory((n) => n + 1);
  };
  const undo = () => {
    if (historyPos.current > 0) {
      historyPos.current -= 1;
      setItems(history.current[historyPos.current]);
      forceHistory((n) => n + 1);
    }
  };
  const redo = () => {
    if (historyPos.current < history.current.length - 1) {
      historyPos.current += 1;
      setItems(history.current[historyPos.current]);
      forceHistory((n) => n + 1);
    }
  };

  const scale = 2.4; // px per mm
  const W = format.w * scale;
  const H = format.h * scale;

  const onMouseDown = (e: React.MouseEvent, index: number, mode: "move" | "resize") => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(index);
    drag.current = { index, mode, startX: e.clientX, startY: e.clientY, orig: { ...items[index] } };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const { index, mode, startX, startY, orig } = drag.current;
    const dx = ((e.clientX - startX) / W) * 100;
    const dy = ((e.clientY - startY) / H) * 100;
    setItems((prev) =>
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
      pushHistory(items);
    }
  };

  const addField = (fieldId: string) => {
    if (!canEdit) return;
    const next = [...items, { fieldId, x: 10, y: 10, w: 40, h: 8 }];
    setItems(next);
    pushHistory(next);
    setSelected(items.length);
  };

  const addImage = (url: string) => {
    if (!canEdit) return;
    const next = [...items, { fieldId: "__img", imageUrl: url, x: 10, y: 10, w: 25, h: 10 }];
    setItems(next);
    pushHistory(next);
    setSelected(items.length);
  };

  const addSticker = () => {
    if (!canEdit) return;
    const next: LayoutItem[] = [
      ...items,
      {
        fieldId: fields.find((f) => f.id === "novita")?.id ?? fields[0].id,
        x: 65, y: 8, w: 22, h: 12,
        color: "#ffffff",
        sticker: { shape: "stella", bg: "#e8481c", rotation: -12, size: 16 },
      },
    ];
    setItems(next);
    pushHistory(next);
    setSelected(items.length);
  };

  const updateSelected = (patch: Partial<LayoutItem> | { sticker: Partial<StickerStyle> }) => {
    if (selected === null) return;
    const next = items.map((it, i) => {
      if (i !== selected) return it;
      if ("sticker" in patch && it.sticker) {
        return { ...it, sticker: { ...it.sticker, ...(patch.sticker as Partial<StickerStyle>) } };
      }
      return { ...it, ...(patch as Partial<LayoutItem>) };
    });
    setItems(next);
    pushHistory(next);
  };

  const selItem = selected !== null ? items[selected] : null;

  const removeSelected = () => {
    if (selected === null) return;
    const next = items.filter((_, i) => i !== selected);
    setItems(next);
    pushHistory(next);
    setSelected(null);
  };

  const doSave = () => {
    startTransition(async () => {
      await saveLayout(format.id, scopeParam, tipologie.join(","), JSON.stringify(items));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const usedFields = new Set(items.map((i) => i.fieldId));

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
          🔖 Aggiungi sticker / bollino
        </button>
        {images.length > 0 && (
          <>
            <h3 style={{ margin: "14px 6px 8px" }}>Le tue immagini</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {images.map((img) => (
                <button key={img.url} type="button" className="btn btn-outline btn-sm" style={{ textAlign: "left" }} onClick={() => addImage(img.url)} disabled={!canEdit}>
                  🖼 {img.name}
                </button>
              ))}
            </div>
          </>
        )}
        {selected !== null && canEdit && (
          <button type="button" className="btn btn-sm" style={{ marginTop: 12, background: "var(--red)" }} onClick={removeSelected}>
            🗑 Rimuovi elemento selezionato
          </button>
        )}
      </div>

      <div>
        {canEdit && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={undo} disabled={historyPos.current === 0} title="Annulla (indietro)">↶ Indietro</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={redo} disabled={historyPos.current >= history.current.length - 1} title="Ripristina (avanti)">↷ Avanti</button>
          </div>
        )}
        <div
          ref={canvasRef}
          className="cartello editor-canvas"
          style={{ width: W, height: H, backgroundImage: format.background ? `url(${format.background})` : undefined, backgroundSize: "cover" }}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onMouseDown={() => setSelected(null)}
        >
          {items.map((item, i) => {
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
                    {sampleValues[item.fieldId] || meta?.label || "Sticker"}
                  </div>
                  {canEdit && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                </div>
              );
            }
            const isImage =
              item.fieldId === "__img" || item.fieldId === "foto" || item.fieldId === "logoAzienda" || item.fieldId === "logoInsegna" || meta?.type === "image";
            const imgSrc = item.fieldId === "__img" ? item.imageUrl : sampleValues[item.fieldId];
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
                  {canEdit && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
                </div>
              );
            }
            const isPrice = item.fieldId === "prezzo" || item.fieldId === "prezzoPromo";
            return (
              <div
                key={i}
                className={`editor-item ${selected === i ? "selected" : ""}`}
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  width: `${item.w}%`,
                  height: `${item.h}%`,
                  fontSize: ((meta?.size ?? 11) * scale) / 2.4,
                  fontWeight: meta?.bold ? 800 : 400,
                  color: isPrice ? "#c2410c" : "#1c2b21",
                  textAlign: isPrice ? "right" : "left",
                  cursor: canEdit ? "move" : "default",
                }}
                onMouseDown={(e) => onMouseDown(e, i, "move")}
              >
                {isPrice ? `€ ${sampleValues[item.fieldId] ?? ""}` : sampleValues[item.fieldId] || meta?.label}
                {canEdit && <span className="resize-handle" onMouseDown={(e) => onMouseDown(e, i, "resize")} />}
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
          Anteprima con un prodotto di esempio · trascina i campi, ridimensiona dall&apos;angolo in basso a destra.
        </p>
      </div>

      <div className="card" style={{ padding: 14 }}>
        {selItem?.sticker && canEdit && (
          <div style={{ borderBottom: "1.5px dashed var(--line)", paddingBottom: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>🔖 Sticker selezionato</h3>
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
                  <option value="cerchio">⚪ Cerchio</option>
                  <option value="quadrato">⬜ Quadrato</option>
                  <option value="stella">💥 Stella/burst</option>
                  <option value="nastro">🎀 Nastro</option>
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
            <button type="button" className="btn" style={{ marginTop: 14, width: "100%" }} onClick={doSave} disabled={pending}>
              {pending ? "Salvataggio…" : "💾 Salva layout"}
            </button>
            {saved && <p style={{ color: "var(--green-700)", fontWeight: 700, fontSize: 13, textAlign: "center", margin: "8px 0 0" }}>✓ Layout salvato</p>}
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
            🔒 Stai vedendo il layout del Consorzio: seleziona la tua insegna/PV in alto per personalizzarlo.
          </p>
        )}
      </div>
    </div>
  );
}
