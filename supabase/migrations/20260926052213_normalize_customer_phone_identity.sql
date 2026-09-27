create or replace function private.normalize_argentine_phone(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(value, ''), '\D', '', 'g');
  national_digits text;
begin
  if digits = '' then
    return null;
  end if;

  national_digits := case
    when digits like '549%' then substr(digits, 4)
    when digits like '54%' then substr(digits, 3)
    else digits
  end;

  if char_length(national_digits) <> 10 then
    return null;
  end if;

  return '549' || national_digits;
end;
$$;

revoke all on function private.normalize_argentine_phone(text) from public;

alter table public.customers
  add column if not exists phone_normalized text;

update public.customers
set phone_normalized = private.normalize_argentine_phone(phone)
where phone_normalized is null;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by phone_normalized
      order by updated_at desc, created_at desc, id
    ) as retained_id
  from public.customers
  where phone_normalized is not null
), duplicates as (
  select id, retained_id
  from ranked
  where id <> retained_id
)
update public.repair_orders repair_order
set customer_id = duplicates.retained_id
from duplicates
where repair_order.customer_id = duplicates.id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by phone_normalized
      order by updated_at desc, created_at desc, id
    ) as retained_id
  from public.customers
  where phone_normalized is not null
)
delete from public.customers customer
using ranked
where customer.id = ranked.id
  and ranked.id <> ranked.retained_id;

create unique index if not exists customers_phone_normalized_key
  on public.customers (phone_normalized)
  where phone_normalized is not null;

create or replace function private.set_customer_phone_normalized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone_normalized := private.normalize_argentine_phone(new.phone);

  if nullif(trim(new.phone), '') is not null and new.phone_normalized is null then
    raise exception 'El teléfono debe ser un número argentino válido';
  end if;

  return new;
end;
$$;

revoke all on function private.set_customer_phone_normalized() from public;

drop trigger if exists set_customer_phone_normalized on public.customers;
create trigger set_customer_phone_normalized
  before insert or update of phone on public.customers
  for each row execute procedure private.set_customer_phone_normalized();

create index if not exists repair_orders_received_order_paging_idx
  on public.repair_orders (received_on desc, order_number desc);

drop view if exists public.repair_order_list;
create view public.repair_order_list
with (security_invoker = true)
as
select
  repair_order.id,
  repair_order.order_number,
  repair_order.equipment,
  repair_order.status,
  repair_order.budget_cents,
  repair_order.received_on,
  repair_order.picked_up_on,
  customer.full_name as customer_name,
  customer.address as customer_address,
  customer.phone as customer_phone,
  customer.phone_normalized as customer_phone_normalized,
  lower(concat_ws(' ', repair_order.order_number::text, customer.full_name, customer.phone, repair_order.equipment)) as search_text
from public.repair_orders repair_order
join public.customers customer on customer.id = repair_order.customer_id;

revoke all on public.repair_order_list from public;
grant select on public.repair_order_list to authenticated;
