"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Un modulo GET che si invia da solo quando si cambia una tendina o una
 * spunta: niente pulsante "Filtra" da premere dopo. Il testo libero (la
 * ricerca) si invia con Invio, come sempre.
 */
export default function FormAutoInvia({
  children, className, style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <form
      method="get"
      className={className}
      style={style}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName === "SELECT" || t.type === "checkbox" || t.type === "radio") e.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
