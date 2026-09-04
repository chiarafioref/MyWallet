-- 0. EXTENSIONS
create extension if not exists "pgcrypto";      -- gen_random_uuid()


-- 1. UTILITY FUNCTION: auto-update of updated_at
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- 2. USER PROFILES
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text,
  last_name   text,
  theme       text    not null default 'light' check (theme in ('light', 'dark')),
  currency    text    not null default 'EUR',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();


-- 3. CATEGORIES (default + custom)
-- kind = 'expense' | 'income'
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('expense', 'income')),
  icon        text,
  color       text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, name, kind)
);

create index if not exists idx_categories_user on public.categories(user_id);


-- Seed the default categories for a new user.
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories (user_id, name, kind, is_default)
  select p_user_id, c, 'expense', true
  from unnest(array[
    'CASA', 'SPESA', 'RISTORANTI', 'BAR', 'TRASPORTI', 'CARBURANTE',
    'SPESE AUTO', 'UTENZE', 'SHOPPING', 'SPORT', 'INTRATTENIMENTO',
    'SALUTE', 'ISTRUZIONE', 'VIAGGI', 'REGALI', 'TASSE',
    'RATE FINANZIAMENTI', 'ALTRO'
  ]) as c
  on conflict (user_id, name, kind) do nothing;

  insert into public.categories (user_id, name, kind, is_default)
  select p_user_id, c, 'income', true
  from unnest(array['STIPENDIO', 'RIMBORSO', 'REGALI', 'ALTRO']) as c
  on conflict (user_id, name, kind) do nothing;
end;
$$;


-- 4. TRIGGER: create profile + categories on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  )
  on conflict (id) do nothing;

  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 5. TRANSACTIONS
-- type = 'ENTRATA' (+) | 'USCITA' (-)
-- payment_method = 'CONTANTI' | 'CARTA'
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  amount          numeric(12,2) not null check (amount > 0),
  category_id     uuid references public.categories(id) on delete set null,
  category_name   text,                       -- readable category snapshot
  type            text not null check (type in ('ENTRATA', 'USCITA')),
  tx_date         date not null default current_date,
  description     text,
  payment_method  text not null default 'CARTA' check (payment_method in ('CONTANTI', 'CARTA')),
  is_recurring    boolean not null default false,
  recurring_day   smallint check (recurring_day between 1 and 31),
  -- optional date after which the recurrence stops generating transactions
  recurring_end   date,
  -- if set, this row is a copy generated from a recurring transaction
  recurring_parent_id uuid references public.transactions(id) on delete set null,
  -- link to a savings goal (RISPARMI section)
  savings_goal_id uuid,
  -- link to a future-expense set-aside (SPESE FUTURE section)
  future_expense_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_transactions_user       on public.transactions(user_id);
create index if not exists idx_transactions_user_date  on public.transactions(user_id, tx_date desc);
create index if not exists idx_transactions_category   on public.transactions(category_id);
create index if not exists idx_transactions_recurring  on public.transactions(recurring_parent_id);

drop trigger if exists trg_transactions_updated_at on public.transactions;
create trigger trg_transactions_updated_at
  before update on public.transactions
  for each row execute function public.handle_updated_at();


-- 6. BUDGETS (monthly, per category)
-- The budget repeats every month; usage is computed from the transactions.
create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   uuid not null references public.categories(id) on delete cascade,
  monthly_limit numeric(12,2) not null check (monthly_limit > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, category_id)
);

create index if not exists idx_budgets_user on public.budgets(user_id);

drop trigger if exists trg_budgets_updated_at on public.budgets;
create trigger trg_budgets_updated_at
  before update on public.budgets
  for each row execute function public.handle_updated_at();


-- 7. SAVINGS (goals + contributions)
create table if not exists public.savings_goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  target_amount numeric(12,2) check (target_amount is null or target_amount > 0),
  target_date   date,
  is_completed  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_savings_goals_user on public.savings_goals(user_id);

