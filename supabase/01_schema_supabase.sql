-- =====================================================================
--  PRÉSTALO — Sistema de Gestión de Préstamo e Inventario de Equipos
--  Universidad Santo Tomás · Área de Comunicación Audiovisual
--  Esquema de base de datos (PostgreSQL 14+)
--  Basado en el Diagrama Entidad-Relación conceptual v2
--  (incorpora normativa UST-IPST 2018, chatbot WhatsApp y modelo
--   multi-entidad / white-label)
--
--  Convenciones:
--   - Nombres en snake_case, singular para tablas de entidad.
--   - Toda tabla lleva created_at / updated_at (trigger de auditoría).
--   - Claves foráneas con política ON DELETE explícita.
--   - Los códigos RF-xx entre comentarios enlazan con la ERS.
--  Fecha: 18 de octubre de 2026
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Esquema y extensiones
-- ---------------------------------------------------------------------
SET search_path TO public;

-- citext para correos/códigos case-insensitive (opcional pero recomendado)
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------
-- 1. Tipos enumerados
-- ---------------------------------------------------------------------
CREATE TYPE rol_usuario        AS ENUM ('alumno', 'docente', 'panolero', 'admin');
CREATE TYPE estado_usuario      AS ENUM ('activo', 'inactivo', 'suspendido');
CREATE TYPE tipo_equipo         AS ENUM ('equipo', 'recinto');            -- RF-51
CREATE TYPE estado_equipo       AS ENUM ('disponible', 'reservado', 'prestado', 'mantencion', 'baja');
CREATE TYPE condicion_equipo    AS ENUM ('optimo', 'bueno', 'con_danio', 'inoperativo');
CREATE TYPE estado_reserva      AS ENUM ('pendiente', 'confirmada', 'en_uso', 'completada', 'cancelada', 'expirada'); -- RF-56
CREATE TYPE estado_prestamo     AS ENUM ('abierto', 'devuelto', 'atrasado', 'con_incidencia');
CREATE TYPE momento_condicion   AS ENUM ('referencia', 'retiro', 'devolucion');   -- fotos RF-22 / RF-55
CREATE TYPE estado_solicitud    AS ENUM ('pendiente', 'aprobada', 'rechazada', 'respondida');
CREATE TYPE nivel_autorizacion  AS ENUM ('jefatura_carrera', 'direccion_academica'); -- RF-53 (Jefatura → DAO)
CREATE TYPE estado_autorizacion AS ENUM ('pendiente', 'aprobada', 'rechazada');
CREATE TYPE tramo_sancion       AS ENUM ('leve', 'medio', 'grave', 'reincidencia'); -- RF-57 (≤1h / 1-5h / 5-24h / reincidencia)
CREATE TYPE canal_notificacion  AS ENUM ('push', 'correo', 'sms', 'whatsapp');   -- RF-33..35 + RF-61
CREATE TYPE tipo_mantencion     AS ENUM ('preventiva', 'correctiva', 'calibracion', 'reposicion');
CREATE TYPE estado_consulta     AS ENUM ('abierta', 'resuelta', 'derivada');     -- RF-61

-- ---------------------------------------------------------------------
-- 2. Función y trigger genérico de updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 3. Entidad (white-label)  — raíz multi-tenant
-- ---------------------------------------------------------------------
CREATE TABLE entidad (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(120) NOT NULL,
    marca_color   VARCHAR(9)   NOT NULL DEFAULT '#0E7C86',   -- color de marca (hex)
    bodega_label  VARCHAR(60)  NOT NULL DEFAULT 'Pañol',     -- "Pañol" / "Bodega" / "Almacén"
    logo_url      TEXT,
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_entidad_nombre UNIQUE (nombre)
);
COMMENT ON TABLE entidad IS 'Institución o marca (white-label) que agrupa usuarios, equipos y catálogo.';

-- ---------------------------------------------------------------------
-- 4. Usuario
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
    rut           VARCHAR(12)  PRIMARY KEY,                  -- 12.345.678-9
    nombre        VARCHAR(160) NOT NULL,
    email         CITEXT,
    rol           rol_usuario  NOT NULL DEFAULT 'alumno',
    estado        estado_usuario NOT NULL DEFAULT 'activo',
    password_hash TEXT,                                      -- hash (bcrypt/argon2); nunca en texto plano
    entidad_id    INTEGER      NOT NULL REFERENCES entidad(id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_usuario_email UNIQUE (email)
);
CREATE INDEX ix_usuario_entidad ON usuario(entidad_id);
CREATE INDEX ix_usuario_rol     ON usuario(rol);

