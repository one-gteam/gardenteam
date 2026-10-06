import type { PermessoRuolo, Role, SiteId } from "./types";

/*
 * Catalogo di cosa si può fare in ogni area e a quale condizione. È la
 * traduzione in parole dei controlli che il codice fa davvero (pagine e
 * azioni): serve alla pagina Utenti e ruoli → Permessi per spiegare cosa può
 * fare un ruolo, e al simulatore "prova un profilo". Se cambia un controllo
 * nel codice, va aggiornata anche la riga qui.
 *
 * Le condizioni:
 *  accesso   — basta avere l'area fra quelle abilitate alla persona
 *  ambito    — l'accesso, lavorando per la propria insegna o il proprio PV
 *  gestione  — gestire l'area, nel proprio ambito (Consorzio, insegna o PV)
 *  consorzio — gestire l'area ed essere collocati al Consorzio
 *  volantino — come "consorzio", oppure essere fra gli editor del volantino
 *  insegna   — essere amministratore di insegna
 *  sistema   — solo l'amministratore di sistema
 *  layout    — come "gestione", oppure essere il Grafico (nel suo ambito)
 *  articoli  — lo decide Articoli → Gestione (chi vede, chi pubblica, chi gestisce)
 */
export type Condizione = "accesso" | "ambito" | "gestione" | "layout" | "consorzio" | "volantino" | "insegna" | "sistema"
  | "articoli-vede" | "articoli-pubblica" | "articoli-gestisce" | PermessoRuolo;

export interface Capacita { testo: string; condizione: Condizione; nota?: string }
export interface SezioneCatalogo { area: SiteId | "articoli" | "portale"; titolo: string; icona: string; capacita: Capacita[] }

export const CATALOGO: SezioneCatalogo[] = [
  {
    area: "zoo", titolo: "Offerte Zoo", icona: "🐾",
    capacita: [
      { testo: "Vedere offerte in corso e database prodotti", condizione: "accesso" },
      { testo: "Scelta offerte volantino: proporre, segnare «non tratto», segnalare errori", condizione: "accesso" },
      { testo: "Bozza del volantino: sfogliarla e lasciare note", condizione: "accesso" },
      { testo: "Stampa cartelli: formati, prezzi e testi per il proprio negozio", condizione: "accesso" },
      { testo: "In reparto: controllo dei cartelli dal cellulare, stampati e non conformi", condizione: "accesso" },
      { testo: "Caricare i prezzi e le promozioni del proprio punto vendita", condizione: "ambito" },
      { testo: "Nascondere fornitori, marche o articoli non trattati", condizione: "ambito" },
      { testo: "Duplicare o creare cartelli propri", condizione: "ambito" },
      { testo: "Layout dei cartelli", condizione: "layout" },
      { testo: "Impostazioni: condizioni dei cartelli, chiave AI propria, giacenze dal gestionale", condizione: "gestione" },
      { testo: "Offerte proprie fuori volantino e articoli propri (anche con l'AI)", condizione: "gestione", nota: "per l'insegna o il PV" },
      { testo: "Storico dei focus (consultazione)", condizione: "gestione" },
      { testo: "Caricare l'Excel delle offerte, aprire e chiudere il volantino", condizione: "consorzio" },
      { testo: "Catalogo comune: prodotti padre, testi, foto, raggruppamento con l'AI", condizione: "consorzio" },
      { testo: "Pagina, focus e selezione finale delle offerte per il volantino", condizione: "consorzio" },
      { testo: "Crea volantino, Excel e foto per il grafico", condizione: "volantino" },
      { testo: "Archivio volantini, modifica dello storico focus, impostazioni del Consorzio", condizione: "consorzio" },
    ],
  },
  {
    area: "arredo", titolo: "Cartelli Arredo", icona: "🪑",
    capacita: [
      { testo: "Consultare i dati prodotti e le linee guida", condizione: "accesso" },
      { testo: "Stampa cartelli", condizione: "accesso" },
      { testo: "Personalizzare i testi dei prodotti per la propria insegna o PV", condizione: "ambito", nota: "salvo blocco dell'insegna" },
      { testo: "Layout dei cartelli del proprio ambito", condizione: "layout" },
      { testo: "Scheda online (QR): cosa si vede sul cartello e cosa online", condizione: "gestione" },
      { testo: "Impostazioni: campi personalizzati, liste, sfondi, codici interni", condizione: "gestione" },
      { testo: "Bloccare la personalizzazione ai propri punti vendita", condizione: "insegna" },
      { testo: "Dati comuni: prodotti, import Excel, varianti, classificazione dei campi", condizione: "consorzio" },
      { testo: "Layout e formati del Consorzio", condizione: "consorzio" },
    ],
  },
  {
    area: "academy", titolo: "Formazione (Academy)", icona: "🎓",
    capacita: [
      { testo: "Seguire i corsi assegnati, quiz, certificati", condizione: "accesso" },
      { testo: "Pannello Formazione: collaboratori, avanzamenti e report del proprio ambito", condizione: "pannelloFormazione" },
      { testo: "Creare e modificare corsi del proprio ambito", condizione: "corsi", nota: "il gestore deve anche gestire la Formazione" },
      { testo: "Percorsi formativi della propria insegna", condizione: "percorsi" },
      { testo: "Testi delle email automatiche per la propria insegna o PV", condizione: "modelliEmail" },
      { testo: "Corsi comuni, pacchetti SCORM, automazioni email del Consorzio", condizione: "consorzio" },
    ],
  },
  {
    area: "articoli", titolo: "Articoli", icona: "📰",
    capacita: [
      { testo: "Leggere gli articoli, iscriversi alla newsletter", condizione: "articoli-vede" },
      { testo: "Scrivere e pubblicare articoli, descrizione con l'AI, statistiche dei propri", condizione: "articoli-pubblica" },
      { testo: "Categorie, modelli, newsletter, permessi, statistiche di tutti", condizione: "articoli-gestisce" },
      { testo: "Casella email da cui arrivano gli articoli", condizione: "sistema" },
    ],
  },
  {
    area: "portale", titolo: "Utenti e organizzazione", icona: "👥",
    capacita: [
      { testo: "Gestire utenti e ruoli del proprio ambito", condizione: "gestioneUtenti", nota: "anche con l'incarico personale" },
      { testo: "Dati dell'insegna o del PV, reparti e gruppi", condizione: "organizzazione" },
      { testo: "Permessi dei ruoli, impostazioni del portale, chiave AI comune", condizione: "sistema" },
    ],
  },
];

