create extension if not exists pgcrypto;
create table if not exists public.admin_settings (
 id integer primary key,
 password_hash text not null,
 updated_at timestamptz default now()
);
create table if not exists public.products (
 id text primary key, name text not null, category text not null,
 price numeric not null default 0, old_price numeric not null default 0,
 rating numeric default 4.5, reviews text default 'New',
 stock integer not null default 0, image text, description text,
 created_at timestamptz default now()
);
create table if not exists public.coupons (
 code text primary key, type text not null check (type in ('flat','percent','shipping')),
 value numeric not null default 0, min_order numeric not null default 0,
 active boolean not null default true, created_at timestamptz default now()
);
create table if not exists public.orders (
 id text primary key, created_at timestamptz default now(),
 name text not null, phone text not null, address text not null, city text not null,
 pin text not null, payment text not null, items jsonb not null,
 subtotal numeric not null, discount numeric not null default 0,
 delivery numeric not null default 0, total numeric not null,
 coupon text, status text not null default 'Confirmed'
);
insert into storage.buckets (id,name,public)
values ('product-images','product-images',true)
on conflict (id) do update set public=true;
