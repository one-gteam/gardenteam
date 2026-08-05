"use client";

import { useState } from "react";

/** Copia il link della pagina studente e apre l'anteprima di come la vedono i corsisti. */
export default function CourseShareBar({ courseId }: { courseId: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/corso/${courseId}`;

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copia il link del corso:", url); // fallback se la clipboard è bloccata
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  return (
    <div className="share-bar">
      <button className="btn btn-outline btn-sm" type="button" onClick={copy}>
        {copied ? "✓ Link copiato" : "Copia link per lo studente"}
      </button>
      <a className="btn btn-outline btn-sm" href={path} target="_blank" rel="noopener noreferrer">
        Vista studente
      </a>
      <span className="hint">l&apos;anteprima si apre in una nuova scheda, come la vede chi segue il corso</span>
    </div>
  );
}
