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

  if char_length(national_digits) = 10 then
    return '549' || national_digits;
  end if;

  return digits;
end;
$$;

revoke all on function private.normalize_argentine_phone(text) from public;

create or replace function private.set_customer_phone_normalized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.phone_normalized := private.normalize_argentine_phone(new.phone);

  if nullif(trim(new.phone), '') is not null and new.phone_normalized is null then
    raise exception 'El teléfono debe contener al menos un dígito';
  end if;

  return new;
end;
$$;

revoke all on function private.set_customer_phone_normalized() from public;

drop index if exists public.customers_phone_normalized_key;

update public.customers
set phone_normalized = private.normalize_argentine_phone(phone);

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

create unique index customers_phone_normalized_key
  on public.customers (phone_normalized)
  where phone_normalized is not null;
