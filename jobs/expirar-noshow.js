// =====================================================================
//  Job de un solo uso: expira las reservas vencidas por no-show (RF-56).
//  Pensado para ejecutarse como CronJob del orquestador, p. ej.:
//    node jobs/expirar-noshow.js
//  En las réplicas web, poner DISABLE_CRON=true para no duplicar la tarea.
// =====================================================================
const { expirarNoShow } = require('../app');

expirarNoShow()
  .then((r) => { console.log('Expiración por no-show completada', r || ''); process.exit(0); })
  .catch((e) => { console.error('Error en expiración por no-show:', e.message); process.exit(1); });
