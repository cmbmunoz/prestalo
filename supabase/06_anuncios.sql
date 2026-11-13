-- =====================================================================
--  Préstalo — Migración: Anuncios (tablón de avisos por sede)
--  Correr UNA vez en Supabase → SQL Editor. Idempotente (IF NOT EXISTS).
-- =====================================================================
CREATE TABLE IF NOT EXISTS anuncio (
  id          SERIAL PRIMARY KEY,
  entidad_id  INTEGER NOT NULL REFERENCES entidad(id) ON DELETE CASCADE,
  titulo      VARCHAR(160) NOT NULL,
  cuerpo      TEXT NOT NULL,
  creado_por  VARCHAR(12) REFERENCES usuario(rut) ON DELETE SET NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_anuncio_entidad ON anuncio(entidad_id, activo);
