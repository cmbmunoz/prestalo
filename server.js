// Servidor web Préstalo (API + PWA). Punto de entrada del contenedor.
const { app, expirarNoShow } = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Préstalo API escuchando en http://localhost:${PORT}`));

// RF-56: expiración por no-show cada 5 min, dentro del proceso web.
// En un despliegue con varias réplicas, poner DISABLE_CRON=true en las réplicas
// web y ejecutar la rutina como CronJob (jobs/expirar-noshow.js) para no duplicar trabajo.
if (process.env.DISABLE_CRON !== 'true') {
  expirarNoShow().catch(() => {});
  setInterval(() => expirarNoShow().catch(() => {}), 5 * 60 * 1000);
}
