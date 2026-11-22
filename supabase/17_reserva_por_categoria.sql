-- =====================================================================
--  Pañol 2.0 — Migración 17
--  RF-11: el alumno reserva por CATEGORÍA (no un equipo individual).
--  El inventario toma la categoría como reservada sin individualizar la
--  unidad; el pañolero/jefe de pañol asigna la unidad física al ENTREGAR.
--
--  Por eso:
--    - reserva.equipo_id pasa a ser NULLABLE (se asigna en la entrega).
--    - reserva.categoria_id guarda la categoría reservada.
--  Idempotente.
-- =====================================================================
SET search_path TO public;

ALTER TABLE reserva ALTER COLUMN equipo_id DROP NOT NULL;
ALTER TABLE reserva ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categoria(id);
CREATE INDEX IF NOT EXISTS ix_reserva_categoria ON reserva(categoria_id);

-- Verificación.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name='reserva' AND column_name IN ('equipo_id','categoria_id')
ORDER BY column_name;
