import type { FontProprio } from "@/lib/font-propri";
import { caricaFont, togliFont, importaGoogleFont } from "@/lib/font-actions";
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
      <div style={{ borderTop: "1px dashed var(--line)", marginTop: 12, paddingTop: 10 }}>
        <strong style={{ fontSize: 13 }}>Oppure da Google Fonts</strong>
        <p className="hint" style={{ margin: "2px 0 8px" }}>
          Scrivete il nome come su <a href="https://fonts.google.com" target="_blank" rel="noreferrer">fonts.google.com</a> e scegliete gli spessori:
          GT One scarica i file e li tiene nel suo archivio (niente da scaricare a mano, e i cartelli non si collegano a Google).
        </p>
        <ModuloInvio azione={importaGoogleFont.bind(null, area, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="text" name="famiglia" required maxLength={40} placeholder="es. Lato, Open Sans, Montserrat" style={{ maxWidth: 240, margin: 0 }} />
          {[["300", "Light"], ["400", "Regular"], ["700", "Bold"], ["900", "Black"]].map(([v, n]) => (
            <label key={v} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12.5 }}>
              <input type="checkbox" name="peso" value={v} defaultChecked={v === "400" || v === "700"} /> {n}
            </label>
          ))}
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" name="corsivo" value="1" /> anche corsivo
          </label>
          <button className="btn btn-sm" type="submit">Importa</button>
        </ModuloInvio>
      </div>
    </div>
  );
}