export const RUOLI_CONFIGURABILI: Role[] = ["group_admin", "store_admin", "manager", "dept_head", "grafico", "student"];

/** Un profilo da provare: ruolo, dove è collocato, aree abilitate e (per il gestore) aree gestite. */
export interface Profilo {
  role: Role;
  livello: "consorzio" | "insegna" | "pv";
  aree: SiteId[];
  gestite: SiteId[];
  editorVolantino?: boolean;
}

export type Esito = { si: boolean; perche: string };

/**
 * Può farlo? `perm` è la tabella dei permessi in vigore (ruolo → permesso).
 * Rispecchia le regole del codice: gestisce() per la gestione dell'area,
 * gestisceConsorzio() per il livello Consorzio, i permessi generali per il resto.
 */
export function puoFare(c: Capacita, area: SezioneCatalogo["area"], p: Profilo, perm: (r: Role, k: PermessoRuolo) => boolean): Esito {
  if (p.role === "system_admin") return { si: true, perche: "amministratore di sistema" };
  const haArea = area === "portale" || area === "articoli" || p.aree.includes(area as SiteId);
  const gestisceArea = (a: SiteId) =>
    p.aree.includes(a) && (perm(p.role, `gestisce_${a}` as PermessoRuolo) || (p.role === "manager" && p.gestite.includes(a)));
  switch (c.condizione) {
    case "accesso":
      return haArea ? { si: true, perche: "ha l'area" } : { si: false, perche: "l'area non è abilitata alla persona" };
    case "ambito":
      if (!haArea) return { si: false, perche: "l'area non è abilitata alla persona" };
      return p.livello !== "consorzio" ? { si: true, perche: "lavora per la sua insegna o il suo PV" } : { si: false, perche: "al Consorzio si lavora sulla versione comune" };
    case "gestione":
      return gestisceArea(area as SiteId) ? { si: true, perche: "gestisce l'area nel suo ambito" }
        : { si: false, perche: haArea ? "non gestisce l'area" : "l'area non è abilitata alla persona" };
    case "layout":
      if (p.role === "grafico" && haArea) return { si: true, perche: "è il grafico: i layout del suo ambito sono suoi" };
      return gestisceArea(area as SiteId) ? { si: true, perche: "gestisce l'area nel suo ambito" }
        : { si: false, perche: haArea ? "non gestisce l'area (e non è il grafico)" : "l'area non è abilitata alla persona" };
    case "consorzio":
    case "volantino": {
      const g = gestisceArea(area as SiteId);
      if (g && p.livello === "consorzio") return { si: true, perche: "gestisce l'area al Consorzio" };
      if (c.condizione === "volantino" && haArea && p.editorVolantino) return { si: true, perche: "è fra gli editor del volantino" };
      return { si: false, perche: !g ? "non gestisce l'area" : "solo chi gestisce al Consorzio" };
    }
    case "insegna":
      return p.role === "group_admin" ? { si: true, perche: "amministratore di insegna" } : { si: false, perche: "solo l'amministratore di insegna" };
    case "sistema":
      return { si: false, perche: "solo l'amministratore di sistema" };
    case "articoli-vede":
    case "articoli-pubblica":
    case "articoli-gestisce":
      return { si: false, perche: "si decide in Articoli → Gestione (per ruolo, gruppo o persona)" };
    default: {
      // permessi generali del ruolo (pannello formazione, corsi, percorsi, modelli email, utenti, organizzazione)
      const k = c.condizione as PermessoRuolo;
      if (!perm(p.role, k)) return { si: false, perche: "il ruolo non ha questo permesso" };
      if (area === "academy" && !haArea) return { si: false, perche: "l'area non è abilitata alla persona" };
      if (k === "corsi" && p.role !== "group_admin" && p.role !== "store_admin" && !gestisceArea("academy")) {
        return { si: false, perche: "deve anche gestire la Formazione" };
      }
      if (k === "percorsi" && p.livello === "consorzio") {
        return gestisceArea("academy") ? { si: true, perche: "gestisce la Formazione al Consorzio" } : { si: false, perche: "al Consorzio serve gestire la Formazione" };
      }
      if (k === "organizzazione" && p.role !== "group_admin" && p.role !== "store_admin") return { si: false, perche: "solo per gli amministratori di insegna e PV" };
      return { si: true, perche: "permesso del ruolo" };
    }
  }
}
