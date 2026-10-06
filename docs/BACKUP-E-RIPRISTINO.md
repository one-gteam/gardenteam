# Backup e ripristino di GT One / Academy GT

## Cosa viene salvato, quando, dove

| Cosa | Come | Quando | Dove |
|---|---|---|---|
| **Dati** (tabella `app_data` di Supabase: una riga per dominio — `academy`, `zoo`, `stampe`, `articoli`, `tentativi`) | `scripts/backup-database.mjs` | ogni notte alle **01:30** (Utilità di pianificazione di Windows sul server AI) | `\\srvdoc\ai\backup\academy-gt-backup-AAAA-MM-GG-HH-MM\tabelle.json.gz` |
| **File** (foto prodotti, loghi, sfondi cartelli, copertine corsi, allegati articoli…) | stesso script | stessa notte | `…\storage\academy-gt\…` |
| **Account di login** (solo elenco: email e date, nessuna password) | stesso script | stessa notte | `…\account-login.json` |
| **Codice** | `scripts/backup-git.ps1` + i commit normali | ogni notte, se ci sono modifiche non salvate | GitHub (`origin/main`) |

- Ogni notte nasce **una cartella nuova**; quelle più vecchie di **60 giorni** si cancellano da sole.
- Lo **schema** delle tabelle è in `data/supabase-schema.sql` (non cambia di notte in notte).
- Il backup prende l'elenco di tabelle e bucket dal database **a ogni esecuzione**: un dominio o un bucket nuovi finiscono nel backup senza toccare nulla.

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
