// =====================================================================
//  Job de migración: aplica los scripts SQL de supabase/ en orden.
//  Usa la misma imagen de la app (ya trae 'pg'). Ejecutar antes de exponer
//  la nueva versión:  node jobs/migrate.js
//  Los scripts son idempotentes (IF NOT EXISTS). Por defecto se omiten los
//  de datos de ejemplo (*seed*); para incluirlos: INCLUDE_SEEDS=true.
// =====================================================================
const fs = require('fs');
const path = require('path');
const db = require('../db');

(async () => {
  const dir = path.join(__dirname, '..', 'supabase');
  const incluirSeeds = process.env.INCLUDE_SEEDS === 'true';
  const files = fs.readdirSync(dir)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .filter(f => incluirSeeds || !/seed/i.test(f))
    .sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    process.stdout.write('Aplicando ' + f + ' ... ');
    await db.query(sql);          // protocolo simple: admite múltiples sentencias
    console.log('ok');
  }
  console.log(`Migraciones completadas (${files.length} archivo/s).`);
  process.exit(0);
})().catch(e => { console.error('Error en migración:', e.message); process.exit(1); });
