// =====================================================================
//  Préstalo — Asistente de IA (agente acotado a la app + normativa UST)
//  Proveedor: Anthropic (Messages API). Requiere ANTHROPIC_API_KEY.
//  MVP: responde consultas sobre el uso de la app y la normativa del
//  pañol, con "grounding" en el texto de la normativa (sin inventar).
//  Guardarraíl: solo responde temas de Préstalo y de la universidad.
// =====================================================================

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ASISTENTE_MODEL || 'claude-haiku-5-5';
const MAX_TOKENS = Number(process.env.ASISTENTE_MAX_TOKENS || 700);

// --- Base de conocimiento: normativa del Departamento de Pañol UST-IPST 2018 ---
const NORMATIVA = `
NORMATIVA DEL DEPARTAMENTO DE PAÑOL (UST-IPST). Aplica a estudiantes diurnos y vespertinos
de Comunicación Audiovisual Digital, Sonido, Animación Digital y Multimedia, Publicidad,
Periodismo, Relaciones Públicas y Diseño Gráfico.

SOLICITUD DE EQUIPOS
1. Las reservas de equipos, estudios y/o salas de edición deben hacerse con un mínimo de 4 horas
   de anticipación a la fecha de recepción; de lo contrario, no tienen validez.
2. Reservas en jornada nocturna (Estudios de Televisión, Sonido, Laboratorios de Animación,
   Media Composer): mínimo 72 horas de anticipación, con autorización previa de la Jefatura de
   Carrera y de Dirección Académica y/o DAO. La solicitud debe incluir nombre y RUT de TODOS los
   integrantes que usarán las instalaciones.
3. La recepción de los equipos debe ser a la hora estipulada. Un retraso de 1 hora sin
   justificación previa (telefónica o por e-mail) anula la reserva: no se entregan los equipos ni
   recintos reservados.
4. Es obligación del estudiante revisar junto al personal de Pañol los equipos al momento de la
   recepción y de la devolución. Pañol no entrega equipos en mal estado; en casos extraordinarios
   se adjuntan observaciones.
5. Ante cualquier duda sobre el funcionamiento de los equipos, pedir ayuda al personal de Pañol.
6. El estándar de equipamiento por asignatura define qué equipos puede pedir cada alumno: no se
   pueden solicitar equipos que no correspondan a la asignatura. Esta información se consulta a la
   Jefatura de Carrera.
7. El equipamiento es solo para proyectos académicos, no para proyectos personales.

SANCIONES (por atraso en la devolución, sin justificación previa)
1. Atraso de hasta 1 hora: 1 semana sin préstamo de equipos a todos los estudiantes involucrados.
2. Atraso de 1 a 5 horas: 2 semanas sin préstamo.
3. Atraso de 5 a 24 horas: suspensión de préstamo por 1 mes a todos los involucrados.
4. La suspensión es válida solo para la asignatura en la que se produjo el atraso.
5. En trabajos grupales la sanción alcanza a todos los integrantes; no se aceptan solicitudes
   especiales de los docentes de la asignatura.
6. Todo atraso sin justificación genera además un informe al docente de la asignatura.
7. La reincidencia en los tramos 1 y 2 implica no poder solicitar equipos durante todo el semestre.
8. Entrega del equipamiento en mal estado (ampolletas quemadas, falta de accesorios, daños o
   pérdidas): no se prestan equipos hasta reponer el bien afectado.
9. Pérdida o daño total irreparable: el equipo debe ser reemplazado. Si es reparable, Pañol
   proporciona el contacto del servicio técnico oficial.
10. Daño intencional: se aplica el Reglamento de Convivencia y Responsabilidad Disciplinaria.
11. Pañol, el Área de Comunicación del IP y la Escuela de Comunicaciones de la UST no están
    autorizados a recibir dinero por equipos dañados.
12. Cualquier situación no contemplada la resuelven en conjunto la Dirección del Área de
    Comunicación del IP Santo Tomás, la Dirección de la Escuela de Comunicaciones de la UST y la
    Dirección de Administración y Operaciones (DAO) de la sede.
`.trim();

