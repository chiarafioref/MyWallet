-- =============================================================================
-- MyWallet — DEMO (una copia privata dei dati di mockup per ogni visitatore)
-- =============================================================================
-- Prerequisiti:
--   1. DB.sql già eseguito.
--   2. Dashboard → Authentication → Sign In / Providers →
--      "Allow anonymous sign-ins" ATTIVO.
--
-- Poi incolla ed esegui questo file nell'SQL Editor. È idempotente: si può
-- rieseguire in sicurezza (ricrea funzioni, trigger e job).
--
-- Come funziona:
--   - "Prova la demo" nel login fa signInAnonymously(): ogni visitatore è un
--     utente anonimo a sé, quindi le policy RLS già esistenti lo isolano dagli
--     altri visitatori (non vede nulla di ciò che fanno gli altri).
--   - Subito dopo il client chiama l'RPC public.start_demo(), che carica il
--     dataset di mockup (demo.seed_data) sul nuovo utente.
--   - Le date sono relative a oggi: l'anno di storico finisce sempre nel mese
--     corrente, quindi dashboard e statistiche sono sempre "vive".
--   - pg_cron (l'"event scheduler" di PostgreSQL) ogni 5 minuti elimina gli
--     utenti demo creati da più di 30 minuti: i loro dati spariscono a cascata.
--
-- Le funzioni di servizio stanno nello schema `demo`, NON esposto dalle API
-- di Supabase: l'unico punto d'ingresso dal client è public.start_demo().
-- =============================================================================


-- 0. SCHEMA PRIVATO -----------------------------------------------------------
create schema if not exists demo;
revoke all on schema demo from public, anon, authenticated;


-- 1. COMPAGNI DI VIAGGIO ------------------------------------------------------
-- Tre utenti "comparsa" per il viaggio condiviso. Non possono fare login
-- (password vuota): esistono solo perché trip_members/trip_expenses
-- referenziano auth.users. Il trigger on_auth_user_created crea il profilo.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('giulia.demo@mywallet.app', 'Giulia', 'Bianchi'),
      ('luca.demo@mywallet.app',   'Luca',   'Ferri'),
      ('sara.demo@mywallet.app',   'Sara',   'Conti')
    ) as t(email, first_name, last_name)
  loop
    if not exists (select 1 from auth.users where email = r.email) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        -- stringhe vuote e non NULL: GoTrue va in errore sui NULL
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated', 'authenticated', r.email, '',
        now(), '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name),
        now(), now(), '', '', '', ''
      );
    end if;
  end loop;
end $$;


-- 2. HELPER -------------------------------------------------------------------

-- Importo casuale tra a e b (2 decimali).
create or replace function demo.rnd(a numeric, b numeric)
returns numeric
language sql
volatile
as $$ select round((a + random() * (b - a))::numeric, 2) $$;

