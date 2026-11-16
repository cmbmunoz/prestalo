-- =====================================================================
--  Préstalo — Datos académicos multi-sede (demo)
--  Permite que el Docente Demo (22.222.222-2) tenga una asignatura en la
--  SEDE 2 además de la sede 1 → queda habilitado para operar multi-sede.
--  Depende de 02_seed y 09_emulacion_multisede. Idempotente.
-- =====================================================================
SET search_path TO public;
BEGIN;

-- Carrera en la sede 2 (Viña del Mar)
INSERT INTO carrera (nombre, entidad_id)
VALUES ('Comunicación Audiovisual Digital', 2)
ON CONFLICT (entidad_id, nombre) DO NOTHING;

-- Asignatura de esa carrera (sede 2)
INSERT INTO asignatura (nombre, seccion, carrera_id)
SELECT 'Producción en Terreno', '001', c.id
FROM carrera c
WHERE c.entidad_id = 2 AND c.nombre = 'Comunicación Audiovisual Digital'
  AND NOT EXISTS (
    SELECT 1 FROM asignatura a WHERE a.carrera_id = c.id AND a.nombre = 'Producción en Terreno');

-- Docente Demo a cargo en la asignatura de la sede 2 (solo si el usuario existe)
INSERT INTO usuario_asignatura (usuario_rut, asignatura_id, rol_en_asig)
SELECT '22.222.222-2', a.id, 'docente'
FROM asignatura a JOIN carrera c ON c.id = a.carrera_id
WHERE c.entidad_id = 2 AND a.nombre = 'Producción en Terreno'
  AND EXISTS (SELECT 1 FROM usuario u WHERE u.rut = '22.222.222-2')
ON CONFLICT (usuario_rut, asignatura_id) DO NOTHING;

-- Alumno de la sede 2 inscrito en esa asignatura (solo si el usuario existe)
INSERT INTO usuario_asignatura (usuario_rut, asignatura_id, rol_en_asig)
SELECT '12.345.678-5', a.id, 'alumno'
FROM asignatura a JOIN carrera c ON c.id = a.carrera_id
WHERE c.entidad_id = 2 AND a.nombre = 'Producción en Terreno'
  AND EXISTS (SELECT 1 FROM usuario u WHERE u.rut = '12.345.678-5')
ON CONFLICT (usuario_rut, asignatura_id) DO NOTHING;

-- Elegibilidad: habilita Cámaras (1) y Trípodes (4) para esa asignatura
INSERT INTO elegibilidad (asignatura_id, categoria_id)
SELECT a.id, v.cat
FROM asignatura a JOIN carrera c ON c.id = a.carrera_id
CROSS JOIN (VALUES (1), (4)) AS v(cat)
WHERE c.entidad_id = 2 AND a.nombre = 'Producción en Terreno'
  AND NOT EXISTS (
    SELECT 1 FROM elegibilidad el WHERE el.asignatura_id = a.id AND el.categoria_id = v.cat);

-- Un par de unidades más en sede 2 para ver cantidades
INSERT INTO equipo (codigo_qr, nombre, modelo, marca, tipo, estado, condicion, requiere_autorizacion, categoria_id, entidad_id) VALUES
  ('QR-VINA-TRI-1', 'Trípode Manfrotto 190', '190', 'Manfrotto', 'equipo', 'disponible', 'bueno', FALSE, 4, 2),
  ('QR-VINA-CAM-2', 'Cámara Sony A7 III',    'A7 III', 'Sony',    'equipo', 'disponible', 'bueno', FALSE, 1, 2)
ON CONFLICT (codigo_qr) DO NOTHING;

COMMIT;
