// Conexión a PostgreSQL.
// - Producción (Supabase/Netlify): usa DATABASE_URL con SSL. Las tablas viven en el schema public.
// - Desarrollo local: socket/usuario locales, schema prestalo.
const { Pool } = require('pg');

const useUrl = !!process.env.DATABASE_URL;

// SSL configurable: por defecto activado (Supabase lo exige). En una base
// PostgreSQL interna del clúster, desactivar con DB_SSL=false.
const sslUrl = process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };

const pool = new Pool(useUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: sslUrl,
      max: Number(process.env.PG_POOL_MAX || 3),
    }
  : {
      host: process.env.PGHOST || '/var/run/postgresql',
      database: process.env.PGDATABASE || 'prestalo_db',
      user: process.env.PGUSER || 'root',
      port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
      options: '-c search_path=prestalo,public',   // schema local
    });

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
