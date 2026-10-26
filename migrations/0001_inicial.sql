-- migrations/0001_inicial.sql
-- Esquema de la base de datos Cloudflare D1 del Inventario WIP.
-- Se ejecuta UNA vez: en Cloudflare → D1 → (tu base) → Console, pega todo y presiona Execute.

CREATE TABLE IF NOT EXISTS usuarios (
  id          TEXT PRIMARY KEY,
  usuario     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre      TEXT NOT NULL,
  rol         TEXT NOT NULL CHECK (rol IN ('ADMIN', 'USUARIO')),
  pass_hash   TEXT NOT NULL,
  pass_salt   TEXT NOT NULL,
  pass_iter   INTEGER NOT NULL DEFAULT 100000,
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
  token       TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL,
  expira      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sesiones_usuario_idx ON sesiones (usuario_id);

CREATE TABLE IF NOT EXISTS sap (
  clave        TEXT PRIMARY KEY,
  lote         TEXT NOT NULL,
  material     TEXT,
  texto_breve  TEXT,
  centro       TEXT,
  almacen      TEXT,
  unidad       TEXT,
  cantidad_sap REAL NOT NULL DEFAULT 0,
  en_calidad   REAL NOT NULL DEFAULT 0,
  etapa        TEXT,
  calibre      TEXT,
  en_sap       INTEGER NOT NULL DEFAULT 1,
  actualizado_en TEXT
);
CREATE INDEX IF NOT EXISTS sap_lote_idx ON sap (lote);

CREATE TABLE IF NOT EXISTS conteos (
  id          TEXT PRIMARY KEY,
  estado      TEXT NOT NULL CHECK (estado IN ('EN_CURSO', 'CERRADO')),
  creado_en   TEXT NOT NULL,
  cerrado_en  TEXT,
  creado_por  TEXT,
  totales_sap TEXT
);

CREATE TABLE IF NOT EXISTS registros (
  id              TEXT PRIMARY KEY,
  conteo_id       TEXT NOT NULL,
  clave           TEXT NOT NULL,
  lote            TEXT NOT NULL,
  material        TEXT,
  texto_breve     TEXT,
  etapa           TEXT,
  calibre         TEXT,
  cantidad_sap    REAL,
  cantidad_fisica REAL,
  estado          TEXT,
  motivo          TEXT,
  comentario      TEXT,
  zona            TEXT,
  carril          TEXT,
  posicion        INTEGER,
  orden           INTEGER,
  usuario         TEXT,
  usuario_id      TEXT,
  creado_en       TEXT NOT NULL,
  actualizado_en  TEXT NOT NULL,
  UNIQUE (conteo_id, clave)
);
CREATE INDEX IF NOT EXISTS registros_conteo_idx ON registros (conteo_id);

CREATE TABLE IF NOT EXISTS movimientos (
  id         TEXT PRIMARY KEY,
  conteo_id  TEXT,
  lote       TEXT,
  accion     TEXT NOT NULL,
  detalle    TEXT,
  usuario    TEXT,
  usuario_id TEXT,
  creado_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movimientos_conteo_idx ON movimientos (conteo_id, creado_en);

-- Ajustes generales (meta de exactitud) y contador de versión para avisar cambios
CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT OR IGNORE INTO ajustes (clave, valor) VALUES ('meta_exactitud', '95');
INSERT OR IGNORE INTO ajustes (clave, valor) VALUES ('version', '0');
INSERT OR IGNORE INTO ajustes (clave, valor) VALUES ('version_sap', '0');
