// =====================================================================
//  PRÉSTALO — Backend/API (Node + Express + PostgreSQL)
//  Login por perfil (alumno/docente/panolero/admin), validaciones y
//  restricciones según la normativa UST-IPST 2018.
//  White-label OCULTO: entidad fija, sin selector ni marca conmutable.
// =====================================================================
const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const db = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');
const mailer = require('./mailer');
const asistente = require('./asistente');

const app = express();
app.use(express.json({ limit: '6mb' })); // permite foto de referencia (data URI) en la ficha
app.use(express.static(path.join(__dirname, 'public')));

const ANTICIPACION_RECINTO_H = 72;   // RF-53 (recintos, con autorización)
const ANTICIPACION_MIN_H = 48;       // Regla común a las sedes (48 h). Parametrizable por sede (entidad.horas_anticipacion).

// RF-11: el plazo de anticipación se cuenta en HORAS HÁBILES (lunes a viernes;
// sábado y domingo no suman). Se usa en la validación de reservas.
function horasHabilesEntre(desde, hasta) {
  if (!(hasta > desde)) return 0;
  let total = 0;
  let d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  for (; d < hasta; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();                    // 0 domingo, 6 sábado
    if (wd === 0 || wd === 6) continue;
    const diaIni = new Date(d);
    const diaFin = new Date(d); diaFin.setDate(diaFin.getDate() + 1);
    const segIni = new Date(Math.max(diaIni, desde));
    const segFin = new Date(Math.min(diaFin, hasta));
    if (segFin > segIni) total += (segFin - segIni) / 3600000;
  }
  return total;
}
const DEMO_PASSWORD = 'prestalo';

// ----------------------- Middleware de sesión -----------------------
async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const p = verifyToken(token);
  if (!p) return res.status(401).json({ error: 'No autenticado' });
  const { rows } = await db.query(
    `SELECT rut, nombre, rol, estado, email, entidad_id FROM usuario WHERE rut=$1`,
    [p.rut]);
  if (!rows.length) return res.status(401).json({ error: 'Usuario no válido' });
  if (rows[0].estado !== 'activo') return res.status(403).json({ error: 'Usuario inactivo o suspendido' });
  req.user = rows[0];
  // --- Sedes permitidas por rol (multi-sede) ---
  //  admin   → todas; docente → las sedes de las carreras de sus asignaturas;
  //  alumno/pañolero → solo su sede. El alumno queda SIEMPRE en una sola sede.
  if (req.user.rol === 'admin') {
    req.sedesPermitidas = null; // null = todas
  } else if (req.user.rol === 'docente') {
    const s = (await db.query(
      `SELECT DISTINCT c.entidad_id FROM usuario_asignatura ua
       JOIN asignatura a ON a.id=ua.asignatura_id
       JOIN carrera c ON c.id=a.carrera_id
       WHERE ua.usuario_rut=$1 AND ua.rol_en_asig='docente'`, [req.user.rut])).rows.map(r => r.entidad_id);
    if (!s.includes(req.user.entidad_id)) s.push(req.user.entidad_id);
    req.sedesPermitidas = s;
  } else {
    req.sedesPermitidas = [req.user.entidad_id];
  }
  // Sede efectiva y bandera "Todos". X-Sede-Id: número (una sede) o "todos".
  const hdr = (req.headers['x-sede-id'] || '').toString().trim().toLowerCase();
  const puedeMulti = req.sedesPermitidas === null || req.sedesPermitidas.length > 1;
  req.sedeTodos = (hdr === 'todos' && puedeMulti);
  const hdrSede = parseInt(hdr, 10);
  const permitida = hdrSede && (req.sedesPermitidas === null || req.sedesPermitidas.includes(hdrSede));
  req.sede = permitida ? hdrSede : req.user.entidad_id;
  next();
}
// Lista de ids de sede para un scope "todos" (admin = todas; docente = sus sedes)
async function sedesScope(req) {
  if (req.sedesPermitidas === null) return (await db.query(`SELECT id FROM entidad WHERE activo=TRUE`)).rows.map(r => r.id);
  return req.sedesPermitidas;
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.rol) ? next()
    : res.status(403).json({ error: 'No autorizado para este perfil' });

// Grupos de roles (build v20): el Jefe de Pañol comparte la operación con el
// pañolero y, además, el catálogo/mantención de SU sede (como el admin, pero
// restringido por sede vía req.sede). El pañolero sigue siendo solo operativo.
const OPERACION = ['panolero', 'jefe_panol', 'admin']; // agenda, entregar, recibir, pedidos, bloqueos, import
const PANOL_SEDE = ['jefe_panol', 'admin'];            // crear/editar equipos, estado, mantenciones (de su sede)

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e); res.status(500).json({ error: 'Error interno', detalle: e.message });
});

// Health check para orquestadores de contenedores (liveness/readiness). Público, sin auth.
app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok', db: 'up' }); }
  catch (e) { res.status(503).json({ status: 'degraded', db: 'down' }); }
});

// Endpoint de test de conectividad (DATI-N3001 7.7): 200 si todo OK, 500 si falla.
// Informa recursos y variables de entorno SIN exponer credenciales ni cadenas de conexión.
app.get('/api/test-conectividad', async (req, res) => {
  const checks = {};
  let ok = true;
  try { await db.query('SELECT 1'); checks.base_datos = 'ok'; }
  catch (e) { checks.base_datos = 'error'; ok = false; }
  // Marcadores para recursos externos a configurar (sFTP / web services / intranet)
  checks.sftp = process.env.SFTP_HOST ? 'configurado' : 'no_configurado';
  checks.intranet_api = process.env.INTRANET_API_URL ? 'configurado' : 'no_configurado';
  const entorno = {
    node: process.version,
    entorno: process.env.NODE_ENV || 'development',
    db_ssl: process.env.DB_SSL === 'false' ? 'off' : 'on',
    integraciones: {
      correo: Boolean(process.env.SMTP_HOST),
      asistente_ia: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  };
  res.status(ok ? 200 : 500).json({ status: ok ? 'ok' : 'error', checks, entorno });
});

// ----------------------- Autenticación -----------------------
app.post('/api/login', wrap(async (req, res) => {
  const { rut, email, password } = req.body || {};
  if ((!rut && !email) || !password)
    return res.status(400).json({ error: 'Ingresa tu RUT o correo y la clave' });
  // Login por correo o por RUT, según lo que venga
  const { rows } = email
    ? await db.query(
        `SELECT rut, nombre, rol, estado, password_hash FROM usuario WHERE lower(email)=lower($1)`,
        [email])
    : await db.query(
        `SELECT rut, nombre, rol, estado, password_hash FROM usuario WHERE rut=$1`,
        [rut]);
  if (!rows.length || !verifyPassword(password, rows[0].password_hash))
    return res.status(401).json({ error: 'Credenciales inválidas' });
  if (rows[0].estado !== 'activo') return res.status(403).json({ error: 'Usuario inactivo o suspendido' });
  const u = rows[0];
  const token = signToken({ rut: u.rut, rol: u.rol, exp: Date.now() + 8 * 3600 * 1000 });
  res.json({ token, user: { rut: u.rut, nombre: u.nombre, rol: u.rol } });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const asigs = await db.query(
    `SELECT a.id, a.nombre, a.seccion FROM usuario_asignatura ua
     JOIN asignatura a ON a.id=ua.asignatura_id WHERE ua.usuario_rut=$1`, [req.user.rut]);
  // Sedes en las que el usuario puede operar (para el selector multi-sede)
  const ids = await sedesScope(req);
  let sedes = [];
  if (ids.length) {
    try {
      sedes = (await db.query(`SELECT id, nombre, horas_anticipacion, permite_solicitud_especial, horas_anticipacion_excepcional, rol_autoriza_especial FROM entidad WHERE id = ANY($1) ORDER BY nombre`, [ids])).rows;
    } catch (e) {
      if (e.code !== '42703') throw e; // columnas de política aún sin migrar
      try {
        sedes = (await db.query(`SELECT id, nombre, horas_anticipacion FROM entidad WHERE id = ANY($1) ORDER BY nombre`, [ids])).rows;
      } catch (e2) {
        if (e2.code !== '42703') throw e2;
        sedes = (await db.query(`SELECT id, nombre FROM entidad WHERE id = ANY($1) ORDER BY nombre`, [ids])).rows;
      }
    }
  }
  res.json({
    user: req.user,
    asignaturas: asigs.rows,
    sedes,                                   // [{id, nombre}]
    sede_activa: req.sede,
    multisede: sedes.length > 1,             // true → mostrar selector de sede
  });
}));

// Mis asignaturas: ramos del usuario con carrera y categorías de equipo habilitadas
app.get('/api/mis-asignaturas', auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.id, a.nombre, a.seccion, c.nombre AS carrera, ua.rol_en_asig,
            COALESCE(array_agg(DISTINCT cat.nombre) FILTER (WHERE cat.nombre IS NOT NULL), '{}') AS categorias
     FROM usuario_asignatura ua
     JOIN asignatura a ON a.id = ua.asignatura_id
     JOIN carrera c ON c.id = a.carrera_id
     LEFT JOIN elegibilidad el ON el.asignatura_id = a.id
     LEFT JOIN categoria cat ON cat.id = el.categoria_id
     WHERE ua.usuario_rut = $1
     GROUP BY a.id, a.nombre, a.seccion, c.nombre, ua.rol_en_asig
     ORDER BY a.nombre`, [req.user.rut]);
  res.json(rows);
}));

// Tareas de una asignatura (verifica que el usuario esté inscrito en ella)
app.get('/api/asignaturas/:id/tareas', auth, wrap(async (req, res) => {
  const aid = Number(req.params.id);
  const insc = await db.query(`SELECT rol_en_asig FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, aid]);
  if (!insc.rowCount && req.user.rol !== 'admin') return res.status(403).json({ error: 'No estás inscrito en esta asignatura' });
  const esDoc = req.user.rol === 'admin' || (insc.rows[0] && insc.rows[0].rol_en_asig === 'docente');
  if (esDoc) {
    const { rows } = await db.query(
      `SELECT t.id, t.titulo, t.tipo, t.fecha_inicio, t.fecha_fin, a.nombre AS asignatura, a.seccion,
              (SELECT count(*)::int FROM reserva r WHERE r.tarea_id=t.id) AS reservas
       FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id
       WHERE t.asignatura_id=$1 ORDER BY t.fecha_inicio DESC`, [aid]);
    return res.json(rows);
  }
  const { rows } = await db.query(
    `SELECT t.id, t.titulo, t.tipo, t.fecha_inicio, t.fecha_fin, a.nombre AS asignatura, a.seccion
     FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id
     WHERE t.asignatura_id=$1 AND t.fecha_fin >= now() ORDER BY t.fecha_inicio`, [aid]);
  res.json(rows);
}));

// Compañeros de una asignatura (verifica inscripción)
app.get('/api/asignaturas/:id/companeros', auth, wrap(async (req, res) => {
  const aid = Number(req.params.id);
  const insc = await db.query(`SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, aid]);
  if (!insc.rowCount && req.user.rol !== 'admin') return res.status(403).json({ error: 'No estás inscrito en esta asignatura' });
  const { rows } = await db.query(
    `SELECT u.nombre, u.rol, ua.rol_en_asig
     FROM usuario_asignatura ua JOIN usuario u ON u.rut=ua.usuario_rut
     WHERE ua.asignatura_id=$1 AND ua.usuario_rut <> $2
     ORDER BY ua.rol_en_asig DESC, u.nombre`, [aid, req.user.rut]);
  res.json(rows);
}));

// ----------------------- Catálogo de equipos -----------------------
// Alumno/Docente ven solo lo elegible para su asignatura (RF-54).
app.get('/api/equipos', auth, wrap(async (req, res) => {
  const todos = req.query.scope === 'todos' && (req.sedesPermitidas === null || req.sedesPermitidas.length > 1);
  const sedeIds = todos ? await sedesScope(req) : [req.sede];
  const base = `
    SELECT e.id, e.codigo_qr, e.nombre, e.modelo, e.marca, e.tipo, e.estado,
           e.condicion, e.requiere_autorizacion, e.foto_referencia, e.accesorios, e.n_serie,
           c.nombre AS categoria, c.id AS categoria_id, c.simbolo,
           l.nombre AS laboratorio, ent.id AS sede_id, ent.nombre AS sede
    FROM equipo e
    JOIN categoria c ON c.id=e.categoria_id
    LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
    JOIN entidad ent ON ent.id=e.entidad_id
    WHERE e.entidad_id = ANY($1)`;
  if (req.user.rol === 'alumno' || req.user.rol === 'docente') {
    const { rows } = await db.query(
      `${base} AND c.id IN (
          SELECT el.categoria_id FROM elegibilidad el
          JOIN usuario_asignatura ua ON ua.asignatura_id=el.asignatura_id
          WHERE ua.usuario_rut=$2)
       ORDER BY ent.nombre, e.tipo, c.nombre, e.nombre`, [sedeIds, req.user.rut]);
    return res.json(rows);
  }
  const { rows } = await db.query(`${base} ORDER BY ent.nombre, e.tipo, c.nombre, e.nombre`, [sedeIds]);
  res.json(rows);
}));

// Resumen de inventario por artículo, con cantidades por sede y total (para reserva e inventario)
app.get('/api/inventario/resumen', auth, wrap(async (req, res) => {
  const todos = req.query.scope === 'todos' && (req.sedesPermitidas === null || req.sedesPermitidas.length > 1);
  const sedeIds = todos ? await sedesScope(req) : [req.sede];
  const { rows } = await db.query(
    `SELECT c.nombre AS categoria, e.nombre AS articulo, ent.id AS sede_id, ent.nombre AS sede,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE e.estado='disponible')::int AS disponible,
            COUNT(*) FILTER (WHERE e.estado='prestado')::int  AS prestado,
            COUNT(*) FILTER (WHERE e.estado='reservado')::int AS reservado,
            COUNT(*) FILTER (WHERE e.estado='mantencion')::int AS mantencion,
            COUNT(*) FILTER (WHERE e.estado='baja')::int       AS baja
     FROM equipo e JOIN categoria c ON c.id=e.categoria_id JOIN entidad ent ON ent.id=e.entidad_id
     WHERE e.entidad_id = ANY($1)
     GROUP BY c.nombre, e.nombre, ent.id, ent.nombre
     ORDER BY c.nombre, e.nombre, ent.nombre`, [sedeIds]);
  res.json(rows);
}));

app.get('/api/equipos/:id', auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.*, c.nombre AS categoria, c.simbolo, l.nombre AS laboratorio
     FROM equipo e JOIN categoria c ON c.id=e.categoria_id
     LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
     WHERE e.id=$1 AND e.entidad_id=$2`, [req.params.id, req.sede]);
  if (!rows.length) return res.status(404).json({ error: 'Equipo no encontrado' });
  res.json(rows[0]);
}));

// Foto de referencia del equipo (pañolero/jefe de pañol/admin). Acepta data URI o URL; null la quita.
app.put('/api/equipos/:id/foto', auth, requireRole('panolero', 'jefe_panol', 'admin'), wrap(async (req, res) => {
  let { foto } = req.body || {};
  if (foto === undefined) foto = null;
  if (foto !== null) {
    if (typeof foto !== 'string') return res.status(400).json({ error: 'Formato de imagen no válido' });
    if (foto.length > 5_500_000) return res.status(413).json({ error: 'La imagen es demasiado grande. Usa una más liviana.' });
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(foto) && !/^https?:\/\//.test(foto))
      return res.status(400).json({ error: 'Formato de imagen no válido' });
  }
  const r = await db.query(`UPDATE equipo SET foto_referencia=$2 WHERE id=$1 AND entidad_id=$3`, [req.params.id, foto, req.sede]);
  if (!r.rowCount) return res.status(404).json({ error: 'Equipo no encontrado' });
  res.json({ ok: true });
}));

