-- Schema Supabase per Academy GT (Academy + Stampe Arredo + Stampe ZOO).
-- Da eseguire UNA VOLTA nel SQL editor del progetto Supabase (Project → SQL Editor → New query).
--
-- Approccio scelto: ogni dominio resta UN SOLO record JSONB, con la stessa forma
-- dei file data/db.json / data/stampe.json / data/zoo.json di oggi. Questo evita di
-- riscrivere tutta la logica applicativa (che già lavora su quell'oggetto in memoria)
-- e riduce al minimo il rischio della migrazione: solo le funzioni di lettura/scrittura
-- del file (getDb/saveDb, getStampeDb/saveStampeDb, getZooDb/saveZooDb) cambiano da
-- fs.readFileSync/writeFileSync a una select/update su queste tabelle.
--
-- Non è una scelta "provvisoria": per i volumi di questo progetto (poche centinaia di
-- prodotti/utenti, uso da un gruppo ristretto di persone) un blob JSONB per dominio
-- si comporta in modo identico a un file, con il vantaggio di essere condiviso e
-- persistente su Vercel. Una normalizzazione in tabelle vere si può fare in futuro
-- se il volume di dati crescerà molto, senza toccare le pagine dell'app.

create table if not exists app_data (
  domain text primary key,        -- 'academy' | 'stampe' | 'zoo'
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Riga vuota di partenza per ciascun dominio (il codice fa upsert quindi
-- questi insert sono solo comodità: puoi anche saltarli e lasciare che la
-- prima chiamata dell'app crei la riga).
insert into app_data (domain, data) values ('academy', '{}'::jsonb) on conflict (domain) do nothing;
insert into app_data (domain, data) values ('stampe', '{}'::jsonb) on conflict (domain) do nothing;
insert into app_data (domain, data) values ('zoo', '{}'::jsonb) on conflict (domain) do nothing;

-- Row Level Security: l'app parla con Supabase solo dal server (service_role key,
-- mai esposta al browser), quindi blocchiamo completamente l'accesso via chiave
-- pubblica (anon) e lasciamo che solo la service_role (che bypassa RLS) possa
-- leggere/scrivere.
alter table app_data enable row level security;

-- Storage: un bucket unico per tutti i file caricati dall'app (foto prodotti zoo,
-- sfondi cartelli, loghi, immagini layout, copertine corsi...). Pubblico in lettura
-- (le immagini devono essere visibili nei cartelli/nelle pagine senza autenticazione),
-- scrittura solo da service_role.
insert into storage.buckets (id, name, public)
values ('academy-gt', 'academy-gt', true)
on conflict (id) do nothing;
