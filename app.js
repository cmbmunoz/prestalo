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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ANTICIPACION_RECINTO_H = 72;   // RF-53
const ANTICIPACION_MIN_H = 4;        // RF-15 (general)
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
  // Sede efectiva: por defecto la del usuario; un admin puede operar sobre otra sede vía header X-Sede-Id
  const hdrSede = parseInt(req.headers['x-sede-id'], 10);
  req.sede = (req.user.rol === 'admin' && hdrSede) ? hdrSede : req.user.entidad_id;
  next();
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.rol) ? next()
    : res.status(403).json({ error: 'No autorizado para este perfil' });

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e); res.status(500).json({ error: 'Error interno', detalle: e.message });
});

// Health check para orquestadores de contenedores (liveness/readiness). Público, sin auth.
app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok', db: 'up' }); }
  catch (e) { res.status(503).json({ status: 'degraded', db: 'down' }); }
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
  res.json({ user: req.user, asignaturas: asigs.rows });
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
  const base = `
    SELECT e.id, e.codigo_qr, e.nombre, e.modelo, e.marca, e.tipo, e.estado,
           e.condicion, e.requiere_autorizacion, e.foto_referencia, e.accesorios,
           c.nombre AS categoria, c.id AS categoria_id, c.simbolo,
           l.nombre AS laboratorio
    FROM equipo e
    JOIN categoria c ON c.id=e.categoria_id
    LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
    WHERE e.entidad_id=$1`;
  if (req.user.rol === 'alumno' || req.user.rol === 'docente') {
    const { rows } = await db.query(
      `${base} AND c.id IN (
          SELECT el.categoria_id FROM elegibilidad el
          JOIN usuario_asignatura ua ON ua.asignatura_id=el.asignatura_id
          WHERE ua.usuario_rut=$2)
       ORDER BY e.tipo, c.nombre, e.nombre`, [req.sede, req.user.rut]);
    return res.json(rows);
  }
  const { rows } = await db.query(`${base} ORDER BY e.tipo, c.nombre, e.nombre`, [req.sede]);
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

  // RF-51/53: recinto o equipo que requiere autorización → 72 h + flujo Jefatura/DAO
  const esRecinto = eq.tipo === 'recinto' || eq.requiere_autorizacion;
  const horas = (ini - now) / 3600000;
  if (esRecinto) {
    if (horas < ANTICIPACION_RECINTO_H)
      return res.status(400).json({ error: `Los recintos requieren al menos ${ANTICIPACION_RECINTO_H} h de anticipación (RF-53)` });
  } else if (horas < ANTICIPACION_MIN_H) {
    return res.status(400).json({ error: `Reserva con al menos ${ANTICIPACION_MIN_H} h de anticipación` });
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
  const { rows } = await db.query(
    `SELECT r.id, r.estado, r.fecha_inicio, r.fecha_fin, r.usuario_rut,
            e.nombre AS equipo, e.marca, c.nombre AS categoria, u.nombre AS solicitante,
            (SELECT p.estado FROM prestamo p WHERE p.reserva_id=r.id) AS prestamo_estado
     FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     JOIN usuario u ON u.rut=r.usuario_rut
     WHERE e.entidad_id=$1 ${filtro}
     ORDER BY r.fecha_inicio DESC LIMIT 100`, params);
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
  const r = (await db.query(
    `SELECT r.*, e.nombre AS equipo, e.marca, e.codigo_qr, c.nombre AS categoria,
            COALESCE(l.nombre, '—') AS laboratorio
     FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
     WHERE r.id=$1`, [req.params.id])).rows[0];
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

// ----------------------- Pañolero: agenda / entrega / recepción -----------------------
app.get('/api/agenda', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, u.nombre AS usuario, u.rut,
            e.id AS equipo_id, e.nombre AS equipo, e.codigo_qr, e.tipo, c.nombre AS categoria
     FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
     JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE r.estado='confirmada' AND e.entidad_id=$1
     ORDER BY r.fecha_inicio`, [req.sede]);
  res.json(rows);
}));

// Entregar (check-out) — crea préstamo, verifica QR opcional
app.post('/api/entregar', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
  const { reserva_id, qr, condicion_salida } = req.body || {};
  const r = (await db.query(`SELECT * FROM reserva WHERE id=$1`, [reserva_id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (r.estado !== 'confirmada') return res.status(409).json({ error: `La reserva está ${r.estado}` });
  const eq = (await db.query(`SELECT * FROM equipo WHERE id=$1`, [r.equipo_id])).rows[0];
  if (qr && qr.toLowerCase() !== eq.codigo_qr.toLowerCase())
    return res.status(409).json({ error: `El QR escaneado (${qr}) no corresponde al equipo` });

  const p = (await db.query(
    `INSERT INTO prestamo (reserva_id, usuario_rut, equipo_id, panolero_rut, condicion_salida, estado)
     VALUES ($1,$2,$3,$4,$5,'abierto') RETURNING id`,
    [r.id, r.usuario_rut, r.equipo_id, req.user.rut, condicion_salida || eq.condicion])).rows[0];
  await db.query(`UPDATE reserva SET estado='en_uso' WHERE id=$1`, [r.id]);
  await db.query(`UPDATE equipo SET estado='prestado' WHERE id=$1`, [r.equipo_id]);
  res.status(201).json({ id: p.id, mensaje: 'Entrega registrada' });
}));

// Equipos por recibir (en préstamo)
app.get('/api/por-recibir', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id AS prestamo_id, p.fecha_salida, u.nombre AS usuario, u.rut,
            e.id AS equipo_id, e.nombre AS equipo, e.codigo_qr, c.nombre AS categoria
     FROM prestamo p JOIN usuario u ON u.rut=p.usuario_rut
     JOIN equipo e ON e.id=p.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE p.estado IN ('abierto','atrasado') AND e.entidad_id=$1
     ORDER BY p.fecha_salida`, [req.sede]);
  res.json(rows);
}));