// ----------------------- Reservas (validaciones normativa) -----------------------
app.post('/api/reservas', auth, requireRole('alumno', 'docente'), wrap(async (req, res) => {
  const { equipo_id, fecha_inicio, fecha_fin, uso_academico, asignatura_id, integrantes, motivo } = req.body || {};
  if (!equipo_id || !fecha_inicio || !fecha_fin)
    return res.status(400).json({ error: 'Faltan datos de la reserva' });

  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin), now = new Date();
  if (isNaN(ini) || isNaN(fin)) return res.status(400).json({ error: 'Fechas inválidas' });
  if (fin <= ini) return res.status(400).json({ error: 'La fecha de término debe ser posterior al inicio' });
  if (ini < now) return res.status(400).json({ error: 'La reserva no puede iniciar en el pasado' });

  // RF-55: declaración de uso académico obligatoria
  if (uso_academico !== true)
    return res.status(400).json({ error: 'Debe declarar el uso exclusivamente académico (RF-55)' });

  // Equipo
  const eq = (await db.query(
    `SELECT * FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, req.sede])).rows[0];
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  if (eq.estado !== 'disponible')
    return res.status(409).json({ error: `El equipo no está disponible (estado: ${eq.estado})` });

  // RF-54: elegibilidad equipo × asignatura (alumno/docente)
  const asig = asignatura_id || null;
  if (asig) {
    const eleg = await db.query(
      `SELECT 1 FROM elegibilidad WHERE asignatura_id=$1 AND categoria_id=$2`, [asig, eq.categoria_id]);
    if (!eleg.rows.length)
      return res.status(403).json({ error: 'El equipo no está habilitado para tu asignatura (RF-54)' });
    const insc = await db.query(
      `SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, asig]);
    if (!insc.rows.length)
      return res.status(403).json({ error: 'No estás inscrito en esa asignatura' });
  }

  // RF-57/58: sanción vigente bloquea la reserva (alcance global o por asignatura)
  const sanc = await db.query(
    `SELECT motivo, asignatura_id, fecha_fin FROM v_sanciones_vigentes
     WHERE usuario_rut=$1 AND (asignatura_id IS NULL OR asignatura_id=$2)`, [req.user.rut, asig]);
  if (sanc.rows.length)
    return res.status(403).json({ error: `Bloqueado por sanción vigente: ${sanc.rows[0].motivo} (hasta ${sanc.rows[0].fecha_fin})` });

  // Plazo de reserva: 48 h de anticipación como regla común, parametrizable por sede
  // (entidad.horas_anticipacion). Las solicitudes excepcionales van por el flujo especial.
  let minHoras = ANTICIPACION_MIN_H;
  try {
    const cfg = (await db.query(`SELECT horas_anticipacion FROM entidad WHERE id=$1`, [eq.entidad_id])).rows[0];
    if (cfg && Number.isFinite(Number(cfg.horas_anticipacion))) minHoras = Number(cfg.horas_anticipacion);
  } catch (e) { if (e.code !== '42703') throw e; } // 42703 = columna aún sin migrar → usa el valor común

  // RF-51/53: recinto o equipo que requiere autorización → autorización Jefatura/DAO
  // RF-11: la anticipación se cuenta en HORAS HÁBILES (días hábiles, sin fin de semana).
  const esRecinto = eq.tipo === 'recinto' || eq.requiere_autorizacion;
  const horas = horasHabilesEntre(now, ini);
  if (esRecinto) {
    const reqH = Math.max(ANTICIPACION_RECINTO_H, minHoras);
    if (horas < reqH)
      return res.status(400).json({ error: `Los recintos requieren al menos ${reqH} h hábiles de anticipación (RF-53)` });
  } else if (horas < minHoras) {
    return res.status(400).json({ error: `El plazo de reserva es de al menos ${minHoras} h hábiles de anticipación (días hábiles). Para casos excepcionales, gestiona una solicitud especial.` });
  }

  // Bloqueo de horarios: periodo no disponible para este equipo (o global)
  try {
    const bloq = await db.query(
      `SELECT motivo, fecha_inicio, fecha_fin FROM bloqueo_horario
       WHERE (equipo_id = $1 OR equipo_id IS NULL) AND fecha_inicio < $3 AND fecha_fin > $2
       ORDER BY fecha_inicio LIMIT 1`, [equipo_id, ini, fin]);
    if (bloq.rows.length)
      return res.status(409).json({ error: `Horario bloqueado para este equipo: ${bloq.rows[0].motivo}` });
  } catch (e) { if (e.code !== '42P01') throw e; } // tabla aún no migrada → se omite

  // RF-52: reserva grupal
  const grupo = Array.isArray(integrantes) ? integrantes.filter(i => i && i.nombre && i.rut) : [];
  const esGrupal = grupo.length > 0;

  const estado = esRecinto ? 'pendiente' : 'confirmada';
  const r = (await db.query(
    `INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, es_grupal, motivo)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7) RETURNING id`,
    [req.user.rut, equipo_id, ini, fin, estado, esGrupal, motivo || null])).rows[0];

  // Integrantes (responsabilidad solidaria): el solicitante es responsable
  await db.query(
    `INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable)
     VALUES ($1,$2,$3,$4,TRUE)`, [r.id, req.user.rut, req.user.nombre, req.user.rut]);
  for (const g of grupo) {
    if (g.rut === req.user.rut) continue;
    await db.query(
      `INSERT INTO integrante (reserva_id, nombre, rut, es_responsable) VALUES ($1,$2,$3,FALSE)
       ON CONFLICT (reserva_id, rut) DO NOTHING`, [r.id, g.nombre, g.rut]);
  }

  // Autorización multinivel para recintos (RF-51/53)
  if (esRecinto) {
    await db.query(`INSERT INTO autorizacion (reserva_id, nivel, estado) VALUES ($1,'jefatura_carrera','pendiente'),($1,'direccion_academica','pendiente')`, [r.id]);
  }

  // Aprobación de grupos: una reserva grupal queda pendiente de validación del grupo
  if (esGrupal) {
    try { await db.query(`UPDATE reserva SET grupo_estado='pendiente' WHERE id=$1`, [r.id]); }
    catch (e) { if (e.code !== '42703') throw e; } // columna aún no migrada → se omite
  }

  // Equipo pasa a reservado
  await db.query(`UPDATE equipo SET estado='reservado' WHERE id=$1`, [equipo_id]);

  res.status(201).json({
    id: r.id, estado,
    mensaje: esRecinto
      ? 'Reserva creada. Requiere autorización de Jefatura de Carrera y Dirección Académica (DAO).'
      : (esGrupal ? 'Reserva confirmada. El grupo queda pendiente de aprobación del docente.' : 'Reserva confirmada.')
  });
}));

app.get('/api/mis-reservas', auth, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.es_grupal, r.uso_academico,
              COALESCE(e.nombre, '(unidad por asignar)') AS equipo, e.tipo,
              COALESCE(ce.nombre, cr.nombre) AS categoria,
              (r.equipo_id IS NULL) AS por_individualizar,
              (SELECT count(*) FROM integrante i WHERE i.reserva_id=r.id) AS integrantes
       FROM reserva r
       LEFT JOIN equipo e ON e.id=r.equipo_id
       LEFT JOIN categoria ce ON ce.id=e.categoria_id
       LEFT JOIN categoria cr ON cr.id=r.categoria_id
       WHERE r.usuario_rut=$1 ORDER BY r.fecha_inicio DESC`, [req.user.rut]);
    return res.json(rows);
  } catch (e) { if (e.code !== '42703') throw e; } // migración 17 sin aplicar → esquema previo
  const { rows } = await db.query(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.es_grupal, r.uso_academico,
            e.nombre AS equipo, e.tipo, c.nombre AS categoria,
            (SELECT count(*) FROM integrante i WHERE i.reserva_id=r.id) AS integrantes
     FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE r.usuario_rut=$1 ORDER BY r.fecha_inicio DESC`, [req.user.rut]);
  res.json(rows);
}));

// ----------------------- Flujo de préstamo (lista + detalle) -----------------------
// Lista para la pestaña "Préstamos", con el estado del flujo por reserva.
app.get('/api/flujo', auth, wrap(async (req, res) => {
  const soloMios = (req.user.rol === 'alumno' || req.user.rol === 'docente');
  const params = [req.sede];
  let filtro = '';
  if (soloMios) { params.push(req.user.rut); filtro = 'AND r.usuario_rut=$2'; }
  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT r.id, r.estado, r.fecha_inicio, r.fecha_fin, r.usuario_rut,
              COALESCE(e.nombre, '(unidad por asignar)') AS equipo, e.marca,
              COALESCE(ce.nombre, cr.nombre) AS categoria, u.nombre AS solicitante,
              (SELECT p.estado FROM prestamo p WHERE p.reserva_id=r.id) AS prestamo_estado
       FROM reserva r
       JOIN usuario u ON u.rut=r.usuario_rut
       LEFT JOIN equipo e ON e.id=r.equipo_id
       LEFT JOIN categoria ce ON ce.id=e.categoria_id
       LEFT JOIN categoria cr ON cr.id=r.categoria_id
       WHERE COALESCE(e.entidad_id, u.entidad_id)=$1 ${filtro}
       ORDER BY r.fecha_inicio DESC LIMIT 100`, params));
  } catch (e) {
    if (e.code !== '42703') throw e; // migración 17 sin aplicar → esquema previo
    ({ rows } = await db.query(
      `SELECT r.id, r.estado, r.fecha_inicio, r.fecha_fin, r.usuario_rut,
              e.nombre AS equipo, e.marca, c.nombre AS categoria, u.nombre AS solicitante,
              (SELECT p.estado FROM prestamo p WHERE p.reserva_id=r.id) AS prestamo_estado
       FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
       JOIN usuario u ON u.rut=r.usuario_rut
       WHERE e.entidad_id=$1 ${filtro}
       ORDER BY r.fecha_inicio DESC LIMIT 100`, params));
  }
  const flowOf = (estado, pe) => {
    if (pe === 'devuelto' || estado === 'completada') return 'devuelto';
    if (pe === 'abierto' || pe === 'atrasado') return 'entregado';
    if (estado === 'confirmada') return 'aprobada';
    if (estado === 'cancelada' || estado === 'expirada') return estado;
    return 'pendiente';
  };
  res.json(rows.map(r => ({
    id: r.id, folio: 'PR-' + String(r.id).padStart(4, '0'),
    equipo: r.equipo, marca: r.marca, categoria: r.categoria,
    solicitante: r.solicitante, flow: flowOf(r.estado, r.prestamo_estado),
    fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin,
  })));
}));

// Detalle de un préstamo/solicitud con el flujo y el historial (prototipo).
app.get('/api/flujo/:id', auth, wrap(async (req, res) => {
  let r;
  try {
    r = (await db.query(
      `SELECT r.*, COALESCE(e.nombre, '(unidad por asignar)') AS equipo, e.marca, e.codigo_qr,
              COALESCE(ce.nombre, cr.nombre) AS categoria, COALESCE(l.nombre, '—') AS laboratorio
       FROM reserva r
       LEFT JOIN equipo e ON e.id=r.equipo_id
       LEFT JOIN categoria ce ON ce.id=e.categoria_id
       LEFT JOIN categoria cr ON cr.id=r.categoria_id
       LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
       WHERE r.id=$1`, [req.params.id])).rows[0];
  } catch (e) {
    if (e.code !== '42703') throw e; // migración 17 sin aplicar
    r = (await db.query(
      `SELECT r.*, e.nombre AS equipo, e.marca, e.codigo_qr, c.nombre AS categoria, COALESCE(l.nombre, '—') AS laboratorio
       FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
       LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
       WHERE r.id=$1`, [req.params.id])).rows[0];
  }
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  if ((req.user.rol === 'alumno' || req.user.rol === 'docente') && r.usuario_rut !== req.user.rut)
    return res.status(403).json({ error: 'No autorizado' });

  const prestamo = (await db.query(`SELECT * FROM prestamo WHERE reserva_id=$1`, [r.id])).rows[0];
  const sol = (await db.query(`SELECT nombre FROM usuario WHERE rut=$1`, [r.usuario_rut])).rows[0];

  let flow = 'pendiente';
  if (r.estado === 'confirmada') flow = 'aprobada';
  if (prestamo && ['abierto', 'atrasado'].includes(prestamo.estado)) flow = 'entregado';
  if ((prestamo && prestamo.estado === 'devuelto') || r.estado === 'completada') flow = 'devuelto';

  const hist = [];
  hist.push({ orden: 1, evento: 'Solicitud enviada', actor: sol?.nombre || r.usuario_rut, fecha: r.created_at, nota: r.motivo || null });
  if (!['pendiente', 'cancelada', 'expirada'].includes(r.estado)) {
    const aut = (await db.query(
      `SELECT autorizante, fecha FROM autorizacion WHERE reserva_id=$1 AND estado='aprobada' ORDER BY fecha DESC LIMIT 1`, [r.id])).rows[0];
    hist.push({ orden: 2, evento: 'Solicitud aprobada', actor: aut?.autorizante || 'Pañol', fecha: aut?.fecha || r.updated_at, nota: null });
  }
  if (prestamo) {
    const pan = prestamo.panolero_rut
      ? (await db.query(`SELECT nombre FROM usuario WHERE rut=$1`, [prestamo.panolero_rut])).rows[0] : null;
    hist.push({ orden: 3, evento: 'Equipo entregado', actor: pan?.nombre || 'Pañol', fecha: prestamo.fecha_salida, nota: prestamo.observacion || null });
    if (prestamo.estado === 'devuelto')
      hist.push({ orden: 4, evento: 'Equipo devuelto', actor: pan?.nombre || 'Pañol', fecha: prestamo.fecha_retorno, nota: prestamo.condicion_retorno ? ('Condición: ' + prestamo.condicion_retorno) : null });
  }
  res.json({
    id: r.id, folio: 'PR-' + String(r.id).padStart(4, '0'), flow, estado: r.estado,
    equipo: { nombre: r.equipo, marca: r.marca, codigo_qr: r.codigo_qr, categoria: r.categoria },
    periodo: { inicio: r.fecha_inicio, fin: r.fecha_fin },
    cantidad: 1, ubicacion: r.laboratorio, motivo: r.motivo || null,
    historial: hist.filter(h => h.fecha).sort((a, b) => a.orden - b.orden).map(({ orden, ...h }) => h),
  });
}));

app.post('/api/reservas/:id/cancelar', auth, wrap(async (req, res) => {
  const r = (await db.query(`SELECT * FROM reserva WHERE id=$1`, [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (r.usuario_rut !== req.user.rut && !['panolero', 'admin'].includes(req.user.rol))
    return res.status(403).json({ error: 'No puedes cancelar esta reserva' });
  if (['completada', 'cancelada'].includes(r.estado))
    return res.status(409).json({ error: 'La reserva ya está cerrada' });
  await db.query(`UPDATE reserva SET estado='cancelada', motivo_cancelacion=$2 WHERE id=$1`,
    [r.id, req.body?.motivo || 'Cancelada por el usuario']);
  await db.query(`UPDATE equipo SET estado='disponible' WHERE id=$1 AND estado='reservado'`, [r.equipo_id]);
  res.json({ ok: true });
}));

// Reprogramación de horario de retiro (build v20): edita fecha/hora de una
// reserva coordinada con el estudiante, manteniendo la prioridad de las clases
// (bloqueos) y validando choques con otras reservas del mismo equipo.
app.put('/api/reservas/:id/reprogramar', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const { fecha_inicio, fecha_fin, motivo } = req.body || {};
  if (!fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Faltan fecha de inicio y término' });
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin), now = new Date();
  if (isNaN(ini) || isNaN(fin)) return res.status(400).json({ error: 'Fechas inválidas' });
  if (fin <= ini) return res.status(400).json({ error: 'La fecha de término debe ser posterior al inicio' });
  if (ini < now) return res.status(400).json({ error: 'La nueva fecha no puede estar en el pasado' });

  // Reserva de la sede activa
  const r = (await db.query(
    `SELECT r.*, e.entidad_id FROM reserva r JOIN equipo e ON e.id=r.equipo_id
     WHERE r.id=$1 AND e.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (['completada', 'cancelada', 'expirada'].includes(r.estado))
    return res.status(409).json({ error: 'La reserva ya está cerrada' });

  // No reprogramar un préstamo ya entregado
  const prest = (await db.query(
    `SELECT estado FROM prestamo WHERE reserva_id=$1`, [r.id])).rows[0];
  if (prest && ['abierto', 'atrasado'].includes(prest.estado))
    return res.status(409).json({ error: 'El equipo ya fue entregado; no se puede reprogramar' });

  // Prioridad de clases: no puede caer sobre un bloqueo de horario del equipo (o global)
  try {
    const bloq = (await db.query(
      `SELECT motivo FROM bloqueo_horario
       WHERE (equipo_id=$1 OR equipo_id IS NULL) AND fecha_inicio < $3 AND fecha_fin > $2
       ORDER BY fecha_inicio LIMIT 1`, [r.equipo_id, ini, fin])).rows[0];
    if (bloq) return res.status(409).json({ error: `El nuevo horario choca con un bloqueo (prioridad de clases): ${bloq.motivo}` });
  } catch (e) { if (e.code !== '42P01') throw e; }

  // Choque con otra reserva activa del mismo equipo
  const choque = (await db.query(
    `SELECT id FROM reserva
     WHERE equipo_id=$1 AND id<>$2 AND estado IN ('pendiente','confirmada','en_uso')
       AND fecha_inicio < $4 AND fecha_fin > $3 LIMIT 1`,
    [r.equipo_id, r.id, ini, fin])).rows[0];
  if (choque) return res.status(409).json({ error: 'El nuevo horario choca con otra reserva del mismo equipo' });

  const nota = `Reprogramada por ${req.user.nombre}${motivo ? ' — ' + motivo : ''}`;
  await db.query(
    `UPDATE reserva SET fecha_inicio=$2, fecha_fin=$3, motivo=COALESCE(motivo,'') || $4 WHERE id=$1`,
    [r.id, ini, fin, (r.motivo ? ' · ' : '') + nota]);
  res.json({ ok: true, fecha_inicio: ini, fecha_fin: fin });
}));

// ----------------------- Pañolero: agenda / entrega / recepción -----------------------
app.get('/api/agenda', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  let rows;
  try {
    // Incluye reservas por CATEGORÍA (equipo_id NULL): el pañolero individualiza al entregar.
    ({ rows } = await db.query(
      `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, u.nombre AS usuario, u.rut,
              e.id AS equipo_id, e.nombre AS equipo, e.codigo_qr, e.n_serie, e.marca, e.modelo,
              e.condicion, e.tipo, COALESCE(ce.nombre, cr.nombre) AS categoria,
              r.categoria_id, (r.equipo_id IS NULL) AS por_individualizar
       FROM reserva r
       JOIN usuario u ON u.rut=r.usuario_rut
       LEFT JOIN equipo e ON e.id=r.equipo_id
       LEFT JOIN categoria ce ON ce.id=e.categoria_id
       LEFT JOIN categoria cr ON cr.id=r.categoria_id
       WHERE r.estado='confirmada' AND COALESCE(e.entidad_id, u.entidad_id)=$1
       ORDER BY r.fecha_inicio`, [req.sede]));
    // Para las reservas por individualizar, adjuntar las unidades disponibles de la categoría.
    for (const row of rows) {
      if (row.por_individualizar && row.categoria_id) {
        row.unidades = (await db.query(
          `SELECT id, nombre, codigo_qr FROM equipo
           WHERE categoria_id=$1 AND entidad_id=$2 AND estado='disponible' ORDER BY codigo_qr`,
          [row.categoria_id, req.sede])).rows;
      }
    }
  } catch (e) {
    if (e.code !== '42703') throw e; // migración 17 sin aplicar → esquema previo
    ({ rows } = await db.query(
      `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, u.nombre AS usuario, u.rut,
              e.id AS equipo_id, e.nombre AS equipo, e.codigo_qr, e.n_serie, e.marca, e.modelo,
              e.condicion, e.tipo, c.nombre AS categoria
       FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
       JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
       WHERE r.estado='confirmada' AND e.entidad_id=$1
       ORDER BY r.fecha_inicio`, [req.sede]));
  }
  res.json(rows);
}));

