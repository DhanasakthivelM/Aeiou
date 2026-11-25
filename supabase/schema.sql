create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (category in ('wear', 'home', 'accessories', 'wellness')),
  description text not null default '',
  price numeric(10, 2) not null check (price > 0),
  label text not null default '',
  trending boolean not null default false,
  image_url text not null,
  image_alt text not null default '',
  rating numeric(2, 1) not null default 5.0 check (rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  eyebrow text not null,
  headline text not null,
  description text not null default '',
  button_label text not null,
  category text not null default 'all' check (category in ('all', 'wear', 'home', 'accessories', 'wellness')),
  image_url text not null,
  image_alt text not null default '',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  shipping numeric(12, 2) not null default 0 check (shipping >= 0),
  total numeric(12, 2) not null check (total = subtotal + shipping),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price numeric(10, 2) not null check (unit_price > 0),
  line_total numeric(12, 2) not null check (line_total = quantity * unit_price)
);

create index if not exists products_active_sort_idx on public.products (is_active, sort_order);
create index if not exists banners_active_sort_idx on public.banners (is_active, sort_order);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists order_items_order_id_idx on public.order_items (order_id);

grant select on public.products, public.banners to anon, authenticated;
grant all on public.products, public.banners, public.orders, public.order_items to service_role;

alter table public.products enable row level security;
alter table public.banners enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Anyone can read active products" on public.products;
create policy "Anyone can read active products"
  on public.products for select to anon, authenticated using (is_active);

drop policy if exists "Anyone can read active banners" on public.banners;
create policy "Anyone can read active banners"
  on public.banners for select to anon, authenticated using (is_active);

create or replace function public.create_store_order(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  item_id text;
  item_quantity integer;
  product_row public.products%rowtype;
  order_uuid uuid := gen_random_uuid();
  order_code text;
  order_subtotal numeric(12, 2) := 0;
  order_shipping numeric(12, 2);
  order_lines jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Add products to your bag before checking out.';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'Add between 1 and 50 products to your bag.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as lines(item)
    group by lines.item ->> 'product_id'
    having sum(
      case
        when lines.item ->> 'quantity' ~ '^[0-9]{1,2}$'
          then (lines.item ->> 'quantity')::integer
        else 100
      end
    ) > 99
  ) then
    raise exception 'Product quantities must be between 1 and 99.';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := item ->> 'product_id';
    if item_id is null or char_length(item_id) > 80 then
      raise exception 'The order contains an invalid product.';
    end if;

    if item ->> 'quantity' !~ '^[0-9]{1,2}$' then
      raise exception 'Product quantities must be between 1 and 99.';
    end if;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 or item_quantity > 99 then
      raise exception 'Product quantities must be between 1 and 99.';
    end if;

    select * into product_row
    from public.products
    where id = item_id and is_active = true
    for update;

    if not found then
      raise exception 'A product in your bag is no longer available.';
    end if;
    if product_row.stock_quantity is not null and product_row.stock_quantity < item_quantity then
      raise exception 'There is not enough stock for %.', product_row.name;
    end if;

    order_subtotal := order_subtotal + (product_row.price * item_quantity);
    if product_row.stock_quantity is not null then
      update public.products
      set stock_quantity = stock_quantity - item_quantity, updated_at = now()
      where id = product_row.id;
    end if;

    order_lines := order_lines || jsonb_build_array(jsonb_build_object(
      'product_id', product_row.id,
      'product_name', product_row.name,
      'quantity', item_quantity,
      'unit_price', product_row.price,
      'line_total', product_row.price * item_quantity
    ));
  end loop;

  order_shipping := case when order_subtotal >= 75 then 0 else 5 end;
  order_code := 'GK-' || upper(substr(replace(order_uuid::text, '-', ''), 1, 8));

  insert into public.orders (id, order_number, status, subtotal, shipping, total)
  values (order_uuid, order_code, 'pending', order_subtotal, order_shipping, order_subtotal + order_shipping);

  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, line_total)
  select
    order_uuid,
    line ->> 'product_id',
    line ->> 'product_name',
    (line ->> 'quantity')::integer,
    (line ->> 'unit_price')::numeric,
    (line ->> 'line_total')::numeric
  from jsonb_array_elements(order_lines) as lines(line);

  return jsonb_build_object(
    'id', order_uuid,
    'order_number', order_code,
    'status', 'pending',
    'subtotal', order_subtotal,
    'shipping', order_shipping,
    'total', order_subtotal + order_shipping,
    'items', order_lines,
    'created_at', now()
  );
end;
$$;

revoke all on function public.create_store_order(jsonb) from public;
grant execute on function public.create_store_order(jsonb) to anon, authenticated, service_role;

