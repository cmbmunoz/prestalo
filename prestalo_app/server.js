// Servidor local de desarrollo. En producción (Netlify) se usa netlify/functions/api.js.
const { app, expirarNoShow } = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Préstalo API escuchando en http://localhost:${PORT}`));
// RF-56: rutina periódica de expiración por no-show (cada 5 min) — solo en el servidor local
expirarNoShow().catch(() => {});
setInterval(() => expirarNoShow().catch(() => {}), 5 * 60 * 1000);
