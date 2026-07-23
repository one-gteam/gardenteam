import { DB, Course, User, Progress, DEFAULT_SETTINGS } from "./types";

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const lezVideo = (id: string, title: string, minutes: number, content: string) => ({
  id, title, type: "video" as const, minutes, content,
});
const lezTesto = (id: string, title: string, minutes: number, content: string) => ({
  id, title, type: "testo" as const, minutes, content,
});
const lezPdf = (id: string, title: string, minutes: number, content: string) => ({
  id, title, type: "pdf" as const, minutes, content,
});
const lezSlide = (id: string, title: string, minutes: number, content: string) => ({
  id, title, type: "slide" as const, minutes, content,
});

export function buildSeed(): DB {
  // Insegne reali del Consorzio Garden Team (fonte: gardenteam.biz) + Nicora Garden e Floridea
  const tenants = [
    { id: "t1", name: "Rosàflor", color: "#c2185b", emoji: "🌹", logoUrl: "/loghi/t1.png", secretWord: "rosa2026", approvalEmail: "formazione@rosaflor.it", welcome: "Benvenuti nell'academy Rosàflor! Ricordate di completare il corso sicurezza entro fine mese. 🌹" },
    { id: "t2", name: "Flover", color: "#7cb342", emoji: "🌸", logoUrl: "/loghi/t2.png" },
    { id: "t3", name: "Iperverde", color: "#2e7d32", emoji: "🌿", logoUrl: "/loghi/t3.png" },
    { id: "t4", name: "Florarici", color: "#f9a825", emoji: "🌼", logoUrl: "/loghi/t4.jpg" },
    { id: "t5", name: "Fasoli Piante", color: "#558b2f", emoji: "🌱", logoUrl: "/loghi/t5.png" },
    { id: "t6", name: "Dichio Vivai Garden", color: "#00897b", emoji: "🌵", logoUrl: "/loghi/t6.png" },
    { id: "t7", name: "BIA Home & Garden", color: "#6d4c41", emoji: "🏡", logoUrl: "/loghi/t7.png" },
    { id: "t8", name: "Il Germoglio Garden Center", color: "#9e9d24", emoji: "🌾", logoUrl: "/loghi/t8.png" },
    { id: "t9", name: "Garden Anna", color: "#d81b60", emoji: "🌷", logoUrl: "/loghi/t9.png" },
    { id: "t10", name: "Nicora Garden", color: "#43a047", emoji: "🍃" },
    { id: "t11", name: "Floridea", color: "#e64a19", emoji: "🌺", logoUrl: "/loghi/t11.png" },
  ];

  const stores = [
    { id: "s1", tenantId: "t1", name: "Rosàflor", city: "Bassano del Grappa (VI)" },
    { id: "s2", tenantId: "t2", name: "Flover Bussolengo", city: "Bussolengo (VR)" },
    { id: "s3", tenantId: "t2", name: "Flover Verona", city: "Verona" },
    { id: "s14", tenantId: "t2", name: "Flover Desio", city: "Desio (MB)" },
    { id: "s15", tenantId: "t2", name: "Flover Desenzano", city: "Desenzano del Garda (BS)" },
    { id: "s16", tenantId: "t2", name: "Flover Affi", city: "Affi (VR)" },
    { id: "s17", tenantId: "t2", name: "Flover Modena", city: "Modena" },
    { id: "s4", tenantId: "t3", name: "Iperverde", city: "" },
    { id: "s5", tenantId: "t4", name: "Florarici", city: "" },
    { id: "s6", tenantId: "t5", name: "Fasoli Piante", city: "" },
    { id: "s7", tenantId: "t6", name: "Dichio Vivai Garden", city: "Matera" },
    { id: "s8", tenantId: "t7", name: "BIA Home & Garden", city: "" },
    { id: "s9", tenantId: "t8", name: "Il Germoglio", city: "" },
    { id: "s10", tenantId: "t9", name: "Garden Anna", city: "" },
    { id: "s11", tenantId: "t10", name: "Nicora Garden Varese", city: "Varese" },
    { id: "s12", tenantId: "t10", name: "Nicora Garden Gazzada", city: "Gazzada Schianno (VA)" },
    { id: "s13", tenantId: "t11", name: "Floridea", city: "Nervesa della Battaglia (TV)" },
  ];

  const departments = [
    { id: "d1", name: "Piante & Fiori", emoji: "🌸" },
    { id: "d2", name: "Pet", emoji: "🐾" },
    { id: "d3", name: "Décor & Casa", emoji: "🕯️" },
    { id: "d4", name: "Attrezzatura & Giardinaggio", emoji: "🧰" },
    { id: "d5", name: "Casse & Accoglienza", emoji: "🛒" },
  ];

  const users: User[] = [
    { id: "u1", firstName: "Marco", lastName: "Consorti", email: "admin@gardenteam.biz", role: "system_admin", hireDate: daysAgo(2400), points: 0, badges: [], jobTitle: "Direttore Consorzio", active: true },
    { id: "u2", firstName: "Laura", lastName: "Bianchi", email: "l.bianchi@rosaflor.it", role: "group_admin", tenantId: "t1", hireDate: daysAgo(1800), points: 0, badges: [], jobTitle: "HR Rosàflor", active: true },
    { id: "u3", firstName: "Paolo", lastName: "Ferrari", email: "p.ferrari@rosaflor.it", role: "store_admin", tenantId: "t1", storeId: "s1", hireDate: daysAgo(1500), points: 0, badges: [], jobTitle: "Direttore PV Rosàflor", active: true },
    { id: "u4", firstName: "Anna", lastName: "Moretti", email: "a.moretti@rosaflor.it", role: "dept_head", tenantId: "t1", storeId: "s1", departmentId: "d1", hireDate: daysAgo(1200), points: 320, badges: ["primo_corso", "tre_corsi"], jobTitle: "Capo reparto Piante & Fiori", active: true },
    { id: "u5", firstName: "Elena", lastName: "Sartori", email: "e.sartori@gardenteam.biz", role: "course_manager", hireDate: daysAgo(900), points: 0, badges: [], jobTitle: "Formatrice Consorzio", active: true },
    { id: "u6", firstName: "Giulia", lastName: "Rossi", email: "g.rossi@rosaflor.it", role: "student", tenantId: "t1", storeId: "s1", departmentId: "d1", hireDate: daysAgo(25), points: 145, badges: ["primo_corso"], jobTitle: "Addetta vendita (neoassunta)", active: true },
    { id: "u7", firstName: "Luca", lastName: "Verdi", email: "l.verdi@rosaflor.it", role: "student", tenantId: "t1", storeId: "s1", departmentId: "d2", hireDate: daysAgo(700), points: 410, badges: ["primo_corso", "tre_corsi", "quiz_perfetto"], jobTitle: "Addetto reparto Pet", active: true },
    { id: "u8", firstName: "Sara", lastName: "Colombo", email: "s.colombo@rosaflor.it", role: "student", tenantId: "t1", storeId: "s1", departmentId: "d5", hireDate: daysAgo(400), points: 260, badges: ["primo_corso"], jobTitle: "Cassiera", active: true },
    { id: "u9", firstName: "Andrea", lastName: "Rigoni", email: "a.rigoni@flover.it", role: "student", tenantId: "t2", storeId: "s2", departmentId: "d4", hireDate: daysAgo(1000), points: 380, badges: ["primo_corso", "tre_corsi"], jobTitle: "Addetto attrezzatura", active: true },
    { id: "u10", firstName: "Chiara", lastName: "Dalla Valle", email: "c.dallavalle@flover.it", role: "student", tenantId: "t2", storeId: "s3", departmentId: "d1", hireDate: daysAgo(15), points: 40, badges: [], jobTitle: "Addetta vendita (neoassunta)", active: true },
    { id: "u11", firstName: "Matteo", lastName: "Pavan", email: "m.pavan@nicoragarden.it", role: "student", tenantId: "t10", storeId: "s11", departmentId: "d1", hireDate: daysAgo(600), points: 300, badges: ["primo_corso"], jobTitle: "Addetto vendita", active: true },
    { id: "u12", firstName: "Federica", lastName: "Zanetti", email: "f.zanetti@floridea.it", role: "student", tenantId: "t11", storeId: "s13", departmentId: "d3", hireDate: daysAgo(350), points: 220, badges: ["primo_corso"], jobTitle: "Addetta décor", active: true },
    { id: "u13", firstName: "Davide", lastName: "Bortolami", email: "d.bortolami@nicoragarden.it", role: "student", tenantId: "t10", storeId: "s12", departmentId: "d5", hireDate: daysAgo(200), points: 180, badges: ["primo_corso"], jobTitle: "Cassiere", active: true },
    { id: "u14", firstName: "Silvia", lastName: "Gasparini", email: "s.gasparini@dichio.it", role: "student", tenantId: "t6", storeId: "s7", departmentId: "d1", hireDate: daysAgo(450), points: 350, badges: ["primo_corso", "tre_corsi"], jobTitle: "Addetta vendita", active: true },
    { id: "u15", firstName: "Giorgio", lastName: "Tonin", email: "g.tonin@iperverde.it", role: "student", tenantId: "t3", storeId: "s4", departmentId: "d2", hireDate: daysAgo(30), points: 60, badges: [], jobTitle: "Addetto Pet (neoassunto)", active: true },
    { id: "u16", firstName: "Carla", lastName: "Stampini", email: "c.stampini@rosaflor.it", role: "store_admin", tenantId: "t1", storeId: "s1", hireDate: daysAgo(500), points: 0, badges: [], jobTitle: "Addetta ufficio (solo Stampe)", active: true, sites: ["stampe"] },
  ];

  const female = new Set(["u2", "u4", "u6", "u8", "u10", "u12", "u14"]);
  for (const u of users) u.gender = female.has(u.id) ? "f" : "m";

  const courses: Course[] = [
    {
      id: "c1",
      title: "Benvenuti in Garden Team",
      description: "Il corso di onboarding per tutti i nuovi collaboratori: chi siamo, i valori del consorzio, come lavoriamo nei punti vendita.",
      category: "Onboarding",
      emoji: "🚀",
      level: "sistema",
      onlyNewHires: true,
      mandatory: true,
      dueDays: 30,
      passScore: 70,
      points: 100,
      lessons: [
        lezVideo("c1l1", "Il Consorzio Garden Team: chi siamo", 8, "Video di benvenuto del direttore: la storia del consorzio, le 10 insegne associate e i 30 punti vendita distribuiti sul territorio. La forza di fare rete mantenendo l'identità di ogni insegna."),
        lezSlide("c1l2", "I nostri valori e lo stile di servizio", 10, "Passione per il verde, competenza, accoglienza. Il cliente al centro: come salutare, ascoltare, accompagnare all'acquisto. Il decalogo del servizio Garden Team."),
        lezPdf("c1l3", "Manuale del collaboratore", 15, "Il manuale operativo: orari e turni, divisa e cartellino, sicurezza, procedure di base, chi contattare per ogni esigenza. Scaricalo e tienilo sempre a portata di mano."),
        lezTesto("c1l4", "La tua prima settimana", 5, "Cosa aspettarti nei primi giorni: affiancamento con il tutor, giro dei reparti, presentazione della squadra. Alla fine della prima settimana saprai orientarti in autonomia nel punto vendita."),
      ],
      quiz: [
        { id: "c1q1", text: "Quanti punti vendita conta il Consorzio Garden Team?", options: ["Circa 10", "Circa 30", "Circa 60", "Più di 100"], correct: 1 },
        { id: "c1q2", text: "Qual è il principio fondamentale dello stile di servizio Garden Team?", options: ["Vendere il più possibile", "Il cliente al centro", "La velocità alle casse", "Il prezzo più basso"], correct: 1 },
        { id: "c1q3", text: "Cosa è previsto nella prima settimana di lavoro?", options: ["Lavoro in autonomia da subito", "Solo formazione in aula", "Affiancamento con un tutor", "Nessuna attività particolare"], correct: 2 },
      ],
    },
    {
      id: "c2",
      title: "Sicurezza sul lavoro — Formazione base",
      description: "Formazione obbligatoria sulla sicurezza: rischi in negozio e nel vivaio, DPI, movimentazione carichi, emergenze.",
      category: "Sicurezza",
      emoji: "🦺",
      level: "sistema",
      mandatory: true,
      dueDays: 60,
      passScore: 80,
      points: 120,
      lessons: [
        lezVideo("c2l1", "I rischi nel punto vendita", 12, "Panoramica dei rischi tipici del garden center: scivolamenti su superfici bagnate, movimentazione vasi e sacchi, uso di attrezzature, prodotti fitosanitari."),
        lezVideo("c2l2", "DPI e movimentazione carichi", 10, "Quando e come usare guanti, scarpe antinfortunistiche e schienalino. Tecniche corrette di sollevamento: piega le ginocchia, schiena dritta, carico vicino al corpo. Mai superare i limiti: usa il transpallet."),
        lezPdf("c2l3", "Piano di emergenza ed evacuazione", 8, "Le vie di fuga, i punti di raccolta, chi sono gli addetti antincendio e primo soccorso del tuo punto vendita. Cosa fare (e non fare) in caso di allarme."),
      ],
      quiz: [
        { id: "c2q1", text: "Come si solleva correttamente un sacco di terriccio pesante?", options: ["Piegando la schiena in avanti", "Piegando le ginocchia e tenendo la schiena dritta", "Sempre in due persone", "Di slancio, velocemente"], correct: 1 },
        { id: "c2q2", text: "Cosa devi fare appena senti l'allarme di evacuazione?", options: ["Finire di servire il cliente", "Prendere gli effetti personali", "Dirigerti al punto di raccolta dalle vie di fuga", "Usare l'ascensore per fare prima"], correct: 2 },
        { id: "c2q3", text: "Quando vanno indossati i guanti da lavoro?", options: ["Solo in inverno", "Quando si maneggiano piante spinose, prodotti chimici o carichi", "Mai, riducono la sensibilità", "Solo nel vivaio esterno"], correct: 1 },
        { id: "c2q4", text: "Un pavimento bagnato nel reparto piante va…", options: ["Lasciato asciugare da solo", "Segnalato con l'apposito cartello e asciugato appena possibile", "Ignorato, è normale", "Coperto con cartone"], correct: 1 },
      ],
    },
    {
      id: "c3",
      title: "Cura delle piante stagionali",
      description: "Riconoscere, curare e consigliare le piante di stagione: annaffiatura, esposizione, rinvaso e i consigli giusti da dare al cliente.",
      category: "Prodotto",
      emoji: "🌸",
      level: "sistema",
      departments: ["d1"],
      mandatory: false,
      passScore: 70,
      points: 90,
      lessons: [
        lezVideo("c3l1", "Le stagionali di primavera-estate", 15, "Gerani, surfinie, dipladenie, basilico e aromatiche: esigenze di acqua, luce e concimazione. Come mantenerle belle in negozio e come presentarle al cliente."),
        lezVideo("c3l2", "Annaffiatura e concimazione in reparto", 10, "Il giro d'acqua mattutino: quali piante prima, come controllare il terriccio, segnali di stress idrico. Concimazione settimanale e rimozione fiori appassiti."),
        lezTesto("c3l3", "I consigli al cliente", 8, "Le tre domande da fare sempre: dove va la pianta (sole/ombra, dentro/fuori)? Quanto tempo può dedicarle? Ha animali domestici? Da qui parte il consiglio giusto — e la vendita del prodotto complementare corretto (terriccio, concime, vaso)."),
      ],
      quiz: [
        { id: "c3q1", text: "Qual è il momento migliore per il giro d'acqua in reparto?", options: ["A fine giornata", "Al mattino presto", "Nelle ore più calde", "Solo quando le piante appassiscono"], correct: 1 },
        { id: "c3q2", text: "Un cliente cerca una pianta per un balcone in pieno sole: cosa consigli?", options: ["Un'orchidea", "Una felce", "Gerani o surfinie", "Un ciclamino"], correct: 2 },
        { id: "c3q3", text: "Perché rimuovere i fiori appassiti?", options: ["Solo per estetica", "Per stimolare nuove fioriture e prevenire malattie", "Non serve", "Per risparmiare acqua"], correct: 1 },
      ],
    },
    {
      id: "c4",
      title: "Vendita assistita e accoglienza cliente",
      description: "Le tecniche di vendita assistita nel garden center: accoglienza, ascolto, proposta, vendita complementare e gestione delle obiezioni.",
      category: "Vendita",
      emoji: "🤝",
      level: "sistema",
      mandatory: true,
      dueDays: 90,
      passScore: 70,
      points: 100,
      lessons: [
        lezVideo("c4l1", "L'accoglienza: i primi 10 secondi", 9, "Il saluto entro pochi secondi dall'ingresso nel reparto, il contatto visivo, la disponibilità senza pressione. La differenza tra 'Posso aiutarla?' e una domanda aperta ben posta."),
        lezSlide("c4l2", "Ascolto e proposta", 12, "Capire il bisogno reale con domande aperte. Proporre massimo 2-3 alternative, spiegando i benefici e non solo le caratteristiche. Il metodo CVB: Caratteristica → Vantaggio → Beneficio."),
        lezVideo("c4l3", "Vendita complementare", 8, "Ogni pianta venduta ha i suoi complementari naturali: terriccio, vaso, sottovaso, concime. Come proporli in modo utile per il cliente e non come forzatura."),
      ],
      quiz: [
        { id: "c4q1", text: "Entro quanto tempo va salutato un cliente che entra nel reparto?", options: ["Pochi secondi", "Un minuto", "Cinque minuti", "Solo se chiede aiuto"], correct: 0 },
        { id: "c4q2", text: "Quante alternative è meglio proporre a un cliente indeciso?", options: ["Una sola", "2-3", "Almeno 5", "Tutte quelle disponibili"], correct: 1 },
        { id: "c4q3", text: "Nel metodo CVB, la 'B' sta per…", options: ["Bonus", "Beneficio", "Budget", "Bisogno"], correct: 1 },
      ],
    },
    {
      id: "c5",
      title: "Standard espositivi Rosàflor",
      description: "Le linee guida visual dell'insegna Rosàflor: layout dei banchi, cartellonistica, cura dell'esposizione e rotazioni stagionali.",
      category: "Visual",
      emoji: "🖼️",
      level: "insegna",
      tenantId: "t1",
      mandatory: true,
      dueDays: 45,
      passScore: 70,
      points: 80,
      lessons: [
        lezSlide("c5l1", "Il layout Rosàflor", 10, "La struttura standard del punto vendita Rosàflor: percorso cliente, zone promozionali, testate di gondola. Le foto-modello da replicare."),
        lezPdf("c5l2", "Cartellonistica e prezzatura", 7, "I formati ufficiali dei cartelli prezzo e promo Rosàflor, come e dove posizionarli. Regola d'oro: ogni prodotto esposto ha sempre il suo prezzo visibile."),
      ],
      quiz: [
        { id: "c5q1", text: "Qual è la regola d'oro della prezzatura Rosàflor?", options: ["I prezzi si mettono solo in promozione", "Ogni prodotto esposto ha sempre il prezzo visibile", "Il prezzo si comunica a voce", "Solo i prodotti sopra 10€ vanno prezzati"], correct: 1 },
        { id: "c5q2", text: "Le testate di gondola sono dedicate a…", options: ["Prodotti invenduti", "Promozioni e prodotti stagionali", "Materiale di magazzino", "Prodotti di importazione"], correct: 1 },
      ],
    },
    {
      id: "c6",
      title: "Programma fedeltà Rosàflor Card",
      description: "Come funziona la Rosàflor Card: iscrizione del cliente in cassa, punti, premi e promozioni riservate.",
      category: "Casse",
      emoji: "💳",
      level: "insegna",
      tenantId: "t1",
      departments: ["d5"],
      mandatory: true,
      dueDays: 30,
      passScore: 80,
      points: 70,
      lessons: [
        lezVideo("c6l1", "Iscrivere un cliente in cassa", 6, "La procedura di iscrizione alla Rosàflor Card in cassa: dati necessari, consenso privacy, consegna della card. Obiettivo: proporre la card a ogni cliente non ancora iscritto."),
        lezTesto("c6l2", "Punti, soglie e premi", 6, "1€ = 1 punto. Le soglie premio: 200, 500 e 1000 punti. Le promozioni riservate ai titolari card e i punti doppi negli eventi stagionali. Come rispondere alle domande più frequenti dei clienti."),
      ],
      quiz: [
        { id: "c6q1", text: "Quanto vale 1€ di spesa in punti Rosàflor Card?", options: ["0,5 punti", "1 punto", "2 punti", "10 punti"], correct: 1 },
        { id: "c6q2", text: "Cosa serve per iscrivere un cliente alla card?", options: ["Solo il numero di telefono", "Dati anagrafici e consenso privacy", "Un documento d'identità in fotocopia", "Niente, è automatico"], correct: 1 },
      ],
    },
    {
      id: "c7",
      title: "Procedure apertura e chiusura — Rosàflor",
      description: "Le procedure operative specifiche del punto vendita Rosàflor: allarme, casse, serre, impianto di irrigazione.",
      category: "Operations",
      emoji: "🔑",
      level: "punto_vendita",
      tenantId: "t1",
      storeId: "s1",
      mandatory: false,
      passScore: 70,
      points: 60,
      lessons: [
        lezTesto("c7l1", "Apertura del punto vendita", 8, "Sequenza di apertura: disattivazione allarme, accensione luci e casse, controllo serre e irrigazione notturna, giro di controllo reparti prima dell'apertura al pubblico alle 8:30."),
        lezTesto("c7l2", "Chiusura del punto vendita", 8, "Sequenza di chiusura: verifica clienti in negozio e area esterna, chiusura casse, spegnimento impianti, attivazione irrigazione notturna programmata, inserimento allarme."),
      ],
      quiz: [
        { id: "c7q1", text: "A che ora apre al pubblico il punto vendita?", options: ["8:00", "8:30", "9:00", "9:30"], correct: 1 },
        { id: "c7q2", text: "Cosa va attivato alla chiusura serale?", options: ["Le luci del vivaio", "L'irrigazione notturna programmata e l'allarme", "La filodiffusione", "Niente di particolare"], correct: 1 },
      ],
    },
    {
      id: "c8",
      title: "Alimentazione e cura del Pet",
      description: "Le basi dell'alimentazione di cani, gatti e piccoli animali: leggere le etichette, consigliare il prodotto giusto, normativa di reparto.",
      category: "Prodotto",
      emoji: "🐾",
      level: "sistema",
      departments: ["d2"],
      mandatory: false,
      passScore: 70,
      points: 90,
      lessons: [
        lezVideo("c8l1", "Leggere l'etichetta del pet food", 12, "Ingredienti, analisi garantita, razione giornaliera: come interpretare l'etichetta e spiegarla al cliente. Differenze tra alimenti fisiologici e dietetici."),
        lezVideo("c8l2", "Il consiglio giusto per ogni età", 10, "Puppy/kitten, adult, senior: le esigenze nutrizionali nelle fasi di vita. Le domande da fare al cliente: età, taglia, stile di vita, sensibilità alimentari."),
        lezPdf("c8l3", "Normativa e cartellini di reparto", 6, "Le regole di esposizione e vendita degli alimenti per animali, la rotazione delle scadenze e il registro di reparto."),
      ],
      quiz: [
        { id: "c8q1", text: "Cosa indica l''analisi garantita' sull'etichetta?", options: ["Il prezzo consigliato", "I valori nutrizionali minimi/massimi del prodotto", "La data di scadenza", "Il paese di origine"], correct: 1 },
        { id: "c8q2", text: "Quali domande fare per consigliare un alimento?", options: ["Solo la marca preferita", "Età, taglia, stile di vita e sensibilità dell'animale", "Il budget disponibile", "Il colore della confezione preferito"], correct: 1 },
      ],
    },
  ];

  courses.push({
    id: "c9",
    title: "Tappeti erbosi",
    description:
      "Dal corso GT Academy con il prof. Stefano Macolino (Università di Padova): specie, realizzazione, prato in rotoli, cure colturali e difesa del tappeto erboso.",
    category: "Prodotto",
    emoji: "🌱",
    level: "sistema",
    departments: ["d1"],
    mandatory: false,
    passScore: 70,
    points: 90,
    coverUrl: "/uploads/cover_tappeto_erboso.png",
    lessons: [
      lezVideo("c9l1", "Le specie del tappeto erboso", 15, "Microterme, macroterme e miscugli: come riconoscerle e quando proporle. Le microterme (loietto, festuca, poa) per i climi del nord, le macroterme (gramigna, zoysia) per zone calde e assolate."),
      lezVideo("c9l2", "Realizzazione e prato in rotoli", 12, "Come si realizza un tappeto erboso con focus sul giardino di casa: preparazione del terreno, semina, prime cure. Prato in rotoli: vantaggi e svantaggi, posa corretta delle zolle."),
      lezTesto("c9l3", "Cure colturali: taglio, irrigazione, concimazione", 10, "Le regole d'oro: mai asportare più di 1/3 della foglia a ogni taglio, irrigare in profondità ma di rado, concimare seguendo le stagioni di crescita. I consigli pratici da dare al cliente."),
      lezTesto("c9l4", "Malattie e infestanti", 8, "Riconoscere le principali malattie fungine e le infestanti del prato; prevenzione con le corrette pratiche colturali e prodotti da consigliare in negozio."),
    ],
    quiz: [
      { id: "c9q1", text: "Quale tra queste è una specie microterma?", options: ["Gramigna (Cynodon dactylon)", "Loietto perenne (Lolium perenne)", "Zoysia japonica", "Paspalum"], correct: 1 },
      { id: "c9q2", text: "Qual è il principale vantaggio del prato in rotoli?", options: ["Costa meno della semina", "Effetto immediato e meno infestanti in fase d'impianto", "Non richiede irrigazione", "Non va mai concimato"], correct: 1 },
      { id: "c9q3", text: "Regola generale per il taglio del prato:", options: ["Tagliare più corto possibile", "Non asportare più di 1/3 dell'altezza della foglia", "Tagliare solo d'estate", "Tagliare con erba bagnata"], correct: 1 },
    ],
  });

  const paths = [
    {
      id: "p1",
      title: "Onboarding Neoassunti",
      description: "Il percorso di ingresso per ogni nuovo collaboratore Garden Team: chi siamo, sicurezza e stile di vendita.",
      emoji: "🚀",
      courseIds: ["c1", "c2", "c4"],
      level: "sistema" as const,
      onlyNewHires: true,
    },
    {
      id: "p2",
      title: "Percorso Reparto Verde",
      description: "Il percorso di specializzazione per gli addetti del reparto Piante & Fiori.",
      emoji: "🌸",
      courseIds: ["c3", "c4"],
      level: "sistema" as const,
      departments: ["d1"],
    },
  ];

  const done = (userId: string, courseId: string, score: number, daysAgoN: number): Progress => {
    const c = courses.find((x) => x.id === courseId)!;
    return {
      userId,
      courseId,
      completedLessons: c.lessons.map((l) => l.id),
      quizScore: score,
      quizPassed: true,
      completedAt: new Date(Date.now() - daysAgoN * 86400000).toISOString(),
    };
  };

  const progress: Progress[] = [
    // Giulia (u6): onboarding in corso
    done("u6", "c1", 100, 10),
    { userId: "u6", courseId: "c2", completedLessons: ["c2l1", "c2l2"] },
    { userId: "u6", courseId: "c3", completedLessons: ["c3l1"] },
    // Luca (u7)
    done("u7", "c2", 100, 120),
    done("u7", "c4", 85, 90),
    done("u7", "c8", 90, 60),
    done("u7", "c5", 100, 30),
    // Sara (u8)
    done("u8", "c2", 80, 200),
    done("u8", "c6", 90, 100),
    { userId: "u8", courseId: "c4", completedLessons: ["c4l1"] },
    // Andrea (u9)
    done("u9", "c2", 85, 300),
    done("u9", "c4", 75, 250),
    done("u9", "c5", 80, 100),
    // Anna (u4)
    done("u4", "c2", 90, 400),
    done("u4", "c3", 100, 200),
    done("u4", "c4", 85, 350),
    // Matteo (u11)
    done("u11", "c2", 80, 150),
    done("u11", "c3", 75, 100),
    // Federica (u12)
    done("u12", "c2", 85, 120),
    { userId: "u12", courseId: "c4", completedLessons: ["c4l1", "c4l2"] },
    // Davide (u13)
    done("u13", "c2", 80, 80),
    // Silvia (u14)
    done("u14", "c2", 95, 200),
    done("u14", "c3", 85, 150),
    done("u14", "c4", 80, 100),
    // Giorgio (u15): neoassunto in corso
    { userId: "u15", courseId: "c1", completedLessons: ["c1l1", "c1l2"] },
  ];

  const certificates = progress
    .filter((p) => p.completedAt)
    .map((p, i) => ({
      id: `cert${i + 1}`,
      userId: p.userId,
      courseId: p.courseId,
      issuedAt: p.completedAt!,
    }));

  const emails = [
    { id: "e1", userId: "u6", to: "g.rossi@rosaflor.it", subject: "Benvenuta in Academy GT, Giulia!", body: "Il tuo account è attivo: trovi già assegnato il percorso Onboarding Neoassunti da completare entro 30 giorni.", type: "benvenuto" as const, date: new Date(Date.now() - 25 * 86400000).toISOString(), status: "inviata" as const },
    { id: "e2", userId: "u6", to: "g.rossi@rosaflor.it", subject: "🎉 Hai completato «Benvenuti in Garden Team»", body: "Complimenti! Il certificato è disponibile nella tua area personale.", type: "completamento" as const, date: new Date(Date.now() - 10 * 86400000).toISOString(), status: "inviata" as const },
    { id: "e3", userId: "u15", to: "g.tonin@iperverde.it", subject: "⏰ Promemoria: corsi da completare", body: "Hai 3 corsi obbligatori in attesa: Benvenuti in Garden Team, Sicurezza sul lavoro, Vendita assistita.", type: "promemoria" as const, date: new Date(Date.now() - 3 * 86400000).toISOString(), status: "inviata" as const },
  ];

  const feedback = [
    { id: "f1", userId: "u7", courseId: "c8", rating: 5, comment: "Corso molto utile, finalmente so spiegare le etichette ai clienti!", date: daysAgo(55) },
    { id: "f2", userId: "u4", courseId: "c3", rating: 4, comment: "Bello, aggiungerei una parte sulle piante da interno.", date: daysAgo(190) },
    { id: "f3", userId: "u8", courseId: "c6", rating: 5, comment: "Chiaro e veloce, perfetto da fare tra un turno e l'altro.", date: daysAgo(95) },
    { id: "f4", userId: "u11", courseId: "c3", rating: 4, comment: "Video ben fatti. Utile il capitolo sui consigli al cliente.", date: daysAgo(90) },
  ];

  const groups = [
    { id: "g1", name: "Referenti sicurezza", emoji: "🦺" },
    { id: "g2", name: "Squadra eventi Rosàflor", emoji: "🎪", tenantId: "t1" },
  ];

  return { settings: { ...DEFAULT_SETTINGS }, tenants, stores, departments, groups, users, courses, paths, progress, certificates, feedback, emails, templates: [], customTemplates: [], registrations: [] };
}