drop trigger if exists trg_savings_goals_updated_at on public.savings_goals;
create trigger trg_savings_goals_updated_at
  before update on public.savings_goals
  for each row execute function public.handle_updated_at();


create table if not exists public.savings_contributions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  savings_goal_id uuid not null references public.savings_goals(id) on delete cascade,
  amount          numeric(12,2) not null check (amount <> 0),
  note            text,
  contributed_on  date not null default current_date,
  created_at      timestamptz not null default now()
);

create index if not exists idx_savings_contrib_user on public.savings_contributions(user_id);
create index if not exists idx_savings_contrib_goal on public.savings_contributions(savings_goal_id);


-- 8. FUTURE EXPENSES (set-asides + paid quotas)
create table if not exists public.future_expenses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  total_amount   numeric(12,2) not null check (total_amount > 0),
  due_date       date not null,
  note           text,
  is_completed   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_future_expenses_user on public.future_expenses(user_id);

drop trigger if exists trg_future_expenses_updated_at on public.future_expenses;
create trigger trg_future_expenses_updated_at
  before update on public.future_expenses
  for each row execute function public.handle_updated_at();


create table if not exists public.future_expense_contributions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  future_expense_id  uuid not null references public.future_expenses(id) on delete cascade,
  amount             numeric(12,2) not null check (amount > 0),
  contributed_on     date not null default current_date,
  created_at         timestamptz not null default now()
);

create index if not exists idx_future_contrib_user on public.future_expense_contributions(user_id);
create index if not exists idx_future_contrib_fe   on public.future_expense_contributions(future_expense_id);


-- 8b. SUBSCRIPTIONS / RECURRING EXPENSES (streaming, gyms, insurance…)
-- frequency = 'MENSILE' | 'ANNUALE' | 'PERSONALIZZATA' (every interval_months months)
-- Promo: amount = current (promotional) price, regular_amount = full price,
--        promo_end_date = date from which regular_amount applies.
create table if not exists public.subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  amount           numeric(12,2) not null check (amount > 0),
  category_id      uuid references public.categories(id) on delete set null,
  category_name    text,
  payment_method   text not null default 'CARTA' check (payment_method in ('CONTANTI', 'CARTA')),
  frequency        text not null default 'MENSILE' check (frequency in ('MENSILE', 'ANNUALE', 'PERSONALIZZATA')),
  interval_months  smallint not null default 1 check (interval_months between 1 and 120),
  next_payment_date date not null default current_date,
  start_date       date not null default current_date,
  end_date         date,
  is_paused        boolean not null default false,
  promo            boolean not null default false,
  promo_end_date   date,                       -- when the amount changes
  regular_amount   numeric(12,2) check (regular_amount is null or regular_amount > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on public.subscriptions(user_id);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.handle_updated_at();


-- 8c. MONEY TRANSFERS (moves between payment methods)
-- A transfer moves money from one method to another (e.g. a cash withdrawal):
-- it is neither income nor expense and does not affect statistics or budgets. It
-- only changes how the balance is split across methods; total wealth is unchanged.
create table if not exists public.transfers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  from_method    text not null check (from_method in ('CONTANTI', 'CARTA')),
  to_method      text not null check (to_method   in ('CONTANTI', 'CARTA')),
  amount         numeric(12,2) not null check (amount > 0),
  transfer_date  date not null default current_date,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (from_method <> to_method)
);

create index if not exists idx_transfers_user      on public.transfers(user_id);
create index if not exists idx_transfers_user_date on public.transfers(user_id, transfer_date desc);

drop trigger if exists trg_transfers_updated_at on public.transfers;
create trigger trg_transfers_updated_at
  before update on public.transfers
  for each row execute function public.handle_updated_at();

-- Expenses generated by a subscription are ordinary transactions linked here.
alter table public.transactions
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null;
-- recurrence end (for existing installations)
alter table public.transactions
  add column if not exists recurring_end date;
create index if not exists idx_transactions_subscription on public.transactions(subscription_id);