// Entregar (check-out) — crea préstamo, verifica QR opcional.
// RF-11: si la reserva es por categoría (equipo_id NULL), el pañolero individualiza la unidad aquí.
app.post('/api/entregar', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const { reserva_id, qr, condicion_salida, equipo_id } = req.body || {};
  const r = (await db.query(`SELECT * FROM reserva WHERE id=$1`, [reserva_id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (r.estado !== 'confirmada') return res.status(409).json({ error: `La reserva está ${r.estado}` });

  let equipoId = r.equipo_id;
  if (!equipoId) {
    // Reserva por categoría → el pañolero asigna la unidad física.
    if (!equipo_id) return res.status(400).json({ error: 'Selecciona la unidad a entregar (individualización).' });
    const u = (await db.query(`SELECT * FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, req.sede])).rows[0];
    if (!u) return res.status(404).json({ error: 'Unidad no encontrada en esta sede' });
    if (r.categoria_id && u.categoria_id !== r.categoria_id)
      return res.status(409).json({ error: 'La unidad no corresponde a la categoría reservada' });
    if (u.estado !== 'disponible') return res.status(409).json({ error: `La unidad no está disponible (estado: ${u.estado})` });
    await db.query(`UPDATE reserva SET equipo_id=$2 WHERE id=$1`, [r.id, equipo_id]);
    equipoId = equipo_id;
  }

  const eq = (await db.query(`SELECT * FROM equipo WHERE id=$1`, [equipoId])).rows[0];
  if (qr && qr.toLowerCase() !== eq.codigo_qr.toLowerCase())
    return res.status(409).json({ error: `El QR escaneado (${qr}) no corresponde al equipo` });

  const p = (await db.query(
    `INSERT INTO prestamo (reserva_id, usuario_rut, equipo_id, panolero_rut, condicion_salida, estado)
     VALUES ($1,$2,$3,$4,$5,'abierto') RETURNING id`,
    [r.id, r.usuario_rut, equipoId, req.user.rut, condicion_salida || eq.condicion])).rows[0];
  await db.query(`UPDATE reserva SET estado='en_uso' WHERE id=$1`, [r.id]);
  await db.query(`UPDATE equipo SET estado='prestado' WHERE id=$1`, [equipoId]);
  res.status(201).json({ id: p.id, mensaje: 'Entrega registrada' });
}));

// Equipos por recibir (en préstamo)
// Dashboard operativo (Control de Inventario): KPIs + entregas de hoy.
app.get('/api/panol/dashboard', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const sede = req.sede;
  const one = async (sql, p = [sede]) => (await db.query(sql, p)).rows[0].n;

  const reservas_pendientes = await one(
    `SELECT count(*)::int n FROM reserva r LEFT JOIN equipo e ON e.id=r.equipo_id JOIN usuario u ON u.rut=r.usuario_rut
     WHERE r.estado='confirmada' AND COALESCE(e.entidad_id,u.entidad_id)=$1`);
  const entregas_hoy = await one(
    `SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id
     WHERE e.entidad_id=$1 AND p.fecha_salida::date = current_date`);
  const devoluciones_hoy = await one(
    `SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id LEFT JOIN reserva r ON r.id=p.reserva_id
     WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado') AND (r.fecha_fin IS NULL OR r.fecha_fin::date <= current_date)`);
  let alertas_stock = 0;
  try {
    alertas_stock = await one(
      `SELECT count(*)::int n FROM (
         SELECT e.categoria_id, e.nombre FROM equipo e
         WHERE e.entidad_id=$1 AND e.tipo='equipo'
         GROUP BY e.categoria_id, e.nombre
         HAVING count(*) FILTER (WHERE e.estado='disponible') <= 1) s`);
  } catch (e) { /* tolerante */ }

  const rng = (ini, fin) => one(
    `SELECT count(*)::int n FROM reserva r LEFT JOIN equipo e ON e.id=r.equipo_id JOIN usuario u ON u.rut=r.usuario_rut
     WHERE r.estado IN ('confirmada','en_uso') AND COALESCE(e.entidad_id,u.entidad_id)=$1
       AND r.fecha_inicio >= ${ini} AND r.fecha_inicio < ${fin}`);
  const prog_hoy    = await rng("current_date", "current_date + interval '1 day'");
  const prog_semana = await rng("date_trunc('week', current_date)", "date_trunc('week', current_date) + interval '7 day'");
  const prog_mes    = await rng("date_trunc('month', current_date)", "date_trunc('month', current_date) + interval '1 month'");

  // Rango seleccionado (tabs Hoy / Esta semana / Este mes) y fecha de referencia
  // elegida con el calendario (semana/mes que se quiere ver). Por defecto: hoy.
  const rango = ['semana', 'mes'].includes(req.query.rango) ? req.query.rango : 'hoy';
  const ref = (req.query.ref && /^\d{4}-\d{2}-\d{2}$/.test(req.query.ref)) ? req.query.ref : null;
  // $2 = fecha de referencia (null => current_date). Semana ISO (lunes) y mes calendario.
  const RD = "COALESCE($2::date, current_date)";
  const cond = rango === 'semana'
    ? `r.fecha_inicio >= date_trunc('week', ${RD}) AND r.fecha_inicio < date_trunc('week', ${RD}) + interval '7 day'`
    : rango === 'mes'
    ? `r.fecha_inicio >= date_trunc('month', ${RD}) AND r.fecha_inicio < date_trunc('month', ${RD}) + interval '1 month'`
    : `r.fecha_inicio::date = ${RD}`;

  const entregasDe = async (whereRango) => {
    const rows = (await db.query(
      `SELECT r.id, r.fecha_inicio, r.fecha_fin, u.nombre AS estudiante, u.rut,
              COALESCE(ta.nombre,'—') AS asignatura,
              COALESCE(ce.nombre, cr.nombre, e.nombre) AS item,
              e.nombre AS equipo, e.codigo_qr, COALESCE(ce.nombre, cr.nombre) AS categoria,
              (r.equipo_id IS NULL) AS por_individualizar, r.categoria_id
       FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
       LEFT JOIN equipo e ON e.id=r.equipo_id
       LEFT JOIN categoria ce ON ce.id=e.categoria_id
       LEFT JOIN categoria cr ON cr.id=r.categoria_id
       LEFT JOIN tarea t ON t.id=r.tarea_id
       LEFT JOIN asignatura ta ON ta.id=t.asignatura_id
       WHERE r.estado='confirmada' AND COALESCE(e.entidad_id,u.entidad_id)=$1 AND ${whereRango}
       ORDER BY r.fecha_inicio`, [sede, ref])).rows;
    for (const row of rows) {
      if (row.por_individualizar && row.categoria_id) {
        row.unidades = (await db.query(
          `SELECT id, nombre, codigo_qr FROM equipo WHERE categoria_id=$1 AND entidad_id=$2 AND estado='disponible' ORDER BY codigo_qr`,
          [row.categoria_id, sede])).rows;
      }
    }
    return rows;
  };
  const entregas = await entregasDe(cond);                                   // según el rango+ref (tabla / vista semana-mes / línea de tiempo)

  const devoluciones = (await db.query(
    `SELECT p.id, p.fecha_salida, r.fecha_fin AS esperada, u.nombre AS estudiante,
            e.nombre AS equipo, e.codigo_qr, e.n_serie, e.marca, e.modelo, c.nombre AS categoria
     FROM prestamo p JOIN usuario u ON u.rut=p.usuario_rut
     JOIN equipo e ON e.id=p.equipo_id JOIN categoria c ON c.id=e.categoria_id
     LEFT JOIN reserva r ON r.id=p.reserva_id
     WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado')
       AND (r.fecha_fin IS NULL OR r.fecha_fin::date <= current_date)
     ORDER BY r.fecha_fin NULLS LAST`, [sede])).rows;

  // Entregas ya confirmadas hoy (préstamos de hoy) — para el filtro de KPI.
  const entregadas_hoy = (await db.query(
    `SELECT p.id, p.fecha_salida, u.nombre AS estudiante, e.nombre AS equipo, c.nombre AS categoria
     FROM prestamo p JOIN usuario u ON u.rut=p.usuario_rut
     JOIN equipo e ON e.id=p.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE e.entidad_id=$1 AND p.fecha_salida::date = current_date
     ORDER BY p.fecha_salida`, [sede])).rows;

  // Artículos con stock bajo (≤1 disponible) — para el filtro de KPI.
  let stock_bajo = [];
  try {
    stock_bajo = (await db.query(
      `SELECT c.nombre AS categoria, e.nombre AS articulo,
              count(*) FILTER (WHERE e.estado='disponible')::int AS disponibles,
              count(*)::int AS total
       FROM equipo e JOIN categoria c ON c.id=e.categoria_id
       WHERE e.entidad_id=$1 AND e.tipo='equipo'
       GROUP BY c.nombre, e.nombre
       HAVING count(*) FILTER (WHERE e.estado='disponible') <= 1
       ORDER BY disponibles, c.nombre`, [sede])).rows;
  } catch (e) { /* tolerante */ }

  res.json({ rango, ref, reservas_pendientes, entregas_hoy, devoluciones_hoy, alertas_stock,
    prog_hoy, prog_semana, prog_mes, entregas, devoluciones, entregadas_hoy, stock_bajo });
}));

// Historial de entregas (préstamos) de la sede.
app.get('/api/entregas/historial', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id, p.fecha_salida, p.fecha_retorno, p.estado, p.condicion_salida, p.condicion_retorno,
            u.nombre AS estudiante, u.rut, e.nombre AS equipo, c.nombre AS categoria,
            pa.nombre AS panolero
     FROM prestamo p JOIN usuario u ON u.rut=p.usuario_rut
     JOIN equipo e ON e.id=p.equipo_id JOIN categoria c ON c.id=e.categoria_id
     LEFT JOIN usuario pa ON pa.rut=p.panolero_rut
     WHERE e.entidad_id=$1 ORDER BY p.fecha_salida DESC LIMIT 200`, [req.sede]);
  res.json(rows);
}));

app.get('/api/por-recibir', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id AS prestamo_id, p.fecha_salida, u.nombre AS usuario, u.rut,
            e.id AS equipo_id, e.nombre AS equipo, e.codigo_qr, e.n_serie, e.marca, e.modelo,
            p.condicion_salida, c.nombre AS categoria
     FROM prestamo p JOIN usuario u ON u.rut=p.usuario_rut
     JOIN equipo e ON e.id=p.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE p.estado IN ('abierto','atrasado') AND e.entidad_id=$1
     ORDER BY p.fecha_salida`, [req.sede]);
  res.json(rows);
}));

// Recibir (check-in) — RF-59: daño → bloqueo por reposición + sanción
app.post('/api/recibir', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const { prestamo_id, condicion_retorno, observacion } = req.body || {};
  const p = (await db.query(`SELECT * FROM prestamo WHERE id=$1`, [prestamo_id])).rows[0];
  if (!p) return res.status(404).json({ error: 'Préstamo no encontrado' });
  if (p.estado === 'devuelto') return res.status(409).json({ error: 'El préstamo ya fue devuelto' });

  const danio = ['con_danio', 'inoperativo'].includes(condicion_retorno);
  await db.query(
    `UPDATE prestamo SET estado='devuelto', fecha_retorno=now(), condicion_retorno=$2,
            requiere_reposicion=$3, observacion=$4 WHERE id=$1`,
    [p.id, condicion_retorno || 'bueno', danio, observacion || null]);
  await db.query(`UPDATE reserva SET estado='completada' WHERE id=$1`, [p.reserva_id]);
  // Equipo: a mantención si hay daño, si no disponible
  await db.query(`UPDATE equipo SET estado=$2, condicion=$3 WHERE id=$1`,
    [p.equipo_id, danio ? 'mantencion' : 'disponible', condicion_retorno || 'bueno']);

  let sancion = null;
  if (danio) {
    const fin = new Date(); fin.setDate(fin.getDate() + 30); // bloqueo 1 mes por daño (RF-59)
    const s = (await db.query(
      `INSERT INTO sancion (usuario_rut, motivo, tramo, fecha_fin, vigente)
       VALUES ($1,$2,'grave',$3,TRUE) RETURNING id`,
      [p.usuario_rut, 'Equipo devuelto con daño — bloqueo hasta reposición', fin])).rows[0];
    await db.query(
      `INSERT INTO mantencion (equipo_id, tipo, detalle) VALUES ($1,'reposicion',$2)`,
      [p.equipo_id, observacion || 'Daño detectado en devolución']);
    sancion = s.id;
  }
  res.json({ ok: true, requiere_reposicion: danio, sancion });
}));

// ----------------------- Autorizaciones (recintos) -----------------------
app.get('/api/autorizaciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.id, a.reserva_id, a.nivel, a.estado, r.fecha_inicio, u.nombre AS solicitante,
            e.nombre AS recinto
     FROM autorizacion a JOIN reserva r ON r.id=a.reserva_id
     JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
     WHERE a.estado='pendiente' ORDER BY a.reserva_id, a.nivel`);
  res.json(rows);
}));

app.post('/api/autorizaciones/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { decision, comentario } = req.body || {}; // 'aprobada' | 'rechazada'
  if (!['aprobada', 'rechazada'].includes(decision))
    return res.status(400).json({ error: 'Decisión inválida' });
  const a = (await db.query(
    `UPDATE autorizacion SET estado=$2, autorizante=$3, comentario=$4, fecha=now()
     WHERE id=$1 RETURNING reserva_id`, [req.params.id, decision, req.user.nombre, comentario || null])).rows[0];
  if (!a) return res.status(404).json({ error: 'Autorización no encontrada' });

  if (decision === 'rechazada') {
    await db.query(`UPDATE reserva SET estado='cancelada', motivo_cancelacion='Autorización rechazada' WHERE id=$1`, [a.reserva_id]);
    const r = (await db.query(`SELECT equipo_id FROM reserva WHERE id=$1`, [a.reserva_id])).rows[0];
    await db.query(`UPDATE equipo SET estado='disponible' WHERE id=$1`, [r.equipo_id]);
    return res.json({ ok: true, reserva: 'cancelada' });
  }
  // Si TODOS los niveles están aprobados → reserva confirmada
  const pend = await db.query(
    `SELECT count(*)::int AS n FROM autorizacion WHERE reserva_id=$1 AND estado<>'aprobada'`, [a.reserva_id]);
  if (pend.rows[0].n === 0) {
    await db.query(`UPDATE reserva SET estado='confirmada' WHERE id=$1`, [a.reserva_id]);
    return res.json({ ok: true, reserva: 'confirmada' });
  }
  res.json({ ok: true, reserva: 'pendiente' });
}));

// ----------------------- Admin: inventario, usuarios, sanciones, KPIs -----------------------
app.get('/api/admin/kpis', auth, requireRole('admin'), wrap(async (req, res) => {
  const q = (s) => db.query(s, [req.sede]).then(r => r.rows[0].n);
  res.json({
    equipos: await q(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1`),
    disponibles: await q(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1 AND estado='disponible'`),
    reservas_activas: await q(`SELECT count(*)::int n FROM reserva r JOIN equipo e ON e.id=r.equipo_id WHERE e.entidad_id=$1 AND r.estado IN ('pendiente','confirmada','en_uso')`),
    prestamos_abiertos: await q(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado')`),
    sanciones_vigentes: await q(`SELECT count(*)::int n FROM sancion s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1 AND s.vigente=TRUE AND s.fecha_fin>=CURRENT_DATE`),
    reposiciones: await q(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.requiere_reposicion=TRUE`),
  });
}));

// Dashboard enriquecido para el panel móvil (y web)
app.get('/api/admin/dashboard', auth, requireRole('admin'), wrap(async (req, res) => {
  const sedeId = req.query.sede ? Number(req.query.sede) : req.sede;   // admin puede inspeccionar cualquier sede
  const one = (s) => db.query(s, [sedeId]).then(r => r.rows[0].n);
  const kpis = {
    prestamos_activos: await one(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado')`),
    reservas_vigentes: await one(`SELECT count(*)::int n FROM reserva r JOIN equipo e ON e.id=r.equipo_id WHERE e.entidad_id=$1 AND r.estado IN ('pendiente','confirmada','en_uso')`),
    solicitudes_pendientes: await one(`SELECT count(*)::int n FROM solicitud_especial s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1 AND s.estado='pendiente'`),
    equipos_disponibles: await one(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1 AND estado='disponible'`),
    total_equipos: await one(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1`),
    atrasados: await one(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.estado='atrasado'`),
    en_mantencion: await one(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1 AND estado='mantencion'`),
    sanciones_vigentes: await one(`SELECT count(*)::int n FROM sancion s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1 AND s.vigente=TRUE AND s.fecha_fin>=CURRENT_DATE`),
    reposiciones: await one(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.requiere_reposicion=TRUE`),
  };
  const top = (await db.query(
    `SELECT e.nombre, count(r.*)::int AS total
     FROM equipo e LEFT JOIN reserva r ON r.equipo_id=e.id
     WHERE e.entidad_id=$1
     GROUP BY e.id, e.nombre ORDER BY total DESC, e.nombre LIMIT 5`, [sedeId])).rows;
  const inv = (await db.query(
    `SELECT estado, count(*)::int AS n FROM equipo WHERE entidad_id=$1 GROUP BY estado`, [sedeId])).rows
    .reduce((a, r) => (a[r.estado] = r.n, a), {});
  const inventario = ['disponible','prestado','reservado','mantencion','baja']
    .map(k => ({ estado: k, n: inv[k] || 0 }));
  const devoluciones = (await db.query(
    `SELECT e.nombre AS equipo, u.nombre AS usuario, p.fecha_salida
     FROM prestamo p JOIN equipo e ON e.id=p.equipo_id JOIN usuario u ON u.rut=p.usuario_rut
     WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado')
     ORDER BY p.fecha_salida LIMIT 5`, [sedeId])).rows;
  const tendencia = (await db.query(
    `SELECT to_char(date_trunc('week', p.fecha_salida), 'DD-MM') AS semana, count(*)::int AS n
     FROM prestamo p JOIN equipo e ON e.id=p.equipo_id
     WHERE e.entidad_id=$1 AND p.fecha_salida >= (CURRENT_DATE - INTERVAL '8 weeks')
     GROUP BY date_trunc('week', p.fecha_salida)
     ORDER BY date_trunc('week', p.fecha_salida)`, [sedeId])).rows;
  res.json({ kpis, top_solicitados: top, inventario, devoluciones_proximas: devoluciones, tendencia });
}));

// Panel global multisede: agregado de todas las sedes + desglose por sede (admin)
app.get('/api/admin/dashboard/global', auth, requireRole('admin'), wrap(async (req, res) => {
  const sedes = (await db.query(`SELECT id, nombre FROM entidad ORDER BY nombre`)).rows;
  const mapCount = async (sql) => {
    const rows = (await db.query(sql)).rows;
    const m = {}; rows.forEach(r => { m[r.entidad_id] = r.n; }); return m;
  };
  const eqTot = await mapCount(`SELECT entidad_id, count(*)::int n FROM equipo GROUP BY entidad_id`);
  const disp  = await mapCount(`SELECT entidad_id, count(*)::int n FROM equipo WHERE estado='disponible' GROUP BY entidad_id`);
  const mant  = await mapCount(`SELECT entidad_id, count(*)::int n FROM equipo WHERE estado='mantencion' GROUP BY entidad_id`);
  const prest = await mapCount(`SELECT e.entidad_id, count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE p.estado IN ('abierto','atrasado') GROUP BY e.entidad_id`);
  const atr   = await mapCount(`SELECT e.entidad_id, count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE p.estado='atrasado' GROUP BY e.entidad_id`);
  const resv  = await mapCount(`SELECT e.entidad_id, count(*)::int n FROM reserva r JOIN equipo e ON e.id=r.equipo_id WHERE r.estado IN ('pendiente','confirmada','en_uso') GROUP BY e.entidad_id`);
  const solic = await mapCount(`SELECT u.entidad_id, count(*)::int n FROM solicitud_especial s JOIN usuario u ON u.rut=s.usuario_rut WHERE s.estado='pendiente' GROUP BY u.entidad_id`);
  const por_sede = sedes.map(s => ({
    id: s.id, nombre: s.nombre,
    total_equipos: eqTot[s.id] || 0,
    equipos_disponibles: disp[s.id] || 0,
    en_mantencion: mant[s.id] || 0,
    prestamos_activos: prest[s.id] || 0,
    atrasados: atr[s.id] || 0,
    reservas_vigentes: resv[s.id] || 0,
    solicitudes_pendientes: solic[s.id] || 0,
  }));
  const sum = (k) => por_sede.reduce((a, x) => a + x[k], 0);
  const global = {
    sedes: sedes.length,
    total_equipos: sum('total_equipos'), equipos_disponibles: sum('equipos_disponibles'),
    en_mantencion: sum('en_mantencion'), prestamos_activos: sum('prestamos_activos'),
    atrasados: sum('atrasados'), reservas_vigentes: sum('reservas_vigentes'),
    solicitudes_pendientes: sum('solicitudes_pendientes'),
  };
  const invRows = (await db.query(`SELECT estado, count(*)::int n FROM equipo GROUP BY estado`)).rows.reduce((a, r) => (a[r.estado] = r.n, a), {});
  const inventario = ['disponible','prestado','reservado','mantencion','baja'].map(k => ({ estado: k, n: invRows[k] || 0 }));
  const top = (await db.query(
    `SELECT e.nombre, count(r.*)::int AS total FROM equipo e LEFT JOIN reserva r ON r.equipo_id=e.id
     GROUP BY e.id, e.nombre ORDER BY total DESC, e.nombre LIMIT 6`)).rows;
  res.json({ global, por_sede, inventario, top_solicitados: top });
}));

app.post('/api/admin/equipos', auth, requireRole(...PANOL_SEDE), wrap(async (req, res) => {
  const { codigo_qr, nombre, modelo, marca, n_serie, tipo, categoria_id, requiere_autorizacion, accesorios } = req.body || {};
  if (!codigo_qr || !nombre || !categoria_id) return res.status(400).json({ error: 'codigo_qr, nombre y categoria_id requeridos' });
  const reqAut = tipo === 'recinto' ? true : !!requiere_autorizacion;
  try {
    const r = (await db.query(
      `INSERT INTO equipo (codigo_qr, nombre, modelo, marca, n_serie, tipo, categoria_id, requiere_autorizacion, accesorios, entidad_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [codigo_qr, nombre, modelo || null, marca || null, n_serie || null, tipo || 'equipo', categoria_id, reqAut, accesorios || null, req.sede])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'El código QR ya existe' });
    throw e;
  }
}));

