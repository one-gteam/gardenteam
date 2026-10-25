# Backup e ripristino di GT One / Academy GT

## Il modo più semplice: il «Pannello GT One» (25/10/2026)

Sul desktop del PC AI c'è **Pannello GT One** (`C:\GTOneDati\pannello_gtone.pyw`, copia nel progetto in
`strumenti\pannello\`). È il gemello dei Pannelli Linfa e my.rosaflor e funziona anche se il sito è giù:

| Scheda | A cosa serve |
|---|---|
| **Stato** | Il sito risponde? È in linea l'ultima versione? C'è il backup di stanotte? La copia completa è recente? Le attività pianificate girano? La chiave delle copie c'è? |
| **Sito: versioni** | Tornare con un clic a una versione precedente se un aggiornamento ha rotto qualcosa, e poi «Rimetti l'ultima». |
| **Dati** | Backup adesso, copia completa adesso, e rimettere **un'area** (zoo, academy, stampe…) da un backup: prima «Prova (non scrive)», poi «Rimetti l'area dal backup…»; anche i file (foto). |
| **Chiavetta** | Copia **cifrata** (AES-256, la stessa chiave di my.rosaflor) dell'ultimo backup e dell'ultima copia completa su una chiavetta USB, in `GTOneBackup\<data>\`, riaperta per verifica. Si apre su qualunque PC Windows con «APRI LA COPIA» e la chiave del foglio in cassaforte (impronta 8F0E5DACDC89). La chiave non va mai sulla chiavetta. |
| **Istruzioni** | Cosa si salva, quando, dove, cosa controllare e cosa fare se va storto, in parole semplici; pulsante per pianificare la copia completa ogni domenica. |

**Le chiavi** (`.env.local`: Supabase, segreti dei cookie, Zoho, Vercel) dal 25/10/2026 stanno sul disco
locale del PC AI, in `C:\GTOneDati\segreti\.env.local` (solo amministratori e AI\admin), non più nella cartella
di rete, come per Linfa e my.rosaflor. Lo spostamento lo fa `C:\GTOneDati\installa.ps1` (da lanciare una volta come
amministratore; copia in `strumenti\pannello\`): fa leggere al backup notturno la copia locale, crea «GT One - Copia
completa» ogni domenica alle 05:00, toglie la copia dalla rete se identica e fa approvare i cambi al guardiano.
Da allora i comandi a mano si lanciano con `--env-file="C:\GTOneDati\segreti\.env.local"` al posto di `--env-file=.env.local`.

La copia su chiavetta la fa `C:\SicurezzaDati\copia-esterna.mjs chiavetta-gtone <cartella>` (stesso
programma della copia fuori sede notturna). Prova del 25/10/2026: 156 MB di dati + 72 MB di copia del sito,
riaperti «come su un altro PC» chiedendo la chiave.

## Cosa viene salvato, quando, dove

| Cosa | Come | Quando | Dove |
|---|---|---|---|
| **Dati** (tabella `app_data` di Supabase: una riga per dominio — `academy`, `zoo`, `stampe`, `articoli`, `tentativi`) | `scripts/backup-database.mjs` | ogni notte alle **02:30** (attività «GT One - Backup Database» sul PC AI; la cartella prende il nome delle 01:30 UTC) | `\\srvdoc\ai\backup\academy-gt-backup-AAAA-MM-GG-HH-MM\tabelle.json.gz` |
| **File** (foto prodotti, loghi, sfondi cartelli, copertine corsi, allegati articoli…) | stesso script | stessa notte | `…\storage\academy-gt\…` |
| **Account di login** (solo elenco: email e date, nessuna password) | stesso script | stessa notte | `…\account-login.json` |
| **Codice** | `scripts/backup-git.ps1` + i commit normali | ogni notte, se ci sono modifiche non salvate | GitHub (`origin/main`) |

- Ogni notte nasce **una cartella nuova**; quelle più vecchie di **60 giorni** si cancellano da sole.
- Lo **schema** delle tabelle è in `data/supabase-schema.sql` (non cambia di notte in notte).
- Il backup prende l'elenco di tabelle e bucket dal database **a ogni esecuzione**: un dominio o un bucket nuovi finiscono nel backup senza toccare nulla.

## Copia completa del sito (codice + chiavi + dati) su `\\srvdoc\ai_backup\gtone`

`scripts\copia-sito.ps1` mette in una cartella sola tutto quello che serve per rimettere in piedi il sito da zero:
`codice.bundle` (tutto il repository git), `segreti\env.local` (le chiavi: **non condividere**), `dati\` (l'ultimo
backup notturno di database e file), `manifest.json` e un `LEGGIMI.md` con i passi del ripristino. Tiene le ultime 6 copie.

```bash
powershell -ExecutionPolicy Bypass -File scripts\copia-sito.ps1
```

Conviene pianificarla una volta a settimana sul server AI (Utilità di pianificazione → nuova attività → Azione
`powershell.exe`, Argomenti `-ExecutionPolicy Bypass -File "\\srvdoc\ai\Progetti AI\Academy GT\academy-gt\scripts\copia-sito.ps1"`),
dopo il backup notturno, es. alle 05:00 della domenica.

Prima copia fatta: 6 ottobre 2026 (77,7 MB), bundle riaperto con `git clone` per prova.

## Controllare che il backup stia girando

1. Apri `\\srvdoc\ai\backup` e ordina per data: deve esserci una cartella `academy-gt-backup-…` con la data di **stanotte**.
2. Dentro devono esserci `tabelle.json.gz` (qualche centinaio di KB) e la cartella `storage\academy-gt` con le foto.
3. Se manca la cartella di stanotte: sul server AI, Utilità di pianificazione → attività del backup → *Ultimo risultato* ed *Esegui*. Oppure lancialo a mano (sotto).

Lanciare il backup a mano (da un PC con la cartella del progetto):

```bash
node --env-file=.env.local scripts/backup-database.mjs
```

Ultima verifica fatta: 6 ottobre 2026 — backup delle 01:30 presente, 5 domini, 692 file, 72 MB.

## Ripristinare

Serve la cartella del progetto con `.env.local` (contiene le chiavi di Supabase). Lo script **non scrive nulla finché non si aggiunge `--esegui`**: la prima volta lancialo senza, per leggere cosa farebbe.

### 1. Solo i dati di un'area (il caso più comune: «abbiamo cancellato le offerte per sbaglio»)

```bash
node --env-file=.env.local scripts/ripristina-database.mjs "\\srvdoc\ai\backup\academy-gt-backup-2026-10-06-01-30" --dominio zoo
```

Controlla il riepilogo (dimensione e data della riga nel backup contro quella attuale), poi:

```bash
node --env-file=.env.local scripts/ripristina-database.mjs "\\srvdoc\ai\backup\academy-gt-backup-2026-10-06-01-30" --dominio zoo --esegui
```

Domini: `zoo` (Offerte Zoo: prodotti, padri, volantini, offerte, voti, layout), `stampe` (Cartelli Arredo e impostazioni di stampa), `academy` (utenti, insegne, PV, corsi, percorsi, email), `articoli`, `tentativi` (tentativi di accesso).

### 2. Tutti i dati

Senza `--dominio` ripristina tutte le righe presenti nel backup.

### 3. Anche i file (foto, loghi, sfondi)

```bash
node --env-file=.env.local scripts/ripristina-database.mjs "<cartella>" --storage --esegui
```

Carica tutti i file del backup nel bucket, sovrascrivendo quelli con lo stesso nome. Le foto perse si possono anche ricaricare a mano dal sito (Offerte in corso → Caricamento foto).

### 4. Il codice

Il codice è su GitHub: `git clone` (o `git pull`) e `npx vercel --prod --yes` per rimetterlo online. Le variabili d'ambiente (chiavi Supabase, segreti, chiave Claude) sono nelle impostazioni del progetto Vercel: non stanno nel backup, tienile anche nel gestore password.

### Cosa succede durante il ripristino

- Prima di scrivere, lo script salva le righe **attuali** in `data/prima-del-ripristino-<data>/`: se il ripristino era sbagliato, si rilancia puntando a quelle.
- Il sito tiene una copia dei dati in memoria, ma controlla la data di aggiornamento a ogni lettura: **vede i dati ripristinati subito**, senza riavvii.
- Chi sta lavorando sul sito in quel momento, al salvataggio successivo, scrive sopra i dati appena ripristinati: fai il ripristino quando nessuno ci lavora, o avvisa.

## Limiti da sapere

- Il piano Supabase gratuito non ha backup scaricabili né «point in time»: questo backup notturno è l'unica copia. Un errore fatto alle 10 del mattino si recupera al massimo dallo stato dell'1:30 della notte prima.
- Le **password** degli utenti sono dentro `app_data` (dominio `academy`, cifrate): un ripristino del dominio `academy` rimette anche quelle del momento del backup.
- Il backup sta su un solo server (`\\srvdoc`). Una copia periodica della cartella su un disco esterno o su un cloud è una buona idea, ma va fatta a parte.
