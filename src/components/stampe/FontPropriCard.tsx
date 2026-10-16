import type { FontProprio } from "@/lib/font-propri";
import { caricaFont, togliFont } from "@/lib/font-actions";
import { ModuloInvio, PulsanteAzione } from "@/components/AzioneSenzaRicarica";

/**
 * Pagina Layout → «I vostri font»: si caricano uno o più file di font
 * dell'insegna/PV e si ritrovano nel menu «Carattere» di ogni campo.
 */
export default function FontPropriCard({ area, scopeParam, scopeLabel, fonts, propri }: {
  area: "arredo" | "zoo"; scopeParam: string; scopeLabel: string;
  /** Tutti quelli che l'ambito può usare (anche dell'insegna sopra e del Consorzio). */
  fonts: FontProprio[];
  /** Id di quelli caricati da questo ambito (gli unici che può togliere). */
  propri: string[];
}) {
  return (
    <div className="card" style={{ marginTop: 14, padding: 14 }}>
      <h3 style={{ marginTop: 0 }}>Font di {scopeLabel}</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
        Caricate i caratteri della vostra grafica (file <strong>.woff2</strong>, .woff, .ttf o .otf, fino a 3 MB l&apos;uno; anche più
        insieme, es. normale e grassetto). Li trovate nel menu <strong>Carattere</strong> del campo scelto, nei layout di questo
        ambito e dei suoi punti vendita. Usate solo font di cui avete la licenza per la stampa.
      </p>
      {fonts.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          {fonts.map((f) => (
            <div key={f.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}>
              <span style={{ fontFamily: `"GTF ${f.id}", sans-serif`, fontSize: 20, minWidth: 180 }}>{f.nome} — Offerta 1,99 €</span>
              <span className="hint" style={{ fontSize: 11.5 }}>{f.scopeType === "system" ? "del Consorzio" : propri.includes(f.id) ? "vostro" : "dell'insegna"}</span>
              {propri.includes(f.id) && (
                <span style={{ marginLeft: "auto" }}>
                  <PulsanteAzione azione={togliFont.bind(null, area, scopeParam, f.id)} conferma={`Togliere il font «${f.nome}»? I campi che lo usano tornano al carattere predefinito.`}>
                    Togli
                  </PulsanteAzione>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <ModuloInvio azione={caricaFont.bind(null, area, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" name="file" accept=".woff2,.woff,.ttf,.otf" multiple required />
        <input type="text" name="nome" maxLength={40} placeholder="Nome (facoltativo, es. Recoleta)" style={{ maxWidth: 240, margin: 0 }} />
        <button className="btn btn-sm" type="submit">Carica font</button>
      </ModuloInvio>
    </div>
  );
}
