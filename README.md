# 🌿 Academy GT — LMS Consorzio Garden Team

Prototipo funzionante della piattaforma di formazione descritta in
`../Academy-GT-Specifica-Funzionale.md`.

## Avvio

```bash
npm install
npm run dev -- -p 3210
```

Poi apri http://localhost:3210 — dalla pagina di login scegli un profilo demo
(amministratore di sistema, di insegna, di punto vendita, gestore corsi, capo reparto o studente).

## Cosa è implementato

- **Gerarchia multi-livello**: Consorzio → 3 insegne → 6 punti vendita → 5 reparti
- **6 ruoli** con ambiti di visibilità distinti (l'admin di insegna vede solo la sua insegna, ecc.)
- **Dashboard studente** con le tre sezioni (sistema / insegna / punto vendita), scadenze, percorsi
- **Assegnazione automatica dei corsi** per reparto, insegna, punto vendita e stato neoassunto (< 90 giorni)
- **Percorsi formativi** multi-modulo con avanzamento
- **Player corso** (video/slide/PDF/testo demo) con completamento lezioni
- **Quiz** con soglia di superamento, tentativi illimitati, punteggio
- **Certificati** automatici al completamento, con pagina stampabile
- **Gamification**: punti, badge, classifica di negozio e sfida tra punti vendita
- **Feedback** di gradimento a fine corso
- **Backend admin**: KPI, conformità per PV, gestione utenti, import CSV massivo,
  creazione corsi, report (corsi più seguiti, solleciti obbligatori, dettaglio PV)

## Dati demo

I dati vivono in `data/db.json`, generato al primo avvio da `src/lib/seed.ts`.
Per ripartire da zero: **elimina `data/db.json`** e ricarica la pagina.

## Dati reali

Le insegne e i punti vendita sono quelli reali del Consorzio Garden Team (fonte gardenteam.biz,
esclusi Rauch, Viridea e Coretto) più Nicora Garden e Floridea. I collaboratori sono fittizi.
Le città non pubblicate sui siti sono lasciate vuote: completarle in `src/lib/seed.ts`.

## Limiti del prototipo (per la versione di produzione)

- Login demo a selezione profilo → sostituire con credenziali/SSO (piano: Supabase Auth condiviso con
  my.rosaflor.it/Presenze; flag `active` già implementato per bloccare i cessati)
- Persistenza su file JSON → sostituire con database (PostgreSQL/Supabase)
- Video/PDF segnaposto → collegare storage reale (Bunny Stream / Vimeo per i video)
- Email: la pagina Email registra le automazioni ma non spedisce → collegare Resend/Brevo + cron notturno
- Niente API esterne / sync HR → previste nella specifica, sezioni 4 e 16