// --- Cómo se usa Préstalo (FAQ funcional de la app) ---
const APP_FAQ = `
QUÉ ES PRÉSTALO
Préstalo es la plataforma de préstamo e inventario de equipos del Área de Comunicación
Audiovisual de la Universidad Santo Tomás (evolución de "Pañol Online"). Tiene app móvil (iOS)
y sitio web.

PERFILES Y ACCESO
- Perfiles: Alumno, Docente, Pañolero y Administrador. Cada uno ve acciones distintas según su rol.
- Ingreso con RUT o correo institucional + clave. Si olvidaste la clave, usa "¿Olvidaste tu
  contraseña?": llega un enlace de recuperación al correo.

FLUJO DE PRÉSTAMO
Reserva → aprobación → entrega (check-out) → uso → devolución (check-in).
- El alumno reserva un equipo disponible desde el catálogo.
- El docente o el pañolero aprueban según corresponda.
- La entrega y la devolución se registran (idealmente con escaneo de código QR del equipo).

FUNCIONES PRINCIPALES
- Catálogo con disponibilidad por fechas.
- Estado de cada equipo (disponible, prestado, en mantención, pendiente de reposición).
- Reservas, solicitudes especiales y seguimiento desde el teléfono.
- Para pañolero/admin: inventario, mantenciones y reportes/KPIs.
`.trim();

// --- Instrucciones del sistema (alcance + guardarraíles + anti-alucinación) ---
function systemPrompt() {
  return `Eres el asistente virtual de "Préstalo", la plataforma de préstamo e inventario de
equipos del Área de Comunicación Audiovisual de la Universidad Santo Tomás (UST).

TU ALCANCE (y solo este):
1) Cómo usar la aplicación Préstalo.
2) La normativa del pañol de la UST y temas académicos relacionados con el préstamo de equipos.

REGLAS:
- Responde ÚNICAMENTE preguntas dentro de ese alcance. Si te preguntan cualquier otra cosa
  (noticias, programación general, temas personales, etc.), responde exactamente:
  "Solo puedo ayudarte con Préstalo y con temas del pañol de la Universidad Santo Tomás."
- Básate SOLO en la información de CONTEXTO que se te entrega (normativa y guía de la app).
  No inventes plazos, sanciones ni funciones. Si la respuesta no está en el contexto, dilo con
  claridad y sugiere consultar al personal de Pañol o a la Jefatura de Carrera.
- Cita la regla concreta cuando corresponda (por ejemplo, los plazos y las sanciones exactas).
- Sé breve, claro y amable. Usa español de Chile. No uses tecnicismos innecesarios.
- No des asesoría legal ni interpretaciones del reglamento más allá de lo que dice el texto.

CONTEXTO — NORMATIVA:
${NORMATIVA}

CONTEXTO — GUÍA DE LA APP:
${APP_FAQ}`;
}

// Normaliza el historial que manda el cliente a mensajes de la Messages API.
function toMessages(pregunta, historial) {
  const msgs = [];
  if (Array.isArray(historial)) {
    for (const h of historial.slice(-8)) {
      if (!h || !h.texto) continue;
      msgs.push({ role: h.rol === 'asistente' ? 'assistant' : 'user', content: String(h.texto).slice(0, 2000) });
    }
  }
  msgs.push({ role: 'user', content: String(pregunta).slice(0, 2000) });
  // La Messages API exige que el primer mensaje sea de rol "user".
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

async function responder(pregunta, historial) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' };
  }
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt(),
    messages: toMessages(pregunta, historial),
  };
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, error: `Error del proveedor (${resp.status})`, detalle: txt.slice(0, 300) };
  }
  const data = await resp.json();
  const texto = Array.isArray(data.content)
    ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
    : '';
  return { ok: true, respuesta: texto || 'No tengo una respuesta para eso.' };
}

module.exports = { responder, MODEL };
