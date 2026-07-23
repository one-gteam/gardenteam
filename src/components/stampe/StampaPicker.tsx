"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ProdLite {
  id: string;
  titolo: string;
  codice: string;
  prezzo: string;
  tipologia: string;
}

/** Selezione prodotti per la stampa: click per aggiungere, Shift+click per intervalli, formato per riga. */
export default function StampaPicker({
  products,
  formats,
  fields,
  scopeParam,
  filters,
  initialSelected,
  initialFormats,
  initialPrices,
  initialNoPrice,
  initialHidden,
  globalFormat,
}: {
  products: ProdLite[];
  formats: { id: string; name: string }[];
  fields: { id: string; label: string }[];
  scopeParam: string;
  filters: Record<string, string>;
  initialSelected: string[];
  initialFormats: Record<string, string>;
  initialPrices: Record<string, string>;
  initialNoPrice: Record<string, boolean>;
  initialHidden: Record<string, string[]>;
  globalFormat: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [rowFormat, setRowFormat] = useState<Record<string, string>>(initialFormats);
  const [prices, setPrices] = useState<Record<string, string>>(initialPrices);
  const [noPrice, setNoPrice] = useState<Record<string, boolean>>(initialNoPrice);
  const [hiddenFields, setHiddenFields] = useState<Record<string, string[]>>(initialHidden);
  const [applyAll, setApplyAll] = useState(globalFormat);
  const [doppio, setDoppio] = useState(false);
  const lastIndex = useRef<number | null>(null);

  const toggle = (index: number, shift: boolean) => {
    const id = products[index].id;
    if (shift && lastIndex.current !== null) {
      const [a, b] = [Math.min(lastIndex.current, index), Math.max(lastIndex.current, index)];
      const range = products.slice(a, b + 1).map((p) => p.id);
      setSelected((prev) => [...prev, ...range.filter((x) => !prev.includes(x))]);
    } else {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
    lastIndex.current = index;
  };

  const buildUrl = (print: boolean) => {
    const params = new URLSearchParams({ scope: scopeParam });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    params.set("sel", selected.join(","));
    params.set("formato", applyAll);
    for (const id of selected) {
      if (rowFormat[id] && rowFormat[id] !== applyAll) params.set(`formato_${id}`, rowFormat[id]);
      if (prices[id]) params.set(`prezzo_${id}`, prices[id]);
      if (noPrice[id]) params.set(`noprezzo_${id}`, "1");
      if (hiddenFields[id]?.length) params.set(`nascondi_${id}`, hiddenFields[id].join(","));
    }
    if (doppio) params.set("doppio", "1");
    if (print) params.set("print", "1");
    return `/stampe/arredo/stampa?${params.toString()}`;
  };

  const anyA5 = selected.some((id) => (rowFormat[id] ?? applyAll) === "a5");

  const selectedProds = selected.map((id) => products.find((p) => p.id === id)).filter(Boolean) as ProdLite[];

  return (
    <>
      {/* elenco con selezione multipla */}
      <div className="card" style={{ padding: 8, maxHeight: 680, overflowY: "auto" }}>
        <div style={{ padding: "4px 10px", fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>
          {products.length} prodotti — clic per selezionare, <kbd>Shift</kbd>+clic per intervalli
        </div>
        {products.map((p, i) => {
          const isSel = selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`prod-item ${isSel ? "active" : ""}`}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", userSelect: "none" }}
              onClick={(e) => toggle(i, e.shiftKey)}
            >
              {isSel ? "☑" : "☐"} {p.titolo}
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.codice} · € {p.prezzo} · {p.tipologia}</div>
            </button>
          );
        })}
      </div>

      {/* selezionati */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <h2 style={{ margin: 0, flex: 1 }}>Selezionati ({selectedProds.length})</h2>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>
            Formato{" "}
            <select value={applyAll} onChange={(e) => setApplyAll(e.target.value)} style={{ marginTop: 0 }}>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setRowFormat(Object.fromEntries(selected.map((id) => [id, applyAll])))}
          >
            Applica a tutti
          </button>
        </div>
        {selectedProds.length === 0 && <p className="empty">Seleziona i prodotti dall&apos;elenco a sinistra (Shift+clic per più righe).</p>}
        {selectedProds.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Prodotto</th><th>Formato</th><th>Prezzo cartello</th><th>Prezzo</th><th>Campi</th><th></th></tr></thead>
                <tbody>
                  {selectedProds.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.titolo}</strong>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.codice} · {p.tipologia}</div>
                      </td>
                      <td>
                        <select
                          value={rowFormat[p.id] ?? applyAll}
                          onChange={(e) => setRowFormat((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          style={{ marginTop: 0, minWidth: 150 }}
                        >
                          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={prices[p.id] ?? p.prezzo}
                          onChange={(e) => setPrices((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          style={{ width: 85, marginTop: 0 }}
                        />
                      </td>
                      <td>
                        <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!noPrice[p.id]}
                            onChange={(e) => setNoPrice((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                          />{" "}
                          nascondi
                        </label>
                      </td>
                      <td>
                        <details className="flag-details">
                          <summary className="btn btn-outline btn-sm" style={{ opacity: 1, fontSize: 12 }} title="Nascondi campi in questo cartello">
                            🙈 Campi{hiddenFields[p.id]?.length ? ` (${hiddenFields[p.id].length})` : ""}
                          </summary>
                          <div className="flag-popover" style={{ maxHeight: 240, overflowY: "auto" }}>
                            {fields.map((f) => (
                              <label key={f.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={hiddenFields[p.id]?.includes(f.id) ?? false}
                                  onChange={(e) =>
                                    setHiddenFields((prev) => {
                                      const cur = prev[p.id] ?? [];
                                      return { ...prev, [p.id]: e.target.checked ? [...cur, f.id] : cur.filter((x) => x !== f.id) };
                                    })
                                  }
                                />
                                {f.label}
                              </label>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelected((prev) => prev.filter((x) => x !== p.id))}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
              {anyA5 && (
                <label style={{ fontSize: 12.5, display: "flex", gap: 5, alignItems: "center" }}>
                  <input type="checkbox" checked={doppio} onChange={(e) => setDoppio(e.target.checked)} />
                  A5: stampa ogni cartello 2 volte (foglio A4 pieno)
                </label>
              )}
              <button type="button" className="btn btn-outline" onClick={() => router.push(buildUrl(false))}>
                Aggiorna anteprima →
              </button>
              <button type="button" className="btn" onClick={() => router.push(buildUrl(true))}>
                🖨️ Anteprima di stampa / Esporta PDF
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