app.post('/api/admin/equipos/:id/estado', auth, requireRole(...PANOL_SEDE), wrap(async (req, res) => {
  const { estado } = req.body || {};
  const permitidos = ['disponible', 'mantencion', 'baja'];
  if (!permitidos.includes(estado)) return res.status(400).json({ error: 'Estado no permitido' });
  await db.query(`UPDATE equipo SET estado=$2 WHERE id=$1 AND entidad_id=$3`, [req.params.id, estado, req.sede]);
  res.json({ ok: true });
}));

app.get('/api/admin/usuarios', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT rut, nombre, email, rol, estado FROM usuario WHERE entidad_id=$1 ORDER BY rol, nombre`, [req.sede]);
  res.json(rows);
}));

// --- Gestión de usuarios (alta/edición/estado/clave) ---
const ROLES_OK = ['alumno', 'docente', 'panolero', 'jefe_panol', 'admin'];
const ESTADOS_OK = ['activo', 'inactivo', 'suspendido'];

app.post('/api/admin/usuarios', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rut, nombre, email, rol, estado, password } = req.body || {};
  if (!rut || !nombre || !rol) return res.status(400).json({ error: 'RUT, nombre y rol son obligatorios' });
  if (!ROLES_OK.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
  const est = ESTADOS_OK.includes(estado) ? estado : 'activo';
  const hash = password ? hashPassword(password) : null;
  try {
    await db.query(
      `INSERT INTO usuario (rut, nombre, email, rol, estado, password_hash, entidad_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rut, nombre, email || null, rol, est, hash, req.sede]);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: e.constraint === 'uq_usuario_email'
      ? 'El correo ya se encuentra registrado en otro usuario.'
      : 'Ya existe un usuario con ese RUT.' });
    throw e;
  }
}));

app.put('/api/admin/usuarios/:rut', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, email, rol, estado } = req.body || {};
  if (rol && !ROLES_OK.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
  if (estado && !ESTADOS_OK.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  let r;
  try {
    r = await db.query(
      `UPDATE usuario SET nombre=COALESCE($2,nombre), email=COALESCE($3,email), rol=COALESCE($4,rol), estado=COALESCE($5,estado)
       WHERE rut=$1 AND entidad_id=$6`,
      [req.params.rut, nombre || null, email || null, rol || null, estado || null, req.sede]);
  } catch (e) {
    if (e.code === '23505')
      return res.status(409).json({ error: e.constraint === 'uq_usuario_email'
        ? 'El correo ya se encuentra registrado en otro usuario.'
        : 'Conflicto de datos únicos.' });
    throw e;
  }
  if (!r.rowCount) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
}));

app.post('/api/admin/usuarios/:rut/estado', auth, requireRole('admin'), wrap(async (req, res) => {
  const { estado } = req.body || {};
  if (!ESTADOS_OK.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  await db.query(`UPDATE usuario SET estado=$2 WHERE rut=$1 AND entidad_id=$3`, [req.params.rut, estado, req.sede]);
  res.json({ ok: true });
}));

app.post('/api/admin/usuarios/:rut/clave', auth, requireRole('admin'), wrap(async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres' });
  await db.query(`UPDATE usuario SET password_hash=$2 WHERE rut=$1 AND entidad_id=$3`, [req.params.rut, hashPassword(password), req.sede]);
  res.json({ ok: true });
}));

app.get('/api/admin/sanciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.usuario_rut, u.nombre, s.motivo, s.tramo, s.fecha_inicio, s.fecha_fin, s.solidaria, s.vigente
     FROM sancion s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1
     ORDER BY s.vigente DESC, s.fecha_fin DESC`, [req.sede]);
  res.json(rows);
}));

app.post('/api/admin/sanciones/:id/levantar', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`UPDATE sancion SET vigente=FALSE WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/sanciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { usuario_rut, motivo, tramo, dias, asignatura_id, solidaria } = req.body || {};
  if (!usuario_rut || !motivo || !tramo) return res.status(400).json({ error: 'Datos de sanción incompletos' });
  const fin = new Date(); fin.setDate(fin.getDate() + (Number(dias) || 7));
  const r = (await db.query(
    `INSERT INTO sancion (usuario_rut, asignatura_id, motivo, tramo, fecha_fin, solidaria, vigente)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`,
    [usuario_rut, asignatura_id || null, motivo, tramo, fin, !!solidaria])).rows[0];
  res.status(201).json({ id: r.id });
}));

// ----------------------- RF-56: expiración por no-show -----------------------
async function expirarNoShow() {
  // Reservas con atraso > 1 h sin justificación y sin préstamo asociado
  const exp = await db.query(
    `UPDATE reserva r SET estado='expirada',
            motivo_cancelacion='No-show: atraso > 1 h sin justificación (RF-56)'
     WHERE r.estado IN ('pendiente','confirmada')
       AND r.justificada = FALSE
       AND r.fecha_inicio < now() - interval '1 hour'
       AND NOT EXISTS (SELECT 1 FROM prestamo p WHERE p.reserva_id = r.id)
     RETURNING r.id, r.equipo_id`);
  for (const row of exp.rows)
    await db.query(`UPDATE equipo SET estado='disponible' WHERE id=$1 AND estado='reservado'`, [row.equipo_id]);
  if (exp.rows.length) console.log(`RF-56: ${exp.rows.length} reserva(s) expirada(s) por no-show`);
  return exp.rows.length;
}

// Justificar atraso (evita la expiración) — RF-56
app.post('/api/reservas/:id/justificar', auth, wrap(async (req, res) => {
  const { justificacion } = req.body || {};
  if (!justificacion) return res.status(400).json({ error: 'Indica la justificación' });
  const r = (await db.query(`SELECT * FROM reserva WHERE id=$1`, [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (r.usuario_rut !== req.user.rut && !['panolero', 'admin'].includes(req.user.rol))
    return res.status(403).json({ error: 'No puedes justificar esta reserva' });
  await db.query(`UPDATE reserva SET justificada=TRUE, justificacion=$2 WHERE id=$1`, [r.id, justificacion]);
  res.json({ ok: true });
}));

// Ejecutar manualmente la rutina de no-show (admin)
app.post('/api/admin/run-noshow', auth, requireRole('admin'), wrap(async (req, res) => {
  const n = await expirarNoShow();
  res.json({ expiradas: n });
}));

// ----------------------- A.2: Recuperación de clave (RF-02) -----------------------
app.post('/api/recuperar', wrap(async (req, res) => {
  const { rut, email } = req.body || {};
  if (!rut || !email) return res.status(400).json({ error: 'RUT y correo requeridos' });
  const r = (await db.query(
    `SELECT rut, email FROM usuario WHERE rut=$1 AND lower(email)=lower($2) AND entidad_id=$3`,
    [rut, email, req.sede])).rows[0];
  // Si coinciden, genera el token y envía el correo (sin revelar si existe o no).
  if (r) {
    const token = mailer.makeResetToken(r.rut);
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/reset.html?token=${encodeURIComponent(token)}`;
    try { await mailer.sendResetEmail(r.email, link); } catch (e) { console.error('mail:', e.message); }
  }
  res.json({ ok: true, mensaje: 'Si los datos coinciden, enviaremos un enlace de recuperación al correo registrado.' });
}));

// Restablecer contraseña con el token recibido por correo
app.post('/api/reset', wrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token y nueva clave requeridos' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres' });
  const p = mailer.verifyResetToken(token);
  if (!p) return res.status(400).json({ error: 'El enlace es inválido o expiró. Solicita uno nuevo.' });
  await db.query(`UPDATE usuario SET password_hash=$1 WHERE rut=$2 AND entidad_id=$3`,
    [hashPassword(password), p.rut, req.sede]);
  res.json({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
}));

// ----------------------- A.2: Perfil (RF-06) -----------------------
app.put('/api/perfil', auth, wrap(async (req, res) => {
  const { nombre, email, password, foto_url } = req.body || {};
  const sets = [], vals = []; let i = 1;
  if (nombre)  { sets.push(`nombre=$${i++}`); vals.push(nombre); }
  if (email)   { sets.push(`email=$${i++}`);  vals.push(email); }
  if (foto_url){ sets.push(`foto_url=$${i++}`); vals.push(foto_url); }
  if (password){ sets.push(`password_hash=$${i++}`); vals.push(hashPassword(password)); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(req.user.rut);
  try {
    await db.query(`UPDATE usuario SET ${sets.join(', ')} WHERE rut=$${i}`, vals);
  } catch (e) {
    if (e.code === '23505') // correo duplicado (uq_usuario_email, CITEXT)
      return res.status(409).json({ error: 'El correo ya se encuentra registrado en otro usuario.' });
    if (e.code === '42703') { // sin columna foto_url: reintentar sin ella
      return res.status(400).json({ error: 'Campo no disponible' });
    }
    throw e;
  }
  res.json({ ok: true });
}));

// ----------------------- A.2: Categorías y laboratorios (RF-10) -----------------------
app.get('/api/categorias', auth, wrap(async (req, res) => {
  res.json((await db.query(`SELECT id, nombre, simbolo FROM categoria ORDER BY nombre`)).rows);
}));
app.get('/api/laboratorios', auth, wrap(async (req, res) => {
  res.json((await db.query(`SELECT id, nombre, ubicacion FROM laboratorio WHERE entidad_id=$1 ORDER BY nombre`, [req.sede])).rows);
}));
app.get('/api/academico', auth, requireRole('admin','docente'), wrap(async (req, res) => {
  const carreras = (await db.query(`SELECT id, nombre FROM carrera WHERE entidad_id=$1 ORDER BY nombre`, [req.sede])).rows;
  const asignaturas = (await db.query(`SELECT a.id, a.nombre, a.seccion, a.carrera_id FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE c.entidad_id=$1 ORDER BY a.nombre`, [req.sede])).rows;
  res.json({ carreras, asignaturas });
}));

// ----------------------- Admin: Estructura académica (carreras / asignaturas / inscripción) -----------------------
app.post('/api/admin/carreras', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const r = (await db.query(`INSERT INTO carrera (nombre, entidad_id) VALUES ($1,$2) RETURNING id`, [nombre.trim(), req.sede])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una carrera con ese nombre' }); throw e; }
}));
app.put('/api/admin/carreras/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const r = await db.query(`UPDATE carrera SET nombre=$2 WHERE id=$1 AND entidad_id=$3`, [req.params.id, nombre.trim(), req.sede]);
  if (!r.rowCount) return res.status(404).json({ error: 'Carrera no encontrada' });
  res.json({ ok: true });
}));
app.delete('/api/admin/carreras/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM carrera WHERE id=$1 AND entidad_id=$2`, [req.params.id, req.sede]);
  res.json({ ok: true });
}));

app.post('/api/admin/asignaturas', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, seccion, carrera_id } = req.body || {};
  if (!nombre || !carrera_id) return res.status(400).json({ error: 'Nombre y carrera son obligatorios' });
  const c = await db.query(`SELECT 1 FROM carrera WHERE id=$1 AND entidad_id=$2`, [carrera_id, req.sede]);
  if (!c.rowCount) return res.status(400).json({ error: 'Carrera no válida' });
  const r = (await db.query(`INSERT INTO asignatura (nombre, seccion, carrera_id) VALUES ($1,$2,$3) RETURNING id`, [nombre.trim(), seccion || null, carrera_id])).rows[0];
  res.status(201).json({ id: r.id });
}));
app.put('/api/admin/asignaturas/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, seccion } = req.body || {};
  const r = await db.query(
    `UPDATE asignatura SET nombre=COALESCE($2,nombre), seccion=$3
     WHERE id=$1 AND carrera_id IN (SELECT id FROM carrera WHERE entidad_id=$4)`,
    [req.params.id, nombre || null, seccion || null, req.sede]);
  if (!r.rowCount) return res.status(404).json({ error: 'Asignatura no encontrada' });
  res.json({ ok: true });
}));
app.delete('/api/admin/asignaturas/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM asignatura WHERE id=$1 AND carrera_id IN (SELECT id FROM carrera WHERE entidad_id=$2)`, [req.params.id, req.sede]);
  res.json({ ok: true });
}));

app.get('/api/admin/asignaturas/:id/inscritos', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ua.usuario_rut AS rut, u.nombre, ua.rol_en_asig FROM usuario_asignatura ua
     JOIN usuario u ON u.rut=ua.usuario_rut
     WHERE ua.asignatura_id=$1 AND u.entidad_id=$2 ORDER BY ua.rol_en_asig, u.nombre`, [req.params.id, req.sede]);
  res.json(rows);
}));
app.post('/api/admin/asignaturas/:id/inscritos', auth, requireRole('admin'), wrap(async (req, res) => {
  const { usuario_rut, rol_en_asig } = req.body || {};
  if (!usuario_rut) return res.status(400).json({ error: 'RUT requerido' });
  const rol = rol_en_asig === 'docente' ? 'docente' : 'alumno';
  const u = await db.query(`SELECT 1 FROM usuario WHERE rut=$1 AND entidad_id=$2`, [usuario_rut, req.sede]);
  if (!u.rowCount) return res.status(400).json({ error: 'El usuario no existe' });
  try {
    await db.query(`INSERT INTO usuario_asignatura (usuario_rut, asignatura_id, rol_en_asig) VALUES ($1,$2,$3)`, [usuario_rut, req.params.id, rol]);
    res.status(201).json({ ok: true });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'El usuario ya está inscrito' }); throw e; }
}));
app.delete('/api/admin/asignaturas/:id/inscritos/:rut', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM usuario_asignatura WHERE asignatura_id=$1 AND usuario_rut=$2`, [req.params.id, req.params.rut]);
  res.json({ ok: true });
}));

// Elegibilidad: qué CATEGORÍAS de equipo habilita una asignatura (RF-54 · Opción 1)
app.get('/api/admin/asignaturas/:id/elegibilidad', auth, requireRole('admin'), wrap(async (req, res) => {
  const a = await db.query(
    `SELECT 1 FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE a.id=$1 AND c.entidad_id=$2`,
    [req.params.id, req.sede]);
  if (!a.rowCount) return res.status(404).json({ error: 'Asignatura no encontrada' });
  const cats = (await db.query(
    `SELECT c.id, c.nombre,
            EXISTS (SELECT 1 FROM elegibilidad el WHERE el.asignatura_id=$1 AND el.categoria_id=c.id) AS habilitada,
            (SELECT count(*)::int FROM equipo e WHERE e.categoria_id=c.id AND e.entidad_id=$2) AS equipos
     FROM categoria c ORDER BY c.nombre`, [req.params.id, req.sede])).rows;
  res.json(cats);
}));
app.put('/api/admin/asignaturas/:id/elegibilidad', auth, requireRole('admin'), wrap(async (req, res) => {
  const a = await db.query(
    `SELECT 1 FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE a.id=$1 AND c.entidad_id=$2`,
    [req.params.id, req.sede]);
  if (!a.rowCount) return res.status(404).json({ error: 'Asignatura no encontrada' });
  const ids = Array.isArray(req.body && req.body.categorias) ? req.body.categorias.map(Number).filter(Boolean) : [];
  await db.query(`DELETE FROM elegibilidad WHERE asignatura_id=$1`, [req.params.id]);
  for (const cid of ids) {
    await db.query(
      `INSERT INTO elegibilidad (asignatura_id, categoria_id) VALUES ($1,$2)
       ON CONFLICT (asignatura_id, categoria_id) DO NOTHING`, [req.params.id, cid]);
  }
  res.json({ ok: true, habilitadas: ids.length });
}));

// ----------------------- Kits de equipos por asignatura (build v20) -----------------------
// Un kit se asocia a una asignatura y se compone POR MODELO (categoría + nombre
// + modelo + marca) con cantidad. Al reservarlo, el sistema asigna unidades
// disponibles de cada modelo en la sede activa.

// Modelos disponibles en la sede, para armar kits (agrupa unidades equivalentes).
// Con ?asignatura_id=X se limita a las categorías permitidas (elegibilidad) de la asignatura.
app.get('/api/modelos', auth, requireRole('docente', 'jefe_panol', 'admin'), wrap(async (req, res) => {
  const aid = req.query.asignatura_id ? Number(req.query.asignatura_id) : null;
  const params = [req.sede];
  let filtro = '';
  if (aid) { params.push(aid); filtro = `AND e.categoria_id IN (SELECT categoria_id FROM elegibilidad WHERE asignatura_id=$2)`; }
  const { rows } = await db.query(
    `SELECT e.categoria_id, c.nombre AS categoria, e.nombre, COALESCE(e.modelo,'') AS modelo,
            COALESCE(e.marca,'') AS marca,
            COUNT(*) FILTER (WHERE e.estado='disponible')::int AS disponibles,
            COUNT(*)::int AS total
     FROM equipo e JOIN categoria c ON c.id=e.categoria_id
     WHERE e.entidad_id=$1 AND e.tipo='equipo' ${filtro}
     GROUP BY e.categoria_id, c.nombre, e.nombre, COALESCE(e.modelo,''), COALESCE(e.marca,'')
     ORDER BY c.nombre, e.nombre`, params);
  res.json(rows);
}));

// ¿Puede el usuario gestionar kits de esta asignatura? (admin o docente a cargo, en la sede)
async function puedeGestionarAsignatura(req, asignaturaId) {
  const a = (await db.query(
    `SELECT c.entidad_id FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE a.id=$1`, [asignaturaId])).rows[0];
  if (!a) return false;
  if (req.user.rol === 'admin') return a.entidad_id === req.sede || req.sedesPermitidas === null;
  if (req.user.rol === 'docente') {
    const d = await db.query(
      `SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2 AND rol_en_asig='docente'`,
      [req.user.rut, asignaturaId]);
    return d.rowCount > 0;
  }
  return false;
}

