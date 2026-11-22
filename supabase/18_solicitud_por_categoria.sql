-- =====================================================================
--  Pañol 2.0 — Migración 18
--  RF-11: la solicitud especial se pide por CATEGORÍA (no por equipo
--  individual). Al aprobar, se materializa una reserva por categoría
--  (sin individualizar); el pañolero asigna la unidad al entregar.
--  Idempotente.
-- =====================================================================
SET search_path TO public;

CREATE TABLE IF NOT EXISTS solicitud_categoria (
  solicitud_id INTEGER NOT NULL REFERENCES solicitud_especial(id) ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categoria(id)          ON DELETE CASCADE,
  PRIMARY KEY (solicitud_id, categoria_id)
);
CREATE INDEX IF NOT EXISTS ix_solicitud_categoria ON solicitud_categoria(solicitud_id);

-- Backfill: derivar categorías desde los equipos ya pedidos en solicitudes.
INSERT INTO solicitud_categoria (solicitud_id, categoria_id)
SELECT DISTINCT se.solicitud_id, e.categoria_id
FROM solicitud_equipo se
JOIN equipo e ON e.id = se.equipo_id
WHERE e.categoria_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Verificación.
SELECT s.id,
       COALESCE(array_agg(c.nombre ORDER BY c.nombre) FILTER (WHERE c.nombre IS NOT NULL), '{}') AS categorias
FROM solicitud_especial s
LEFT JOIN solicitud_categoria sc ON sc.solicitud_id = s.id
LEFT JOIN categoria c ON c.id = sc.categoria_id
GROUP BY s.id
ORDER BY s.id;
