-- =====================================================================
--  Pañol 2.0 — Migración 16
--  RF-11: las tareas se definen por CATEGORÍA (no por equipo individual).
--  El docente habilita categorías (elegibles para la asignatura) y el alumno
--  reserva una unidad disponible de esas categorías dentro de las fechas de
--  la tarea. Idempotente.
-- =====================================================================
SET search_path TO public;

-- Categorías habilitadas por tarea.
CREATE TABLE IF NOT EXISTS tarea_categoria (
  tarea_id     INTEGER NOT NULL REFERENCES tarea(id)     ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categoria(id) ON DELETE CASCADE,
  PRIMARY KEY (tarea_id, categoria_id)
);
CREATE INDEX IF NOT EXISTS ix_tarea_categoria ON tarea_categoria(tarea_id);

-- Backfill: derivar las categorías desde los equipos ya habilitados en tareas.
INSERT INTO tarea_categoria (tarea_id, categoria_id)
SELECT DISTINCT te.tarea_id, e.categoria_id
FROM tarea_equipo te
JOIN equipo e ON e.id = te.equipo_id
WHERE e.categoria_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Verificación.
SELECT t.id, t.titulo,
       COALESCE(array_agg(c.nombre ORDER BY c.nombre) FILTER (WHERE c.nombre IS NOT NULL), '{}') AS categorias
FROM tarea t
LEFT JOIN tarea_categoria tc ON tc.tarea_id = t.id
LEFT JOIN categoria c ON c.id = tc.categoria_id
GROUP BY t.id, t.titulo
ORDER BY t.id;
