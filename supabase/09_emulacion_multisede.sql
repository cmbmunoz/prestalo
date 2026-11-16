-- =====================================================================
--  PRÉSTALO — Emulación de datos institucionales multisede
--  DATI-N3001 · Integración con API de Santo Tomás (personas y sedes)
--
--  PROPÓSITO
--  Mientras la API de Santo Tomás no entregue sede / rut / nombre, estos
--  datos EMULAN esa fuente para poder operar y probar el sistema multisede.
--  Cuando la API esté disponible, estos registros se reemplazan por la
--  sincronización real (ver "Requerimientos de Integración", SOL-API-01..06).
--
--  Idempotente: puede ejecutarse varias veces sin duplicar.
-- =====================================================================
SET search_path TO public;
BEGIN;

-- 1) Sedes (entidad) como sedes reales del Instituto Profesional Santo Tomás.
--    La API entregará el catálogo oficial de sedes; aquí se emula.
UPDATE entidad SET nombre = 'Instituto Profesional Santo Tomás — Santiago Centro', bodega_label = 'Pañol'  WHERE id = 1;
UPDATE entidad SET nombre = 'Instituto Profesional Santo Tomás — Viña del Mar',     bodega_label = 'Pañol'  WHERE id = 2;
UPDATE entidad SET nombre = 'Instituto Profesional Santo Tomás — Concepción',        bodega_label = 'Pañol'  WHERE id = 3;

-- Por si la instalación tuviera menos de 3 sedes, se asegura su existencia.
INSERT INTO entidad (id, nombre, marca_color, bodega_label, activo) VALUES
  (2, 'Instituto Profesional Santo Tomás — Viña del Mar', '#0E8F86', 'Pañol', TRUE),
  (3, 'Instituto Profesional Santo Tomás — Concepción',   '#0E8F86', 'Pañol', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2) Personas (usuario) emuladas con los campos que entregará la API:
--    sede (entidad_id) · rut · nombre. Clave inicial de demo: "prestalo".
--    El hash es el mismo de la semilla base (scrypt de "prestalo").
INSERT INTO usuario (rut, nombre, email, rol, estado, password_hash, entidad_id) VALUES
  -- Sede 2 · Viña del Mar
  ('55.555.555-5', 'Pañolero Viña',   'panol.vina@santotomas.cl',  'panolero', 'activo', 'scrypt$7e4adb9fd1b4df577c4022e045907895$528ab3430d095ea2b5652432d4d4286ec823741a38792b3f1ec45ad0dee81ab3', 2),
  ('66.666.666-6', 'Admin Viña',      'admin.vina@santotomas.cl',  'admin',    'activo', 'scrypt$7e4adb9fd1b4df577c4022e045907895$528ab3430d095ea2b5652432d4d4286ec823741a38792b3f1ec45ad0dee81ab3', 2),
  ('12.345.678-5', 'Alumno Viña',     'alumno.vina@santotomas.cl', 'alumno',   'activo', 'scrypt$7e4adb9fd1b4df577c4022e045907895$528ab3430d095ea2b5652432d4d4286ec823741a38792b3f1ec45ad0dee81ab3', 2),
  -- Sede 3 · Concepción
  ('77.777.777-7', 'Pañolero Concepción', 'panol.conce@santotomas.cl', 'panolero', 'activo', 'scrypt$7e4adb9fd1b4df577c4022e045907895$528ab3430d095ea2b5652432d4d4286ec823741a38792b3f1ec45ad0dee81ab3', 3),
  ('88.888.888-8', 'Admin Concepción',    'admin.conce@santotomas.cl', 'admin',    'activo', 'scrypt$7e4adb9fd1b4df577c4022e045907895$528ab3430d095ea2b5652432d4d4286ec823741a38792b3f1ec45ad0dee81ab3', 3)
ON CONFLICT (rut) DO NOTHING;

-- 3) Inventario mínimo por sede (para que el panel y el catálogo no salgan vacíos).
--    categoria_id 1 = Cámaras (de la semilla base).
INSERT INTO equipo (codigo_qr, nombre, modelo, marca, tipo, estado, condicion, requiere_autorizacion, categoria_id, entidad_id) VALUES
  ('QR-VINA-CAM-1',  'Cámara Sony A7 III', 'A7III', 'Sony', 'equipo', 'disponible', 'bueno', FALSE, 1, 2),
  ('QR-CONCE-CAM-1', 'Cámara Canon R6',    'R6',    'Canon','equipo', 'disponible', 'bueno', FALSE, 1, 3)
ON CONFLICT (codigo_qr) DO NOTHING;

COMMIT;

-- =====================================================================
--  Cuentas de demostración resultantes (clave: prestalo)
--  Sede 1 · Santiago Centro : 11.111.111-1 (alumno) · 22.222.222-2 (docente)
--                             33.333.333-3 (pañolero) · 44.444.444-4 (admin)
--  Sede 2 · Viña del Mar     : 55.555.555-5 (pañolero) · 66.666.666-6 (admin) · 12.345.678-5 (alumno)
--  Sede 3 · Concepción       : 77.777.777-7 (pañolero) · 88.888.888-8 (admin)
--  Un administrador puede, además, inspeccionar cualquier sede desde el
--  selector de sede del panel (encabezado) — cabecera X-Sede-Id.
-- =====================================================================
