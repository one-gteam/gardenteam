import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessStampe, getStampeDb } from "@/lib/stampe";

// Contenuti dal file "linee guida.xlsx" del Consorzio (dati_arredo giardino_2025)
const REGOLE_CAMPO: { campo: string; regola: string; esempio?: string }[] = [
  { campo: "Titolo", regola: "Lettera maiuscola iniziale. Lunghezza massima (spazi inclusi): 27 caratteri.", esempio: "Lettino alluminio antracite" },
  { campo: "Sottotitolo", regola: "Breve descrizione. Lunghezza max (spazi inclusi): 47 caratteri.", esempio: "Set Pranzo da giardino Pratic - da 6 a 10 posti" },
  { campo: "Descrizione", regola: "Lunghezza max (spazi inclusi): 285 caratteri." },
  { campo: "Materiali", regola: "Materiale del prodotto. Lunghezza max: 145 caratteri.", esempio: "Alluminio grigio e textilene grigio" },
  { campo: "Parti incluse", regola: "N° articoli con misura in formato lunghezza×larghezza×altezza cm. Quando serve, vai a capo (due spazi) e aggiungi portata o peso.", esempio: "1 lettino 181x67xh39 cm  Portata 120 kg" },
  { campo: "Colori", regola: "Le colorazioni disponibili, sempre andando a capo con due spazi. Se necessario specifica le colorazioni delle varie parti del prodotto.", esempio: "Bianco e grigio  Giallo  Antracite" },
  { campo: "Misure imballo", regola: "Specificare n° di box, peso e misure, andando a capo a ogni box con doppio spazio. Inserire il peso totale dove necessario.", esempio: "1 box 278x26x23.5 cm  1 box 395x28x17 cm  Peso totale 197 kg" },
  { campo: "Prodotti consigliati / Consigli utili", regola: "Lunghezza max: 85 caratteri.", esempio: "Aggiungi un tavolino e completa con un ombrellone" },
  { campo: "Buono a sapersi", regola: "Lunghezza max: 170 caratteri." },
  { campo: "Prezzo", regola: "Prezzo senza cifre decimali (i centesimi vanno nel campo dedicato)." },
  { campo: "Pagamento", regola: "Metodo di pagamento disponibile. Lunghezza max: 43 caratteri.", esempio: "Paga in comodità in 3 rate con" },
  { campo: "Trasporto", regola: "Lunghezza max: 75 caratteri.", esempio: "Trasporto e montaggio senza stress? Chiedi al nostro Infopoint!" },
  { campo: "@image / @azienda / @listino / @pagamento", regola: "Percorso del file immagine (collegato per codice articolo fornitore)." },
];

const REGOLE_GENERALI = [
  "Inizia la frase sempre con lettera maiuscola.",
  "Rivolgiti alla 2ª persona singolare (aggiungi, completa, ecc.).",
  "Unità di misura: cm (centimetri), mt (metri), kg (chili).",
  "Misure nel formato lunghezza×larghezza×altezza: 100x50xh20 cm.",
  "Per tavoli allungabili scrivi le misure con il trattino: 1 tavolo 140-210x90xh76 cm.",
  "Separa i decimali con il punto: 5.50 mt.",
  "IMPORTANTE: vai a capo con due spazi consecutivi → riga1␣␣riga2␣␣riga3.",
];

const IMMAGINI = [
  { tipo: "Foto prodotto", regola: "Preferibilmente quadrata, minimo 1000×1000 px, 300 dpi. Nominata con il codice articolo fornitore." },
  { tipo: "Logo aziende", regola: "430×110 pixel, 300 dpi." },
  { tipo: "Logo pagamento", regola: "285×80 pixel, 300 dpi." },
];

export default async function LineeGuidaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");
  const db = await getStampeDb();

  return (
    <div>
      <StampeHeader user={user} active="linee-guida" />
      <div className="container" style={{ maxWidth: 900 }}>
        <h1>📏 Linee guida cartelli Arredo Giardino</h1>
        <p className="subtitle">
          Le regole del Consorzio per scrivere i dati dei prodotti: seguirle garantisce cartelli uniformi in tutti i punti vendita.
        </p>

        <div className="card" style={{ marginBottom: 22 }}>
          <h2>Regole generali di scrittura</h2>
          <ul style={{ lineHeight: 1.9, margin: 0, paddingLeft: 20 }}>
            {REGOLE_GENERALI.map((r, i) => (
              <li key={i} style={r.startsWith("IMPORTANTE") ? { fontWeight: 700 } : {}}>{r}</li>
            ))}
          </ul>
        </div>

        <div className="card table-wrap" style={{ marginBottom: 22 }}>
          <h2>Regole per campo</h2>
          <table className="data">
            <thead><tr><th>Campo</th><th>Regola</th><th>Esempio</th></tr></thead>
            <tbody>
              {REGOLE_CAMPO.map((r) => (
                <tr key={r.campo}>
                  <td style={{ whiteSpace: "nowrap" }}><strong>{r.campo}</strong></td>
                  <td style={{ fontSize: 13 }}>{r.regola}</td>
                  <td style={{ fontSize: 12.5, color: "var(--muted)", fontStyle: "italic" }}>{r.esempio ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Grandezza immagini</h2>
          <table className="data">
            <tbody>
              {IMMAGINI.map((r) => (
                <tr key={r.tipo}>
                  <td style={{ whiteSpace: "nowrap" }}><strong>{r.tipo}</strong></td>
                  <td style={{ fontSize: 13 }}>{r.regola}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {db.settings.sharepointImagesUrl && (
            <p style={{ marginTop: 12 }}>
              <a className="btn btn-outline btn-sm" href={db.settings.sharepointImagesUrl} target="_blank" rel="noopener noreferrer">
                ☁️ Apri la cartella immagini su SharePoint
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
