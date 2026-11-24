// Servidor web Pañol 2.0 (API + PWA). Punto de entrada del contenedor.
const { app, expirarNoShow, liberarEnRevision } = require('./app');
const { migrate } = require('./migrate');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pañol 2.0 API escuchando en http://localhost:${PORT}`));

// Migración idempotente al arranque (columnas/valores nuevos; segura si ya existen).
migrate().catch(() => {});

// RF-56: expiración por no-show + liberación de equipos «En revisión», cada 5 min.
// En un despliegue con varias réplicas, poner DISABLE_CRON=true en las réplicas
// web y ejecutar las rutinas como CronJob para no duplicar trabajo.
if (process.env.DISABLE_CRON !== 'true') {
  expirarNoShow().catch(() => {});
  liberarEnRevision().catch(() => {});
  setInterval(() => { expirarNoShow().catch(() => {}); liberarEnRevision().catch(() => {}); }, 5 * 60 * 1000);
}
