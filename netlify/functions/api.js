// Netlify Function: expone la API Express de Préstalo en /.netlify/functions/api
// Las rutas de la app son /api/...  El netlify.toml reescribe /api/* hacia aquí.
const serverless = require('serverless-http');
const { app } = require('../../app');

const handler = serverless(app, {
  // Tipos binarios en la RESPUESTA (descarga de plantillas .xlsx, imágenes)
  binary: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream', 'image/*',
  ],
});

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  // Normaliza el path para que Express vea /api/...
  let p = event.path || '/';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/api')) p = '/api' + (p === '' || p === '/' ? '' : p);
  event.path = p || '/';
  return handler(event, context);
};
