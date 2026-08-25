"use client";

import { useEffect, useRef } from "react";

/**
 * Checkbox "seleziona tutto" per una tabella con più `input[name=<name>]` nella
 * stessa pagina, più selezione a intervallo con Maiusc+clic (come le liste file
 * del sistema operativo): un clic normale seleziona/deseleziona una riga sola,
 * Maiusc+clic estende la selezione dall'ultima riga cliccata a quella corrente.
 */
export default function BulkCheckbox({ name }: { name: string }) {
  const allRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const boxes = () =>
      Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`));
    let lastIndex: number | null = null;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLInputElement) || target.name !== name) return;
      const list = boxes();
      const idx = list.indexOf(target);
      if (e.shiftKey && lastIndex !== null && idx >= 0) {
        const [start, end] = idx > lastIndex ? [lastIndex, idx] : [idx, lastIndex];
        for (let i = start; i <= end; i++) list[i].checked = target.checked;
      }
      lastIndex = idx;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [name]);

  const toggleAll = () => {
    const next = allRef.current?.checked ?? false;
    for (const b of document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`)) {
      b.checked = next;
    }
  };

  return <input ref={allRef} type="checkbox" title="Seleziona tutte" onChange={toggleAll} />;
}
