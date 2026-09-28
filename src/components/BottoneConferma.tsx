"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Pulsante di invio che chiede conferma prima di partire: per le azioni che non
 * si possono annullare (eliminare tutte le offerte di un volantino…).
 * Va dentro un <form action={…}> come un normale pulsante submit.
 */
export default function BottoneConferma({
  messaggio, children, className = "btn btn-outline btn-sm", style, title,
}: {
  messaggio: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <button type="submit" className={className} style={style} title={title}
      onClick={(e) => { if (!window.confirm(messaggio)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
