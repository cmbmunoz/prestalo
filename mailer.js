// =====================================================================
//  Préstalo — Envío de correo y token de recuperación de contraseña
//  Usa nodemailer con SMTP (configurable por variables de entorno).
//  Sin credenciales SMTP, opera en modo simulación (registra el enlace).
// =====================================================================
const crypto = require('crypto');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* opcional */ }

const SECRET = process.env.PRESTALO_SECRET || 'prestalo-dev-secret-cambiar';

// Token de recuperación firmado (válido 1 hora), sin estado en la base.
function makeResetToken(rut) {
  const payload = Buffer.from(JSON.stringify({ rut, exp: Date.now() + 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyResetToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (crypto.createHmac('sha256', SECRET).update(payload).digest('base64url') !== sig) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > o.exp) return null;
    return o;
  } catch { return null; }
}

async function sendResetEmail(to, link) {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || 'Préstalo <no-reply@prestalo.app>';
  if (!host || !user || !pass || !nodemailer) {
    console.log(`[EMAIL SIMULADO → ${to}] Enlace de recuperación: ${link}`);
    return { simulado: true };
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
  });
  await transport.sendMail({
    from, to, subject: 'Recuperación de contraseña — Préstalo',
    html: `
      <div style="font-family:Arial,sans-serif;color:#1a2230">
        <h2 style="color:#0E8F86">Préstalo · Universidad Santo Tomás</h2>
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${link}" style="background:#0E8F86;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Restablecer contraseña</a></p>
        <p style="font-size:13px;color:#666">El enlace es válido por 1 hora. Si no solicitaste esto, ignora este correo.</p>
        <p style="font-size:12px;color:#999">${link}</p>
      </div>`,
  });
  return { enviado: true };
}

module.exports = { makeResetToken, verifyResetToken, sendResetEmail };