// Listar kits (opcionalmente por asignatura). Alumno ve kits de sus asignaturas.
app.get('/api/kits', auth, wrap(async (req, res) => {
  const asig = req.query.asignatura_id ? Number(req.query.asignatura_id) : null;
  const params = [req.sede]; let filtro = '';
  if (asig) { params.push(asig); filtro += ` AND k.asignatura_id=$${params.length}`; }
  if (req.user.rol === 'alumno' || req.user.rol === 'docente') {
    params.push(req.user.rut);
    filtro += ` AND k.asignatura_id IN (SELECT asignatura_id FROM usuario_asignatura WHERE usuario_rut=$${params.length})`;
  }
  const { rows } = await db.query(
    `SELECT k.id, k.nombre, k.descripcion, k.asignatura_id, a.nombre AS asignatura, a.seccion,
            (SELECT count(*)::int FROM kit_item ki WHERE ki.kit_id=k.id) AS n_items
     FROM kit k JOIN asignatura a ON a.id=k.asignatura_id
     WHERE k.entidad_id=$1 ${filtro}
     ORDER BY a.nombre, k.nombre`, params);
  res.json(rows);
}));

// Detalle de un kit con disponibilidad por modelo en la sede
app.get('/api/kits/:id', auth, wrap(async (req, res) => {
  const k = (await db.query(
    `SELECT k.id, k.nombre, k.descripcion, k.asignatura_id, a.nombre AS asignatura
     FROM kit k JOIN asignatura a ON a.id=k.asignatura_id
     WHERE k.id=$1 AND k.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!k) return res.status(404).json({ error: 'Kit no encontrado' });
  const items = (await db.query(
    `SELECT ki.id, ki.categoria_id, c.nombre AS categoria, ki.nombre, ki.modelo, ki.marca, ki.cantidad,
            (SELECT count(*)::int FROM equipo e WHERE e.entidad_id=$2 AND e.categoria_id=ki.categoria_id
                AND e.nombre=ki.nombre AND COALESCE(e.modelo,'')=COALESCE(ki.modelo,'')
                AND COALESCE(e.marca,'')=COALESCE(ki.marca,'') AND e.estado='disponible') AS disponibles
     FROM kit_item ki JOIN categoria c ON c.id=ki.categoria_id
     WHERE ki.kit_id=$1 ORDER BY ki.id`, [k.id, req.sede])).rows;
  res.json({ ...k, items });
}));

// Crear kit (docente a cargo o admin)
app.post('/api/kits', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const { nombre, descripcion, asignatura_id, items } = req.body || {};
  if (!nombre || !asignatura_id || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'nombre, asignatura_id e items son obligatorios' });
  if (!(await puedeGestionarAsignatura(req, Number(asignatura_id))))
    return res.status(403).json({ error: 'No puedes gestionar kits de esta asignatura' });
  const ent = (await db.query(
    `SELECT c.entidad_id FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE a.id=$1`, [asignatura_id])).rows[0];
  const k = (await db.query(
    `INSERT INTO kit (nombre, descripcion, asignatura_id, entidad_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    [nombre, descripcion || null, asignatura_id, ent.entidad_id])).rows[0];
  for (const it of items) {
    if (!it || !it.categoria_id || !it.nombre) continue;
    await db.query(
      `INSERT INTO kit_item (kit_id, categoria_id, nombre, modelo, marca, cantidad)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [k.id, Number(it.categoria_id), it.nombre, it.modelo || null, it.marca || null, Math.max(1, Number(it.cantidad) || 1)]);
  }
  res.status(201).json({ id: k.id });
}));

// Editar kit (reemplaza nombre/descr e items)
app.put('/api/kits/:id', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const k = (await db.query(`SELECT asignatura_id FROM kit WHERE id=$1 AND entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!k) return res.status(404).json({ error: 'Kit no encontrado' });
  if (!(await puedeGestionarAsignatura(req, k.asignatura_id)))
    return res.status(403).json({ error: 'No puedes gestionar este kit' });
  const { nombre, descripcion, items } = req.body || {};
  await db.query(`UPDATE kit SET nombre=COALESCE($2,nombre), descripcion=$3 WHERE id=$1`,
    [req.params.id, nombre || null, descripcion || null]);
  if (Array.isArray(items)) {
    await db.query(`DELETE FROM kit_item WHERE kit_id=$1`, [req.params.id]);
    for (const it of items) {
      if (!it || !it.categoria_id || !it.nombre) continue;
      await db.query(
        `INSERT INTO kit_item (kit_id, categoria_id, nombre, modelo, marca, cantidad) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.id, Number(it.categoria_id), it.nombre, it.modelo || null, it.marca || null, Math.max(1, Number(it.cantidad) || 1)]);
    }
  }
  res.json({ ok: true });
}));

app.delete('/api/kits/:id', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const k = (await db.query(`SELECT asignatura_id FROM kit WHERE id=$1 AND entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!k) return res.status(404).json({ error: 'Kit no encontrado' });
  if (!(await puedeGestionarAsignatura(req, k.asignatura_id)))
    return res.status(403).json({ error: 'No puedes eliminar este kit' });
  await db.query(`DELETE FROM kit WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// Reservar un kit como paquete: asigna unidades disponibles de cada modelo
app.post('/api/kits/:id/reservar', auth, requireRole('alumno', 'docente'), wrap(async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.body || {};
  if (!fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Faltan fechas de la reserva' });
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin), now = new Date();
  if (isNaN(ini) || isNaN(fin) || fin <= ini) return res.status(400).json({ error: 'Fechas inválidas' });
  if (ini < now) return res.status(400).json({ error: 'La reserva no puede iniciar en el pasado' });

  const k = (await db.query(
    `SELECT k.id, k.nombre, k.asignatura_id FROM kit k WHERE k.id=$1 AND k.entidad_id=$2`,
    [req.params.id, req.sede])).rows[0];
  if (!k) return res.status(404).json({ error: 'Kit no encontrado' });

  // Debe estar inscrito en la asignatura del kit
  const insc = await db.query(
    `SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, k.asignatura_id]);
  if (!insc.rowCount && req.user.rol !== 'admin')
    return res.status(403).json({ error: 'No estás inscrito en la asignatura de este kit' });

  // Sanción vigente bloquea
  const sanc = await db.query(
    `SELECT motivo FROM v_sanciones_vigentes WHERE usuario_rut=$1 AND (asignatura_id IS NULL OR asignatura_id=$2)`,
    [req.user.rut, k.asignatura_id]);
  if (sanc.rows.length) return res.status(403).json({ error: `Bloqueado por sanción vigente: ${sanc.rows[0].motivo}` });

  const items = (await db.query(`SELECT * FROM kit_item WHERE kit_id=$1`, [k.id])).rows;
  if (!items.length) return res.status(400).json({ error: 'El kit no tiene equipos definidos' });

  // Reservar dentro de una transacción: o se asigna todo el kit, o nada.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const asignadas = [];
    for (const it of items) {
      const libres = (await client.query(
        `SELECT id FROM equipo WHERE entidad_id=$1 AND categoria_id=$2 AND nombre=$3
           AND COALESCE(modelo,'')=COALESCE($4,'') AND COALESCE(marca,'')=COALESCE($5,'')
           AND estado='disponible'
         ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $6`,
        [req.sede, it.categoria_id, it.nombre, it.modelo, it.marca, it.cantidad])).rows;
      if (libres.length < it.cantidad) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Sin stock suficiente de "${it.nombre}" (se requieren ${it.cantidad}, hay ${libres.length})` });
      }
      for (const u of libres) {
        const r = (await client.query(
          `INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, motivo)
           VALUES ($1,$2,$3,$4,'confirmada',TRUE,$5) RETURNING id`,
          [req.user.rut, u.id, ini, fin, `Kit: ${k.nombre}`])).rows[0];
        await client.query(
          `INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable) VALUES ($1,$2,$3,$4,TRUE)`,
          [r.id, req.user.rut, req.user.nombre, req.user.rut]);
        await client.query(`UPDATE equipo SET estado='reservado' WHERE id=$1`, [u.id]);
        asignadas.push(r.id);
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, reservas: asignadas.length, kit: k.nombre });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}));

// ----------------------- Módulo de Tareas (flujo académico) -----------------------
app.get('/api/tareas', auth, wrap(async (req, res) => {
  if (req.user.rol === 'docente' || req.user.rol === 'admin') {
    const { rows } = await db.query(
      `SELECT t.id, t.titulo, t.tipo, t.fecha_inicio, t.fecha_fin, a.nombre AS asignatura, a.seccion,
              (SELECT count(*)::int FROM reserva r WHERE r.tarea_id=t.id) AS reservas
       FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id JOIN carrera c ON c.id=a.carrera_id
       WHERE c.entidad_id=$1 AND (t.docente_rut=$2
             OR t.asignatura_id IN (SELECT asignatura_id FROM usuario_asignatura WHERE usuario_rut=$2 AND rol_en_asig='docente')
             OR $3='admin')
       ORDER BY t.fecha_inicio DESC`, [req.sede, req.user.rut, req.user.rol]);
    return res.json(rows);
  }
  const { rows } = await db.query(
    `SELECT t.id, t.titulo, t.tipo, t.fecha_inicio, t.fecha_fin, a.nombre AS asignatura, a.seccion
     FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id
     WHERE t.asignatura_id IN (SELECT asignatura_id FROM usuario_asignatura WHERE usuario_rut=$1 AND rol_en_asig='alumno')
       AND t.fecha_fin >= now()
     ORDER BY t.fecha_inicio`, [req.user.rut]);
  res.json(rows);
}));

app.get('/api/tareas/:id', auth, wrap(async (req, res) => {
  const t = (await db.query(
    `SELECT t.*, a.nombre AS asignatura, a.seccion FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id
     JOIN carrera c ON c.id=a.carrera_id WHERE t.id=$1 AND c.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
  // RF-11: categorías habilitadas de la tarea.
  let categorias = [];
  try {
    categorias = (await db.query(
      `SELECT c.id, c.nombre, c.simbolo,
              GREATEST(0,
                (SELECT count(*)::int FROM equipo e WHERE e.categoria_id=c.id AND e.entidad_id=$2 AND e.estado='disponible')
                - COALESCE((SELECT count(*)::int FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
                            WHERE r.categoria_id=c.id AND r.equipo_id IS NULL AND r.estado='confirmada' AND u.entidad_id=$2), 0)
              ) AS disponibles,
              EXISTS (SELECT 1 FROM reserva r WHERE r.tarea_id=$1 AND r.categoria_id=c.id
                        AND r.usuario_rut=$3 AND r.estado IN ('pendiente','confirmada','en_uso')) AS ya_reservada
       FROM tarea_categoria tc JOIN categoria c ON c.id=tc.categoria_id
       WHERE tc.tarea_id=$1 ORDER BY c.nombre`, [req.params.id, req.sede, req.user.rut])).rows;
  } catch (e) {
    if (e.code === '42P01') { /* migración 16 sin aplicar */ }
    else if (e.code === '42703') { // migración 17 sin aplicar → sin descuento por reservas de categoría
      categorias = (await db.query(
        `SELECT c.id, c.nombre, c.simbolo,
                (SELECT count(*)::int FROM equipo e WHERE e.categoria_id=c.id AND e.entidad_id=$2 AND e.estado='disponible') AS disponibles
         FROM tarea_categoria tc JOIN categoria c ON c.id=tc.categoria_id
         WHERE tc.tarea_id=$1 ORDER BY c.nombre`, [req.params.id, req.sede])).rows;
    } else throw e;
  }
  // Unidades disponibles para reservar: equipos de esas categorías en la sede.
  // (Si no hay categorías —tareas legadas— se usan los equipos habilitados por tarea_equipo.)
  let equipos;
  if (categorias.length) {
    equipos = (await db.query(
      `SELECT e.id, e.nombre, e.codigo_qr, e.estado, cat.nombre AS categoria, cat.id AS categoria_id
       FROM equipo e JOIN categoria cat ON cat.id=e.categoria_id
       WHERE e.entidad_id=$2 AND cat.id IN (SELECT categoria_id FROM tarea_categoria WHERE tarea_id=$1)
       ORDER BY cat.nombre, e.nombre`, [req.params.id, req.sede])).rows;
  } else {
    equipos = (await db.query(
      `SELECT e.id, e.nombre, e.codigo_qr, e.estado, cat.nombre AS categoria, cat.id AS categoria_id
       FROM tarea_equipo te JOIN equipo e ON e.id=te.equipo_id LEFT JOIN categoria cat ON cat.id=e.categoria_id
       WHERE te.tarea_id=$1 ORDER BY e.nombre`, [req.params.id])).rows;
  }
  let reservas = [];
  if (req.user.rol === 'docente' || req.user.rol === 'admin') {
    reservas = (await db.query(
      `SELECT r.id, u.nombre AS alumno, u.rut, e.nombre AS equipo, r.estado, r.fecha_inicio, r.fecha_fin
       FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
       WHERE r.tarea_id=$1 ORDER BY r.created_at DESC`, [req.params.id])).rows;
  }
  res.json({ tarea: t, categorias, equipos, reservas });
}));

app.post('/api/tareas', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const { asignatura_id, titulo, descripcion, fecha_inicio, fecha_fin, tipo, equipos, categorias } = req.body || {};
  if (!asignatura_id || !titulo || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Faltan datos de la tarea' });
  const cats = Array.isArray(categorias) ? [...new Set(categorias.map(Number).filter(Boolean))] : [];
  if (!cats.length) return res.status(400).json({ error: 'Debes habilitar al menos una categoría para la tarea (RF-11).' });
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin);
  if (isNaN(ini) || isNaN(fin) || fin <= ini) return res.status(400).json({ error: 'Fechas inválidas' });
  const a = (await db.query(`SELECT a.id FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE a.id=$1 AND c.entidad_id=$2`, [asignatura_id, req.sede])).rows[0];
  if (!a) return res.status(400).json({ error: 'Asignatura no válida' });
  if (req.user.rol === 'docente') {
    const ok = await db.query(`SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2 AND rol_en_asig='docente'`, [req.user.rut, asignatura_id]);
    if (!ok.rows.length) return res.status(403).json({ error: 'No estás a cargo de esa asignatura' });
  }
  // RF-11: toda categoría de la tarea debe estar habilitada (elegibilidad) para la asignatura.
  const eleg = (await db.query(`SELECT categoria_id FROM elegibilidad WHERE asignatura_id=$1`, [asignatura_id])).rows.map(r => r.categoria_id);
  const noEleg = cats.filter(c => !eleg.includes(c));
  if (noEleg.length) {
    const nombres = (await db.query(`SELECT nombre FROM categoria WHERE id=ANY($1)`, [noEleg])).rows.map(r => r.nombre);
    return res.status(400).json({ error: `Categoría no habilitada para la asignatura: ${nombres.join(', ') || noEleg.join(', ')}. No se puede crear la tarea (RF-11).` });
  }
  const tp = tipo === 'grupal' ? 'grupal' : 'individual';
  const t = (await db.query(
    `INSERT INTO tarea (asignatura_id, docente_rut, titulo, descripcion, fecha_inicio, fecha_fin, tipo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [asignatura_id, req.user.rut, titulo.trim(), descripcion || null, ini, fin, tp])).rows[0];
  try {
    for (const cid of cats) await db.query(`INSERT INTO tarea_categoria (tarea_id, categoria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.id, cid]);
  } catch (e) {
    if (e.code === '42P01') { await db.query(`DELETE FROM tarea WHERE id=$1`, [t.id]); return res.status(409).json({ error: 'Falta correr la migración 16 (tarea_categoria).' }); }
    throw e;
  }
  // Compatibilidad: si además se enviaron equipos específicos, se registran.
  if (Array.isArray(equipos)) {
    for (const eid of equipos) await db.query(`INSERT INTO tarea_equipo (tarea_id, equipo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.id, eid]);
  }
  // Anuncio automático para los alumnos de la sede: cada nueva tarea aparece en Anuncios.
  try {
    const asg = (await db.query(`SELECT nombre, seccion FROM asignatura WHERE id=$1`, [asignatura_id])).rows[0];
    const nomAsg = asg ? asg.nombre + (asg.seccion ? ` (${asg.seccion})` : '') : '';
    const cuerpo = `${nomAsg ? nomAsg + ' · ' : ''}${descripcion ? descripcion + ' · ' : ''}`
      + `Período: ${ini.toISOString().slice(0, 10)} al ${fin.toISOString().slice(0, 10)}.`;
    await db.query(
      `INSERT INTO anuncio (entidad_id, titulo, cuerpo, creado_por) VALUES ($1,$2,$3,$4)`,
      [req.sede, `Nueva tarea: ${titulo.trim()}`, cuerpo, req.user.rut]);
  } catch (e) { if (e.code !== '42P01') throw e; } // migración 06 no aplicada → se omite
  res.status(201).json({ id: t.id });
}));

app.put('/api/tareas/:id', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const { titulo, descripcion, fecha_inicio, fecha_fin, tipo, equipos, categorias } = req.body || {};
  const t = (await db.query(`SELECT t.* FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id JOIN carrera c ON c.id=a.carrera_id WHERE t.id=$1 AND c.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (req.user.rol === 'docente' && t.docente_rut !== req.user.rut) return res.status(403).json({ error: 'No es tu tarea' });
  const ini = fecha_inicio ? new Date(fecha_inicio) : t.fecha_inicio;
  const fin = fecha_fin ? new Date(fecha_fin) : t.fecha_fin;
  const tp = tipo ? (tipo === 'grupal' ? 'grupal' : 'individual') : t.tipo;
  // RF-11: si se actualizan categorías, validar elegibilidad contra la asignatura.
  let cats = null;
  if (Array.isArray(categorias)) {
    cats = [...new Set(categorias.map(Number).filter(Boolean))];
    if (!cats.length) return res.status(400).json({ error: 'La tarea debe tener al menos una categoría (RF-11).' });
    const eleg = (await db.query(`SELECT categoria_id FROM elegibilidad WHERE asignatura_id=$1`, [t.asignatura_id])).rows.map(r => r.categoria_id);
    const noEleg = cats.filter(c => !eleg.includes(c));
    if (noEleg.length) {
      const nombres = (await db.query(`SELECT nombre FROM categoria WHERE id=ANY($1)`, [noEleg])).rows.map(r => r.nombre);
      return res.status(400).json({ error: `Categoría no habilitada para la asignatura: ${nombres.join(', ') || noEleg.join(', ')} (RF-11).` });
    }
  }
  await db.query(`UPDATE tarea SET titulo=COALESCE($2,titulo), descripcion=$3, fecha_inicio=$4, fecha_fin=$5, tipo=$6, updated_at=now() WHERE id=$1`,
    [req.params.id, titulo || null, descripcion || null, ini, fin, tp]);
  if (cats) {
    try {
      await db.query(`DELETE FROM tarea_categoria WHERE tarea_id=$1`, [req.params.id]);
      for (const cid of cats) await db.query(`INSERT INTO tarea_categoria (tarea_id, categoria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, cid]);
    } catch (e) { if (e.code === '42P01') return res.status(409).json({ error: 'Falta correr la migración 16 (tarea_categoria).' }); throw e; }
  }
  if (Array.isArray(equipos)) {
    await db.query(`DELETE FROM tarea_equipo WHERE tarea_id=$1`, [req.params.id]);
    for (const eid of equipos) await db.query(`INSERT INTO tarea_equipo (tarea_id, equipo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, eid]);
  }
  res.json({ ok: true });
}));

app.delete('/api/tareas/:id', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const t = (await db.query(`SELECT t.docente_rut FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id JOIN carrera c ON c.id=a.carrera_id WHERE t.id=$1 AND c.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (req.user.rol === 'docente' && t.docente_rut !== req.user.rut) return res.status(403).json({ error: 'No es tu tarea' });
  await db.query(`DELETE FROM tarea WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/tareas/:id/reservar', auth, requireRole('alumno', 'docente'), wrap(async (req, res) => {
  const { categoria_id, integrantes } = req.body || {};
  if (!categoria_id) return res.status(400).json({ error: 'Debes elegir una categoría disponible' });
  const t = (await db.query(`SELECT t.* FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id JOIN carrera c ON c.id=a.carrera_id WHERE t.id=$1 AND c.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
  // El solicitante debe estar inscrito en la asignatura/sección de la tarea.
  const insc = await db.query(`SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, t.asignatura_id]);
  if (!insc.rows.length) return res.status(403).json({ error: 'No estás inscrito en la asignatura/sección de la tarea' });

  // RF-11: la categoría debe estar habilitada en la tarea…
  let catOk = false;
  try {
    catOk = (await db.query(`SELECT 1 FROM tarea_categoria WHERE tarea_id=$1 AND categoria_id=$2`, [req.params.id, categoria_id])).rowCount > 0;
  } catch (e) { if (e.code !== '42P01') throw e; } // migración 16 aún sin aplicar
  if (!catOk) return res.status(403).json({ error: 'La categoría no está habilitada para la tarea (RF-11).' });
  // …y ser elegible para la asignatura.
  const eleg = await db.query(`SELECT 1 FROM elegibilidad WHERE asignatura_id=$1 AND categoria_id=$2`, [t.asignatura_id, categoria_id]);
  if (!eleg.rows.length) return res.status(403).json({ error: 'La categoría no está habilitada para la asignatura (elegibilidad, RF-11).' });
  const cat = (await db.query(`SELECT nombre FROM categoria WHERE id=$1`, [categoria_id])).rows[0];

  // RF-11: las fechas COINCIDEN con las de la tarea (las define el docente).
  const ini = new Date(t.fecha_inicio), fin = new Date(t.fecha_fin), now = new Date();

  // RF-11: anticipación en HORAS HÁBILES (parametrizable por sede).
  let minHoras = ANTICIPACION_MIN_H;
  try {
    const cfg = (await db.query(`SELECT horas_anticipacion FROM entidad WHERE id=$1`, [req.sede])).rows[0];
    if (cfg && Number.isFinite(Number(cfg.horas_anticipacion))) minHoras = Number(cfg.horas_anticipacion);
  } catch (e) { if (e.code !== '42703') throw e; }
  if (horasHabilesEntre(now, ini) < minHoras)
    return res.status(400).json({ error: `El plazo de reserva es de al menos ${minHoras} h hábiles de anticipación respecto al inicio de la tarea. Para excepciones, usa una solicitud especial.` });

  // RF-11: capacidad de la categoría = unidades disponibles − reservas de categoría ya confirmadas (sin individualizar).
  const disp = (await db.query(`SELECT count(*)::int n FROM equipo WHERE categoria_id=$1 AND entidad_id=$2 AND estado='disponible'`, [categoria_id, req.sede])).rows[0].n;
  let resCat = 0;
  try {
    resCat = (await db.query(
      `SELECT count(*)::int n FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
       WHERE r.categoria_id=$1 AND r.equipo_id IS NULL AND r.estado='confirmada' AND u.entidad_id=$2`,
      [categoria_id, req.sede])).rows[0].n;
  } catch (e) { if (e.code !== '42703') throw e; } // sin migración 17 → columna categoria_id aún no existe
  if (disp - resCat <= 0)
    return res.status(409).json({ error: `No hay unidades disponibles en la categoría ${cat ? cat.nombre : ''} para las fechas de la tarea.` });

  const sanc = await db.query(`SELECT motivo FROM v_sanciones_vigentes WHERE usuario_rut=$1 AND (asignatura_id IS NULL OR asignatura_id=$2)`, [req.user.rut, t.asignatura_id]);
  if (sanc.rows.length) return res.status(403).json({ error: `Bloqueado por sanción vigente: ${sanc.rows[0].motivo}` });

  // RF-11/52: los integrantes deben estar inscritos en la MISMA asignatura/sección de la tarea.
  const grupo = Array.isArray(integrantes)
    ? integrantes.filter(x => x && x.rut).map(x => ({ nombre: (x.nombre || '').trim(), rut: x.rut.trim() }))
    : [];
  for (const g of grupo) {
    if (g.rut === req.user.rut) continue;
    const ok = await db.query(
      `SELECT u.nombre FROM usuario_asignatura ua JOIN usuario u ON u.rut=ua.usuario_rut WHERE ua.usuario_rut=$1 AND ua.asignatura_id=$2`,
      [g.rut, t.asignatura_id]);
    if (!ok.rows.length) return res.status(400).json({ error: `El integrante ${g.rut} no está inscrito en la asignatura/sección de la tarea (RF-11).` });
    if (!g.nombre) g.nombre = ok.rows[0].nombre;
  }
  const esGrupal = grupo.length > 0;

  // RF-11: reserva POR CATEGORÍA (sin individualizar). El pañolero asigna la unidad al entregar.
  let r;
  try {
    r = (await db.query(
      `INSERT INTO reserva (usuario_rut, equipo_id, categoria_id, fecha_inicio, fecha_fin, estado, uso_academico, es_grupal, tarea_id)
       VALUES ($1,NULL,$2,$3,$4,'confirmada',TRUE,$5,$6) RETURNING id`,
      [req.user.rut, categoria_id, ini, fin, esGrupal, req.params.id])).rows[0];
  } catch (e) {
    if (e.code === '42703' || e.code === '23502') return res.status(409).json({ error: 'Falta correr la migración 17 (reserva por categoría).' });
    throw e;
  }
  await db.query(`INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable) VALUES ($1,$2,$3,$4,TRUE)`, [r.id, req.user.rut, req.user.nombre, req.user.rut]);
  for (const g of grupo) {
    if (g.rut === req.user.rut) continue;
    await db.query(`INSERT INTO integrante (reserva_id, nombre, rut, es_responsable) VALUES ($1,$2,$3,FALSE) ON CONFLICT (reserva_id, rut) DO NOTHING`, [r.id, g.nombre, g.rut]);
  }
  res.status(201).json({ id: r.id, mensaje: `Reserva de la categoría "${cat ? cat.nombre : ''}" confirmada. El pañol asignará la unidad al entregar.` });
}));

// ----------------------- Solicitudes especiales -----------------------
// Equipos disponibles para una asignatura (según elegibilidad categoría × asignatura)
app.get('/api/asignaturas/:id/equipos', auth, wrap(async (req, res) => {
  const aid = Number(req.params.id);
  const insc = await db.query(`SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, aid]);
  if (!insc.rowCount && req.user.rol !== 'admin') return res.status(403).json({ error: 'No estás inscrito en esta asignatura' });
  const { rows } = await db.query(
    `SELECT e.id, e.nombre, e.estado, e.foto_referencia, c.nombre AS categoria
     FROM equipo e JOIN categoria c ON c.id=e.categoria_id
     WHERE e.entidad_id=$1 AND c.id IN (SELECT categoria_id FROM elegibilidad WHERE asignatura_id=$2)
     ORDER BY c.nombre, e.nombre`, [req.sede, aid]);
  res.json(rows);
}));

// RF-11: categorías ELEGIBLES para una asignatura (para crear tareas por categoría),
// con el conteo de unidades disponibles en la sede.
app.get('/api/asignaturas/:id/categorias', auth, wrap(async (req, res) => {
  const aid = Number(req.params.id);
  if (req.user.rol !== 'admin') {
    const insc = await db.query(`SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, aid]);
    if (!insc.rowCount) return res.status(403).json({ error: 'No estás inscrito en esta asignatura' });
  }
  const { rows } = await db.query(
    `SELECT c.id, c.nombre, c.simbolo,
            (SELECT count(*)::int FROM equipo e WHERE e.categoria_id=c.id AND e.entidad_id=$1 AND e.estado='disponible') AS disponibles,
            (SELECT count(*)::int FROM equipo e WHERE e.categoria_id=c.id AND e.entidad_id=$1) AS total
     FROM categoria c
     WHERE c.id IN (SELECT categoria_id FROM elegibilidad WHERE asignatura_id=$2)
     ORDER BY c.nombre`, [req.sede, aid]);
  res.json(rows);
}));

app.post('/api/solicitudes', auth, wrap(async (req, res) => {
  const { asignatura_id, descripcion, fecha_inicio, fecha_fin, duracion, equipos, categorias } = req.body || {};
  if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'La descripción es obligatoria' });
  const catsReq = Array.isArray(categorias) ? categorias.map(Number).filter(Boolean) : [];
  const eqReq = Array.isArray(equipos) ? equipos.map(Number).filter(Boolean) : [];
  if (!catsReq.length && !eqReq.length) return res.status(400).json({ error: 'Debe seleccionar al menos una categoría' });

  // Sede de la solicitud = sede del solicitante. Política del flujo excepcional por sede.
  const su = (await db.query(`SELECT entidad_id FROM usuario WHERE rut=$1`, [req.user.rut])).rows[0];
  const sedeId = (su && su.entidad_id) || req.sede || null;
  let pol = { permite: true, hae: 0 };
  try {
    const p = (await db.query(
      `SELECT permite_solicitud_especial, horas_anticipacion_excepcional FROM entidad WHERE id=$1`, [sedeId])).rows[0];
    if (p) pol = { permite: p.permite_solicitud_especial !== false, hae: Number(p.horas_anticipacion_excepcional) || 0 };
  } catch (e) { if (e.code !== '42703') throw e; } // política aún sin migrar → se asume habilitada
  if (!pol.permite)
    return res.status(400).json({ error: 'Esta sede no habilita solicitudes excepcionales. Coordina con el pañol.' });
  if (pol.hae > 0 && fecha_inicio) {
    const horas = (new Date(fecha_inicio) - new Date()) / 3600000;
    if (horas < pol.hae)
      return res.status(400).json({ error: `Las solicitudes excepcionales de esta sede requieren al menos ${pol.hae} h de anticipación.` });
  }

  let docente = null;
  if (asignatura_id) {
    const d = await db.query(`SELECT usuario_rut FROM usuario_asignatura WHERE asignatura_id=$1 AND rol_en_asig='docente' LIMIT 1`, [asignatura_id]);
    docente = d.rows[0] ? d.rows[0].usuario_rut : null;
  }
  let r;
  try {
    r = (await db.query(
      `INSERT INTO solicitud_especial (usuario_rut, asignatura_id, docente_rut, entidad_id, descripcion, estado)
       VALUES ($1,$2,$3,$4,$5,'pendiente') RETURNING id`,
      [req.user.rut, asignatura_id || null, docente, sedeId, descripcion.trim()])).rows[0];
  } catch (e) {
    if (e.code !== '42703') throw e; // columna entidad_id aún sin migrar
    r = (await db.query(
      `INSERT INTO solicitud_especial (usuario_rut, asignatura_id, docente_rut, descripcion, estado)
       VALUES ($1,$2,$3,$4,'pendiente') RETURNING id`,
      [req.user.rut, asignatura_id || null, docente, descripcion.trim()])).rows[0];
  }
  // Campos adicionales (tolerante a migración 07 no aplicada)
  try {
    if (fecha_inicio || fecha_fin || duracion) {
      await db.query(`UPDATE solicitud_especial SET fecha_inicio=$2, fecha_fin=$3, duracion=$4 WHERE id=$1`,
        [r.id, fecha_inicio ? new Date(fecha_inicio) : null, fecha_fin ? new Date(fecha_fin) : null, (duracion || null)]);
    }
  } catch (e) { if (e.code !== '42703') throw e; }
  if (Array.isArray(equipos) && equipos.length) {
    try {
      for (const eid of equipos) {
        await db.query(`INSERT INTO solicitud_equipo (solicitud_id, equipo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r.id, Number(eid)]);
      }
    } catch (e) { if (e.code !== '42P01') throw e; }
  }
  // RF-11: categorías solicitadas (se piden por categoría, no por equipo individual).
  const catsSol = Array.isArray(categorias) ? [...new Set(categorias.map(Number).filter(Boolean))] : [];
  if (catsSol.length) {
    try {
      for (const cid of catsSol) {
        await db.query(`INSERT INTO solicitud_categoria (solicitud_id, categoria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r.id, cid]);
      }
    } catch (e) { if (e.code !== '42P01') throw e; } // migración 18 aún sin aplicar
  }
  res.status(201).json({ id: r.id });
}));

