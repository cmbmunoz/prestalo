-- =====================================================================
--  PRÉSTALO — Datos semilla (demo) · PostgreSQL
--  Coherentes con el prototipo de la app (tenants, categorías, equipos)
-- =====================================================================
SET search_path TO prestalo, public;
BEGIN;

-- Entidades (white-label)
INSERT INTO entidad (nombre, marca_color, bodega_label, activo) VALUES
  ('Préstalo — Universidad Santo Tomás', '#0E8F86', 'Pañol',  TRUE),  -- id 1
  ('LogiCorp',                           '#E8590C', 'Bodega', TRUE),  -- id 2
  ('Campus Lab',                         '#2563EB', 'Almacén',TRUE);  -- id 3

-- Categorías
INSERT INTO categoria (nombre, simbolo) VALUES
  ('Cámaras',     'camera.fill'),         -- 1
  ('Audio',       'mic.fill'),            -- 2
  ('Iluminación', 'lightbulb.fill'),      -- 3
  ('Trípodes',    'camera.on.rectangle'), -- 4
  ('Accesorios',  'bag.fill'),            -- 5
  ('Recintos',    'building.2.fill');     -- 6

-- Carrera y asignatura
INSERT INTO carrera (nombre, entidad_id) VALUES
  ('Comunicación Audiovisual Digital', 1);                 -- 1
INSERT INTO asignatura (nombre, seccion, carrera_id) VALUES
  ('Taller de Realización Audiovisual', '001', 1),         -- 1
  ('Fotografía Digital',                '002', 1);         -- 2

-- Elegibilidad: la asignatura 1 habilita cámaras, audio, iluminación, trípodes, recintos
INSERT INTO elegibilidad (asignatura_id, categoria_id) VALUES
  (1,1),(1,2),(1,3),(1,4),(1,6),
  (2,1),(2,4),(2,5);

-- Laboratorios / salas
INSERT INTO laboratorio (nombre, ubicacion, entidad_id) VALUES
  ('Pañol Central',  'Edificio B, piso 1', 1),   -- 1
  ('Estudio de TV',  'Edificio B, piso 2', 1);   -- 2

-- Usuarios demo (password_hash de ejemplo; reemplazar por hash real)
INSERT INTO usuario (rut, nombre, email, rol, estado, password_hash, entidad_id) VALUES
  ('11.111.111-1', 'Alumno Demo',    'alumno@ust.cl',   'alumno',   'activo', '$2b$12$demohashdemohashdemohas', 1),
  ('22.222.222-2', 'Docente Demo',   'docente@ust.cl',  'docente',  'activo', '$2b$12$demohashdemohashdemohas', 1),
  ('33.333.333-3', 'Pañolero Demo',  'panol@ust.cl',    'panolero', 'activo', '$2b$12$demohashdemohashdemohas', 1),
  ('44.444.444-4', 'Admin Demo',     'admin@ust.cl',    'admin',    'activo', '$2b$12$demohashdemohashdemohas', 1);

INSERT INTO usuario_asignatura (usuario_rut, asignatura_id, rol_en_asig) VALUES
  ('11.111.111-1', 1, 'alumno'),
  ('22.222.222-2', 1, 'docente');

-- Equipos (incluye recintos que requieren autorización)
INSERT INTO equipo (codigo_qr, nombre, modelo, marca, tipo, estado, condicion, requiere_autorizacion, categoria_id, laboratorio_id, entidad_id, accesorios) VALUES
  ('QR-CAM-001', 'Cámara Sony A7 III',      'A7 III',  'Sony',     'equipo', 'disponible', 'optimo', FALSE, 1, 1, 1, 'Batería x2, cargador, correa'),
  ('QR-CAM-002', 'Cámara Canon EOS R6',     'EOS R6',  'Canon',    'equipo', 'disponible', 'bueno',  FALSE, 1, 1, 1, 'Batería, tarjeta SD 64GB'),
  ('QR-AUD-001', 'Micrófono Rode VideoMic', 'VideoMic','Rode',     'equipo', 'disponible', 'bueno',  FALSE, 2, 1, 1, 'Pértiga, deadcat'),
  ('QR-LUZ-001', 'Kit LED Aputure 120D',    '120D',    'Aputure',  'equipo', 'prestado',   'bueno',  FALSE, 3, 1, 1, 'Softbox, trípode'),
  ('QR-TRI-001', 'Trípode Manfrotto 055',   '055',     'Manfrotto','equipo', 'disponible', 'optimo', FALSE, 4, 1, 1, 'Cabezal fluido'),
  ('QR-REC-001', 'Estudio de TV',           NULL,      NULL,       'recinto','disponible', 'optimo', TRUE,  6, 2, 1, 'Set de iluminación fijo, croma'),
  ('QR-REC-002', 'Sala de edición 2',       NULL,      NULL,       'recinto','disponible', 'optimo', TRUE,  6, 2, 1, '2 estaciones, Media Composer');

-- Kit de ejemplo
INSERT INTO kit (nombre, descripcion) VALUES ('Kit Reportería Básico', 'Cámara + micrófono + trípode');
INSERT INTO kit_equipo (kit_id, equipo_id) VALUES (1,1),(1,3),(1,5);

-- Reserva grupal de ejemplo (con integrantes y declaración de uso académico)
INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, es_grupal)
VALUES ('11.111.111-1', 1, now() + interval '1 day', now() + interval '2 day', 'confirmada', TRUE, TRUE);

INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable) VALUES
  (1, '11.111.111-1', 'Alumno Demo', '11.111.111-1', TRUE),
  (1, NULL,           'Compañero Uno', '55.555.555-5', FALSE);

-- Reserva de recinto con autorización multinivel pendiente
INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, es_grupal)
VALUES ('22.222.222-2', 6, now() + interval '4 day', now() + interval '4 day 3 hour', 'pendiente', TRUE, FALSE);
INSERT INTO autorizacion (reserva_id, nivel, estado) VALUES
  (2, 'jefatura_carrera',    'pendiente'),
  (2, 'direccion_academica', 'pendiente');

COMMIT;