// Recibir (check-in) — RF-59: daño → bloqueo por reposición + sanción
app.post('/api/recibir', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
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

app.post('/api/admin/equipos', auth, requireRole('admin'), wrap(async (req, res) => {
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

app.post('/api/admin/equipos/:id/estado', auth, requireRole('admin'), wrap(async (req, res) => {
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
const ROLES_OK = ['alumno', 'docente', 'panolero', 'admin'];
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
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese RUT o correo' });
    throw e;
  }
}));

app.put('/api/admin/usuarios/:rut', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, email, rol, estado } = req.body || {};
  if (rol && !ROLES_OK.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
  if (estado && !ESTADOS_OK.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  const r = await db.query(
    `UPDATE usuario SET nombre=COALESCE($2,nombre), email=COALESCE($3,email), rol=COALESCE($4,rol), estado=COALESCE($5,estado)
     WHERE rut=$1 AND entidad_id=$6`,
    [req.params.rut, nombre || null, email || null, rol || null, estado || null, req.sede]);
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
  const equipos = (await db.query(
    `SELECT e.id, e.nombre, e.codigo_qr, e.estado, cat.nombre AS categoria
     FROM tarea_equipo te JOIN equipo e ON e.id=te.equipo_id LEFT JOIN categoria cat ON cat.id=e.categoria_id
     WHERE te.tarea_id=$1 ORDER BY e.nombre`, [req.params.id])).rows;
  let reservas = [];
  if (req.user.rol === 'docente' || req.user.rol === 'admin') {
    reservas = (await db.query(
      `SELECT r.id, u.nombre AS alumno, u.rut, e.nombre AS equipo, r.estado, r.fecha_inicio, r.fecha_fin
       FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
       WHERE r.tarea_id=$1 ORDER BY r.created_at DESC`, [req.params.id])).rows;
  }
  res.json({ tarea: t, equipos, reservas });
}));

app.post('/api/tareas', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const { asignatura_id, titulo, descripcion, fecha_inicio, fecha_fin, tipo, equipos } = req.body || {};
  if (!asignatura_id || !titulo || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Faltan datos de la tarea' });
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin);
  if (isNaN(ini) || isNaN(fin) || fin <= ini) return res.status(400).json({ error: 'Fechas inválidas' });
  const a = (await db.query(`SELECT a.id FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE a.id=$1 AND c.entidad_id=$2`, [asignatura_id, req.sede])).rows[0];
  if (!a) return res.status(400).json({ error: 'Asignatura no válida' });
  if (req.user.rol === 'docente') {
    const ok = await db.query(`SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2 AND rol_en_asig='docente'`, [req.user.rut, asignatura_id]);
    if (!ok.rows.length) return res.status(403).json({ error: 'No estás a cargo de esa asignatura' });
  }
  const tp = tipo === 'grupal' ? 'grupal' : 'individual';
  const t = (await db.query(
    `INSERT INTO tarea (asignatura_id, docente_rut, titulo, descripcion, fecha_inicio, fecha_fin, tipo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [asignatura_id, req.user.rut, titulo.trim(), descripcion || null, ini, fin, tp])).rows[0];
  if (Array.isArray(equipos)) {
    for (const eid of equipos) await db.query(`INSERT INTO tarea_equipo (tarea_id, equipo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.id, eid]);
  }
  res.status(201).json({ id: t.id });
}));

