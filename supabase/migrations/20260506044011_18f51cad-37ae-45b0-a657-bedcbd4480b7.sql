create table if not exists public.owner_settings (
  id uuid primary key default gen_random_uuid(),
  owner_telegram_id bigint not null unique,
  default_bio text,
  default_description text,
  default_application_fee numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.owner_settings enable row level security;

create policy "no public access owner_settings"
on public.owner_settings
for select
to public
using (false);

create trigger set_owner_settings_updated_at
before update on public.owner_settings
for each row
execute function public.set_updated_at();

alter table public.fetched_listings
add column if not exists target_group_id uuid references public.link_groups(id) on delete set null;

create index if not exists idx_fetched_listings_target_group_id
on public.fetched_listings(target_group_id);

create index if not exists idx_owner_settings_owner_telegram_id
on public.owner_settings(owner_telegram_id);