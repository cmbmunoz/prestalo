-- =====================================================================
--  Pañol 2.0 — Build v20 · Migración 12 (datos demo)
--  Usuario Jefe de Pañol demo + un kit demo por asignatura.
--  Depende de 11_jefe_kits.sql (enum ya commiteado) y de 02_seed.
--  Idempotente.
-- =====================================================================
SET search_path TO public;
BEGIN;

-- Jefe de Pañol demo en la sede 1 (clave de ejemplo = la del seed base)
INSERT INTO usuario (rut, nombre, email, rol, estado, password_hash, entidad_id)
VALUES ('19.000.000-1', 'Jefe de Pañol Demo', 'jefepanol@santotomas.cl', 'jefe_panol', 'activo',
        'scrypt$7e4adb9fd1b4df577c4022e045907895$528ab3430d095ea2b5652432d4d4286ec823741a38792b3f1ec45ad0dee81ab3', 1)
ON CONFLICT (rut) DO UPDATE SET rol='jefe_panol';

-- Kit demo "Kit Reportería" asociado a la asignatura 1 (sede derivada de su carrera)
INSERT INTO kit (nombre, descripcion, asignatura_id, entidad_id)
SELECT 'Kit Reportería', 'Cámara + micrófono + trípode para salida en terreno', a.id, c.entidad_id
FROM asignatura a JOIN carrera c ON c.id=a.carrera_id
WHERE a.id = 1
  AND NOT EXISTS (SELECT 1 FROM kit k WHERE k.asignatura_id=1 AND k.nombre='Kit Reportería');

-- Líneas del kit (por modelo), tomando modelos reales del catálogo de la sede
INSERT INTO kit_item (kit_id, categoria_id, nombre, modelo, marca, cantidad)
SELECT k.id, e.categoria_id, e.nombre, e.modelo, e.marca, 1
FROM kit k
JOIN equipo e ON e.entidad_id = k.entidad_id
WHERE k.asignatura_id = 1 AND k.nombre='Kit Reportería'
  AND e.codigo_qr IN ('QR-CAM-001','QR-AUD-001','QR-TRI-001')
  AND NOT EXISTS (SELECT 1 FROM kit_item ki WHERE ki.kit_id=k.id AND ki.nombre=e.nombre);

COMMIT;