-- links to savings goals / future expenses (for existing installations)
alter table public.transactions add column if not exists savings_goal_id uuid;
alter table public.transactions add column if not exists future_expense_id uuid;
create index if not exists idx_transactions_savings_goal on public.transactions(savings_goal_id);

-- A savings goal's target amount is optional.
alter table public.savings_goals alter column target_amount drop not null;
alter table public.savings_goals drop constraint if exists savings_goals_target_amount_check;
alter table public.savings_goals
  add constraint savings_goals_target_amount_check check (target_amount is null or target_amount > 0);


-- 9. TRIPS (shared group wallets)
create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  join_key    text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  status      text not null default 'ATTIVO' check (status in ('ATTIVO', 'TERMINATO')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_trips_updated_at on public.trips;
create trigger trg_trips_updated_at
  before update on public.trips
  for each row execute function public.handle_updated_at();


create table if not exists public.trip_members (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null,
  joined_at     timestamptz not null default now(),
  unique (trip_id, user_id)
);

create index if not exists idx_trip_members_trip on public.trip_members(trip_id);
create index if not exists idx_trip_members_user on public.trip_members(user_id);


create table if not exists public.trip_categories (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  name        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (trip_id, name)
);

create index if not exists idx_trip_categories_trip on public.trip_categories(trip_id);


create table if not exists public.trip_expenses (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  created_by    uuid not null references auth.users(id) on delete cascade,
  -- who actually paid the expense (for the reimbursement calculation);
  -- if null, it is assumed to be whoever recorded it (created_by)
  paid_by       uuid references auth.users(id) on delete set null,
  title         text not null,
  amount        numeric(12,2) not null check (amount > 0),
  category_name text not null default 'ALTRO',
  type          text not null default 'USCITA' check (type in ('ENTRATA', 'USCITA')),
  expense_date  date not null default current_date,
  description   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_trip_expenses_trip on public.trip_expenses(trip_id);
-- "paid by" for existing installations
alter table public.trip_expenses add column if not exists paid_by uuid;

drop trigger if exists trg_trip_expenses_updated_at on public.trip_expenses;
create trigger trg_trip_expenses_updated_at
  before update on public.trip_expenses
  for each row execute function public.handle_updated_at();


-- Helper functions (SECURITY DEFINER) to avoid recursion in the RLS policies.
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_trip_active(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.trips
    where id = p_trip_id and status = 'ATTIVO'
  );
$$;

-- Join a trip via its unique key.
create or replace function public.join_trip(p_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_name    text;
begin
  select id into v_trip_id
  from public.trips
  where join_key = upper(trim(p_key));

  if v_trip_id is null then
    raise exception 'Viaggio non trovato con la chiave fornita';
  end if;

  select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_name
  from public.profiles
  where id = auth.uid();

  insert into public.trip_members (trip_id, user_id, display_name)
  values (v_trip_id, auth.uid(), coalesce(v_name, 'Utente'))
  on conflict (trip_id, user_id) do nothing;

  return v_trip_id;
end;
$$;


-- 10. ROW LEVEL SECURITY
alter table public.profiles                     enable row level security;
alter table public.categories                   enable row level security;
alter table public.transactions                 enable row level security;
alter table public.budgets                      enable row level security;
alter table public.savings_goals                enable row level security;
alter table public.subscriptions                enable row level security;
alter table public.transfers                    enable row level security;
alter table public.savings_contributions        enable row level security;
alter table public.future_expenses              enable row level security;
alter table public.future_expense_contributions enable row level security;
alter table public.trips                        enable row level security;
alter table public.trip_members                 enable row level security;
alter table public.trip_categories              enable row level security;
alter table public.trip_expenses                enable row level security;


-- ---- PROFILES ---------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete using (id = auth.uid());


-- ---- CATEGORIES ------------------------------------------------------------
drop policy if exists "categories_all_own" on public.categories;
create policy "categories_all_own" on public.categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- TRANSACTIONS ---------------------------------------------------------
drop policy if exists "transactions_all_own" on public.transactions;
create policy "transactions_all_own" on public.transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- TRANSFERS ----------------------------------------------------------
drop policy if exists "transfers_all_own" on public.transfers;
create policy "transfers_all_own" on public.transfers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- BUDGETS ------------------------------------------------------------
drop policy if exists "budgets_all_own" on public.budgets;
create policy "budgets_all_own" on public.budgets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- SUBSCRIPTIONS -------------------------------------
drop policy if exists "subscriptions_all_own" on public.subscriptions;
create policy "subscriptions_all_own" on public.subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- SAVINGS GOALS ----------------------------------------------------
drop policy if exists "savings_goals_all_own" on public.savings_goals;
create policy "savings_goals_all_own" on public.savings_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- SAVINGS CONTRIBUTIONS ------------------------------------------
drop policy if exists "savings_contrib_all_own" on public.savings_contributions;
create policy "savings_contrib_all_own" on public.savings_contributions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- FUTURE EXPENSES ----------------------------------------------
drop policy if exists "future_expenses_all_own" on public.future_expenses;
create policy "future_expenses_all_own" on public.future_expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- FUTURE EXPENSE CONTRIBUTIONS ------------------------------
drop policy if exists "future_contrib_all_own" on public.future_expense_contributions;
create policy "future_contrib_all_own" on public.future_expense_contributions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---- TRIPS -------------------------------------------------------
drop policy if exists "trips_select_member" on public.trips;
create policy "trips_select_member" on public.trips
  for select using (owner_id = auth.uid() or public.is_trip_member(id));

drop policy if exists "trips_insert_owner" on public.trips;
create policy "trips_insert_owner" on public.trips
  for insert with check (owner_id = auth.uid());

drop policy if exists "trips_update_owner" on public.trips;
create policy "trips_update_owner" on public.trips
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "trips_delete_owner" on public.trips;
create policy "trips_delete_owner" on public.trips
  for delete using (owner_id = auth.uid());


-- ---- TRIP MEMBERS ---------------------------------------------
drop policy if exists "trip_members_select" on public.trip_members;
create policy "trip_members_select" on public.trip_members
  for select using (public.is_trip_member(trip_id));

-- join only via the join_trip() function or for yourself
drop policy if exists "trip_members_insert_self" on public.trip_members;
create policy "trip_members_insert_self" on public.trip_members
  for insert with check (user_id = auth.uid());

drop policy if exists "trip_members_delete_self_or_owner" on public.trip_members;
create policy "trip_members_delete_self_or_owner" on public.trip_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
  );


-- ---- TRIP CATEGORIES ---------------------------------------
drop policy if exists "trip_categories_select" on public.trip_categories;
create policy "trip_categories_select" on public.trip_categories
  for select using (public.is_trip_member(trip_id));

drop policy if exists "trip_categories_insert" on public.trip_categories;
create policy "trip_categories_insert" on public.trip_categories
  for insert with check (public.is_trip_member(trip_id) and public.is_trip_active(trip_id));

drop policy if exists "trip_categories_delete" on public.trip_categories;
create policy "trip_categories_delete" on public.trip_categories
  for delete using (created_by = auth.uid());


-- ---- TRIP EXPENSES ---------------------------------------
drop policy if exists "trip_expenses_select" on public.trip_expenses;
create policy "trip_expenses_select" on public.trip_expenses
  for select using (public.is_trip_member(trip_id));

-- insert allowed only if a member AND the trip is ATTIVO
drop policy if exists "trip_expenses_insert" on public.trip_expenses;
create policy "trip_expenses_insert" on public.trip_expenses
  for insert with check (
    created_by = auth.uid()
    and public.is_trip_member(trip_id)
    and public.is_trip_active(trip_id)
  );

-- update/delete only your own expense and only while the trip is ATTIVO
drop policy if exists "trip_expenses_update_own" on public.trip_expenses;
create policy "trip_expenses_update_own" on public.trip_expenses
  for update using (created_by = auth.uid() and public.is_trip_active(trip_id))
  with check (created_by = auth.uid());

drop policy if exists "trip_expenses_delete_own" on public.trip_expenses;
create policy "trip_expenses_delete_own" on public.trip_expenses
  for delete using (created_by = auth.uid() and public.is_trip_active(trip_id));


-- 11. REALTIME (channel / publication)
-- Enables broadcasting of table changes. In the JS client:
--
--   const channel = supabaseClient
--     .channel('mywallet')
--     .on('postgres_changes',
--         { event: '*', schema: 'public', table: 'transactions',
--           filter: `user_id=eq.${userId}` },
--         payload => { /* update UI */ })
--     .subscribe();
--
-- Idempotent: adds to the publication only the tables not already present
-- (avoids "relation is already member of publication supabase_realtime").
do $$
declare
  t text;
  tables text[] := array[
    'transactions', 'budgets', 'categories', 'transfers',
    'savings_goals', 'savings_contributions', 'subscriptions',
    'future_expenses', 'future_expense_contributions',
    'trips', 'trip_members', 'trip_categories', 'trip_expenses', 'profiles'
  ];
begin
  -- create the publication if missing (usually already present on Supabase)
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Needed to receive the full "old" values in UPDATE/DELETE events.
alter table public.trip_expenses replica identity full;
alter table public.transactions replica identity full;
alter table public.transfers replica identity full;


-- 12. FUNCTION: delete account (SETTINGS section)
-- Removes the user's data. Deleting the row from auth.users must be done from
-- the client with supabaseClient.auth.admin or via an Edge Function with service_role.
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- trips owned by the user (cascades to members/categories/expenses)
  delete from public.trips where owner_id = v_uid;
  -- remove the user from other people's trips
  delete from public.trip_members where user_id = v_uid;

  delete from public.future_expense_contributions where user_id = v_uid;
  delete from public.future_expenses where user_id = v_uid;
  delete from public.savings_contributions where user_id = v_uid;
  delete from public.savings_goals where user_id = v_uid;
  delete from public.subscriptions where user_id = v_uid;
  delete from public.transfers where user_id = v_uid;
  delete from public.budgets where user_id = v_uid;
  delete from public.transactions where user_id = v_uid;
  delete from public.categories where user_id = v_uid;
  delete from public.profiles where id = v_uid;
end;
$$;


-- 13. TRIGGER: a transfer cannot move more money than is available on the
-- source payment method. The available balance mirrors the client-side
-- selectors.paymentMethodBalances():
--   transactions of that method (ENTRATA +, USCITA -)
--   + transfers received on that method
--   - transfers sent from that method   (the row being updated is excluded)
create or replace function public.check_transfer_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid    uuid := new.user_id;
  v_from   text := new.from_method;
  v_exclude uuid;
  v_tx   numeric;
  v_in   numeric;
  v_out  numeric;
  v_available numeric;
begin
  if tg_op = 'UPDATE' then
    v_exclude := old.id;
  end if;

  select coalesce(sum(case when type = 'ENTRATA' then amount else -amount end), 0)
    into v_tx
  from public.transactions
  where user_id = v_uid and payment_method = v_from;

  -- transfers already received on this method (excluding the row being updated)
  select coalesce(sum(amount), 0) into v_in
  from public.transfers
  where user_id = v_uid and to_method = v_from
    and (v_exclude is null or id <> v_exclude);

  -- transfers already sent from this method (excluding the row being updated)
  select coalesce(sum(amount), 0) into v_out
  from public.transfers
  where user_id = v_uid and from_method = v_from
    and (v_exclude is null or id <> v_exclude);

  v_available := v_tx + v_in - v_out;

  if new.amount > v_available then
    raise exception 'Saldo insufficiente su % (disponibile %, richiesto %)',
      v_from, v_available, new.amount
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_transfers_balance on public.transfers;
create trigger trg_transfers_balance
  before insert or update on public.transfers
  for each row execute function public.check_transfer_balance();

-- END
