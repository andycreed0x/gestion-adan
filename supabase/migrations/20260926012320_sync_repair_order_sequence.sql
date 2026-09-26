create or replace function private.sync_repair_order_number_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sequence_last_value bigint;
  sequence_is_called boolean;
begin
  select last_value, is_called
  into sequence_last_value, sequence_is_called
  from public.repair_orders_order_number_seq;

  if new.order_number > sequence_last_value
    or (new.order_number = sequence_last_value and not sequence_is_called) then
    perform setval(
      'public.repair_orders_order_number_seq'::regclass,
      new.order_number,
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_repair_order_number_sequence() from public;

drop trigger if exists sync_repair_order_number_sequence on public.repair_orders;
create trigger sync_repair_order_number_sequence
  before insert on public.repair_orders
  for each row execute procedure private.sync_repair_order_number_sequence();
