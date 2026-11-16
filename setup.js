// Inicializa la base: aplica schema, seed y claves demo (scrypt).
// Uso: node setup.js   (requiere la base 'prestalo_db' creada y PostgreSQL en marcha)
const fs = require('fs');
const db = require('./db');
const { hashPassword } = require('./auth');
(async () => {
  console.log('Aplicando schema…');
  await db.query(fs.readFileSync(__dirname + '/db/01_schema.sql', 'utf8'));
  console.log('Cargando datos demo…');
  await db.query(fs.readFileSync(__dirname + '/db/02_seed.sql', 'utf8'));
  console.log('Seteando claves demo (prestalo)…');
  await db.query('SET search_path TO prestalo, public');
  await db.query('UPDATE usuario SET password_hash=$1 WHERE entidad_id=1', [hashPassword('prestalo')]);
  console.log('Listo. Usuarios demo: 11.111.111-1 / 22.222.222-2 / 33.333.333-3 / 44.444.444-4  (clave: prestalo)');
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
