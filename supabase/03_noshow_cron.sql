-- =====================================================================
--  RF-56 — Expiración por no-show, ejecutada dentro de Supabase (pg_cron)
--  Opcional. Reemplaza al setInterval del servidor local: corre en la
--  base de datos cada 30 min, sin necesidad de tener un servidor encendido.
--
--  Requisito: habilitar la extensión pg_cron en Supabase
--  (Dashboard → Database → Extensions → pg_cron → Enable).
-- =====================================================================
SET search_path TO public;

CREATE OR REPLACE FUNCTION public.expirar_no_show() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE reserva r SET estado='expirada',
           motivo_cancelacion='No-show: atraso > 1 h sin justificación (RF-56)'
    WHERE r.estado IN ('pendiente','confirmada')
      AND r.justificada = FALSE
      AND r.fecha_inicio < now() - interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM prestamo p WHERE p.reserva_id = r.id)
    RETURNING r.equipo_id
  )
  UPDATE equipo e SET estado='disponible'
  FROM upd WHERE e.id = upd.equipo_id AND e.estado='reservado';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Programar cada 30 minutos (ejecutar una sola vez)
SELECT cron.schedule('prestalo-noshow', '*/30 * * * *', $$SELECT public.expirar_no_show();$$);

-- Para desprogramar:  SELECT cron.unschedule('prestalo-noshow');
