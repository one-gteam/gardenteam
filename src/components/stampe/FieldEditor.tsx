"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { autosaveField } from "@/lib/stampe-actions";

const CLIP_KEY = "stampe_clipboard";

export function readClipboard(): { type: "field" | "product"; fieldId?: string; value?: string; fields?: Record<string, string> } | null {
  try {
    return JSON.parse(localStorage.getItem(CLIP_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Editor di un campo prodotto: salvataggio automatico (debounce 800ms), copia/incolla dagli appunti. */
export default function FieldEditor({
  productId,
  fieldId,
  scopeParam,
  initialValue,
  initialCustom,
  showVersionBadge,
  canEdit,
  isImage,
}: {
  productId: string;
  fieldId: string;
  scopeParam: string;
  initialValue: string;
  initialCustom: boolean;
  showVersionBadge: boolean;
  canEdit: boolean;
  isImage?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [custom, setCustom] = useState(initialCustom);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialValue);

  useEffect(() => {
    setValue(initialValue);
    setCustom(initialCustom);
    lastSaved.current = initialValue;
  }, [productId, initialValue, initialCustom]);

  const save = async (v: string) => {
    if (v === lastSaved.current) return;
    setState("saving");
    const res = await autosaveField(productId, fieldId, scopeParam, v);
    if (res.ok) {
      lastSaved.current = v.trim();
      setCustom(!!res.custom);
      setState("saved");
      router.refresh(); // aggiorna l'anteprima
      setTimeout(() => setState("idle"), 1600);
    } else {
      setState("error");
    }
  };

  const onChange = (v: string) => {
    setValue(v);
    if (!canEdit) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 800);
  };

  const copyField = () => {
    localStorage.setItem(CLIP_KEY, JSON.stringify({ type: "field", fieldId, value }));
    setState("saved");
    setTimeout(() => setState("idle"), 800);
  };

  const pasteField = () => {
    const clip = readClipboard();
    if (!clip) return;
    const v = clip.type === "field" ? clip.value : clip.fields?.[fieldId];
    if (v !== undefined) onChange(v);
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
      <textarea
        rows={value.length > 90 ? 3 : 1}
        value={value}
        readOnly={!canEdit}
        placeholder={isImage ? "URL o percorso immagine (es. /uploads/…)" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => canEdit && save(value)}
        style={{ flex: 1, marginTop: 0, opacity: canEdit ? 1 : 0.65 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", minWidth: 40 }}>
        <div style={{ display: "flex", gap: 2 }}>
          <button type="button" className="mini-btn" title="Copia campo" onClick={copyField}>⧉</button>
          {canEdit && <button type="button" className="mini-btn" title="Incolla dagli appunti" onClick={pasteField}>📋</button>}
        </div>
        <span style={{ fontSize: 10, color: state === "error" ? "var(--red)" : "var(--green-700)", minHeight: 13 }}>
          {state === "saving" ? "…" : state === "saved" ? "✓" : state === "error" ? "errore" : showVersionBadge && custom ? "pers." : ""}
        </span>
      </div>
    </div>
  );
}