-- ---------------------------------------------------------------------
-- 5. Carrera y Asignatura
-- ---------------------------------------------------------------------
CREATE TABLE carrera (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(160) NOT NULL,
    entidad_id  INTEGER NOT NULL REFERENCES entidad(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_carrera UNIQUE (entidad_id, nombre)
);

CREATE TABLE asignatura (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(160) NOT NULL,
    seccion     VARCHAR(30),
    carrera_id  INTEGER NOT NULL REFERENCES carrera(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_asignatura_carrera ON asignatura(carrera_id);

-- Inscripción Usuario N:N Asignatura  ("inscrito")
CREATE TABLE usuario_asignatura (
    usuario_rut   VARCHAR(12) NOT NULL REFERENCES usuario(rut)    ON DELETE CASCADE,
    asignatura_id INTEGER     NOT NULL REFERENCES asignatura(id)  ON DELETE CASCADE,
    rol_en_asig   rol_usuario NOT NULL DEFAULT 'alumno',          -- alumno inscrito o docente a cargo
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (usuario_rut, asignatura_id)
);

-- ---------------------------------------------------------------------
-- 6. Catálogo: Categoría, Laboratorio, Kit, Equipo
-- ---------------------------------------------------------------------
CREATE TABLE categoria (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(120) NOT NULL,
    simbolo     VARCHAR(60),                                 -- ícono SF Symbol usado en la app
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_categoria_nombre UNIQUE (nombre)
);

CREATE TABLE laboratorio (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(120) NOT NULL,
    ubicacion   VARCHAR(160),
    entidad_id  INTEGER NOT NULL REFERENCES entidad(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kit (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(120) NOT NULL,
    descripcion TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE equipo (
    id                   SERIAL PRIMARY KEY,
    codigo_qr            VARCHAR(60)  NOT NULL,
    nombre               VARCHAR(160) NOT NULL,
    modelo               VARCHAR(120),
    marca                VARCHAR(120),
    tipo                 tipo_equipo      NOT NULL DEFAULT 'equipo',        -- RF-51 (equipo/recinto)
    estado               estado_equipo    NOT NULL DEFAULT 'disponible',
    condicion            condicion_equipo NOT NULL DEFAULT 'bueno',
    requiere_autorizacion BOOLEAN         NOT NULL DEFAULT FALSE,           -- RF-51/53
    foto_referencia      TEXT,                                             -- URL foto de referencia
    n_serie              VARCHAR(80),                                      -- RF-07 (+ N° de serie)
    accesorios           TEXT,
    categoria_id         INTEGER NOT NULL REFERENCES categoria(id)   ON DELETE RESTRICT,
    laboratorio_id       INTEGER          REFERENCES laboratorio(id) ON DELETE SET NULL,
    entidad_id           INTEGER NOT NULL REFERENCES entidad(id)     ON DELETE RESTRICT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_equipo_qr UNIQUE (codigo_qr),
    -- Un recinto siempre requiere autorización (coherencia normativa)
    CONSTRAINT ck_equipo_recinto_autoriza
        CHECK (tipo <> 'recinto' OR requiere_autorizacion = TRUE)
);
CREATE INDEX ix_equipo_categoria   ON equipo(categoria_id);
CREATE INDEX ix_equipo_entidad     ON equipo(entidad_id);
CREATE INDEX ix_equipo_estado      ON equipo(estado);

-- Kit N:N Equipo  ("compone")
CREATE TABLE kit_equipo (
    kit_id     INTEGER NOT NULL REFERENCES kit(id)    ON DELETE CASCADE,
    equipo_id  INTEGER NOT NULL REFERENCES equipo(id) ON DELETE CASCADE,
    PRIMARY KEY (kit_id, equipo_id)
);

-- Elegibilidad equipo × asignatura (RF-54): qué categorías habilita cada asignatura
CREATE TABLE elegibilidad (
    id            SERIAL PRIMARY KEY,
    asignatura_id INTEGER NOT NULL REFERENCES asignatura(id) ON DELETE CASCADE,
    categoria_id  INTEGER NOT NULL REFERENCES categoria(id)  ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_elegibilidad UNIQUE (asignatura_id, categoria_id)
);

-- ---------------------------------------------------------------------
-- 7. Reserva, Integrantes y Autorización
-- ---------------------------------------------------------------------
CREATE TABLE reserva (
    id            SERIAL PRIMARY KEY,
    usuario_rut   VARCHAR(12) NOT NULL REFERENCES usuario(rut) ON DELETE RESTRICT,
    equipo_id     INTEGER     NOT NULL REFERENCES equipo(id)   ON DELETE RESTRICT,
    fecha_inicio  TIMESTAMPTZ NOT NULL,
    fecha_fin     TIMESTAMPTZ NOT NULL,
    estado        estado_reserva NOT NULL DEFAULT 'pendiente',
    uso_academico BOOLEAN     NOT NULL DEFAULT FALSE,          -- RF-55 (declaración obligatoria)
    es_grupal     BOOLEAN     NOT NULL DEFAULT FALSE,          -- RF-52
    justificada   BOOLEAN     NOT NULL DEFAULT FALSE,          -- RF-56 (atraso justificado)
    justificacion TEXT,                                        -- RF-56 (tel/e-mail de la justificación)
    motivo        TEXT,                                        -- motivo del préstamo (flujo)
    motivo_cancelacion TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_reserva_fechas CHECK (fecha_fin > fecha_inicio)
);
CREATE INDEX ix_reserva_usuario ON reserva(usuario_rut);
CREATE INDEX ix_reserva_equipo  ON reserva(equipo_id);
CREATE INDEX ix_reserva_estado  ON reserva(estado);

-- Integrantes de una reserva grupal (RF-52): responsabilidad solidaria
CREATE TABLE integrante (
    id             SERIAL PRIMARY KEY,
    reserva_id     INTEGER NOT NULL REFERENCES reserva(id)  ON DELETE CASCADE,
    usuario_rut    VARCHAR(12)     REFERENCES usuario(rut)  ON DELETE SET NULL, -- si es usuario del sistema
    nombre         VARCHAR(160) NOT NULL,
    rut            VARCHAR(12)  NOT NULL,
    es_responsable BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_integrante_reserva_rut UNIQUE (reserva_id, rut)
);
CREATE INDEX ix_integrante_reserva ON integrante(reserva_id);

-- Autorización multinivel para recintos / jornada nocturna (RF-51/53)
CREATE TABLE autorizacion (
    id          SERIAL PRIMARY KEY,
    reserva_id  INTEGER NOT NULL REFERENCES reserva(id) ON DELETE CASCADE,
    nivel       nivel_autorizacion  NOT NULL,
    estado      estado_autorizacion NOT NULL DEFAULT 'pendiente',
    autorizante VARCHAR(160),                                  -- nombre/rut de quien autoriza
    comentario  TEXT,
    fecha       TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_autorizacion_nivel UNIQUE (reserva_id, nivel)
);
CREATE INDEX ix_autorizacion_reserva ON autorizacion(reserva_id);

-- ---------------------------------------------------------------------
-- 8. Préstamo y Registro de condición (fotos)
-- ---------------------------------------------------------------------
CREATE TABLE prestamo (
    id                  SERIAL PRIMARY KEY,
    reserva_id          INTEGER      REFERENCES reserva(id) ON DELETE SET NULL, -- 0..1
    usuario_rut         VARCHAR(12) NOT NULL REFERENCES usuario(rut) ON DELETE RESTRICT,
    equipo_id           INTEGER     NOT NULL REFERENCES equipo(id)   ON DELETE RESTRICT,
    panolero_rut        VARCHAR(12)      REFERENCES usuario(rut) ON DELETE SET NULL, -- quien entrega/recibe
    fecha_salida        TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_retorno       TIMESTAMPTZ,
    condicion_salida    condicion_equipo,
    condicion_retorno   condicion_equipo,
    estado              estado_prestamo NOT NULL DEFAULT 'abierto',
    requiere_reposicion BOOLEAN     NOT NULL DEFAULT FALSE,     -- RF-59 (daño / pérdida)
    observacion         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_prestamo_reserva UNIQUE (reserva_id),        -- Reserva 1 : 0..1 Préstamo
    CONSTRAINT ck_prestamo_fechas
        CHECK (fecha_retorno IS NULL OR fecha_retorno >= fecha_salida)
);
CREATE INDEX ix_prestamo_usuario ON prestamo(usuario_rut);
CREATE INDEX ix_prestamo_equipo  ON prestamo(equipo_id);
CREATE INDEX ix_prestamo_estado  ON prestamo(estado);

-- Fotos de referencia / retiro / devolución (RF-22, RF-55)
CREATE TABLE registro_condicion (
    id          SERIAL PRIMARY KEY,
    prestamo_id INTEGER NOT NULL REFERENCES prestamo(id) ON DELETE CASCADE,
    momento     momento_condicion NOT NULL,
    foto_url    TEXT NOT NULL,
    observacion TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_regcond_prestamo ON registro_condicion(prestamo_id);

-- ---------------------------------------------------------------------
-- 9. Mantención
-- ---------------------------------------------------------------------
CREATE TABLE mantencion (
    id          SERIAL PRIMARY KEY,
    equipo_id   INTEGER NOT NULL REFERENCES equipo(id) ON DELETE CASCADE,
    tipo        tipo_mantencion NOT NULL DEFAULT 'correctiva',
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    detalle     TEXT,
    costo       NUMERIC(12,2),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_mantencion_equipo ON mantencion(equipo_id);

-- ---------------------------------------------------------------------
-- 10. Sanción  (motor escalonado RF-57 / solidaria RF-58)
-- ---------------------------------------------------------------------
CREATE TABLE sancion (
    id            SERIAL PRIMARY KEY,
    usuario_rut   VARCHAR(12) NOT NULL REFERENCES usuario(rut) ON DELETE CASCADE,
    asignatura_id INTEGER          REFERENCES asignatura(id) ON DELETE SET NULL, -- alcance por asignatura (RF-57)
    reserva_id    INTEGER          REFERENCES reserva(id)    ON DELETE SET NULL, -- origen de la sanción
    motivo        VARCHAR(240) NOT NULL,
    tramo         tramo_sancion NOT NULL,
    fecha_inicio  DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_fin     DATE NOT NULL,
    solidaria     BOOLEAN NOT NULL DEFAULT FALSE,               -- RF-58
    vigente       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sancion_fechas CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX ix_sancion_usuario ON sancion(usuario_rut);
CREATE INDEX ix_sancion_vigente ON sancion(vigente);

-- ---------------------------------------------------------------------
-- 11. Notificación  (push/correo/sms/whatsapp + informe docente RF-60)
-- ---------------------------------------------------------------------
CREATE TABLE notificacion (
    id            SERIAL PRIMARY KEY,
    usuario_rut   VARCHAR(12) NOT NULL REFERENCES usuario(rut) ON DELETE CASCADE,
    canal         canal_notificacion NOT NULL DEFAULT 'push',
    destinatario  VARCHAR(160),                                 -- correo/teléfono/token, o docente (RF-60)
    asunto        VARCHAR(200),
    mensaje       TEXT NOT NULL,
    leida         BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_envio   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_notificacion_usuario ON notificacion(usuario_rut);

-- ---------------------------------------------------------------------
-- 12. Solicitud especial
-- ---------------------------------------------------------------------
CREATE TABLE solicitud_especial (
    id            SERIAL PRIMARY KEY,
    usuario_rut   VARCHAR(12) NOT NULL REFERENCES usuario(rut)  ON DELETE CASCADE,
    asignatura_id INTEGER          REFERENCES asignatura(id)    ON DELETE SET NULL,
    docente_rut   VARCHAR(12)      REFERENCES usuario(rut)      ON DELETE SET NULL, -- quien responde
    descripcion   TEXT NOT NULL,
    estado        estado_solicitud NOT NULL DEFAULT 'pendiente',
    respuesta     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_solicitud_usuario ON solicitud_especial(usuario_rut);

-- ---------------------------------------------------------------------
-- 13. Consulta por WhatsApp (chatbot RF-61)
-- ---------------------------------------------------------------------
CREATE TABLE consulta_whatsapp (
    id           SERIAL PRIMARY KEY,
    usuario_rut  VARCHAR(12)      REFERENCES usuario(rut) ON DELETE SET NULL, -- puede no estar identificado
    telefono     VARCHAR(20) NOT NULL,
    rol          rol_usuario,
    consulta     TEXT NOT NULL,
    respuesta    TEXT,
    estado       estado_consulta NOT NULL DEFAULT 'abierta',
    fecha        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_consulta_telefono ON consulta_whatsapp(telefono);

-- ---------------------------------------------------------------------
-- 14. Bitácora de auditoría (RF-49)
-- ---------------------------------------------------------------------
CREATE TABLE bitacora (
    id          BIGSERIAL PRIMARY KEY,
    usuario_rut VARCHAR(12) REFERENCES usuario(rut) ON DELETE SET NULL,
    entidad     VARCHAR(60) NOT NULL,     -- tabla afectada
    registro_id VARCHAR(60),              -- id del registro afectado
    accion      VARCHAR(20) NOT NULL,     -- INSERT / UPDATE / DELETE / LOGIN ...
    detalle     JSONB,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_bitacora_fecha ON bitacora(fecha);

-- ---------------------------------------------------------------------
-- 15. Triggers updated_at
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
     'entidad','usuario','carrera','asignatura','categoria','laboratorio','kit',
     'equipo','reserva','autorizacion','prestamo','mantencion','sancion',
     'solicitud_especial','consulta_whatsapp'])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 16. Vistas de apoyo
-- ---------------------------------------------------------------------
-- Equipos disponibles por entidad
CREATE VIEW v_equipos_disponibles AS
SELECT e.id, e.codigo_qr, e.nombre, c.nombre AS categoria, e.tipo, e.entidad_id
FROM equipo e
JOIN categoria c ON c.id = e.categoria_id
WHERE e.estado = 'disponible';

-- Sanciones vigentes por usuario (para bloquear reservas)
CREATE VIEW v_sanciones_vigentes AS
SELECT s.usuario_rut, s.asignatura_id, s.motivo, s.tramo, s.fecha_fin
FROM sancion s
WHERE s.vigente = TRUE AND s.fecha_fin >= CURRENT_DATE;

COMMIT;
