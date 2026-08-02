"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { moveHomeBlock, toggleHomeBlock } from "@/lib/actions";
import { HOME_BLOCK_LABELS, HomeBlockConfig } from "@/lib/types";

/**
 * Ordina e attiva/disattiva i blocchi della home studente — l'equivalente, con
 * pulsanti ↑/↓ invece del trascinamento del mouse, di una dashboard "a blocchi"
 * riordinabile senza sviluppo.
 */
export default function HomeBlocksPanel({ blocks }: { blocks: HomeBlockConfig[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div className="table-wrap">
      <table className="data">
        <tbody>
          {blocks.map((b, i) => (
            <tr key={b.kind} style={{ opacity: b.enabled ? 1 : 0.5 }}>
              <td style={{ width: 34 }}><span className="rank-pos">{i + 1}</span></td>
              <td>{HOME_BLOCK_LABELS[b.kind]}</td>
              <td style={{ width: 90 }}>
                <button className="btn btn-outline btn-sm" type="button" disabled={i === 0 || pending}
                  onClick={() => run(() => moveHomeBlock(i, -1))} title="Sposta su">↑</button>{" "}
                <button className="btn btn-outline btn-sm" type="button" disabled={i === blocks.length - 1 || pending}
                  onClick={() => run(() => moveHomeBlock(i, 1))} title="Sposta giù">↓</button>
              </td>
              <td style={{ width: 110 }}>
                <button className={`btn btn-sm ${b.enabled ? "btn-outline" : ""}`} type="button" disabled={pending}
                  onClick={() => run(() => toggleHomeBlock(i))}>
                  {b.enabled ? "Nascondi" : "Mostra"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
