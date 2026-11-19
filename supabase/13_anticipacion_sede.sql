-- =====================================================================
--  Pañol 2.0 — Migración 13
--  Plazo de reserva parametrizable por sede.
--  Regla común inicial: 48 h de anticipación. Cada sede puede ajustar su
--  propio plazo (entidad.horas_anticipacion). Las solicitudes excepcionales
--  se gestionan por el flujo de solicitud especial.
--  Idempotente.
-- =====================================================================
SET search_path TO public;

ALTER TABLE entidad ADD COLUMN IF NOT EXISTS horas_anticipacion INTEGER NOT NULL DEFAULT 48;

-- Dejar explícitamente la regla común (48 h) en las sedes existentes.
UPDATE entidad SET horas_anticipacion = 48 WHERE horas_anticipacion IS NULL;