app.get('/api/solicitudes/mias', auth, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.descripcion, s.estado, s.respuesta, s.created_at, s.fecha_inicio, s.fecha_fin, s.duracion, a.nombre AS asignatura,
              COALESCE((SELECT array_agg(e.nombre ORDER BY e.nombre) FROM solicitud_equipo se JOIN equipo e ON e.id=se.equipo_id WHERE se.solicitud_id=s.id), '{}') AS equipos,
              COALESCE((SELECT array_agg(c.nombre ORDER BY c.nombre) FROM solicitud_categoria sc JOIN categoria c ON c.id=sc.categoria_id WHERE sc.solicitud_id=s.id), '{}') AS categorias
       FROM solicitud_especial s LEFT JOIN asignatura a ON a.id=s.asignatura_id
       WHERE s.usuario_rut=$1 ORDER BY s.created_at DESC`, [req.user.rut]);
    return res.json(rows);
  } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }
  const { rows } = await db.query(
    `SELECT s.id, s.descripcion, s.estado, s.respuesta, s.created_at, a.nombre AS asignatura
     FROM solicitud_especial s LEFT JOIN asignatura a ON a.id=s.asignatura_id
     WHERE s.usuario_rut=$1 ORDER BY s.created_at DESC`, [req.user.rut]);
  res.json(rows);
}));

app.get('/api/solicitudes/pendientes', auth, requireRole('docente', 'jefe_panol', 'admin'), wrap(async (req, res) => {
  // Queue acotado por sede: admin ve todas sus sedes; el resto solo las sedes en que opera.
  // Autorización: admin, el docente relacionado a la asignatura, o el rol que la sede define
  // en rol_autoriza_especial (docente | jefe_panol | admin).
  const esTodos = req.sedesPermitidas === null;
  const baseRich = `FROM solicitud_especial s
       JOIN usuario u ON u.rut=s.usuario_rut
       LEFT JOIN asignatura a ON a.id=s.asignatura_id
       LEFT JOIN entidad en ON en.id=s.entidad_id
     WHERE s.estado='pendiente'
       AND (${esTodos ? 'TRUE' : 's.entidad_id = ANY($3)'})
       AND ( $2='admin'
             OR s.docente_rut=$1
             OR s.asignatura_id IN (SELECT asignatura_id FROM usuario_asignatura WHERE usuario_rut=$1 AND rol_en_asig='docente')
             OR en.rol_autoriza_especial = $2 )
     ORDER BY s.created_at`;
  const paramsRich = esTodos ? [req.user.rut, req.user.rol] : [req.user.rut, req.user.rol, req.sedesPermitidas];
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.descripcion, s.estado, s.created_at, s.fecha_inicio, s.fecha_fin, s.duracion, u.nombre AS alumno, u.rut, a.nombre AS asignatura, en.nombre AS sede,
              COALESCE((SELECT array_agg(e.nombre ORDER BY e.nombre) FROM solicitud_equipo se JOIN equipo e ON e.id=se.equipo_id WHERE se.solicitud_id=s.id), '{}') AS equipos,
              COALESCE((SELECT array_agg(c.nombre ORDER BY c.nombre) FROM solicitud_categoria sc JOIN categoria c ON c.id=sc.categoria_id WHERE sc.solicitud_id=s.id), '{}') AS categorias
       ${baseRich}`, paramsRich);
    return res.json(rows);
  } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; } // migraciones 07/15 aún sin aplicar

  // Fallback (sin entidad_id / sin solicitud_equipo): comportamiento previo por relación docente.
  const base = `FROM solicitud_especial s JOIN usuario u ON u.rut=s.usuario_rut LEFT JOIN asignatura a ON a.id=s.asignatura_id
     WHERE s.estado='pendiente' AND (s.docente_rut=$1
           OR s.asignatura_id IN (SELECT asignatura_id FROM usuario_asignatura WHERE usuario_rut=$1 AND rol_en_asig='docente')
           OR $2='admin')
     ORDER BY s.created_at`;
  const { rows } = await db.query(
    `SELECT s.id, s.descripcion, s.estado, s.created_at, u.nombre AS alumno, u.rut, a.nombre AS asignatura ${base}`,
    [req.user.rut, req.user.rol]);
  res.json(rows);
}));