app.put('/api/tareas/:id', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const { titulo, descripcion, fecha_inicio, fecha_fin, tipo, equipos } = req.body || {};
  const t = (await db.query(`SELECT t.* FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id JOIN carrera c ON c.id=a.carrera_id WHERE t.id=$1 AND c.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (req.user.rol === 'docente' && t.docente_rut !== req.user.rut) return res.status(403).json({ error: 'No es tu tarea' });
  const ini = fecha_inicio ? new Date(fecha_inicio) : t.fecha_inicio;
  const fin = fecha_fin ? new Date(fecha_fin) : t.fecha_fin;
  const tp = tipo ? (tipo === 'grupal' ? 'grupal' : 'individual') : t.tipo;
  await db.query(`UPDATE tarea SET titulo=COALESCE($2,titulo), descripcion=$3, fecha_inicio=$4, fecha_fin=$5, tipo=$6, updated_at=now() WHERE id=$1`,
    [req.params.id, titulo || null, descripcion || null, ini, fin, tp]);
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
  const { equipo_id, fecha_inicio, fecha_fin } = req.body || {};
  if (!equipo_id || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Faltan datos de la reserva' });
  const t = (await db.query(`SELECT t.* FROM tarea t JOIN asignatura a ON a.id=t.asignatura_id JOIN carrera c ON c.id=a.carrera_id WHERE t.id=$1 AND c.entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
  const insc = await db.query(`SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, t.asignatura_id]);
  if (!insc.rows.length) return res.status(403).json({ error: 'No estás inscrito en la asignatura de la tarea' });
  const te = await db.query(`SELECT 1 FROM tarea_equipo WHERE tarea_id=$1 AND equipo_id=$2`, [req.params.id, equipo_id]);
  if (!te.rows.length) return res.status(403).json({ error: 'Ese equipo no está habilitado para la tarea' });
  const eq = (await db.query(`SELECT * FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, req.sede])).rows[0];
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  if (eq.estado !== 'disponible') return res.status(409).json({ error: `El equipo no está disponible (estado: ${eq.estado})` });
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin), now = new Date();
  if (isNaN(ini) || isNaN(fin) || fin <= ini) return res.status(400).json({ error: 'Fechas inválidas' });
  if (ini < now) return res.status(400).json({ error: 'La reserva no puede iniciar en el pasado' });
  if (ini < new Date(t.fecha_inicio) || fin > new Date(t.fecha_fin)) return res.status(400).json({ error: 'La reserva debe estar dentro de las fechas de la tarea' });
  const sanc = await db.query(`SELECT motivo FROM v_sanciones_vigentes WHERE usuario_rut=$1 AND (asignatura_id IS NULL OR asignatura_id=$2)`, [req.user.rut, t.asignatura_id]);
  if (sanc.rows.length) return res.status(403).json({ error: `Bloqueado por sanción vigente: ${sanc.rows[0].motivo}` });
  const r = (await db.query(
    `INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, tarea_id)
     VALUES ($1,$2,$3,$4,'confirmada',TRUE,$5) RETURNING id`, [req.user.rut, equipo_id, ini, fin, req.params.id])).rows[0];
  await db.query(`INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable) VALUES ($1,$2,$3,$4,TRUE)`, [r.id, req.user.rut, req.user.nombre, req.user.rut]);
  await db.query(`UPDATE equipo SET estado='reservado' WHERE id=$1`, [equipo_id]);
  res.status(201).json({ id: r.id, mensaje: 'Reserva confirmada dentro de la tarea.' });
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

