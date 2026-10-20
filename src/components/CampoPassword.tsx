"use client";

import { useState } from "react";

/**
 * Campo password con «mostra»: chi non riesce a entrare vede cosa ha scritto
 * davvero (o cosa ha messo il browser da solo). `autoComplete` dice al browser
 * se è la password attuale o una nuova: dopo una reimpostazione propone di
 * aggiornare quella salvata invece di continuare a riempire la vecchia.
 */
export default function CampoPassword({ name, autoComplete, minLength, autoFocus }: {
  name: string; autoComplete: "current-password" | "new-password"; minLength?: number; autoFocus?: boolean;
}) {
  const [vedi, setVedi] = useState(false);
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type={vedi ? "text" : "password"} name={name} required minLength={minLength} autoFocus={autoFocus}
        autoComplete={autoComplete} autoCapitalize="off" autoCorrect="off" spellCheck={false} style={{ flex: 1 }} />
      <button type="button" className="mini-btn" onClick={() => setVedi((v) => !v)} aria-pressed={vedi}
        title={vedi ? "Nascondi la password" : "Mostra la password che hai scritto"}>{vedi ? "nascondi" : "mostra"}</button>
    </span>
  );
}