app.post('/api/solicitudes/:id/responder', auth, requireRole('docente', 'jefe_panol', 'admin'), wrap(async (req, res) => {
  const { estado, respuesta } = req.body || {};
  if (!['aprobada', 'rechazada'].includes(estado)) return res.status(400).json({ error: 'Estado no válido' });

  const cur = (await db.query(
    `SELECT estado, usuario_rut, fecha_inicio, fecha_fin FROM solicitud_especial WHERE id=$1`, [req.params.id])).rows[0];
  if (!cur || cur.estado !== 'pendiente') return res.status(404).json({ error: 'Solicitud no encontrada o ya respondida' });

  // Lo solicitado: categorías (RF-11) y, por compatibilidad, equipos legados.
  let cats = [];
  try {
    cats = (await db.query(`SELECT categoria_id FROM solicitud_categoria WHERE solicitud_id=$1`, [req.params.id])).rows.map(x => x.categoria_id);
  } catch (e) { if (e.code !== '42P01') throw e; } // sin tabla solicitud_categoria (migración 18)
  let eqs = [];
  if (!cats.length) {
    try {
      eqs = (await db.query(`SELECT equipo_id FROM solicitud_equipo WHERE solicitud_id=$1`, [req.params.id])).rows;
    } catch (e) { if (e.code !== '42P01') throw e; } // sin tabla solicitud_equipo (migración 07)
  }

  // Sede del solicitante (para la capacidad por categoría).
  const su = (await db.query(`SELECT entidad_id FROM usuario WHERE rut=$1`, [cur.usuario_rut])).rows[0];
  const sedeId = su ? su.entidad_id : null;

  // "Según disponibilidad": verificar ANTES de materializar. Si no hay, queda pendiente.
  if (estado === 'aprobada' && cur.fecha_inicio && cur.fecha_fin) {
    for (const cid of cats) {
      const disp = (await db.query(`SELECT count(*)::int n FROM equipo WHERE categoria_id=$1 AND entidad_id=$2 AND estado='disponible'`, [cid, sedeId])).rows[0].n;
      let resCat = 0;
      try {
        resCat = (await db.query(
          `SELECT count(*)::int n FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
           WHERE r.categoria_id=$1 AND r.equipo_id IS NULL AND r.estado='confirmada' AND u.entidad_id=$2`, [cid, sedeId])).rows[0].n;
      } catch (e) { if (e.code !== '42703') throw e; }
      if (disp - resCat <= 0) {
        const c = (await db.query(`SELECT nombre FROM categoria WHERE id=$1`, [cid])).rows[0];
        return res.status(409).json({ error: `No hay unidades disponibles en la categoría "${c ? c.nombre : cid}". La solicitud queda pendiente.` });
      }
    }
    for (const row of eqs) {
      const choca = (await db.query(
        `SELECT 1 FROM reserva WHERE equipo_id=$1 AND estado IN ('pendiente','confirmada','en_uso')
          AND fecha_fin > $2 AND fecha_inicio < $3 LIMIT 1`,
        [row.equipo_id, cur.fecha_inicio, cur.fecha_fin])).rows[0];
      if (choca) {
        const eq = (await db.query(`SELECT nombre FROM equipo WHERE id=$1`, [row.equipo_id])).rows[0];
        return res.status(409).json({ error: `El equipo "${eq ? eq.nombre : row.equipo_id}" no está disponible en esa fecha. La solicitud queda pendiente.` });
      }
    }
  }

  const r = await db.query(
    `UPDATE solicitud_especial SET estado=$2, respuesta=$3, docente_rut=$4, updated_at=now()
     WHERE id=$1 AND estado='pendiente'`, [req.params.id, estado, respuesta || null, req.user.rut]);
  if (!r.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada o ya respondida' });

  // Al APROBAR se materializa como reserva(s) confirmada(s). Las de CATEGORÍA quedan sin
  // unidad (el pañolero individualiza al entregar); las legadas por equipo lo marcan reservado.
  let reservas_creadas = 0;
  if (estado === 'aprobada' && cur.fecha_inicio && cur.fecha_fin) {
    const sol = (await db.query(`SELECT nombre FROM usuario WHERE rut=$1`, [cur.usuario_rut])).rows[0];
    try {
      for (const cid of cats) {
        const nr = (await db.query(
          `INSERT INTO reserva (usuario_rut, equipo_id, categoria_id, fecha_inicio, fecha_fin, estado, uso_academico, es_grupal, motivo)
           VALUES ($1,NULL,$2,$3,$4,'confirmada',TRUE,FALSE,$5) RETURNING id`,
          [cur.usuario_rut, cid, cur.fecha_inicio, cur.fecha_fin, `Solicitud especial #${req.params.id}`])).rows[0];
        await db.query(
          `INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable)
           VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (reserva_id, rut) DO NOTHING`,
          [nr.id, cur.usuario_rut, sol ? sol.nombre : cur.usuario_rut, cur.usuario_rut]);
        reservas_creadas++;
      }
      for (const row of eqs) {
        const nr = (await db.query(
          `INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, es_grupal, motivo)
           VALUES ($1,$2,$3,$4,'confirmada',TRUE,FALSE,$5) RETURNING id`,
          [cur.usuario_rut, row.equipo_id, cur.fecha_inicio, cur.fecha_fin, `Solicitud especial #${req.params.id}`])).rows[0];
        await db.query(
          `INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable)
           VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (reserva_id, rut) DO NOTHING`,
          [nr.id, cur.usuario_rut, sol ? sol.nombre : cur.usuario_rut, cur.usuario_rut]);
        await db.query(`UPDATE equipo SET estado='reservado' WHERE id=$1`, [row.equipo_id]);
        reservas_creadas++;
      }
    } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }
  }
  res.json({ ok: true, reservas_creadas });
}));

// ----------------------- Calendario de disponibilidad -----------------------
// Disponibilidad agregada por asignatura y categoría (RF-11), considerando
// reservas confirmadas y solicitudes pendientes que se solapan con el rango.
app.get('/api/disponibilidad', auth, wrap(async (req, res) => {
  const desde = req.query.desde ? new Date(req.query.desde) : new Date();
  const hasta = req.query.hasta ? new Date(req.query.hasta + 'T23:59:59') : new Date(Date.now() + 21 * 864e5);
  if (isNaN(desde) || isNaN(hasta)) return res.status(400).json({ error: 'Rango de fechas inválido' });

  const rol = req.user.rol;
  let asigs;
  if (rol === 'alumno' || rol === 'docente') {
    asigs = (await db.query(
      `SELECT a.id, a.nombre, a.seccion FROM usuario_asignatura ua
         JOIN asignatura a ON a.id=ua.asignatura_id JOIN carrera c ON c.id=a.carrera_id
       WHERE ua.usuario_rut=$1 AND c.entidad_id=$2 ORDER BY a.nombre, a.seccion`, [req.user.rut, req.sede])).rows;
  } else {
    asigs = (await db.query(
      `SELECT a.id, a.nombre, a.seccion FROM asignatura a JOIN carrera c ON c.id=a.carrera_id
       WHERE c.entidad_id=$1 ORDER BY a.nombre, a.seccion`, [req.sede])).rows;
  }

  const out = [];
  for (const a of asigs) {
    const cats = (await db.query(
      `SELECT c.id, c.nombre,
         (SELECT count(*)::int FROM equipo e WHERE e.categoria_id=c.id AND e.entidad_id=$2 AND e.estado<>'baja') AS total,
         (SELECT count(*)::int FROM equipo e WHERE e.categoria_id=c.id AND e.entidad_id=$2 AND e.estado='mantencion') AS en_mantencion
       FROM categoria c
       WHERE c.id IN (SELECT categoria_id FROM elegibilidad WHERE asignatura_id=$1)
       ORDER BY c.nombre`, [a.id, req.sede])).rows;
    for (const cc of cats) {
      // Reservas confirmadas / en uso que consumen una unidad de la categoría y se solapan.
      cc.confirmadas = (await db.query(
        `SELECT count(*)::int n FROM reserva r
           LEFT JOIN equipo e ON e.id=r.equipo_id
           JOIN usuario u ON u.rut=r.usuario_rut
         WHERE r.estado IN ('confirmada','en_uso')
           AND COALESCE(r.categoria_id, e.categoria_id)=$1
           AND COALESCE(e.entidad_id, u.entidad_id)=$2
           AND r.fecha_fin > $3 AND r.fecha_inicio < $4`, [cc.id, req.sede, desde, hasta])).rows[0].n;
      // Solicitudes especiales PENDIENTES que incluyen la categoría y se solapan.
      let sol = 0;
      try {
        sol = (await db.query(
          `SELECT count(*)::int n FROM solicitud_categoria sc
             JOIN solicitud_especial s ON s.id=sc.solicitud_id
             JOIN usuario u ON u.rut=s.usuario_rut
           WHERE sc.categoria_id=$1 AND s.estado='pendiente' AND u.entidad_id=$2
             AND (s.fecha_inicio IS NULL OR (s.fecha_fin > $3 AND s.fecha_inicio < $4))`,
          [cc.id, req.sede, desde, hasta])).rows[0].n;
      } catch (e) { if (e.code !== '42P01' && e.code !== '42703') throw e; } // migración 18 sin aplicar
      cc.solicitadas = sol;
      cc.disponibles = Math.max(0, cc.total - cc.en_mantencion - cc.confirmadas);
    }
    out.push({ asignatura: a, categorias: cats });
  }
  res.json(out);
}));

app.get('/api/equipos/:id/ocupacion', auth, wrap(async (req, res) => {
  const desde = req.query.desde ? new Date(req.query.desde) : new Date();
  const hasta = req.query.hasta ? new Date(req.query.hasta) : new Date(Date.now() + 21 * 864e5);
  if (isNaN(desde) || isNaN(hasta)) return res.status(400).json({ error: 'Rango de fechas inválido' });
  const reservas = (await db.query(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, u.nombre AS usuario
     FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
     WHERE r.equipo_id=$1 AND r.estado IN ('pendiente','confirmada','en_uso')
       AND r.fecha_fin >= $2 AND r.fecha_inicio <= $3
     ORDER BY r.fecha_inicio`, [req.params.id, desde, hasta])).rows;
  // Solicitudes especiales PENDIENTES que incluyen este equipo → ocupación tentativa
  // (así el alumno ve su solicitud reflejada en la disponibilidad antes de ser aprobada).
  try {
    const sol = (await db.query(
      `SELECT s.id, s.fecha_inicio, s.fecha_fin, u.nombre AS usuario
       FROM solicitud_especial s
       JOIN solicitud_equipo se ON se.solicitud_id=s.id
       JOIN usuario u ON u.rut=s.usuario_rut
       WHERE se.equipo_id=$1 AND s.estado='pendiente'
         AND s.fecha_inicio IS NOT NULL AND s.fecha_fin IS NOT NULL
         AND s.fecha_fin >= $2 AND s.fecha_inicio <= $3
       ORDER BY s.fecha_inicio`, [req.params.id, desde, hasta])).rows;
    for (const x of sol) reservas.push({
      id: 'sol-' + x.id, fecha_inicio: x.fecha_inicio, fecha_fin: x.fecha_fin,
      estado: 'solicitud_pendiente', usuario: (x.usuario || '') + ' · solicitud especial',
    });
    reservas.sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));
  } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }

  const eq = (req.sedesPermitidas === null)
    ? (await db.query(`SELECT nombre, estado, codigo_qr FROM equipo WHERE id=$1`, [req.params.id])).rows[0]
    : (await db.query(`SELECT nombre, estado, codigo_qr FROM equipo WHERE id=$1 AND entidad_id = ANY($2)`, [req.params.id, req.sedesPermitidas])).rows[0];
  res.json({ equipo: eq || null, reservas, horario: 'Lunes a viernes, 9:00 a 18:00 h' });
}));

// ----------------------- Gestión completa de pedidos (admin/pañolero) -----------------------
app.get('/api/admin/pedidos', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const estado = req.query.estado || null;
  const q = req.query.q ? '%' + req.query.q + '%' : null;
  const { rows } = await db.query(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.tarea_id, u.nombre AS usuario, u.rut, e.nombre AS equipo, e.codigo_qr
     FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
     WHERE e.entidad_id=$1
       AND ($2::text IS NULL OR r.estado::text=$2)
       AND ($3::text IS NULL OR u.nombre ILIKE $3 OR u.rut ILIKE $3 OR e.nombre ILIKE $3)
     ORDER BY r.created_at DESC LIMIT 200`, [req.sede, estado, q]);
  res.json(rows);
}));

app.get('/api/admin/pedidos/:id', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const r = (await db.query(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.motivo, r.es_grupal, r.created_at,
            u.nombre AS usuario, u.rut, e.nombre AS equipo, e.codigo_qr
     FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
     WHERE r.id=$1`, [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Pedido no encontrado' });
  const integrantes = (await db.query(`SELECT nombre, rut, es_responsable FROM integrante WHERE reserva_id=$1 ORDER BY es_responsable DESC`, [req.params.id])).rows;
  const prestamo = (await db.query(`SELECT id, estado, fecha_salida, fecha_retorno FROM prestamo WHERE reserva_id=$1`, [req.params.id])).rows[0] || null;
  res.json({ reserva: r, integrantes, prestamo });
}));

app.post('/api/admin/pedidos', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const { usuario_rut, equipo_id, fecha_inicio, fecha_fin, motivo } = req.body || {};
  if (!usuario_rut || !equipo_id || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Faltan datos del pedido' });
  const u = await db.query(`SELECT nombre FROM usuario WHERE rut=$1 AND entidad_id=$2`, [usuario_rut, req.sede]);
  if (!u.rowCount) return res.status(400).json({ error: 'El usuario no existe' });
  const eq = (await db.query(`SELECT estado FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, req.sede])).rows[0];
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  if (eq.estado !== 'disponible') return res.status(409).json({ error: `El equipo no está disponible (estado: ${eq.estado})` });
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin);
  if (isNaN(ini) || isNaN(fin) || fin <= ini) return res.status(400).json({ error: 'Fechas inválidas' });
  const r = (await db.query(
    `INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, motivo)
     VALUES ($1,$2,$3,$4,'confirmada',TRUE,$5) RETURNING id`, [usuario_rut, equipo_id, ini, fin, motivo || 'Pedido presencial'])).rows[0];
  await db.query(`INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable) VALUES ($1,$2,$3,$2,TRUE)`, [r.id, usuario_rut, u.rows[0].nombre]);
  await db.query(`UPDATE equipo SET estado='reservado' WHERE id=$1`, [equipo_id]);
  res.status(201).json({ id: r.id });
}));

// ----------------------- Categorías y Laboratorios (admin) -----------------------
app.post('/api/admin/categorias', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, simbolo } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const r = (await db.query(`INSERT INTO categoria (nombre, simbolo) VALUES ($1,$2) RETURNING id`, [nombre.trim(), simbolo || null])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' }); throw e; }
}));
app.put('/api/admin/categorias/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, simbolo } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const r = await db.query(`UPDATE categoria SET nombre=$2, simbolo=$3, updated_at=now() WHERE id=$1`, [req.params.id, nombre.trim(), simbolo || null]);
  if (!r.rowCount) return res.status(404).json({ error: 'Categoría no encontrada' });
  res.json({ ok: true });
}));
app.delete('/api/admin/categorias/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  try {
    await db.query(`DELETE FROM categoria WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { if (e.code === '23503') return res.status(409).json({ error: 'No se puede eliminar: hay equipos en esta categoría' }); throw e; }
}));

app.post('/api/admin/laboratorios', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, ubicacion } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const r = (await db.query(`INSERT INTO laboratorio (nombre, ubicacion, entidad_id) VALUES ($1,$2,$3) RETURNING id`, [nombre.trim(), ubicacion || null, req.sede])).rows[0];
  res.status(201).json({ id: r.id });
}));
app.put('/api/admin/laboratorios/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, ubicacion } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const r = await db.query(`UPDATE laboratorio SET nombre=$2, ubicacion=$3, updated_at=now() WHERE id=$1 AND entidad_id=$4`, [req.params.id, nombre.trim(), ubicacion || null, req.sede]);
  if (!r.rowCount) return res.status(404).json({ error: 'Laboratorio no encontrado' });
  res.json({ ok: true });
}));
app.delete('/api/admin/laboratorios/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM laboratorio WHERE id=$1 AND entidad_id=$2`, [req.params.id, req.sede]);
  res.json({ ok: true });
}));

// ----------------------- Multisede: gestión de sedes (entidad) -----------------------
app.get('/api/sedes', auth, wrap(async (req, res) => {
  // Cada usuario recibe las sedes en las que puede operar (admin: todas; docente: las de
  // sus asignaturas; alumno/pañolero: la suya). Habilita el selector multi-sede.
  const ids = await sedesScope(req);
  const cols = 'id, nombre, bodega_label, activo';
  // Campos de política por sede (migración 13 y 15). Fallback si aún no se migran.
  const colsPol = `${cols}, horas_anticipacion, permite_solicitud_especial, horas_anticipacion_excepcional, rol_autoriza_especial`;
  let sedes = [];
  if (ids.length) {
    try {
      sedes = (await db.query(`SELECT ${colsPol} FROM entidad WHERE id = ANY($1) ORDER BY nombre`, [ids])).rows;
    } catch (e) {
      if (e.code !== '42703') throw e; // columnas aún sin migrar
      try {
        sedes = (await db.query(`SELECT ${cols}, horas_anticipacion FROM entidad WHERE id = ANY($1) ORDER BY nombre`, [ids])).rows;
      } catch (e2) {
        if (e2.code !== '42703') throw e2;
        sedes = (await db.query(`SELECT ${cols} FROM entidad WHERE id = ANY($1) ORDER BY nombre`, [ids])).rows;
      }
    }
  }
  const actual = sedes.find(s => s.id === req.sede) || sedes[0] || null;
  res.json({ actual, sede_activa: req.sede, sedes, puede_todos: sedes.length > 1 });
}));
const ROLES_AUTORIZA = ['docente', 'jefe_panol', 'admin'];
const normRolAutoriza = (v) => ROLES_AUTORIZA.includes(v) ? v : 'docente';