create or replace function public.admin_dashboard_summary()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'confirmed_revenue', coalesce((
      select sum(total) from public.orders where status in ('confirmed', 'completed')
    ), 0),
    'confirmed_orders', (
      select count(*) from public.orders where status in ('confirmed', 'completed')
    ),
    'orders_today', (
      select count(*) from public.orders where created_at >= date_trunc('day', now())
    ),
    'pending_orders', (
      select count(*) from public.orders where status = 'pending'
    ),
    'active_products', (
      select count(*) from public.products where is_active = true
    ),
    'weekly_sales', coalesce((
      select jsonb_agg(jsonb_build_object('day', sales.day, 'revenue', sales.revenue) order by sales.day)
      from (
        select dates.day::date as day,
          coalesce(sum(orders.total) filter (where orders.status in ('confirmed', 'completed')), 0) as revenue
        from generate_series(current_date - 6, current_date, interval '1 day') as dates(day)
        left join public.orders as orders
          on orders.created_at >= dates.day
         and orders.created_at < dates.day + interval '1 day'
        group by dates.day
      ) as sales
    ), '[]'::jsonb),
    'recent_orders', coalesce((
      select jsonb_agg(recent_order.order_data order by recent_order.created_at desc)
      from (
        select orders.created_at,
          jsonb_build_object(
            'id', orders.id,
            'order_number', orders.order_number,
            'status', orders.status,
            'subtotal', orders.subtotal,
            'shipping', orders.shipping,
            'total', orders.total,
            'created_at', orders.created_at,
            'order_items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'product_name', items.product_name,
                'quantity', items.quantity,
                'unit_price', items.unit_price,
                'line_total', items.line_total
              ) order by items.product_name)
              from public.order_items as items
              where items.order_id = orders.id
            ), '[]'::jsonb)
          ) as order_data
        from public.orders as orders
        order by orders.created_at desc
        limit 10
      ) as recent_order
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_dashboard_summary() from public, anon, authenticated;
grant execute on function public.admin_dashboard_summary() to service_role;

insert into public.products (
  id, name, category, description, price, label, trending, image_url, image_alt,
  rating, review_count, sort_order
) values
  ('everyday-tote', 'The Everyday Tote', 'accessories', 'A useful everyday carryall with an easy, timeless shape.', 32, 'Bestseller', true, 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80', 'Neutral canvas tote bag with simple everyday styling', 4.9, 48, 10),
  ('soft-knit', 'Sunday Soft Knit', 'wear', 'An easy, soft layer for slow mornings and everyday outings.', 58, 'Just lovely', true, 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=80', 'Soft neutral knitwear folded in warm natural light', 4.8, 31, 20),
  ('stoneware-mug', 'Slow Morning Mug', 'home', 'A handmade-feel ceramic mug for a quieter start to the day.', 24, 'Small-batch', true, 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=80', 'Handmade ceramic mug on a wooden table', 5.0, 22, 30),
  ('gold-hoops', 'Little Golden Hoops', 'accessories', 'Simple golden hoops made to go with just about everything.', 28, '', true, 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=80', 'Minimal gold earrings displayed on a warm neutral background', 4.7, 19, 40),
  ('linen-cushion', 'Sunday Linen Cushion', 'home', 'Natural texture and a relaxed feel for your favorite corner.', 39, 'Bestseller', false, 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=900&q=80', 'Textured linen cushion in a calm living room', 4.9, 27, 50),
  ('daily-journal', 'A Little Daily Journal', 'wellness', 'A simple place to gather your thoughts and small plans.', 18, 'Feel-good find', false, 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=900&q=80', 'Open notebook and pen on a tidy desk', 4.8, 36, 60),
  ('weekend-shirt', 'The Weekend Shirt', 'wear', 'A relaxed shirt that makes getting dressed feel easy.', 46, '', false, 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=80', 'Relaxed neutral shirt styled for an easy weekend', 4.6, 15, 70),
  ('room-mist', 'A Quiet Moment Mist', 'wellness', 'A gentle home fragrance for a little pause in your day.', 22, 'New', false, 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=900&q=80', 'Minimal glass bottle of room fragrance with botanical details', 4.9, 12, 80)
on conflict (id) do nothing;

insert into public.banners (
  eyebrow, headline, description, button_label, category, image_url, image_alt, sort_order
) values
  ('A softer kind of shopping', 'Make room for the little joys.', 'Everyday pieces, picked with care and made to be loved.', 'Explore the edit', 'all', 'https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=2000&q=85', 'Sunlit living room with a comfortable armchair and warm natural textures', 10),
  ('The everyday collection', 'Wear what feels like you.', 'Easy layers and lovely details for wherever the day goes.', 'Shop the collection', 'wear', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=2000&q=85', 'A thoughtfully styled wardrobe in warm natural light', 20),
  ('Find your feel-good', 'A little more lovely at home.', 'Small touches that make your favorite place feel even better.', 'Bring it home', 'home', 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=2000&q=85', 'Calm, welcoming home decorated with natural materials', 30);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('storefront-media', 'storefront-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read storefront images" on storage.objects;
create policy "Public can read storefront images"
  on storage.objects for select to public using (bucket_id = 'storefront-media');
