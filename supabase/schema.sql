-- supabase/schema.sql
-- Pégalo completo en Supabase → SQL Editor → New query → Run.
-- Crea las tablas de la app de inventario WIP y activa el tiempo real.

create table if not exists public.bultos (
  id              uuid primary key default gen_random_uuid(),
  clave           text not null unique,          -- material|lote (un lote puede existir en varios materiales)
  lote            text not null,                 -- = número de BULTO de la etiqueta
  material        text not null default '',
  texto_breve     text not null default '',
  centro          text not null default '',
  almacen         text not null default '',
  unidad          text not null default '',
  cantidad_sap    numeric not null default 0,    -- Libre utilización
  en_calidad      numeric not null default 0,    -- En control de calidad
  etapa           text not null default 'OTRO',  -- VIRGEN | RECUBIERTA | IMPRESA | OTRO
  calibre         text not null default '',      -- 70 | 75 | ALU | ''
  en_sap          boolean not null default true, -- false = ya no vino en el último reporte
  estado          text not null default 'PENDIENTE', -- PENDIENTE | OK | DIFERENCIA | SOBRANTE
  cantidad_fisica numeric,
  verificado_por  text,
  verificado_en   timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index if not exists bultos_lote_idx on public.bultos (lote);
create index if not exists bultos_estado_idx on public.bultos (estado);

create table if not exists public.movimientos (
  id         uuid primary key default gen_random_uuid(),
  lote       text not null default '',
  accion     text not null,
  detalle    text not null default '',
  usuario    text,
  creado_en  timestamptz not null default now()
);

create index if not exists movimientos_creado_idx on public.movimientos (creado_en desc);

-- ------------------------------------------------------------------
-- Permisos (FASE DE PRUEBAS)
-- Cualquiera que tenga la URL de la app puede leer y escribir.
-- Antes de pasar a producción hay que activar inicio de sesión y
-- cambiar estas políticas a "solo usuarios autenticados".
-- ------------------------------------------------------------------
alter table public.bultos enable row level security;
alter table public.movimientos enable row level security;

drop policy if exists "pruebas_bultos" on public.bultos;
create policy "pruebas_bultos" on public.bultos
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "pruebas_movimientos" on public.movimientos;
create policy "pruebas_movimientos" on public.movimientos
  for all to anon, authenticated using (true) with check (true);

-- Tiempo real: los celulares ven los cambios al instante
do $$
begin
  alter publication supabase_realtime add table public.bultos;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.movimientos;
exception when duplicate_object then null;
end $$;