app.post('/api/admin/sedes', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, bodega_label, horas_anticipacion,
          permite_solicitud_especial, horas_anticipacion_excepcional, rol_autoriza_especial } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });
  const ha  = Number.isFinite(Number(horas_anticipacion)) ? Math.max(0, Math.round(Number(horas_anticipacion))) : 48;
  const hae = Number.isFinite(Number(horas_anticipacion_excepcional)) ? Math.max(0, Math.round(Number(horas_anticipacion_excepcional))) : 0;
  const pse = (permite_solicitud_especial === false) ? false : true;
  const ra  = normRolAutoriza(rol_autoriza_especial);
  try {
    const r = (await db.query(
      `INSERT INTO entidad (nombre, bodega_label, horas_anticipacion,
         permite_solicitud_especial, horas_anticipacion_excepcional, rol_autoriza_especial)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [nombre.trim(), (bodega_label && bodega_label.trim()) || 'Pañol', ha, pse, hae, ra])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
    if (e.code === '42703') return res.status(409).json({ error: 'Falta correr las migraciones 13 y 15 (columnas de política por sede).' });
    throw e;
  }
}));
app.put('/api/admin/sedes/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, bodega_label, activo, horas_anticipacion,
          permite_solicitud_especial, horas_anticipacion_excepcional, rol_autoriza_especial } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });
  const ha  = Number.isFinite(Number(horas_anticipacion)) ? Math.max(0, Math.round(Number(horas_anticipacion))) : null;
  const hae = Number.isFinite(Number(horas_anticipacion_excepcional)) ? Math.max(0, Math.round(Number(horas_anticipacion_excepcional))) : null;
  const pse = (typeof permite_solicitud_especial === 'boolean') ? permite_solicitud_especial : null;
  const ra  = ROLES_AUTORIZA.includes(rol_autoriza_especial) ? rol_autoriza_especial : null;
  try {
    const r = await db.query(
      `UPDATE entidad SET nombre=$2, bodega_label=$3, activo=COALESCE($4,activo),
         horas_anticipacion=COALESCE($5,horas_anticipacion),
         permite_solicitud_especial=COALESCE($6,permite_solicitud_especial),
         horas_anticipacion_excepcional=COALESCE($7,horas_anticipacion_excepcional),
         rol_autoriza_especial=COALESCE($8,rol_autoriza_especial),
         updated_at=now() WHERE id=$1`,
      [req.params.id, nombre.trim(), (bodega_label && bodega_label.trim()) || 'Pañol',
       typeof activo === 'boolean' ? activo : null, ha, pse, hae, ra]);
    if (!r.rowCount) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
    if (e.code === '42703') return res.status(409).json({ error: 'Falta correr las migraciones 13 y 15 (columnas de política por sede).' });
    throw e;
  }
}));

// ----------------------- Anuncios / tablón de avisos (por sede) -----------------------
app.get('/api/anuncios', auth, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.titulo, a.cuerpo, a.created_at, u.nombre AS autor
       FROM anuncio a LEFT JOIN usuario u ON u.rut=a.creado_por
       WHERE a.entidad_id=$1 AND a.activo=TRUE ORDER BY a.created_at DESC LIMIT 50`, [req.sede]);
    res.json(rows);
  } catch (e) { if (e.code === '42P01') return res.json([]); throw e; }
}));
app.post('/api/admin/anuncios', auth, requireRole('admin'), wrap(async (req, res) => {
  const { titulo, cuerpo } = req.body || {};
  if (!titulo || !titulo.trim() || !cuerpo || !cuerpo.trim()) return res.status(400).json({ error: 'Título y contenido son obligatorios' });
  try {
    const r = (await db.query(
      `INSERT INTO anuncio (entidad_id, titulo, cuerpo, creado_por) VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.sede, titulo.trim(), cuerpo.trim(), req.user.rut])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) { if (e.code === '42P01') return res.status(409).json({ error: 'Falta correr la migración 06 en Supabase (tabla anuncio).' }); throw e; }
}));
app.delete('/api/admin/anuncios/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM anuncio WHERE id=$1 AND entidad_id=$2`, [req.params.id, req.sede]);
  res.json({ ok: true });
}));

// ----------------------- Compañeros inscritos (alumno/docente) -----------------------
app.get('/api/companeros', auth, requireRole('alumno', 'docente'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT u.nombre, u.rol, a.nombre AS asignatura, a.seccion
     FROM usuario_asignatura ua
     JOIN usuario_asignatura ua2 ON ua2.asignatura_id = ua.asignatura_id AND ua2.usuario_rut <> ua.usuario_rut
     JOIN usuario u ON u.rut = ua2.usuario_rut
     JOIN asignatura a ON a.id = ua.asignatura_id
     WHERE ua.usuario_rut = $1
     ORDER BY a.nombre, u.nombre`, [req.user.rut]);
  res.json(rows);
}));

// ----------------------- Respaldos: exportación de datos (admin) -----------------------
app.get('/api/admin/respaldo', auth, requireRole('admin'), wrap(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const addSheet = (nombre, columnas, filas) => {
    const ws = wb.addWorksheet(nombre);
    const head = ws.addRow(columnas); head.font = { bold: true };
    head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F7' } }; });
    filas.forEach(f => ws.addRow(f));
    columnas.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, String(c).length + 4); });
  };
  const equipos = (await db.query(
    `SELECT e.codigo_qr, e.nombre, c.nombre AS categoria, COALESCE(e.marca,''), COALESCE(e.modelo,''), COALESCE(e.n_serie,''), e.estado, COALESCE(l.nombre,'')
     FROM equipo e JOIN categoria c ON c.id=e.categoria_id LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
     WHERE e.entidad_id=$1 ORDER BY c.nombre, e.nombre`, [req.sede])).rows;
  addSheet('Equipos', ['Código', 'Nombre', 'Categoría', 'Marca', 'Modelo', 'N° serie', 'Estado', 'Laboratorio'], equipos.map(r => Object.values(r)));
  const usuarios = (await db.query(
    `SELECT rut, nombre, COALESCE(email,''), rol, estado FROM usuario WHERE entidad_id=$1 ORDER BY rol, nombre`, [req.sede])).rows;
  addSheet('Usuarios', ['RUT', 'Nombre', 'Email', 'Rol', 'Estado'], usuarios.map(r => Object.values(r)));
  const reservas = (await db.query(
    `SELECT r.id, u.nombre AS usuario, e.nombre AS equipo, r.fecha_inicio, r.fecha_fin, r.estado
     FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
     WHERE e.entidad_id=$1 ORDER BY r.fecha_inicio DESC LIMIT 5000`, [req.sede])).rows;
  const fdt = x => x ? new Date(x).toLocaleString('es-CL') : '';
  addSheet('Reservas', ['N°', 'Usuario', 'Equipo', 'Inicio', 'Término', 'Estado'],
    reservas.map(r => [r.id, r.usuario, r.equipo, fdt(r.fecha_inicio), fdt(r.fecha_fin), r.estado]));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=respaldo_panol2_${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.write(res); res.end();
}));

// ----------------------- Bloqueo de horarios (admin/pañolero) -----------------------
app.get('/api/admin/bloqueos', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.equipo_id, b.fecha_inicio, b.fecha_fin, b.motivo, e.nombre AS equipo
       FROM bloqueo_horario b LEFT JOIN equipo e ON e.id=b.equipo_id
       WHERE b.entidad_id=$1 AND b.fecha_fin >= now() - interval '1 day'
       ORDER BY b.fecha_inicio`, [req.sede]);
    res.json(rows);
  } catch (e) { if (e.code === '42P01') return res.json({ _pendiente_migracion: true, rows: [] }); throw e; }
}));
app.post('/api/admin/bloqueos', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const { equipo_id, fecha_inicio, fecha_fin, motivo } = req.body || {};
  if (!fecha_inicio || !fecha_fin || !motivo || !motivo.trim()) return res.status(400).json({ error: 'Faltan fecha de inicio, término o motivo' });
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin);
  if (isNaN(ini) || isNaN(fin) || fin <= ini) return res.status(400).json({ error: 'Rango de fechas inválido' });
  if (equipo_id) {
    const eq = await db.query(`SELECT 1 FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, req.sede]);
    if (!eq.rowCount) return res.status(404).json({ error: 'Equipo no encontrado' });
  }
  try {
    const r = (await db.query(
      `INSERT INTO bloqueo_horario (equipo_id, fecha_inicio, fecha_fin, motivo, creado_por, entidad_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [equipo_id || null, ini, fin, motivo.trim(), req.user.rut, req.sede])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) { if (e.code === '42P01') return res.status(409).json({ error: 'Falta correr la migración 05 en Supabase (tabla bloqueo_horario).' }); throw e; }
}));
app.delete('/api/admin/bloqueos/:id', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  await db.query(`DELETE FROM bloqueo_horario WHERE id=$1 AND entidad_id=$2`, [req.params.id, req.sede]);
  res.json({ ok: true });
}));

// ----------------------- Aprobación de grupos (docente/admin) -----------------------
app.get('/api/grupos/pendientes', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.fecha_inicio, r.fecha_fin, u.nombre AS solicitante, u.rut, e.nombre AS equipo
       FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
       WHERE e.entidad_id=$1 AND r.es_grupal=TRUE AND r.grupo_estado='pendiente'
       ORDER BY r.fecha_inicio`, [req.sede]);
    for (const row of rows) {
      row.integrantes = (await db.query(
        `SELECT nombre, rut, es_responsable FROM integrante WHERE reserva_id=$1 ORDER BY es_responsable DESC`, [row.id])).rows;
    }
    res.json(rows);
  } catch (e) { if (e.code === '42703') return res.json([]); throw e; } // columna aún no migrada
}));
app.post('/api/grupos/:id/aprobar', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const { estado } = req.body || {};
  if (!['aprobado', 'rechazado'].includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  try {
    const r = await db.query(
      `UPDATE reserva SET grupo_estado=$2 WHERE id=$1 AND grupo_estado='pendiente'`, [req.params.id, estado]);
    if (!r.rowCount) return res.status(404).json({ error: 'Grupo no encontrado o ya resuelto' });
    res.json({ ok: true });
  } catch (e) { if (e.code === '42703') return res.status(409).json({ error: 'Falta correr la migración 05 en Supabase (columna grupo_estado).' }); throw e; }
}));

// ----------------------- Ficha completa del equipo: historial (admin/pañolero) -----------------------
app.get('/api/equipos/:id/historial', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  const prestamos = (await db.query(
    `SELECT p.id, p.estado, p.fecha_salida, p.fecha_retorno, u.nombre AS usuario
     FROM prestamo p LEFT JOIN usuario u ON u.rut=p.usuario_rut
     WHERE p.equipo_id=$1 ORDER BY p.fecha_salida DESC NULLS LAST, p.id DESC LIMIT 15`, [req.params.id])).rows;
  let mantenciones = [];
  try {
    mantenciones = (await db.query(
      `SELECT id, tipo, fecha, detalle, costo FROM mantencion WHERE equipo_id=$1 ORDER BY fecha DESC, id DESC LIMIT 15`, [req.params.id])).rows;
  } catch (e) { if (e.code !== '42P01') throw e; }
  res.json({ prestamos, mantenciones });
}));

// ----------------------- Reportes (admin): Excel/PDF -----------------------
async function reporteData(tipo, desde, hasta, entId) {
  const d1 = desde ? new Date(desde + 'T00:00:00') : new Date('2000-01-01');
  const d2 = hasta ? new Date(hasta + 'T23:59:59') : new Date('2999-12-31');
  const fdt = x => x ? new Date(x).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  if (tipo === 'reservas') {
    const { rows } = await db.query(
      `SELECT r.id, u.nombre AS usuario, e.nombre AS equipo, r.fecha_inicio, r.fecha_fin, r.estado
       FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
       WHERE e.entidad_id=$1 AND r.fecha_inicio >= $2 AND r.fecha_inicio <= $3
       ORDER BY r.fecha_inicio DESC`, [entId, d1, d2]);
    return { titulo: 'Reservas por periodo', columnas: ['N°', 'Usuario', 'Equipo', 'Inicio', 'Término', 'Estado'],
      filas: rows.map(r => [r.id, r.usuario, r.equipo, fdt(r.fecha_inicio), fdt(r.fecha_fin), r.estado]) };
  }
  if (tipo === 'equipos') {
    const { rows } = await db.query(
      `SELECT e.nombre AS equipo, c.nombre AS categoria, COUNT(r.id)::int AS total
       FROM equipo e JOIN categoria c ON c.id=e.categoria_id
       LEFT JOIN reserva r ON r.equipo_id=e.id AND r.fecha_inicio >= $2 AND r.fecha_inicio <= $3
       WHERE e.entidad_id=$1 GROUP BY e.id, e.nombre, c.nombre ORDER BY total DESC, e.nombre`, [entId, d1, d2]);
    return { titulo: 'Equipos más solicitados', columnas: ['Equipo', 'Categoría', 'N° de reservas'],
      filas: rows.map(r => [r.equipo, r.categoria, r.total]) };
  }
  if (tipo === 'inventario') {
    const { rows } = await db.query(
      `SELECT e.codigo_qr, e.nombre, c.nombre AS categoria, COALESCE(e.marca,'') AS marca, e.estado, COALESCE(l.nombre,'') AS laboratorio
       FROM equipo e JOIN categoria c ON c.id=e.categoria_id LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
       WHERE e.entidad_id=$1 ORDER BY c.nombre, e.nombre`, [entId]);
    return { titulo: 'Inventario de equipos', columnas: ['Código', 'Nombre', 'Categoría', 'Marca', 'Estado', 'Laboratorio'],
      filas: rows.map(r => [r.codigo_qr, r.nombre, r.categoria, r.marca, r.estado, r.laboratorio]) };
  }
  throw Object.assign(new Error('Tipo de reporte inválido'), { _status: 400 });
}

app.get('/api/admin/reportes', auth, requireRole('admin'), wrap(async (req, res) => {
  try {
    const data = await reporteData(req.query.tipo, req.query.desde, req.query.hasta, req.sede);
    res.json(data);
  } catch (e) { if (e._status === 400) return res.status(400).json({ error: e.message }); throw e; }
}));
app.get('/api/admin/reportes/xlsx', auth, requireRole('admin'), wrap(async (req, res) => {
  let data;
  try { data = await reporteData(req.query.tipo, req.query.desde, req.query.hasta, req.sede); }
  catch (e) { if (e._status === 400) return res.status(400).json({ error: e.message }); throw e; }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reporte');
  ws.mergeCells(1, 1, 1, data.columnas.length);
  const t = ws.getCell(1, 1); t.value = `Pañol 2.0 · ${data.titulo}`; t.font = { bold: true, size: 14, color: { argb: 'FF0E8F86' } };
  const sub = ws.getCell(2, 1); ws.mergeCells(2, 1, 2, data.columnas.length);
  sub.value = `Universidad Santo Tomás — generado ${new Date().toLocaleString('es-CL')}`; sub.font = { size: 10, color: { argb: 'FF6B7785' } };
  const head = ws.addRow(data.columnas); head.font = { bold: true }; head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F7' } }; });
  data.filas.forEach(f => ws.addRow(f));
  data.columnas.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, String(c).length + 4); });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=reporte_${req.query.tipo || 'panol2'}.xlsx`);
  await wb.xlsx.write(res); res.end();
}));

// ----------------------- Admin: Mantenciones (RF-30/31/32) -----------------------
app.get('/api/admin/mantenciones', auth, requireRole(...PANOL_SEDE), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.id, m.tipo, m.fecha, m.detalle, m.costo, e.nombre AS equipo, e.codigo_qr, e.id AS equipo_id
     FROM mantencion m JOIN equipo e ON e.id=m.equipo_id WHERE e.entidad_id=$1
     ORDER BY m.fecha DESC, m.id DESC`, [req.sede]);
  res.json(rows);
}));
app.post('/api/admin/mantenciones', auth, requireRole(...PANOL_SEDE), wrap(async (req, res) => {
  const { equipo_id, tipo, detalle, costo, fecha, cerrar } = req.body || {};
  if (!equipo_id || !tipo) return res.status(400).json({ error: 'equipo_id y tipo requeridos' });
  const eq = (await db.query(`SELECT 1 FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, req.sede])).rows[0];
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  const m = (await db.query(
    `INSERT INTO mantencion (equipo_id, tipo, detalle, costo, fecha)
     VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE)) RETURNING id`,
    [equipo_id, tipo, detalle || null, costo || null, fecha || null])).rows[0];
  // Poner el equipo en mantención (o disponible si se cierra)
  await db.query(`UPDATE equipo SET estado=$2 WHERE id=$1`, [equipo_id, cerrar ? 'disponible' : 'mantencion']);
  res.status(201).json({ id: m.id });
}));

// ----------------------- Carga masiva Excel (RF-11 / RF-44) -----------------------
async function leerFilas(buffer, headersEsperados) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas');
  const headers = (ws.getRow(1).values || []).map(v => (v == null ? '' : String(v).trim().toLowerCase()));
  const col = {}; headersEsperados.forEach(h => { col[h] = headers.indexOf(h); });
  const filas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (h) => { const i = col[h]; return i >= 0 ? (row.values[i] ?? '') : ''; };
    const obj = {}; headersEsperados.forEach(h => obj[h] = String(get(h) ?? '').trim());
    if (Object.values(obj).some(v => v !== '')) filas.push({ n, ...obj });
  });
  return { filas, headers };
}

// Plantillas descargables
app.get('/api/admin/import/plantilla/:tipo', auth, requireRole(...OPERACION), wrap(async (req, res) => {
  if (req.params.tipo === 'nomina' && req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Solo un administrador puede importar la nómina de usuarios' });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Datos');
  if (req.params.tipo === 'equipos') {
    ws.addRow(['codigo_qr','nombre','modelo','marca','n_serie','categoria','tipo']);
    ws.addRow(['QR-CAM-100','Cámara Sony FX3','FX3','Sony','SN-12345','Cámaras','equipo']);
  } else if (req.params.tipo === 'nomina') {
    ws.addRow(['rut','nombre','email','rol']);
    ws.addRow(['12.345.678-9','Juan Pérez','juan@ust.cl','alumno']);
  } else return res.status(400).json({ error: 'Tipo inválido (equipos|nomina)' });
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=plantilla_${req.params.tipo}.xlsx`);
  await wb.xlsx.write(res); res.end();
}));

// Importar inventario (RF-11) — validación por fila · admin o pañolero (a su sede)
app.post('/api/admin/import/equipos', auth, requireRole(...OPERACION), upload.single('archivo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo .xlsx (campo "archivo")' });
  const { filas } = await leerFilas(req.file.buffer, ['codigo_qr','nombre','modelo','marca','n_serie','categoria','tipo']);
  const cats = (await db.query(`SELECT id, lower(nombre) AS n FROM categoria`)).rows
    .reduce((a, r) => (a[r.n] = r.id, a), {});
  let insertados = 0; const errores = [];
  for (const f of filas) {
    if (!f.codigo_qr || !f.nombre) { errores.push({ fila: f.n, error: 'Falta codigo_qr o nombre' }); continue; }
    const tipo = (f.tipo || 'equipo').toLowerCase();
    if (!['equipo','recinto'].includes(tipo)) { errores.push({ fila: f.n, error: `Tipo inválido: ${f.tipo}` }); continue; }
    const catId = cats[(f.categoria || '').toLowerCase()];
    if (!catId) { errores.push({ fila: f.n, error: `Categoría no existe: ${f.categoria}` }); continue; }
    try {
      await db.query(
        `INSERT INTO equipo (codigo_qr,nombre,modelo,marca,n_serie,tipo,categoria_id,requiere_autorizacion,entidad_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [f.codigo_qr, f.nombre, f.modelo || null, f.marca || null, f.n_serie || null, tipo, catId, tipo === 'recinto', req.sede]);
      insertados++;
    } catch (e) {
      errores.push({ fila: f.n, error: e.code === '23505' ? `QR duplicado: ${f.codigo_qr}` : e.message });
    }
  }
  res.json({ total: filas.length, insertados, errores });
}));

// Importar nómina (RF-44) — validación por fila
app.post('/api/admin/import/nomina', auth, requireRole('admin'), upload.single('archivo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo .xlsx (campo "archivo")' });
  const { filas } = await leerFilas(req.file.buffer, ['rut','nombre','email','rol']);
  const rolesOK = ['alumno','docente','panolero','admin'];
  const pwd = hashPassword('prestalo'); // clave inicial; el usuario la cambia luego
  let insertados = 0, actualizados = 0; const errores = [];
  for (const f of filas) {
    if (!f.rut || !f.nombre) { errores.push({ fila: f.n, error: 'Falta rut o nombre' }); continue; }
    const rol = (f.rol || 'alumno').toLowerCase();
    if (!rolesOK.includes(rol)) { errores.push({ fila: f.n, error: `Rol inválido: ${f.rol}` }); continue; }
    try {
      const up = await db.query(
        `INSERT INTO usuario (rut,nombre,email,rol,password_hash,entidad_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (rut) DO UPDATE SET nombre=EXCLUDED.nombre, email=EXCLUDED.email, rol=EXCLUDED.rol
         RETURNING (xmax=0) AS insertado`,
        [f.rut, f.nombre, f.email || null, rol, pwd, req.sede]);
      up.rows[0].insertado ? insertados++ : actualizados++;
    } catch (e) {
      errores.push({ fila: f.n, error: e.code === '23505' ? `Correo duplicado: ${f.email}` : e.message });
    }
  }
  res.json({ total: filas.length, insertados, actualizados, errores });
}));

// Exporta la app Express y utilidades (usado por server.js local y por Netlify Functions)
// ----------------------- Asistente IA (acotado a la app + normativa del pañol) -----------------------
app.post('/api/asistente', wrap(async (req, res) => {
  const { pregunta, historial } = req.body || {};
  if (!pregunta || !String(pregunta).trim())
    return res.status(400).json({ error: 'Falta la pregunta' });
  const r = await asistente.responder(String(pregunta), historial);
  if (!r.ok) return res.status(502).json({ error: r.error, detalle: r.detalle });
  res.json({ respuesta: r.respuesta });
}));

module.exports = { app, expirarNoShow };
