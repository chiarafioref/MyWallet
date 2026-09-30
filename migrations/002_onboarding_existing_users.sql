-- Il tutorial va mostrato solo ai nuovi utenti. La colonna è nata con default false, quindi
-- anche gli utenti già registrati risultavano "da introdurre": li si segna come già visti.
-- Da eseguire una sola volta, dopo DB.sql.

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

update public.profiles
  set onboarding_completed = true
  where onboarding_completed = false;
