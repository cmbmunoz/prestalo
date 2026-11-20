-- =====================================================================
--  Pañol 2.0 — Migración 15
--  Flujo de solicitud especial (excepcional) parametrizable por sede.
--
--  Política por sede (atributos de entidad, junto a horas_anticipacion):
--    - permite_solicitud_especial    : la sede habilita o no el flujo excepcional.
--    - horas_anticipacion_excepcional : plazo mínimo para una excepción
--                                       (0 = sin límite de tiempo; solo sujeta
--                                        a autorización y disponibilidad).
--    - rol_autoriza_especial          : quién autoriza en esa sede
--                                       (docente | jefe_panol | admin).
--
--  Además, cada solicitud queda anclada a su sede (entidad_id) para acotar
--  el queue de aprobación, las métricas y las políticas por sede.
--  Idempotente.
-- =====================================================================
SET search_path TO public;

-- 1) Política del flujo excepcional, por sede.
ALTER TABLE entidad ADD COLUMN IF NOT EXISTS permite_solicitud_especial    BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE entidad ADD COLUMN IF NOT EXISTS horas_anticipacion_excepcional INTEGER    NOT NULL DEFAULT 0;
ALTER TABLE entidad ADD COLUMN IF NOT EXISTS rol_autoriza_especial         VARCHAR(20) NOT NULL DEFAULT 'docente';

-- 2) Anclar cada solicitud a su sede.
ALTER TABLE solicitud_especial ADD COLUMN IF NOT EXISTS entidad_id INTEGER REFERENCES entidad(id);
CREATE INDEX IF NOT EXISTS ix_solicitud_entidad ON solicitud_especial(entidad_id);

-- 3) Backfill: la sede de la solicitud es la del solicitante.
UPDATE solicitud_especial s
   SET entidad_id = u.entidad_id
  FROM usuario u
 WHERE u.rut = s.usuario_rut
   AND s.entidad_id IS NULL;

-- 4) Verificación.
SELECT id, nombre, permite_solicitud_especial, horas_anticipacion,
       horas_anticipacion_excepcional, rol_autoriza_especial
FROM entidad
ORDER BY id;
