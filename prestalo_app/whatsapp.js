// =====================================================================
//  Préstalo — Motor del chatbot WhatsApp (RF-61)
//  Responde consultas desde los datos reales de la base y la normativa.
//  Dos niveles: (1) respuestas guiadas por intención; (2) si no resuelve,
//  deriva a una persona. El envío real por WhatsApp requiere la
//  WhatsApp Business API (Meta); ver sendWhatsApp() más abajo.
// =====================================================================
const db = require('./db');

const NORMATIVA = {
  horarios: 'El préstamo de equipos se realiza en el horario de atención del Pañol. Las reservas de equipos requieren al menos 4 h de anticipación; los recintos, 72 h.',
  reservar: 'Para reservar: ingresa a Préstalo, entra al Catálogo, elige el equipo habilitado para tu asignatura, declara el uso académico y confirma. En grupo, agrega el nombre y RUT de cada integrante.',
  recinto: 'Los recintos (estudios, salas de edición, laboratorios) requieren 72 h de anticipación y autorización de Jefatura de Carrera y Dirección Académica (DAO).',
  sancion_info: 'Las sanciones por atraso son escalonadas: hasta 1 h → 1 semana; 1 a 5 h → 2 semanas; 5 a 24 h → 1 mes. En grupo la sanción es solidaria. El daño o la pérdida bloquean hasta la reposición.',
  devolucion: 'La devolución se registra en el Pañol con la condición del equipo. Si presenta daño, quedará bloqueado hasta su reposición y se aplicará la sanción correspondiente.',
};

// Clasificación simple por palabras clave (nivel 1)
function intent(text) {
  const t = (text || '').toLowerCase();
  const has = (...k) => k.some(x => t.includes(x));
  if (has('disponib', 'hay ', 'queda', 'stock')) return 'disponibilidad';
  if (has('mi reserva', 'mis reserva', 'estado de mi', 'cuando devuelvo', 'cuándo devuelvo', 'devolver')) return 'mis_reservas';
  if (has('sancion', 'sanción', 'bloque', 'castig', 'multa')) return 'sanciones';
  if (has('recinto', 'estudio', 'sala', 'laborator')) return 'recinto';
  if (has('horario', 'hora', 'cuando abre', 'cuándo abre')) return 'horarios';
  if (has('como reservo', 'cómo reservo', 'como reservar', 'cómo reservar', 'reservar', 'reserva')) return 'reservar';
  if (has('devolu', 'entregar de vuelta', 'daño', 'dano')) return 'devolucion';
  if (has('normativa', 'reglamento', 'regla')) return 'normativa';
  if (has('hola', 'buenas', 'ayuda', 'menu', 'menú')) return 'saludo';
  return 'desconocido';
}

// Genera la respuesta (nivel 1 datos+normativa; nivel 2 derivación)
async function responder(user, text) {
  const i = intent(text);
  try {
    if (i === 'saludo')
      return { estado: 'resuelta', texto: `Hola ${user?.nombre?.split(' ')[0] || ''}. Puedo ayudarte con: disponibilidad de equipos, el estado de tus reservas, sanciones, cómo reservar, recintos y horarios. ¿Qué necesitas?` };

    if (i === 'disponibilidad') {
      const r = await db.query(
        `SELECT c.nombre AS categoria, count(*)::int AS n
         FROM equipo e JOIN categoria c ON c.id=e.categoria_id
         WHERE e.entidad_id=1 AND e.estado='disponible' GROUP BY c.nombre ORDER BY c.nombre`);
      if (!r.rows.length) return { estado: 'resuelta', texto: 'Por ahora no hay equipos disponibles. Intenta más tarde o revisa el catálogo en la app.' };
      const linea = r.rows.map(x => `${x.categoria}: ${x.n}`).join(' · ');
      return { estado: 'resuelta', texto: `Equipos disponibles ahora — ${linea}. Puedes reservar desde el Catálogo en Préstalo.` };
    }

    if (i === 'mis_reservas') {
      if (!user) return { estado: 'derivada', texto: 'Para ver tus reservas necesito identificarte. Te derivo con el Pañol.' };
      const r = await db.query(
        `SELECT e.nombre, r.fecha_inicio, r.fecha_fin, r.estado
         FROM reserva r JOIN equipo e ON e.id=r.equipo_id
         WHERE r.usuario_rut=$1 AND r.estado IN ('pendiente','confirmada','en_uso')
         ORDER BY r.fecha_inicio LIMIT 3`, [user.rut]);
      if (!r.rows.length) return { estado: 'resuelta', texto: 'No tienes reservas activas en este momento.' };
      const lineas = r.rows.map(x => `• ${x.nombre}: ${new Date(x.fecha_inicio).toLocaleString('es-CL')} (${x.estado})`).join('\n');
      return { estado: 'resuelta', texto: `Tus reservas activas:\n${lineas}` };
    }

    if (i === 'sanciones') {
      if (!user) return { estado: 'resuelta', texto: NORMATIVA.sancion_info };
      const r = await db.query(
        `SELECT motivo, fecha_fin FROM v_sanciones_vigentes WHERE usuario_rut=$1`, [user.rut]);
      if (!r.rows.length) return { estado: 'resuelta', texto: `No tienes sanciones vigentes. ${NORMATIVA.sancion_info}` };
      const s = r.rows[0];
      return { estado: 'resuelta', texto: `Tienes una sanción vigente: ${s.motivo}, hasta el ${new Date(s.fecha_fin).toLocaleDateString('es-CL')}. ${NORMATIVA.sancion_info}` };
    }

    if (i === 'recinto')  return { estado: 'resuelta', texto: NORMATIVA.recinto };
    if (i === 'horarios') return { estado: 'resuelta', texto: NORMATIVA.horarios };
    if (i === 'reservar') return { estado: 'resuelta', texto: NORMATIVA.reservar };
    if (i === 'devolucion') return { estado: 'resuelta', texto: NORMATIVA.devolucion };
    if (i === 'normativa') return { estado: 'resuelta', texto: `${NORMATIVA.sancion_info}\n${NORMATIVA.recinto}` };

    // Nivel 2: no resuelto → derivar a una persona
    return { estado: 'derivada', texto: 'No pude resolver tu consulta automáticamente. La derivé al personal del Pañol, que te contactará a la brevedad.' };
  } catch (e) {
    return { estado: 'derivada', texto: 'Tuve un problema al consultar. Te derivo con el Pañol.' };
  }
}

// Envío real por WhatsApp Business API (Meta Cloud API).
// Requiere WHATSAPP_TOKEN y WHATSAPP_PHONE_ID (número de la institución).
// Sin esas variables, opera en modo simulación (no envía; solo registra).
async function sendWhatsApp(to, texto) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    console.log(`[WhatsApp SIMULADO → ${to}] ${texto}`);
    return { simulado: true };
  }
  const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }),
  });
  return resp.json();
}

module.exports = { responder, sendWhatsApp, intent };