app.post('/api/solicitudes', auth, wrap(async (req, res) => {
  const { asignatura_id, descripcion, fecha_inicio, fecha_fin, duracion, equipos } = req.body || {};
  if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'La descripción es obligatoria' });
  let docente = null;
  if (asignatura_id) {
    const d = await db.query(`SELECT usuario_rut FROM usuario_asignatura WHERE asignatura_id=$1 AND rol_en_asig='docente' LIMIT 1`, [asignatura_id]);
    docente = d.rows[0] ? d.rows[0].usuario_rut : null;
  }
  const r = (await db.query(
    `INSERT INTO solicitud_especial (usuario_rut, asignatura_id, docente_rut, descripcion, estado)
     VALUES ($1,$2,$3,$4,'pendiente') RETURNING id`, [req.user.rut, asignatura_id || null, docente, descripcion.trim()])).rows[0];
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
  res.status(201).json({ id: r.id });
}));

app.get('/api/solicitudes/mias', auth, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.descripcion, s.estado, s.respuesta, s.created_at, s.fecha_inicio, s.fecha_fin, s.duracion, a.nombre AS asignatura,
              COALESCE((SELECT array_agg(e.nombre ORDER BY e.nombre) FROM solicitud_equipo se JOIN equipo e ON e.id=se.equipo_id WHERE se.solicitud_id=s.id), '{}') AS equipos
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

app.get('/api/solicitudes/pendientes', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const base = `FROM solicitud_especial s JOIN usuario u ON u.rut=s.usuario_rut LEFT JOIN asignatura a ON a.id=s.asignatura_id
     WHERE s.estado='pendiente' AND (s.docente_rut=$1
           OR s.asignatura_id IN (SELECT asignatura_id FROM usuario_asignatura WHERE usuario_rut=$1 AND rol_en_asig='docente')
           OR $2='admin')
     ORDER BY s.created_at`;
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.descripcion, s.estado, s.created_at, s.fecha_inicio, s.fecha_fin, s.duracion, u.nombre AS alumno, u.rut, a.nombre AS asignatura,
              COALESCE((SELECT array_agg(e.nombre ORDER BY e.nombre) FROM solicitud_equipo se JOIN equipo e ON e.id=se.equipo_id WHERE se.solicitud_id=s.id), '{}') AS equipos
       ${base}`, [req.user.rut, req.user.rol]);
    return res.json(rows);
  } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }
  const { rows } = await db.query(
    `SELECT s.id, s.descripcion, s.estado, s.created_at, u.nombre AS alumno, u.rut, a.nombre AS asignatura ${base}`,
    [req.user.rut, req.user.rol]);
  res.json(rows);
}));

app.post('/api/solicitudes/:id/responder', auth, requireRole('docente', 'admin'), wrap(async (req, res) => {
  const { estado, respuesta } = req.body || {};
  if (!['aprobada', 'rechazada'].includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  const r = await db.query(
    `UPDATE solicitud_especial SET estado=$2, respuesta=$3, docente_rut=$4, updated_at=now()
     WHERE id=$1 AND estado='pendiente'`, [req.params.id, estado, respuesta || null, req.user.rut]);
  if (!r.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada o ya respondida' });
  res.json({ ok: true });
}));

// ----------------------- Calendario de disponibilidad -----------------------
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
  const eq = (await db.query(`SELECT nombre, estado FROM equipo WHERE id=$1 AND entidad_id=$2`, [req.params.id, req.sede])).rows[0];
  res.json({ equipo: eq || null, reservas, horario: 'Lunes a viernes, 9:00 a 18:00 h' });
}));

// ----------------------- Gestión completa de pedidos (admin/pañolero) -----------------------
app.get('/api/admin/pedidos', auth, requireRole('admin', 'panolero'), wrap(async (req, res) => {
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

app.get('/api/admin/pedidos/:id', auth, requireRole('admin', 'panolero'), wrap(async (req, res) => {
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

app.post('/api/admin/pedidos', auth, requireRole('admin', 'panolero'), wrap(async (req, res) => {
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
  // Todos los autenticados reciben su sede actual; el admin recibe además la lista completa para cambiar de sede.
  const actual = (await db.query(`SELECT id, nombre, bodega_label FROM entidad WHERE id=$1`, [req.user.entidad_id])).rows[0] || null;
  if (req.user.rol !== 'admin') return res.json({ actual, sedes: actual ? [actual] : [] });
  const sedes = (await db.query(`SELECT id, nombre, bodega_label, activo FROM entidad ORDER BY nombre`)).rows;
  res.json({ actual, sede_activa: req.sede, sedes });
}));
app.post('/api/admin/sedes', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, bodega_label } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });
  try {
    const r = (await db.query(
      `INSERT INTO entidad (nombre, bodega_label) VALUES ($1,$2) RETURNING id`,
      [nombre.trim(), (bodega_label && bodega_label.trim()) || 'Pañol'])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' }); throw e; }
}));
app.put('/api/admin/sedes/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, bodega_label, activo } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });
  try {
    const r = await db.query(
      `UPDATE entidad SET nombre=$2, bodega_label=$3, activo=COALESCE($4,activo), updated_at=now() WHERE id=$1`,
      [req.params.id, nombre.trim(), (bodega_label && bodega_label.trim()) || 'Pañol', typeof activo === 'boolean' ? activo : null]);
    if (!r.rowCount) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ ok: true });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' }); throw e; }
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
  res.setHeader('Content-Disposition', `attachment; filename=respaldo_prestalo_${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.write(res); res.end();
}));

