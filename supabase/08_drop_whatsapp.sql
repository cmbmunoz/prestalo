-- =====================================================================
--  Préstalo — Migración de limpieza: eliminar Consultas por WhatsApp
--  Correr UNA vez en Supabase → SQL Editor. Operación destructiva:
--  elimina la tabla de consultas y su tipo asociado.
-- =====================================================================

-- Tabla de consultas por WhatsApp (ya no se usa)
DROP TABLE IF EXISTS consulta_whatsapp;

-- Tipo usado únicamente por esa tabla
DROP TYPE IF EXISTS estado_consulta;

-- Nota: el enum "canal_notificacion" conserva el valor 'whatsapp' porque lo
-- declara el tipo (usado por la tabla "notificacion"); quitar un valor de un
-- enum en PostgreSQL exige recrear el tipo, por lo que se deja intacto.
-- El CHECK de "bitacora" puede seguir listando 'consulta_whatsapp' como texto;
-- es un literal inofensivo y no requiere cambios.
