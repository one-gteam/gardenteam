"use client";

import { useEffect } from "react";

/**
 * Abilita lo Shift+clic sugli checkbox di selezione offerte (name="zsel"):
 * tenendo premuto Shift si seleziona/deseleziona tutto l'intervallo tra
 * l'ultimo checkbox toccato e quello corrente, come in un gestionale.
 */
export default function ShiftChecks() {
  useEffect(() => {
    let last: HTMLInputElement | null = null;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLInputElement) || target.name !== "zsel") return;
      const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="zsel"]'));
      if (e.shiftKey && last && last !== target) {
        const [a, b] = [boxes.indexOf(last), boxes.indexOf(target)].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) boxes[i].checked = target.checked;
      }
      last = target;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