// ----------------------- Bloqueo de horarios (admin/pañolero) -----------------------
app.get('/api/admin/bloqueos', auth, requireRole('admin', 'panolero'), wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.equipo_id, b.fecha_inicio, b.fecha_fin, b.motivo, e.nombre AS equipo
       FROM bloqueo_horario b LEFT JOIN equipo e ON e.id=b.equipo_id
       WHERE b.entidad_id=$1 AND b.fecha_fin >= now() - interval '1 day'
       ORDER BY b.fecha_inicio`, [req.sede]);
    res.json(rows);
  } catch (e) { if (e.code === '42P01') return res.json({ _pendiente_migracion: true, rows: [] }); throw e; }
}));
app.post('/api/admin/bloqueos', auth, requireRole('admin', 'panolero'), wrap(async (req, res) => {
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
app.delete('/api/admin/bloqueos/:id', auth, requireRole('admin', 'panolero'), wrap(async (req, res) => {
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
app.get('/api/equipos/:id/historial', auth, requireRole('admin', 'panolero'), wrap(async (req, res) => {
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
  const t = ws.getCell(1, 1); t.value = `Préstalo · ${data.titulo}`; t.font = { bold: true, size: 14, color: { argb: 'FF0E8F86' } };
  const sub = ws.getCell(2, 1); ws.mergeCells(2, 1, 2, data.columnas.length);
  sub.value = `Universidad Santo Tomás — generado ${new Date().toLocaleString('es-CL')}`; sub.font = { size: 10, color: { argb: 'FF6B7785' } };
  const head = ws.addRow(data.columnas); head.font = { bold: true }; head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F7' } }; });
  data.filas.forEach(f => ws.addRow(f));
  data.columnas.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, String(c).length + 4); });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=reporte_${req.query.tipo || 'prestalo'}.xlsx`);
  await wb.xlsx.write(res); res.end();
}));

// ----------------------- Admin: Mantenciones (RF-30/31/32) -----------------------
app.get('/api/admin/mantenciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.id, m.tipo, m.fecha, m.detalle, m.costo, e.nombre AS equipo, e.codigo_qr, e.id AS equipo_id
     FROM mantencion m JOIN equipo e ON e.id=m.equipo_id WHERE e.entidad_id=$1
     ORDER BY m.fecha DESC, m.id DESC`, [req.sede]);
  res.json(rows);
}));
app.post('/api/admin/mantenciones', auth, requireRole('admin'), wrap(async (req, res) => {
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
app.get('/api/admin/import/plantilla/:tipo', auth, requireRole('admin'), wrap(async (req, res) => {
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

// Importar inventario (RF-11) — validación por fila
app.post('/api/admin/import/equipos', auth, requireRole('admin'), upload.single('archivo'), wrap(async (req, res) => {
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
