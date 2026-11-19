-- =====================================================================
--  Pañol 2.0 — Migración 14
--  Alta de la sede Talca como entidad (Instituto Profesional Santo Tomás).
--  Queda con la regla común de 48 h de anticipación; puede ajustarse luego
--  desde Admin → Sedes o con un UPDATE sobre entidad.horas_anticipacion.
--  Idempotente (no duplica si ya existe por nombre).
-- =====================================================================
SET search_path TO public;

-- 1) Alinear la secuencia de ids con el máximo actual, por si sedes previas
--    se insertaron con id explícito sin avanzar el SERIAL.
SELECT setval(pg_get_serial_sequence('entidad', 'id'), (SELECT MAX(id) FROM entidad));

-- 2) Crear la sede Talca (id autoasignado, seguro).
INSERT INTO entidad (nombre, marca_color, bodega_label, activo, horas_anticipacion)
VALUES ('Instituto Profesional Santo Tomás — Talca', '#0E8F86', 'Pañol', TRUE, 48)
ON CONFLICT (nombre) DO NOTHING;

-- 3) Verificación: listado de sedes con su plazo de reserva.
SELECT id, nombre, bodega_label, activo, horas_anticipacion
FROM entidad
ORDER BY id;
