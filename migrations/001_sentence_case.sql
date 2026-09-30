-- Migrazione una tantum per i database creati prima del passaggio al sentence case.
-- In precedenza categorie, titoli delle transazioni e snapshot dei nomi di categoria
-- venivano salvati in MAIUSCOLO; ora l'app li salva come "Prima lettera maiuscola".
-- Nomi di viaggi, abbonamenti e obiettivi non sono mai stati forzati e restano invariati.
-- Da eseguire una sola volta, dopo DB.sql.

update public.categories
  set name = upper(left(name, 1)) || lower(substring(name from 2))
  where name is not null and name <> '';

update public.transactions
  set title = upper(left(title, 1)) || lower(substring(title from 2)),
      category_name = case when category_name is not null and category_name <> ''
        then upper(left(category_name, 1)) || lower(substring(category_name from 2))
        else category_name end;

update public.subscriptions
  set category_name = upper(left(category_name, 1)) || lower(substring(category_name from 2))
  where category_name is not null and category_name <> '';

update public.trip_categories
  set name = upper(left(name, 1)) || lower(substring(name from 2))
  where name is not null and name <> '';

update public.trip_expenses
  set category_name = upper(left(category_name, 1)) || lower(substring(category_name from 2))
  where category_name is not null and category_name <> '';

alter table public.trip_expenses alter column category_name set default 'Altro';