-- Giorno p_day del mese p_month (limitato all'ultimo giorno del mese).
create or replace function demo.day(p_month date, p_day int)
returns date
language sql
immutable
as $$
  select p_month + (least(p_day,
    extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int) - 1)
$$;

-- Elemento casuale di un array di testo.
create or replace function demo.pick(arr text[])
returns text
language sql
volatile
as $$ select arr[1 + floor(random() * array_length(arr, 1))::int] $$;

-- Inserisce una transazione dell'utente demo; salta le date future.
create or replace function demo.add_tx(
  p_uid    uuid,
  p_date   date,
  p_title  text,
  p_amount numeric,
  p_cat    text,
  p_type   text default 'USCITA',
  p_method text default 'CARTA',
  p_desc   text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_date > current_date then
    return null;
  end if;

  insert into public.transactions
    (user_id, title, amount, category_id, category_name, type, tx_date, description, payment_method)
  values (
    p_uid, p_title, p_amount,
    (select id from public.categories
      where user_id = p_uid and name = p_cat
        and kind = case when p_type = 'ENTRATA' then 'income' else 'expense' end),
    p_cat, p_type, p_date, p_desc, p_method
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Crea un abbonamento e le transazioni già addebitate fino a oggi.
-- next_payment_date = prima scadenza futura: così il client
-- (subscriptions.js → generateSubscriptions) non genera duplicati.
create or replace function demo.add_subscription(
  p_uid       uuid,
  p_name      text,
  p_amount    numeric,
  p_cat       text,
  p_frequency text,       -- 'MENSILE' | 'ANNUALE'
  p_start     date,
  p_paused    boolean default false,
  p_regular   numeric default null,   -- prezzo pieno dopo la promo
  p_promo_end date    default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_months int := case when p_frequency = 'ANNUALE' then 12 else 1 end;
  v_sub    uuid;
  v_due    date := p_start;
  v_k      int  := 0;
  v_title  text := upper(left(p_name, 1)) || lower(substring(p_name from 2));
begin
  insert into public.subscriptions
    (user_id, name, amount, category_id, category_name, payment_method,
     frequency, interval_months, next_payment_date, start_date, is_paused,
     promo, promo_end_date, regular_amount)
  values (
    p_uid, p_name, p_amount,
    (select id from public.categories where user_id = p_uid and name = p_cat and kind = 'expense'),
    p_cat, 'CARTA', p_frequency, v_months, p_start, p_start, p_paused,
    p_regular is not null, p_promo_end, p_regular
  )
  returning id into v_sub;

  if p_paused then
    update public.subscriptions
      set next_payment_date = (current_date + 30)
      where id = v_sub;
    return;
  end if;

  while v_due <= current_date loop
    insert into public.transactions
      (user_id, title, amount, category_id, category_name, type, tx_date,
       description, payment_method, subscription_id)
    values (
      p_uid, v_title,
      case when p_promo_end is not null and v_due >= p_promo_end then p_regular else p_amount end,
      (select id from public.categories where user_id = p_uid and name = p_cat and kind = 'expense'),
      p_cat, 'USCITA', v_due, 'Abbonamento', 'CARTA', v_sub
    );
    v_k   := v_k + 1;
    v_due := (p_start + make_interval(months => v_k * v_months))::date;
  end loop;

  update public.subscriptions set next_payment_date = v_due where id = v_sub;
end;
$$;


-- 3. SEED: carica il dataset di mockup sull'utente p_uid ---------------------
-- Il vecchio reset sull'account condiviso non serve più.
drop function if exists demo.reset_data();

create or replace function demo.seed_data(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := p_uid;
  v_giulia uuid;
  v_luca   uuid;
  v_sara   uuid;

  -- primo giorno di 11 mesi fa → 12 mesi di storico incluso quello corrente
  v_start  date := (date_trunc('month', current_date) - interval '11 months')::date;
  v_month  date;
  v_m      int;
  i        int;
  j        int;

  v_salary uuid;
  v_rent   uuid;
  v_goal   uuid;
  v_fe     uuid;
  v_trip   uuid;
  v_aug    date;
  v_amount numeric;
begin
  select id into v_giulia from auth.users where email = 'giulia.demo@mywallet.app';
  select id into v_luca   from auth.users where email = 'luca.demo@mywallet.app';
  select id into v_sara   from auth.users where email = 'sara.demo@mywallet.app';

  -- stesso dataset per ogni visitatore (a parità di giorno)
  perform setseed(0.42);

  -- ---------------------------------------------------------------------------
  -- 3.1 PROFILO + CATEGORIE
  -- onboarding_completed = false: ogni visitatore vede il tutorial.
  -- ---------------------------------------------------------------------------
  insert into public.profiles (id, first_name, last_name, theme, currency, onboarding_completed)
  values (v_uid, 'Marco', 'Rossi', 'light', 'EUR', false)
  on conflict (id) do update set
    first_name = excluded.first_name,
    last_name  = excluded.last_name,
    theme      = excluded.theme,
    currency   = excluded.currency,
    onboarding_completed = excluded.onboarding_completed;

  perform public.seed_default_categories(v_uid);

  -- ---------------------------------------------------------------------------
  -- 3.3 SALDO DI PARTENZA
  -- ---------------------------------------------------------------------------
  perform demo.add_tx(v_uid, v_start, 'Saldo iniziale conto', 3500, 'Altro', 'ENTRATA', 'CARTA',
                      'Saldo del conto all''inizio del monitoraggio');
  perform demo.add_tx(v_uid, v_start, 'Contanti nel portafoglio', 150, 'Altro', 'ENTRATA', 'CONTANTI');

  -- ---------------------------------------------------------------------------
  -- 3.4 MOVIMENTI MESE PER MESE (12 mesi)
  -- ---------------------------------------------------------------------------
  for i in 0..11 loop
    v_month := (v_start + make_interval(months => i))::date;
    v_m     := extract(month from v_month)::int;

    -- Stipendio e affitto: transazioni ricorrenti (template + copie mensili).
    -- Le copie coprono anche il mese corrente, come fa recurring.js: così il
    -- client non ha nulla da generare.
    if i = 0 then
      insert into public.transactions
        (user_id, title, amount, category_id, category_name, type, tx_date,
         description, payment_method, is_recurring, recurring_day)
      values
        (v_uid, 'Stipendio', 1820,
         (select id from categories where user_id = v_uid and name = 'Stipendio' and kind = 'income'),
         'Stipendio', 'ENTRATA', demo.day(v_month, 27), 'Stipendio netto mensile', 'CARTA', true, 27)
      returning id into v_salary;

      insert into public.transactions
        (user_id, title, amount, category_id, category_name, type, tx_date,
         description, payment_method, is_recurring, recurring_day)
      values
        (v_uid, 'Affitto', 580,
         (select id from categories where user_id = v_uid and name = 'Casa' and kind = 'expense'),
         'Casa', 'USCITA', demo.day(v_month, 5), 'Affitto bilocale', 'CARTA', true, 5)
      returning id into v_rent;
    else
      insert into public.transactions
        (user_id, title, amount, category_id, category_name, type, tx_date,
         description, payment_method, recurring_parent_id)
      select user_id, title, amount, category_id, category_name, type,
             demo.day(v_month, recurring_day), description, payment_method, id
      from public.transactions
      where id in (v_salary, v_rent);
    end if;

    -- Entrate straordinarie
    if v_m = 12 then
      perform demo.add_tx(v_uid, demo.day(v_month, 15), 'Tredicesima', 1780, 'Stipendio', 'ENTRATA');
      perform demo.add_tx(v_uid, demo.day(v_month, 25), 'Regalo di natale dai nonni', 100, 'Regali', 'ENTRATA', 'CONTANTI');
    end if;
    if v_m = 7 then
      perform demo.add_tx(v_uid, demo.day(v_month, 20), 'Rimborso 730', 362, 'Rimborso', 'ENTRATA', 'CARTA',
                          'Rimborso IRPEF in busta paga');
    end if;
    if v_m = 3 then
      perform demo.add_tx(v_uid, demo.day(v_month, 11), 'Regalo di compleanno', 150, 'Regali', 'ENTRATA', 'CONTANTI');
    end if;

    -- Utenze
    perform demo.add_tx(v_uid, demo.day(v_month, 12), 'Bolletta luce',
      case when v_m in (6, 7, 8) then demo.rnd(62, 78)
           when v_m in (11, 12, 1, 2) then demo.rnd(58, 72)
           else demo.rnd(42, 55) end, 'Utenze');
    perform demo.add_tx(v_uid, demo.day(v_month, 18), 'Bolletta gas',
      case when v_m in (11, 12, 1, 2, 3) then demo.rnd(95, 140)
           when v_m in (4, 10) then demo.rnd(45, 60)
           else demo.rnd(18, 28) end, 'Utenze');
    if v_m in (2, 5, 8, 11) then
      perform demo.add_tx(v_uid, demo.day(v_month, 22), 'Bolletta acqua', demo.rnd(45, 58), 'Utenze');
    end if;

    -- Spesa: 5 volte al mese al supermercato + 2 al mercato (contanti)
    for j in 0..4 loop
      perform demo.add_tx(v_uid, demo.day(v_month, 2 + j * 6 + floor(random() * 2)::int),
        demo.pick(array['Spesa esselunga', 'Spesa coop', 'Spesa lidl', 'Spesa conad']),
        demo.rnd(52, 88), 'Spesa');
    end loop;
    for j in 0..1 loop
      perform demo.add_tx(v_uid, demo.day(v_month, 7 + j * 14), 'Frutta e verdura al mercato',
        demo.rnd(9, 22), 'Spesa', 'USCITA', 'CONTANTI');
    end loop;

    -- Carburante
    perform demo.add_tx(v_uid, demo.day(v_month, 4),  'Rifornimento', demo.rnd(50, 68), 'Carburante');
    perform demo.add_tx(v_uid, demo.day(v_month, 19), 'Rifornimento', demo.rnd(50, 68), 'Carburante');

    -- Bar (contanti)
    for j in 0..7 loop
      if random() < 0.7 then
        perform demo.add_tx(v_uid, demo.day(v_month, 1 + j * 3 + floor(random() * 3)::int),
          demo.pick(array['Caffè e cornetto', 'Colazione al bar', 'Caffè']),
          demo.rnd(1.4, 4.5), 'Bar', 'USCITA', 'CONTANTI');
      else
        perform demo.add_tx(v_uid, demo.day(v_month, 1 + j * 3 + floor(random() * 3)::int),
          'Aperitivo con amici', demo.rnd(8, 14), 'Bar', 'USCITA', 'CONTANTI');
      end if;
    end loop;

    -- Ristoranti
    for j in 0..2 loop
      perform demo.add_tx(v_uid, demo.day(v_month, 6 + j * 8 + floor(random() * 3)::int),
        demo.pick(array['Pizzeria con amici', 'Cena fuori', 'Sushi', 'Pranzo di lavoro', 'Trattoria']),
        demo.rnd(22, 48), 'Ristoranti');
    end loop;
    if random() < 0.6 then
      perform demo.add_tx(v_uid, demo.day(v_month, 14), 'Cena a domicilio', demo.rnd(18, 28), 'Ristoranti');
    end if;

    -- Shopping
    perform demo.add_tx(v_uid, demo.day(v_month, 9 + floor(random() * 10)::int),
      demo.pick(array['Amazon', 'Zara', 'Decathlon', 'Ikea', 'H&m']), demo.rnd(22, 85), 'Shopping');
    if random() < 0.4 then
      perform demo.add_tx(v_uid, demo.day(v_month, 24), demo.pick(array['Amazon', 'Libreria', 'Scarpe']),
        demo.rnd(15, 60), 'Shopping');
    end if;
    if v_m = 11 then
      perform demo.add_tx(v_uid, demo.day(v_month, 28), 'Black friday - cuffie wireless', 179, 'Shopping');
    end if;

    -- Intrattenimento
    if random() < 0.7 then
      perform demo.add_tx(v_uid, demo.day(v_month, 16), demo.pick(array['Cinema', 'Libro', 'Bowling']),
        demo.rnd(9, 22), 'Intrattenimento');
    end if;
    if v_m in (6, 9) then
      perform demo.add_tx(v_uid, demo.day(v_month, 10), 'Biglietto concerto', 58, 'Intrattenimento');
    end if;

    -- Salute
    perform demo.add_tx(v_uid, demo.day(v_month, 13), 'Farmacia', demo.rnd(8, 28), 'Salute');
    if v_m = 4 then
      perform demo.add_tx(v_uid, demo.day(v_month, 17), 'Dentista - pulizia denti', 90, 'Salute');
    end if;
    if v_m = 10 then
      perform demo.add_tx(v_uid, demo.day(v_month, 8), 'Visita oculistica', 110, 'Salute');
    end if;

    -- Trasporti
    perform demo.add_tx(v_uid, demo.day(v_month, 20 + floor(random() * 6)::int),
      demo.pick(array['Treno per milano', 'Parcheggio centro', 'Pedaggio autostrada']),
      demo.rnd(6, 32), 'Trasporti');

    -- Altro (contanti)
    perform demo.add_tx(v_uid, demo.day(v_month, 23), 'Parrucchiere', 18, 'Altro', 'USCITA', 'CONTANTI');

    -- Spese una tantum
    if v_m = 2 then
      perform demo.add_tx(v_uid, demo.day(v_month, 25), 'Bollo auto', 214, 'Tasse');
    end if;
    if v_m in (4, 10) then
      perform demo.add_tx(v_uid, demo.day(v_month, 26), 'Tari - rata', 94, 'Tasse');
    end if;
    if v_m = 5 then
      perform demo.add_tx(v_uid, demo.day(v_month, 11), 'Tagliando auto', 238, 'Spese auto');
      perform demo.add_tx(v_uid, demo.day(v_month, 21), 'Scarpe da running', 89, 'Sport');
    end if;
    if v_m = 11 then
      perform demo.add_tx(v_uid, demo.day(v_month, 7), 'Cambio gomme invernali', 60, 'Spese auto');
    end if;
    if v_m = 1 then
      perform demo.add_tx(v_uid, demo.day(v_month, 15), 'Corso online di excel', 15, 'Istruzione');
    end if;
    if v_m = 8 then
      perform demo.add_tx(v_uid, demo.day(v_month, 2), 'Vacanza in puglia - quota', 620, 'Viaggi',
                          'USCITA', 'CARTA', 'Vedi il viaggio condiviso "Vacanza in Puglia"');
    end if;
    if v_m = 12 then
      perform demo.add_tx(v_uid, demo.day(v_month, 12), 'Regali di natale', 185, 'Regali');
      perform demo.add_tx(v_uid, demo.day(v_month, 20), 'Regali di natale', 120, 'Regali');
      perform demo.add_tx(v_uid, demo.day(v_month, 22), 'Pandoro e panettone', 24, 'Spesa', 'USCITA', 'CONTANTI');
    end if;
    if v_m = 6 then
      perform demo.add_tx(v_uid, demo.day(v_month, 18), 'Regalo compleanno luca', 50, 'Regali');
    end if;
  end loop;

  -- ---------------------------------------------------------------------------
  -- 3.5 ABBONAMENTI (con gli addebiti già avvenuti)
  -- ---------------------------------------------------------------------------
  perform demo.add_subscription(v_uid, 'Palestra',        39.00, 'Sport',           'MENSILE', demo.day(v_start, 2));
  perform demo.add_subscription(v_uid, 'Netflix',         13.99, 'Intrattenimento', 'MENSILE', demo.day(v_start, 8));
  perform demo.add_subscription(v_uid, 'Spotify',         11.99, 'Intrattenimento', 'MENSILE', demo.day(v_start, 14));
  perform demo.add_subscription(v_uid, 'Iliad',            9.99, 'Utenze',          'MENSILE', demo.day(v_start, 20));
  -- promo: 24,90 € fino a fra 2 mesi, poi 29,90 €
  perform demo.add_subscription(v_uid, 'Fibra casa',      24.90, 'Utenze',          'MENSILE', demo.day(v_start, 10),
                                false, 29.90, current_date + 60);
  perform demo.add_subscription(v_uid, 'Assicurazione auto', 590, 'Spese auto',     'ANNUALE',
                                demo.day((v_start + interval '2 months')::date, 15));
  perform demo.add_subscription(v_uid, 'Amazon Prime',    49.90, 'Shopping',        'ANNUALE',
                                demo.day((v_start + interval '4 months')::date, 3));
  perform demo.add_subscription(v_uid, 'Disney+',          9.99, 'Intrattenimento', 'MENSILE', demo.day(v_start, 25),
                                true);   -- in pausa

  -- ---------------------------------------------------------------------------
  -- 3.6 BUDGET MENSILI
  -- ---------------------------------------------------------------------------
  insert into public.budgets (user_id, category_id, monthly_limit)
  select v_uid, c.id, b.lim
  from (values
    ('Spesa', 380),('Ristoranti', 130), ('Bar', 40), ('Carburante', 130),
    ('Shopping', 100), ('Intrattenimento', 60), ('Utenze', 220)
  ) as b(name, lim)
  join public.categories c on c.user_id = v_uid and c.name = b.name and c.kind = 'expense';

  -- ---------------------------------------------------------------------------
  -- 3.7 OBIETTIVI DI RISPARMIO
  -- Ogni versamento = contribution + transazione USCITA "Risparmi" (come savings.js)
  -- ---------------------------------------------------------------------------
  -- Fondo emergenza: 100 €/mese per tutto l'anno
  insert into public.savings_goals (user_id, name, target_amount)
  values (v_uid, 'Fondo emergenza', 5000) returning id into v_goal;
  for i in 0..11 loop
    perform demo.add_saving(v_uid, v_goal, 'Fondo emergenza', 100,
      demo.day((v_start + make_interval(months => i))::date, 28));
  end loop;

  -- Bici elettrica: completato nei primi 6 mesi
  insert into public.savings_goals (user_id, name, target_amount, target_date, is_completed)
  values (v_uid, 'Bici elettrica', 600, demo.day((v_start + interval '6 months')::date, 1), true)
  returning id into v_goal;
  for i in 0..5 loop
    perform demo.add_saving(v_uid, v_goal, 'Bici elettrica', 100,
      demo.day((v_start + make_interval(months => i))::date, 28));
  end loop;
  perform demo.add_tx(v_uid, demo.day((v_start + interval '6 months')::date, 6),
                      'Acquisto bici elettrica', 590, 'Sport');

  -- Viaggio in Giappone: in corso, iniziato 6 mesi fa
  insert into public.savings_goals (user_id, name, target_amount, target_date)
  values (v_uid, 'Viaggio in Giappone', 3000, current_date + 300) returning id into v_goal;
  for i in 6..11 loop
    perform demo.add_saving(v_uid, v_goal, 'Viaggio in Giappone', 100,
      demo.day((v_start + make_interval(months => i))::date, 28));
  end loop;

  -- ---------------------------------------------------------------------------
  -- 3.8 SPESE FUTURE (accantonamenti)
  -- ---------------------------------------------------------------------------
  insert into public.future_expenses (user_id, name, total_amount, due_date, note)
  values (v_uid, 'Gomme nuove auto', 480, current_date + 120, 'Quattro gomme quattro stagioni')
  returning id into v_fe;
  perform demo.add_future_quota(v_uid, v_fe, 'Gomme nuove auto', 120, current_date - 45, current_date + 120);
  perform demo.add_future_quota(v_uid, v_fe, 'Gomme nuove auto', 120, current_date - 15, current_date + 120);

  insert into public.future_expenses (user_id, name, total_amount, due_date, note)
  values (v_uid, 'Regalo matrimonio Luca', 400, current_date + 200, null)
  returning id into v_fe;
  perform demo.add_future_quota(v_uid, v_fe, 'Regalo matrimonio Luca', 100, current_date - 10, current_date + 200);

  -- ---------------------------------------------------------------------------
  -- 3.9 TRASFERIMENTI: prelievo bancomat mensile (carta → contanti)
  -- Inseriti dopo le transazioni: il trigger check_transfer_balance
  -- verifica che sulla carta ci sia abbastanza saldo.
  -- ---------------------------------------------------------------------------
  for i in 0..11 loop
    v_month := demo.day((v_start + make_interval(months => i))::date, 1 + (i % 3));
    if v_month <= current_date then
      insert into public.transfers (user_id, from_method, to_method, amount, transfer_date, note)
      values (v_uid, 'CARTA', 'CONTANTI', 100, v_month, 'Prelievo bancomat');
    end if;
  end loop;

  -- ---------------------------------------------------------------------------
  -- 3.10 VIAGGI CONDIVISI
  -- ---------------------------------------------------------------------------
  if v_giulia is not null and v_luca is not null and v_sara is not null then

    -- A) Weekend a Lisbona — ATTIVO, creato da Giulia, 4 partecipanti.
    --    Spese pagate da persone diverse → il riepilogo mostra chi deve a chi.
    insert into public.trips (owner_id, name, status)
    values (v_giulia, 'Weekend a Lisbona', 'ATTIVO') returning id into v_trip;

    insert into public.trip_members (trip_id, user_id, display_name) values
      (v_trip, v_giulia, 'Giulia Bianchi'),
      (v_trip, v_uid,    'Marco Rossi'),
      (v_trip, v_luca,   'Luca Ferri'),
      (v_trip, v_sara,   'Sara Conti');

    insert into public.trip_expenses
      (trip_id, created_by, paid_by, title, amount, category_name, expense_date, description)
    values
      (v_trip, v_uid,    v_uid,    'Voli andata e ritorno',        348.00, 'Trasporti',         current_date - 30, 'Ryanair, 4 persone'),
      (v_trip, v_giulia, v_giulia, 'Appartamento Alfama 3 notti',  465.00, 'Alloggio',          current_date - 28, null),
      (v_trip, v_luca,   v_luca,   'Navetta aeroporto',             32.00, 'Trasporti',         current_date - 20, null),
      (v_trip, v_sara,   v_sara,   'Pranzo a Time Out Market',      74.50, 'Cibo e ristoranti', current_date - 20, null),
      (v_trip, v_uid,    v_uid,    'Viva Viagem - 4 tessere',       40.00, 'Trasporti',         current_date - 20, 'Metro e tram 28'),
      (v_trip, v_giulia, v_giulia, 'Cena a Bairro Alto',           118.00, 'Cibo e ristoranti', current_date - 20, null),
      (v_trip, v_luca,   v_luca,   'Torre di Belém',                48.00, 'Musei',             current_date - 19, null),
      (v_trip, v_uid,    v_uid,    'Pastéis de Belém',              19.60, 'Cibo e ristoranti', current_date - 19, null),
      (v_trip, v_sara,   v_sara,   'Monastero dos Jerónimos',       72.00, 'Musei',             current_date - 19, null),
      (v_trip, v_giulia, v_giulia, 'Cena con fado',                156.00, 'Cibo e ristoranti', current_date - 19, null),
      (v_trip, v_luca,   v_luca,   'Gita a Sintra - treno',         20.40, 'Trasporti',         current_date - 18, null),
      (v_trip, v_sara,   v_sara,   'Palácio da Pena',               80.00, 'Attività',          current_date - 18, null),
      (v_trip, v_uid,    v_uid,    'Pranzo a Sintra',               68.00, 'Cibo e ristoranti', current_date - 18, null),
      (v_trip, v_giulia, v_giulia, 'Spesa per colazioni',           27.30, 'Cibo e ristoranti', current_date - 18, null),
      -- pagata da Giulia ma inserita da Luca ("Pagato da")
      (v_trip, v_luca,   v_giulia, 'Tuk tuk tour',                  60.00, 'Attività',          current_date - 17, null);

    -- B) Vacanza in Puglia — TERMINATO, creato dalla demo, agosto scorso.
    v_aug := make_date(
      extract(year from current_date)::int - case when extract(month from current_date) <= 8 then 1 else 0 end,
      8, 1);

    insert into public.trips (owner_id, name, status)
    values (v_uid, 'Vacanza in Puglia', 'TERMINATO') returning id into v_trip;

    insert into public.trip_members (trip_id, user_id, display_name) values
      (v_trip, v_uid,  'Marco Rossi'),
      (v_trip, v_sara, 'Sara Conti'),
      (v_trip, v_luca, 'Luca Ferri');

    insert into public.trip_expenses
      (trip_id, created_by, paid_by, title, amount, category_name, expense_date)
    values
      (v_trip, v_uid,  v_uid,  'Masseria 7 notti',            1260.00, 'Alloggio',            v_aug + 2),
      (v_trip, v_sara, v_sara, 'Carburante andata',              95.00, 'Carburante',          v_aug + 2),
      (v_trip, v_luca, v_luca, 'Autostrada',                     64.80, 'Parcheggi e pedaggi', v_aug + 2),
      (v_trip, v_uid,  v_uid,  'Lido a Polignano - 2 giorni',    90.00, 'Attività',            v_aug + 4),
      (v_trip, v_sara, v_sara, 'Cena a Ostuni',                 132.00, 'Cibo e ristoranti',   v_aug + 4),
      (v_trip, v_luca, v_luca, 'Escursione in barca',           150.00, 'Attività',            v_aug + 5),
      (v_trip, v_uid,  v_uid,  'Spesa',                          86.40, 'Cibo e ristoranti',   v_aug + 5),
      (v_trip, v_sara, v_sara, 'Parcheggio Alberobello',         10.00, 'Parcheggi e pedaggi', v_aug + 6),
      (v_trip, v_luca, v_luca, 'Orecchiette e bombette',         78.00, 'Cibo e ristoranti',   v_aug + 7),
      (v_trip, v_uid,  v_uid,  'Carburante ritorno',             92.00, 'Carburante',          v_aug + 9);
  end if;
end;
$$;


-- Helper usati da seed_data (definiti dopo: plpgsql li risolve a runtime).

-- Versamento su un obiettivo di risparmio + transazione collegata.
create or replace function demo.add_saving(
  p_uid uuid, p_goal uuid, p_name text, p_amount numeric, p_date date
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_date > current_date then return; end if;

  insert into public.savings_contributions (user_id, savings_goal_id, amount, contributed_on)
  values (p_uid, p_goal, p_amount, p_date);

  insert into public.transactions
    (user_id, title, amount, category_name, type, tx_date, description, payment_method, savings_goal_id)
  values
    (p_uid, 'Risparmio · ' || lower(p_name), p_amount, 'Risparmi', 'USCITA', p_date,
     'Versamento verso un obiettivo di risparmio', 'CARTA', p_goal);
end;
$$;

-- Quota accantonata per una spesa futura + transazione collegata.
create or replace function demo.add_future_quota(
  p_uid uuid, p_fe uuid, p_name text, p_amount numeric, p_date date, p_due date
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into public.future_expense_contributions (user_id, future_expense_id, amount, contributed_on)
  values (p_uid, p_fe, p_amount, p_date);

  insert into public.transactions
    (user_id, title, amount, category_name, type, tx_date, description, payment_method, future_expense_id)
  values
    (p_uid, 'Accantonamento · ' || lower(p_name), p_amount, 'Spese future', 'USCITA', p_date,
     'Quota mensile per "' || p_name || '" (scadenza ' || to_char(p_due, 'DD/MM/YYYY') || ')',
     'CARTA', p_fe);
end;
$$;


-- 4. PULIZIA: elimina le demo scadute ---------------------------------------
-- Cancellare l'utente da auth.users elimina a cascata profilo, categorie,
-- transazioni, abbonamenti, ecc. (tutte le FK sono "on delete cascade").
-- Restano solo i viaggi creati dai compagni (owner = Giulia): quelli rimasti
-- senza nessun visitatore vengono eliminati qui.
create or replace function demo.cleanup()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_companions uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_companions
  from auth.users
  where email in ('giulia.demo@mywallet.app', 'luca.demo@mywallet.app', 'sara.demo@mywallet.app');

  delete from auth.users
  where is_anonymous
    and created_at < now() - interval '30 minutes';

  delete from public.trips t
  where t.owner_id = any (v_companions)
    and not exists (
      select 1 from public.trip_members m
      where m.trip_id = t.id and not (m.user_id = any (v_companions))
    );
end;
$$;


-- Nessun client (anon/authenticated) può eseguire le funzioni demo.
revoke all on all functions in schema demo from public, anon, authenticated;


-- 5. RPC PER IL CLIENT: avvio della demo -------------------------------------
-- Chiamata subito dopo signInAnonymously(). Funziona solo per utenti anonimi
-- e solo una volta (se il dataset è già caricato non fa nulla).
create or replace function public.start_demo()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or not coalesce((select is_anonymous from auth.users where id = v_uid), false) then
    raise exception 'La demo è disponibile solo per gli utenti demo'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.transactions where user_id = v_uid) then
    return;
  end if;

  perform demo.seed_data(v_uid);
end;
$$;

revoke all on function public.start_demo() from public, anon;
grant execute on function public.start_demo() to authenticated;


-- 6. PROTEZIONE: un utente demo non può diventare un account vero ------------
-- Blocca cambio email/telefono/password e la conversione in utente permanente
-- (updateUser su un anonimo lo "promuoverebbe" e la pulizia non lo toccherebbe più).
create or replace function public.block_demo_account_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_anonymous and (
       new.is_anonymous       is distinct from old.is_anonymous
    or new.email              is distinct from old.email
    or new.email_change       is distinct from old.email_change
    or new.phone              is distinct from old.phone
    or new.encrypted_password is distinct from old.encrypted_password
  ) then
    raise exception 'Operazione non consentita nella demo'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_demo_account_changes on auth.users;
create trigger trg_block_demo_account_changes
  before update on auth.users
  for each row execute function public.block_demo_account_changes();


-- 7. SCHEDULER: pulizia ogni 5 minuti ----------------------------------------
-- pg_cron è l'equivalente PostgreSQL dell'event scheduler di MySQL.
-- (In alternativa si attiva da Dashboard → Integrations → Cron.)
-- Ogni 5 minuti vengono eliminate le demo con più di 30 minuti di vita:
-- ogni visitatore ha quindi a disposizione 30-35 minuti.
create extension if not exists pg_cron;

-- job della versione precedente (reset dell'account condiviso), se presente
select cron.unschedule(jobid) from cron.job where jobname = 'reset-demo';

-- Con lo stesso nome il job viene sostituito, non duplicato.
select cron.schedule(
  'demo-cleanup',
  '*/5 * * * *',
  $$ select demo.cleanup(); $$
);


-- -----------------------------------------------------------------------------
-- Comandi utili
-- -----------------------------------------------------------------------------
-- Demo attive:              select id, created_at from auth.users where is_anonymous order by created_at desc;
-- Job pianificati:          select * from cron.job;
-- Ultime esecuzioni:        select * from cron.job_run_details order by start_time desc limit 10;
-- Pulizia manuale:          select demo.cleanup();
-- Sospendere la pulizia:    select cron.unschedule('demo-cleanup');
-- END
