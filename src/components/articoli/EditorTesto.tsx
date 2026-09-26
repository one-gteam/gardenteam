"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

export interface EditorTestoHandle {
  /** Sostituisce tutto il testo (usato dall'AI). */
  imposta: (html: string) => void;
  html: () => string;
}

/**
 * Un editor di testo con la formattazione che serve a una circolare: grassetto,
 * corsivo, elenchi, titolo, link. Niente librerie: è un riquadro modificabile
 * e il contenuto finisce in un campo nascosto del modulo (`name`), che il
 * server ripulisce comunque.
 */
const EditorTesto = forwardRef<EditorTestoHandle, { name: string; iniziale?: string; placeholder?: string }>(
  function EditorTesto({ name, iniziale = "", placeholder = "Scrivi qui la descrizione…" }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const nascosto = useRef<HTMLInputElement>(null);

    const aggiorna = () => { if (nascosto.current && box.current) nascosto.current.value = box.current.innerHTML; };
    useEffect(() => { if (box.current) box.current.innerHTML = iniziale; aggiorna(); }, [iniziale]);

    useImperativeHandle(ref, () => ({
      imposta: (html) => { if (box.current) { box.current.innerHTML = html; aggiorna(); } },
      html: () => box.current?.innerHTML ?? "",
    }));

    const cmd = (c: string, arg?: string) => {
      box.current?.focus();
      document.execCommand(c, false, arg);
      aggiorna();
    };
    const link = () => {
      const url = window.prompt("Indirizzo del link (https://…)");
      if (!url) return;
      cmd("createLink", /^https?:\/\//i.test(url) ? url : `https://${url}`);
    };
    const B = ({ c, arg, children, title }: { c: string; arg?: string; children: React.ReactNode; title: string }) => (
      <button type="button" className="editor-btn" title={title} onMouseDown={(e) => { e.preventDefault(); cmd(c, arg); }}>{children}</button>
    );

    return (
      <div className="editor">
        <div className="editor-barra">
          <B c="bold" title="Grassetto"><b>G</b></B>
          <B c="italic" title="Corsivo"><i>C</i></B>
          <B c="underline" title="Sottolineato"><u>S</u></B>
          <span className="editor-sep" />
          <B c="formatBlock" arg="h3" title="Titolo">Titolo</B>
          <B c="formatBlock" arg="p" title="Testo normale">Testo</B>
          <span className="editor-sep" />
          <B c="insertUnorderedList" title="Elenco puntato">• Elenco</B>
          <B c="insertOrderedList" title="Elenco numerato">1. Elenco</B>
          <span className="editor-sep" />
          <button type="button" className="editor-btn" title="Inserisci un link" onMouseDown={(e) => { e.preventDefault(); link(); }}>🔗 Link</button>
          <B c="removeFormat" title="Togli la formattazione">✕ Formato</B>
        </div>
        <div ref={box} className="editor-area" contentEditable suppressContentEditableWarning data-placeholder={placeholder}
          onInput={aggiorna} onBlur={aggiorna} />
        <input ref={nascosto} type="hidden" name={name} />
      </div>
    );
  }
);

export default EditorTesto;
