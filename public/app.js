// ===================== Pañol 2.0 — Frontend SPA =====================
let TOKEN = localStorage.getItem('prestalo_token') || null;
let ME = null;                 // {user, asignaturas}
let SEDE = null;               // sede activa (id) — admin puede cambiarla
let PANEL_SEDE = '';           // selección del panel ('' = todas las sedes)
const $ = (s, el = document) => el.querySelector(s);

const ICON_CAT = { 'Cámaras':'📷','Audio':'🎙️','Iluminación':'💡','Trípodes':'🎥','Accesorios':'🎒','Recintos':'🏢' };
const icon = (c) => ICON_CAT[c] || '📦';
const ESTADO_EQ = {
  disponible:['Disponible','ok'], reservado:['Reservado','warn'], prestado:['En préstamo','warn'],
  mantencion:['Mantención','bad'], baja:['De baja','bad']
};
const ESTADO_RES = {
  pendiente:['Pendiente','warn'], confirmada:['Confirmada','ok'], en_uso:['En uso','warn'],
  completada:['Completada','info'], cancelada:['Cancelada','bad'], expirada:['Expirada','bad'],
  solicitud_pendiente:['Solicitud especial (pendiente)','warn']
};

// ---------- API helper ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(SEDE ? { 'X-Sede-Id': String(SEDE) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
function fmtDate(s) {
  const d = new Date(s);
  return d.toLocaleString('es-CL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ---------- RUT: normaliza a xx.xxx.xxx-x sin importar cómo se ingrese ----------
function limpiaRut(v) { return (v || '').toString().replace(/[^0-9kK]/g, '').toUpperCase(); }
function formatRut(v) {
  const c = limpiaRut(v);
  if (c.length < 2) return c;                       // aún no hay cuerpo+DV
  const cuerpo = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return cuerpo + '-' + c.slice(-1);
}
// Formatea automáticamente cualquier campo de RUT al salir del foco (incluye modales).
// #ident se maneja aparte porque alterna entre RUT y correo.
document.addEventListener('blur', (e) => {
  const t = e.target;
  if (t && t.tagName === 'INPUT' && /rut/i.test(t.id) && t.id !== 'ident' && t.value.trim()) {
    t.value = formatRut(t.value);
  }
}, true);

// ---------- Login (por RUT o correo) ----------
let MODO = 'rut';
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => {
  MODO = b.dataset.modo;
  document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('active', x === b));
  $('#idLabel').textContent = MODO === 'rut' ? 'RUT' : 'Correo';
  $('#ident').placeholder = MODO === 'rut' ? '11.111.111-1' : 'correo@ust.cl';
  $('#ident').value = '';
});
// Da formato al RUT al salir del campo (solo en modo RUT)
if ($('#ident')) $('#ident').addEventListener('blur', () => {
  if (MODO === 'rut' && $('#ident').value.trim()) $('#ident').value = formatRut($('#ident').value);
});

async function doLogin(credencial, password, modo) {
  $('#loginErr').textContent = '';
  const body = { password };
  if ((modo || MODO) === 'correo') body.email = credencial; else body.rut = formatRut(credencial);
  try {
    const { token } = await api('/login', { method:'POST', body });
    TOKEN = token; localStorage.setItem('prestalo_token', token);
    await boot();
  } catch (e) { $('#loginErr').textContent = e.message; }
}
// Captcha aritmético simple (6.6) — se resuelve antes de iniciar sesión manualmente
let CAP_RES = 0;
function nuevoCaptcha() {
  const a = 1 + Math.floor(Math.random() * 9), b = 1 + Math.floor(Math.random() * 9);
  CAP_RES = a + b;
  const q = $('#capQ'); if (q) q.textContent = a + ' + ' + b + ' =';
  const i = $('#capA'); if (i) i.value = '';
}
nuevoCaptcha();
if ($('#capNew')) $('#capNew').onclick = nuevoCaptcha;
// Consentimiento (6.7) — términos visibles antes de aceptar
if ($('#verTerminos')) $('#verTerminos').onclick = (e) => {
  e.preventDefault();
  openModal(`<h3>Tratamiento de datos personales</h3>
    <p style="font-size:13px;line-height:1.55">Pañol 2.0 trata tus datos personales (identificación, correo y registro de préstamos)
    con la única finalidad de gestionar el préstamo e inventario de equipos del Área de Comunicación Audiovisual
    de la Instituto Profesional Santo Tomás.</p>
    <p style="font-size:13px;line-height:1.55">Los datos se usan solo para esa finalidad, no se ceden a terceros sin base legal
    y se conservan según las políticas de retención del Instituto Profesional, conforme a la Ley 21.719 de protección de datos.</p>
    <p style="font-size:13px;line-height:1.55">Puedes ejercer tus derechos de acceso, rectificación y supresión ante el administrador del sistema.</p>
    <button class="btn full" id="tOk">Entendido</button>`);
  $('#tOk').onclick = closeModal;
};
function loginGate() {
  $('#loginErr').textContent = '';
  if (!$('#consent') || !$('#consent').checked) {
    $('#loginErr').textContent = 'Debes aceptar el tratamiento de datos personales para continuar.'; return false;
  }
  if (Number($('#capA').value) !== CAP_RES) {
    $('#loginErr').textContent = 'Verificación incorrecta: resuelve la operación.'; nuevoCaptcha(); return false;
  }
  return true;
}
$('#btnLogin').onclick = () => { if (!loginGate()) return; doLogin($('#ident').value.trim(), $('#password').value); };
$('#password').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#ident').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
if ($('#capA')) $('#capA').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
document.querySelectorAll('.demo-grid button').forEach(b =>
  b.onclick = () => { MODO='rut'; $('#ident').value = b.dataset.rut; $('#password').value = 'prestalo'; doLogin(b.dataset.rut, 'prestalo', 'rut'); });

// Recuperar contraseña
$('#linkRecuperar').onclick = (e) => {
  e.preventDefault();
  openModal(`<h3>Recuperar contraseña</h3>
    <p class="muted" style="margin-top:0;font-size:13px">Ingresa tu RUT y el correo registrado. Si coinciden, te enviaremos un enlace de recuperación.</p>
    <div class="field"><label>RUT</label><input id="recRut" placeholder="11.111.111-1"></div>
    <div class="field"><label>Correo</label><input id="recMail" placeholder="correo@ust.cl"></div>
    <div class="err" id="recErr"></div>
    <div id="recOk" class="aviso ok" style="display:none"></div>
    <button class="btn full" id="recBtn">Enviar enlace</button>`);
  $('#recRut').addEventListener('blur', () => { if ($('#recRut').value.trim()) $('#recRut').value = formatRut($('#recRut').value); });
  $('#recBtn').onclick = async () => {
    $('#recErr').textContent = '';
    const rut = formatRut($('#recRut').value), email = $('#recMail').value.trim();
    if (!rut || !email) { $('#recErr').textContent = 'Completa RUT y correo'; return; }
    try {
      const r = await api('/recuperar', { method:'POST', body:{ rut, email } });
      $('#recOk').style.display = 'block'; $('#recOk').textContent = r.mensaje || 'Solicitud enviada.';
      $('#recBtn').disabled = true;
    } catch (e) { $('#recErr').textContent = e.message; }
  };
};

$('#btnLogout').onclick = () => { TOKEN = null; localStorage.removeItem('prestalo_token'); location.reload(); };

// ---------- Menú por perfil ----------
const MENUS = {
  alumno:   [['catalogo','📚','Catálogo'],['kits','🎒','Kits'],['asignaturas','🎓','Mis asignaturas'],['reservas','📅','Mis reservas'],['disponibilidad','🗓️','Disponibilidad'],['solicitudes','🙋','Solicitudes especiales'],['anuncios','📢','Anuncios'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
  // Nota: "Compañeros" del alumno ahora vive dentro de cada asignatura (ver Mis asignaturas).
  docente:  [['tareas','📝','Tareas'],['solicitudes','🙋','Solicitudes especiales'],['grupos','👪','Grupos'],['kits','🎒','Kits'],['catalogo','📚','Catálogo'],['asignaturas','🎓','Mis asignaturas'],['reservas','📅','Mis reservas'],['disponibilidad','🗓️','Disponibilidad'],['companeros','🧑‍🤝‍🧑','Alumnos'],['anuncios','📢','Anuncios'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
  panolero: [['inventario','📦','Inventario'],
             [null,null,'Entregas'],
             ['entregas_plan','🚚','Planificación y ejecución'],['entregas_hist','🧾','Historial de entregas'],
             [null,null,'Operación'],
             ['recibir','↩️','Devoluciones'],['pedidos','🧾','Pedidos'],['equipos','🧰','Equipos'],['importar','📦','Importar inventario'],['disponibilidad','🗓️','Disponibilidad'],['bloqueos','🚫','Bloqueos'],
             [null,null,'Sistema'],
             ['anuncios','📢','Anuncios'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
  // Jefe de Pañol: operación + catálogo/mantención de SU sede (sin administración general)
  jefe_panol: [['inventario','📦','Inventario'],
             [null,null,'Entregas'],
             ['entregas_plan','🚚','Planificación y ejecución'],['entregas_hist','🧾','Historial de entregas'],
             [null,null,'Operación'],
             ['recibir','↩️','Devoluciones'],['pedidos','🧾','Pedidos'],['disponibilidad','🗓️','Disponibilidad'],['bloqueos','🚫','Bloqueos'],
             [null,null,'Pañol de mi sede'],
             ['equipos','🧰','Equipos'],['mantenciones','🔧','Mantenciones'],['importar','📦','Importar inventario'],
             [null,null,'Sistema'],
             ['anuncios','📢','Anuncios'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
  admin:    [['inventario','📦','Inventario'],
             [null,null,'Entregas'],
             ['entregas_plan','🚚','Planificación y ejecución'],['entregas_hist','🧾','Historial de entregas'],
             [null,null,'Operación'],
             ['kpis','📊','Panel'],['reportes','📈','Reportes'],['equipos','🧰','Equipos'],['pedidos','🧾','Pedidos'],['disponibilidad','🗓️','Disponibilidad'],['bloqueos','🚫','Bloqueos'],['mantenciones','🔧','Mantenciones'],
             [null,null,'Gestión académica'],
             ['importar','📥','Importar Excel'],['autoriz','✅','Autorizaciones'],['grupos','👪','Grupos'],['kits','🎒','Kits'],['sanciones','⛔','Sanciones'],['usuarios','👥','Usuarios'],['academico','🎓','Académico'],['catalogos','🗂️','Catálogos'],
             [null,null,'Sistema'],
             ['anuncios','📢','Anuncios'],['sedes','🏫','Sedes'],['respaldos','💾','Respaldos'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
};
function firstView(rol) { const m = MENUS[rol].find(x => x[0] !== null); return m ? m[0] : null; }
function buildNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  let firstDone = false;
  MENUS[ME.user.rol].forEach(([k, ic, label]) => {
    if (k === null) { const g = document.createElement('div'); g.className = 'nav-group'; g.textContent = label; nav.appendChild(g); return; }
    const b = document.createElement('button');
    b.dataset.key = k;
    b.innerHTML = `<span class="ic">${ic}</span><span class="lb">${label}</span>`;
    b.onclick = () => { nav.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); render(k); };
    if (!firstDone) { b.classList.add('active'); firstDone = true; }
    nav.appendChild(b);
  });
}

// Globo con el número de anuncios sin leer (por usuario, en este dispositivo)
async function updateAnunciosBadge() {
  const btn = document.querySelector('#nav button[data-key="anuncios"]');
  if (!btn) return;
  let rows = [];
  try { rows = await api('/anuncios'); } catch (e) { return; }
  let seen = 0;
  try { seen = Number(localStorage.getItem('prestalo_anuncios_seen_' + ME.user.rut) || 0); } catch (e) {}
  const nuevos = rows.filter(a => Number(a.id) > seen).length;
  let badge = btn.querySelector('.nav-badge');
  if (nuevos > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; btn.appendChild(badge); }
    badge.textContent = '☁ ' + (nuevos > 9 ? '9+' : nuevos);
    badge.title = nuevos + ' anuncio(s) sin leer';
  } else if (badge) { badge.remove(); }
}
function marcarAnunciosLeidos(rows) {
  try {
    const maxId = rows && rows.length ? Math.max(...rows.map(a => Number(a.id))) : 0;
    localStorage.setItem('prestalo_anuncios_seen_' + ME.user.rut, String(maxId));
  } catch (e) {}
}

// ---------- Boot ----------
async function boot() {
  ME = await api('/me');
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#whoName').textContent = ME.user.nombre;
  $('#whoRole').textContent = ({alumno:'Alumno',docente:'Docente',panolero:'Pañolero',jefe_panol:'Jefe de Pañol',admin:'Administrador'})[ME.user.rol];
  await buildSedeSelector();
  buildNav();
  render(firstView(ME.user.rol));
  updateAnunciosBadge();
}

// Multisede: selector de sede en la barra superior (solo admin con >1 sede)
async function buildSedeSelector() {
  const host = $('#sedeHost'); if (host) host.innerHTML = '';
  try {
    const s = await api('/sedes');
    SEDE = (s.sede_activa || (s.actual && s.actual.id)) || null;
    // Selector de sede para cualquier usuario multi-sede (admin y docente con asignaturas en varias sedes)
    if (host && s.sedes && s.sedes.length > 1) {
      host.innerHTML = `<select id="sedeSel" title="Sede activa">${s.sedes.map(x => `<option value="${x.id}" ${x.id === SEDE ? 'selected' : ''}>${escD(x.nombre)}</option>`).join('')}</select>`;
      $('#sedeSel').onchange = (e) => { SEDE = Number(e.target.value); PANEL_SEDE = String(SEDE); buildNav(); render(firstView(ME.user.rol)); toast('Sede cambiada'); };
    }
  } catch (e) { /* sede opcional */ }
}

// ===================== Vistas =====================
const view = () => $('#view');
// Panel operativo activo (para recarga tras una acción y auto-refresh online).
let DASH_POLL = null, DASHVIEW = { fn: null };
function stopDashPoll() { if (DASH_POLL) { clearInterval(DASH_POLL); DASH_POLL = null; } }
function h(html) { stopDashPoll(); DASHVIEW = { fn: null }; view().innerHTML = html; }
// Recarga la vista operativa activa (Control de Inventario / Planificación) preservando
// su estado; si no hay una activa, usa el fallback. Se llama tras entregar/recibir.
// silent=true → actualiza en el lugar sin mostrar "Cargando…" ni parpadeo.
function reloadDash(fallback) {
  if (DASHVIEW.fn === 'ep') return viewEntregasPlan(DASHVIEW.rango, DASHVIEW.ref, { keepId: DASHVIEW.keepId, filtro: DASHVIEW.filtro }, { silent: true });
  if (DASHVIEW.fn === 'inv') return viewInventarioDash(DASHVIEW.rango, DASHVIEW.modo, DASHVIEW.ref, { silent: true });
  return fallback ? fallback() : null;
}
// ¿El usuario está interactuando? (modal abierto o campo con foco) → no auto-refrescar ahora.
function dashBusy() {
  if (document.querySelector('.modal, .modal-bg, #modal')) return true;
  const a = document.activeElement;
  return !!(a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName));
}
// Firma compacta del estado operativo: cambia sólo cuando hay un cambio real
// (nuevas reservas, cambios de estado, individualización). Evita re-render inútil.
function dashSig(d) {
  try {
    return JSON.stringify([
      d.rango, d.reservas_pendientes, d.entregas_hoy, d.devoluciones_hoy, d.alertas_stock,
      (d.entregas || []).map(x => [x.id, x.fecha_inicio, x.fecha_fin, x.por_individualizar ? 1 : 0, (x.unidades || []).length]),
      (d.devoluciones || []).map(x => x.id)
    ]);
  } catch (e) { return String(Math.random()); }
}
// Auto-refresh online y silencioso: consulta cada 20s; sólo reemplaza el contenido
// cuando la firma cambió, y nunca mientras el usuario interactúa.
function startDashPoll(kind) {
  stopDashPoll();
  DASH_POLL = setInterval(async () => {
    const sel = kind === 'inv' ? '#invDash' : '#epRoot';
    if (!$(sel)) { stopDashPoll(); return; }
    if (dashBusy()) return;
    let d2;
    try { d2 = await api('/panol/dashboard?rango=' + DASHVIEW.rango + (DASHVIEW.ref ? '&ref=' + DASHVIEW.ref : '')); } catch (e) { return; }
    if (!$(sel) || dashBusy()) return;
    if (dashSig(d2) === DASHVIEW.sig) return;              // nada cambió → no tocar el DOM
    if (kind === 'inv') viewInventarioDash(DASHVIEW.rango, DASHVIEW.modo, DASHVIEW.ref, { silent: true, data: d2 });
    else viewEntregasPlan(DASHVIEW.rango, DASHVIEW.ref, { keepId: DASHVIEW.keepId, filtro: DASHVIEW.filtro }, { silent: true, data: d2 });
  }, 20000);
}

async function render(key) {
  try {
    if (key === 'catalogo')   return viewCatalogo();
    if (key === 'kits')       return viewKits();
    if (key === 'reservas')   return viewReservas();
    if (key === 'agenda')     return viewEntregasPlan();
    if (key === 'entregas_plan') return viewEntregasPlan();
    if (key === 'entregas_hist') return viewHistorialEntregas();
    if (key === 'recibir')    return viewDevoluciones();
    if (key === 'devoluciones_prog') return viewDevolucionesProg();
    if (key === 'kpis')       return viewKpis();
    if (key === 'inventario') return viewInventarioDash();
    if (key === 'equipos')    return viewInventario();
    if (key === 'mantenciones') return viewMantenciones();
    if (key === 'importar')   return viewImportar();
    if (key === 'autoriz')    return viewAutoriz();
    if (key === 'sanciones')  return viewSanciones();
    if (key === 'usuarios')   return viewUsuarios();
    if (key === 'academico')  return viewAcademico();
    if (key === 'perfil')     return viewPerfil();
    if (key === 'tareas')     return viewTareas();
    if (key === 'solicitudes') return viewSolicitudes();
    if (key === 'disponibilidad') return viewDisponibilidad();
    if (key === 'pedidos')    return viewPedidos();
    if (key === 'catalogos')  return viewCatalogos();
    if (key === 'bloqueos')   return viewBloqueos();
    if (key === 'grupos')     return viewGrupos();
    if (key === 'reportes')   return viewReportes();
    if (key === 'anuncios')   return viewAnuncios();
    if (key === 'companeros') return viewCompaneros();
    if (key === 'asignaturas') return viewAsignaturas();
    if (key === 'sedes')      return viewSedes();
    if (key === 'respaldos')  return viewRespaldos();
    if (key === 'manuales')   return viewManuales();
  } catch (e) { h(`<h2 class="page">Error</h2><div class="aviso bad">${e.message}</div>`); }
}

// ----- Catálogo (alumno/docente) -----
async function viewCatalogo() {
  const asigs = ME.asignaturas || [];
  h(`<h2 class="page">Catálogo</h2><p class="muted">Disponibilidad y ficha del equipamiento habilitado para tus asignaturas.</p><div id="catWrap">Cargando…</div>`);
  if (!asigs.length) { $('#catWrap').innerHTML = '<p class="muted">No tienes asignaturas con equipamiento habilitado.</p>'; return; }
  const secciones = [];
  for (const a of asigs) {
    let eq = [];
    try { eq = await api('/asignaturas/' + a.id + '/equipos'); } catch (e) { eq = []; }
    // Agrupar por artículo (categoría + nombre): una tarjeta por modelo, con su disponibilidad.
    const grupos = {};
    eq.forEach(e => { const k = e.categoria + '|' + e.nombre; (grupos[k] = grupos[k] || { rep: e, unidades: [] }).unidades.push(e); });
    const cards = Object.keys(grupos).map(k => {
      const g = grupos[k], e = g.rep;
      const disp = g.unidades.filter(u => u.estado === 'disponible').length, tot = g.unidades.length;
      return `<div class="card">
        <div class="thumb">${icon(e.categoria)}</div>
        <h3>${escD(e.nombre)}</h3><div class="cat">${escD(e.categoria)}${e.marca ? ' · ' + escD(e.marca) : ''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="pill ${disp > 0 ? 'ok' : 'bad'}" title="Unidades disponibles">Disponibles: ${disp}/${tot}</span></div>
        <div><button class="btn sm ghost" style="width:100%" data-ficha="${e.id}">Ficha</button></div>
      </div>`;
    }).join('');
    secciones.push(`<h3 style="margin:18px 0 8px;font-size:15px">${escD(a.nombre)}${a.seccion ? ' · ' + escD(a.seccion) : ''}</h3>
      <div class="grid">${cards || '<p class="muted" style="margin:0">Sin equipamiento habilitado para esta asignatura.</p>'}</div>`);
  }
  $('#catWrap').innerHTML = secciones.join('');
  $('#catWrap').querySelectorAll('button[data-ficha]').forEach(b => b.onclick = () => fichaEquipo(b.dataset.ficha));
}

async function modalReserva(id) {
  const e = await api('/equipos/' + id);
  const esRecinto = e.tipo === 'recinto' || e.requiere_autorizacion;
  // Inventario y cantidad disponible de este artículo (en esta sede y en total)
  let dispInfo = '';
  try {
    const multi = !!(ME.sedes && ME.sedes.length > 1);
    const res = await api('/inventario/resumen' + (multi ? '?scope=todos' : ''));
    const art = res.filter(r => r.articulo === e.nombre && r.categoria === e.categoria);
    const dispSede = art.filter(r => r.sede_id === e.entidad_id).reduce((n, r) => n + r.disponible, 0);
    const dispTot = art.reduce((n, r) => n + r.disponible, 0);
    const totTot = art.reduce((n, r) => n + r.total, 0);
    dispInfo = `<div class="aviso ${dispSede > 0 ? 'ok' : 'bad'}" style="margin-bottom:10px">
      Disponibles de <b>${escD(e.nombre)}</b>: <b>${dispSede}</b> en esta sede${multi ? ` · <b>${dispTot}</b> en total (${totTot} unidades en todas las sedes)` : ''}.</div>`;
  } catch (_) { /* resumen opcional */ }
  const asigs = ME.asignaturas;
  const now = new Date();
  const minH = (ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).horas_anticipacion) || 48;
  const defIni = new Date(now.getTime() + (esRecinto ? Math.max(73, minH + 1) : (minH + 1)) * 3600000);
  const toLocal = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  openModal(`
    <h3>Reservar: ${e.nombre}</h3>
    <p class="muted" style="margin-top:0">${e.categoria} · ${e.codigo_qr}</p>
    ${dispInfo}
    ${esRecinto ? `<div class="aviso warn">Recinto: requiere 72 h de anticipación y autorización de Jefatura de Carrera y Dirección Académica (DAO).</div>` : ''}
    ${asigs.length ? `<div class="field"><label>Asignatura</label><select id="rAsig">${asigs.map(a=>`<option value="${a.id}">${a.nombre}${a.seccion?' · '+a.seccion:''}</option>`).join('')}</select></div>` : '<div class="aviso bad">No tienes asignaturas inscritas.</div>'}
    <div class="field"><label>Inicio</label><input type="datetime-local" id="rIni" value="${toLocal(defIni)}"></div>
    <div class="field"><label>Término</label><input type="datetime-local" id="rFin" value="${toLocal(new Date(defIni.getTime()+3*3600000))}"></div>
    <label style="font-size:12px;font-weight:600;color:var(--muted)">Integrantes del grupo (opcional — RF-52)</label>
    <div id="integrantes"></div>
    <button class="btn sm ghost" id="addInt" style="margin:4px 0 8px">+ Agregar integrante</button>
    <div class="toggle"><input type="checkbox" id="rUso"><label for="rUso" style="margin:0">Declaro que el uso es exclusivamente académico (obligatorio)</label></div>
    <div class="err" id="rErr"></div>
    <button class="btn full" id="rSubmit">Confirmar reserva</button>
  `);
  const cont = $('#integrantes');
  $('#addInt').onclick = () => {
    const d = document.createElement('div'); d.className = 'integrantes-row';
    d.innerHTML = `<input placeholder="Nombre" class="i-nom"><input placeholder="RUT" class="i-rut"><button class="btn sm danger">×</button>`;
    d.querySelector('button').onclick = () => d.remove();
    cont.appendChild(d);
  };
  $('#rSubmit').onclick = async () => {
    $('#rErr').textContent = '';
    const integrantes = [...cont.querySelectorAll('.integrantes-row')].map(r => ({
      nombre: r.querySelector('.i-nom').value.trim(), rut: r.querySelector('.i-rut').value.trim()
    })).filter(x => x.nombre && x.rut);
    try {
      const r = await api('/reservas', { method:'POST', body:{
        equipo_id: Number(id),
        asignatura_id: $('#rAsig') ? Number($('#rAsig').value) : null,
        fecha_inicio: new Date($('#rIni').value).toISOString(),
        fecha_fin: new Date($('#rFin').value).toISOString(),
        uso_academico: $('#rUso').checked,
        integrantes,
      }});
      closeModal(); toast(r.mensaje || 'Reserva creada'); viewCatalogo();
    } catch (e) { $('#rErr').textContent = e.message; }
  };
}

// ----- Mis reservas -----
async function viewReservas() {
  h(`<h2 class="page">Mis reservas</h2><div id="list"></div>`);
  const rs = await api('/mis-reservas');
  if (!rs.length) { $('#list').innerHTML = '<p class="muted">Sin reservas.</p>'; return; }
  $('#list').innerHTML = rs.map(r => {
    const [lab, cls] = ESTADO_RES[r.estado] || [r.estado,'info'];
    const cancel = ['pendiente','confirmada'].includes(r.estado)
      ? `<button class="btn sm ghost" data-c="${r.id}">Cancelar</button>` : '';
    return `<div class="row"><div class="ava">${icon(r.categoria)}</div>
      <div class="info"><b>${r.equipo}</b><small>${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)} · ${r.integrantes} integrante(s)${r.es_grupal?' · grupal':''}</small></div>
      <span class="pill ${cls}">${lab}</span>${cancel}</div>`;
  }).join('');
  $('#list').querySelectorAll('button[data-c]').forEach(b => b.onclick = async () => {
    await api(`/reservas/${b.dataset.c}/cancelar`, { method:'POST', body:{} }); toast('Reserva cancelada'); viewReservas();
  });
}

// ----- Pañolero: Agenda / Entregar -----
function unidadLinea(x) {
  return `Unidad <b>${escD(x.codigo_qr)}</b>${x.n_serie ? ' · N° serie ' + escD(x.n_serie) : ''}`
    + `${x.marca ? ' · ' + escD(x.marca) : ''}${x.modelo ? ' ' + escD(x.modelo) : ''}`;
}
function fmtHora(dt) { try { return new Date(dt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

// ===================== Control de Inventario (dashboard operativo, maqueta) =====================
const INVDASH_CSS = `
.invd{--b:#2563eb;--b2:#eff4ff;--g:#16a34a;--g2:#eafaf0;--p:#7c3aed;--p2:#f3eefe;--r:#dc2626;--r2:#fdeeee;color:#1f2937}
.invd .ihead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.invd .ihead h1{font-size:26px;font-weight:800;margin:0;color:#111827}
.invd .ihead p{margin:3px 0 0;color:#6b7280;font-size:13.5px}
.invd .segs{display:flex;background:#eef1f5;border-radius:10px;padding:3px}
.invd .segs button{border:0;background:transparent;padding:7px 14px;border-radius:8px;font-weight:600;font-size:13px;color:#4b5563;cursor:pointer}
.invd .segs button.on{background:var(--b);color:#fff}
.invd .datert{color:#374151;font-size:13px;display:flex;align-items:center;gap:6px;margin-top:8px}
.invd .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}
@media(max-width:900px){.invd .kpis{grid-template-columns:repeat(2,1fr)}}
.invd .kpi{border-radius:14px;padding:16px;display:flex;gap:12px;align-items:flex-start;position:relative;border:1px solid #eceff3;cursor:pointer;transition:transform .08s}
.invd .kpi:hover{transform:translateY(-1px)}
.invd .kpi.sel{outline:3px solid #2563eb;outline-offset:1px}
.invd .segs button{transition:background .1s}
.invd .kpi .ico{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:20px;flex:0 0 auto}
.invd .kpi .lb{font-size:12.5px;color:#4b5563;font-weight:600}
.invd .kpi .vl{font-size:30px;font-weight:800;line-height:1.05;margin:2px 0}
.invd .kpi .sb{font-size:11.5px;color:#6b7280}
.invd .kpi .chev{position:absolute;right:12px;top:14px;color:#9aa3af;font-size:16px}
.invd .kpi.b{background:var(--b2)}.invd .kpi.b .ico{background:#dbe6ff;color:var(--b)}
.invd .kpi.g{background:var(--g2)}.invd .kpi.g .ico{background:#d4f3df;color:var(--g)}
.invd .kpi.p{background:var(--p2)}.invd .kpi.p .ico{background:#e7ddfb;color:var(--p)}
.invd .kpi.r{background:var(--r2)}.invd .kpi.r .ico{background:#fbdcdc;color:var(--r)}
.invd .cols2{display:grid;grid-template-columns:1fr 1.6fr;gap:14px;margin-bottom:16px}
@media(max-width:900px){.invd .cols2{grid-template-columns:1fr}}
.invd .pnl{background:#fff;border:1px solid #eceff3;border-radius:14px;padding:16px}
.invd .pnl h3{margin:0 0 12px;font-size:16px;font-weight:700;color:#111827}
.invd .prog{margin:12px 0}
.invd .prog .t{display:flex;justify-content:space-between;font-size:13px;color:#374151;margin-bottom:5px}
.invd .prog .track{height:9px;background:#eef1f5;border-radius:6px;overflow:hidden}
.invd .prog .fill{height:100%;background:linear-gradient(90deg,#2563eb,#16a34a);border-radius:6px}
.invd .tl{position:relative;padding-left:4px}
.invd .tl .axis{display:flex;justify-content:space-between;font-size:10.5px;color:#9aa3af;margin-bottom:6px}
.invd .tl .lane{position:relative;height:34px;background:#f1f5fb;border-radius:9px;margin:5px 0}
.invd .tl .lane .blk{position:absolute;top:6px;height:22px;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.invd .tl .lane.ent .blk{background:#5da8e8}.invd .tl .lane.dev .blk{background:#4fcfb3}
.invd .tl .lanelb{font-size:12px;color:#4b5563;font-weight:600;display:flex;align-items:center;gap:6px;margin-top:8px}
.invd .tl .now{position:absolute;top:2px;bottom:6px;width:2px;background:var(--b);z-index:4}
.invd .tl .now::after{content:"";position:absolute;left:50%;top:0;transform:translateX(-50%);width:9px;height:9px;border-radius:50%;background:var(--b)}
.invd .tl .now .pin{position:absolute;top:-4px;left:50%;transform:translateX(-50%);background:var(--b);color:#fff;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:9px;white-space:nowrap;box-shadow:0 1px 5px rgba(37,99,235,.45)}
.invd .wkgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:4px}
.invd .wkcell{border:1px solid #eef1f5;border-radius:10px;padding:8px 3px;text-align:center;background:#f9fafb}
.invd .wkcell.has{background:var(--b2);border-color:#cfe0ff}
.invd .wkcell.today{outline:2px solid var(--b);outline-offset:-1px}
.invd .wkcell .wd{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.02em}
.invd .wkcell .wn{font-size:16px;font-weight:800;color:#111827;margin:1px 0}
.invd .wkcell .wb{font-size:10px;font-weight:700;color:var(--b);min-height:12px}
.invd .mwk{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid #eef1f5;border-radius:10px;padding:10px 12px;margin:6px 0;background:#f9fafb}
.invd .mwk.has{background:var(--b2);border-color:#cfe0ff}
.invd .mwk.cur{outline:2px solid var(--b);outline-offset:-1px}
.invd .mwk .ml{font-size:12.5px;color:#374151;font-weight:600}
.invd .mwk .mn{font-size:12px;font-weight:700;color:var(--b);white-space:nowrap}
.invd .refpick{border:1px solid #d7dce3;border-radius:9px;padding:6px 9px;font-size:12.5px;background:#fff;color:#374151;margin-top:8px}
.invd .refpick::-webkit-calendar-picker-indicator{cursor:pointer}
.invd .filt{background:#fff;border:1px solid #eceff3;border-radius:14px;padding:14px 16px;display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px}
.invd .filt .ft{display:flex;align-items:center;gap:8px;color:#374151;font-weight:600;font-size:13px}
.invd .filt .fg{display:flex;flex-direction:column;gap:3px;min-width:150px}
.invd .filt .fg.srchfg{min-width:240px;flex:1}
.invd .filt .fg label{font-size:11px;color:#6b7280}
.invd .filt select,.invd .filt input{width:100%;box-sizing:border-box;height:38px;border:1px solid #d7dce3;border-radius:9px;padding:8px 10px;font-size:13px;background:#fff;color:#1f2937;font-family:inherit}
.invd .filt input::placeholder{color:#9aa3af}
.invd .filt a{margin-left:auto;color:var(--b);font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
.invd .tbl{background:#fff;border:1px solid #eceff3;border-radius:14px;padding:16px}
.invd .tbl .tbh{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.invd .tbl .tbh h3{margin:0;font-size:16px;font-weight:700}
.invd .tbl .srch{border:1px solid #d7dce3;border-radius:10px;padding:8px 12px;font-size:13px;min-width:260px}
.invd table{width:100%;border-collapse:collapse}
.invd thead th{text-align:left;font-size:11.5px;color:#6b7280;font-weight:600;padding:8px 10px;border-bottom:1px solid #eef1f5;white-space:nowrap}
.invd tbody td{padding:11px 10px;border-bottom:1px solid #f3f5f8;font-size:13.5px;color:#1f2937;vertical-align:middle}
.invd .st{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.invd .st.pend{background:#eef4ff;color:#2563eb}.invd .st.conf{background:#eafaf0;color:#16a34a}
.invd .st.prep{background:#fff5e6;color:#b45309}.invd .st.dev{background:#f3eefe;color:#7c3aed}
.invd .ab{border:0;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer}
.invd .ab.pri{background:var(--b);color:#fff}.invd .ab.out{background:#fff;border:1px solid #d7dce3;color:#374151}
.invd .dots{border:0;background:transparent;color:#9aa3af;font-size:16px;cursor:pointer;padding:4px 8px}
.invd .itico{width:26px;height:26px;border-radius:7px;background:#eef1f5;display:inline-flex;align-items:center;justify-content:center;margin-right:7px;vertical-align:middle}
`;
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fmtFechaLarga(d) {
  try { return 'Hoy, ' + d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
}
async function viewInventarioDash(rango = 'hoy', modo = 'programadas', ref = null, opts = {}) {
  const silent = !!opts.silent;
  const prevSrch = silent && $('#tSrch') ? $('#tSrch').value : '';
  if (!silent) h(`<div class="invd"><style>${INVDASH_CSS}</style><div id="invDash">Cargando…</div></div>`);
  let d = opts.data;
  if (!d) { try { d = await api('/panol/dashboard?rango=' + rango + (ref ? '&ref=' + ref : '')); } catch (e) { if (!silent && $('#invDash')) $('#invDash').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; } }
  if (!$('#invDash')) return;
  const rangoLabel = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes' };
  // Fecha base: la elegida en el calendario (ref) o hoy.
  const baseD = ref ? new Date(ref + 'T12:00:00') : new Date();
  const lunesDe = b => { const x = new Date(b); const wd = (x.getDay() + 6) % 7; x.setHours(0,0,0,0); x.setDate(x.getDate() - wd); return x; };
  const isoDay = x => { const y = x.getFullYear(), m = ('0'+(x.getMonth()+1)).slice(-2), dd = ('0'+x.getDate()).slice(-2); return `${y}-${m}-${dd}`; };
  const hoyISO = isoDay(new Date());

  // ===== Línea de tiempo (según el filtro) =====
  // HOY → franja horaria del día; SEMANA → 7 días marcando entregas; MES → por semanas.
  let timelineTitulo, timelineHTML;
  if (rango === 'hoy') {
    // Eje horario dinámico: incluye las horas reales de retiros/devoluciones (y 08–19 por defecto).
    const horasT = [...d.entregas.map(a => a.fecha_inicio), ...d.devoluciones.map(p => p.esperada || p.fecha_salida)]
      .filter(Boolean).map(t => { const x = new Date(t); return x.getHours() + x.getMinutes() / 60; }).filter(v => !isNaN(v));
    let AX0 = 8, AX1 = 19;
    if (horasT.length) { AX0 = Math.max(5, Math.min(8, Math.floor(Math.min(...horasT)))); AX1 = Math.min(23, Math.max(19, Math.ceil(Math.max(...horasT)))); }
    const SPAN = AX1 - AX0;
    const pos = t => { const dt = new Date(t); const hh = dt.getHours() + dt.getMinutes() / 60; return Math.max(0, Math.min(100, (hh - AX0) / SPAN * 100)); };
    const ejes = []; for (let hgt = AX0; hgt <= AX1; hgt++) ejes.push(('0' + hgt).slice(-2) + ':00');
    // Cada entrega/devolución es un bloque pequeño en su hora (agrupa por cantidad, nunca abarca el día).
    const blkEnt = d.entregas.map(a => { const l = pos(a.fecha_inicio); const durH = Math.max(0.5, (new Date(a.fecha_fin || a.fecha_inicio) - new Date(a.fecha_inicio)) / 3600000); const w = Math.max(2.4, Math.min(7, durH / SPAN * 100)); return `<div class="blk" style="left:${Math.min(l, 100 - w)}%;width:${w}%" title="${escD(a.estudiante)} · ${fmtHora(a.fecha_inicio)}"></div>`; }).join('');
    const blkDev = d.devoluciones.map(p => { const l = pos(p.esperada || p.fecha_salida); const w = 3; return `<div class="blk" style="left:${Math.min(l, 100 - w)}%;width:${w}%" title="${escD(p.estudiante)}"></div>`; }).join('');
    const nowD = new Date(); const nowH = nowD.getHours() + nowD.getMinutes() / 60;
    const esHoy = !ref || ref === hoyISO;
    const nowMark = (esHoy && nowH >= AX0 && nowH <= AX1) ? `<div class="now" style="left:${pos(nowD)}%"><span class="pin">${fmtHora(nowD)}</span></div>` : '';
    timelineTitulo = 'Línea de tiempo del día';
    timelineHTML = `<div class="tl">
          <div class="axis">${ejes.map(e => `<span>${e}</span>`).join('')}</div>
          <div class="lanelb">📦 Entregas (${d.entregas.length})</div>
          <div class="lane ent">${blkEnt}</div>
          <div class="lanelb">↩️ Devoluciones (${d.devoluciones.length})</div>
          <div class="lane dev">${blkDev}</div>
          ${nowMark}
        </div>`;
  } else if (rango === 'semana') {
    // Semana = ventana de 7 días que PARTE en la fecha elegida (no se fuerza al lunes).
    const l0 = new Date(baseD); l0.setHours(0, 0, 0, 0);
    const porDia = {}; d.entregas.forEach(a => { const k = isoDay(new Date(a.fecha_inicio)); porDia[k] = (porDia[k] || 0) + 1; });
    const celdas = [];
    for (let i = 0; i < 7; i++) {
      const x = new Date(l0); x.setDate(l0.getDate() + i); const k = isoDay(x);
      const n = porDia[k] || 0;
      celdas.push(`<div class="wkcell ${n ? 'has' : ''} ${k === hoyISO ? 'today' : ''}">
        <div class="wd">${x.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '')}</div>
        <div class="wn">${x.getDate()}</div>
        <div class="wb">${n ? n + '📦' : ''}</div></div>`);
    }
    const fin7 = new Date(l0); fin7.setDate(l0.getDate() + 6);
    timelineTitulo = `Semana del ${l0.getDate()} ${l0.toLocaleDateString('es-CL',{month:'short'}).replace('.','')} al ${fin7.getDate()} ${fin7.toLocaleDateString('es-CL',{month:'short'}).replace('.','')}`;
    timelineHTML = `<div class="tl"><div class="wkgrid">${celdas.join('')}</div></div>`;
  } else {
    // Mes por semanas que PARTEN el día 1 (1–7, 8–14, …), no en lunes.
    const y = baseD.getFullYear(), m = baseD.getMonth();
    const ult = new Date(y, m + 1, 0).getDate();
    const semanas = [];
    for (let start = 1; start <= ult; start += 7) {
      const end = Math.min(start + 6, ult);
      const ini = new Date(y, m, start), fin = new Date(y, m, end);
      const n = d.entregas.filter(a => { const dd = new Date(a.fecha_inicio); return dd >= new Date(y, m, start, 0, 0, 0) && dd <= new Date(y, m, end, 23, 59, 59); }).length;
      const cur2 = (hoyISO >= isoDay(ini) && hoyISO <= isoDay(fin));
      const mes = ini.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '');
      semanas.push(`<div class="mwk ${n ? 'has' : ''} ${cur2 ? 'cur' : ''}">
        <span class="ml">Desde ${start} ${mes} · ${start}–${end}</span>
        <span class="mn">${n} entrega${n === 1 ? '' : 's'}</span></div>`);
    }
    timelineTitulo = `Mes de ${baseD.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })} (por semanas)`;
    timelineHTML = `<div class="tl">${semanas.join('')}</div>`;
  }

  const maxProg = Math.max(d.prog_hoy, d.prog_semana, d.prog_mes, 1);
  const prog = (lb, n) => `<div class="prog"><div class="t"><span>📅 ${lb}</span><b>${n} entregas</b></div><div class="track"><div class="fill" style="width:${Math.round(n / maxProg * 100)}%"></div></div></div>`;
  const kpi = (cls, mod, ic, lb, vl, sb) => `<div class="kpi ${cls} ${modo === mod ? 'sel' : ''}" data-modo="${mod}"><div class="ico">${ic}</div><div><div class="lb">${lb}</div><div class="vl">${vl}</div><div class="sb">${sb}</div></div><span class="chev">›</span></div>`;

  $('#invDash').innerHTML = `
    <div class="ihead">
      <div><h1>Control de Inventario</h1><p>Gestión operativa de equipos, reservas y entregas del pañol</p></div>
      <div style="text-align:right">
        <div class="segs"><button data-r="hoy" class="${rango === 'hoy' ? 'on' : ''}">Hoy</button><button data-r="semana" class="${rango === 'semana' ? 'on' : ''}">Esta semana</button><button data-r="mes" class="${rango === 'mes' ? 'on' : ''}">Este mes</button></div>
        ${rango === 'hoy'
          ? `<div class="datert">📅 ${cap(fmtFechaLarga(new Date()))}</div>`
          : `<div style="margin-top:8px"><label style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px">${rango === 'semana' ? '🗓️ Ver la semana de:' : '🗓️ Ver el mes de:'}</label>
             <input type="date" class="refpick" id="refPick" value="${isoDay(baseD)}" style="margin-top:0"></div>`}
      </div>
    </div>
    <div class="kpis">
      ${kpi('b', 'pendientes', '📅', 'Reservas pendientes', d.reservas_pendientes, 'Por preparar y entregar')}
      ${kpi('g', 'confirmadas', '✅', 'Entregas confirmadas', d.entregas_hoy, 'Entregadas hoy')}
      ${kpi('p', 'devoluciones', '📦', 'Devoluciones esperadas', d.devoluciones_hoy, 'Programadas para hoy')}
      ${kpi('r', 'stock', '⚠️', 'Alertas de stock', d.alertas_stock, 'Equipos con stock bajo')}
    </div>
    <div class="cols2">
      <div class="pnl"><h3>Entregas programadas</h3>${prog('Hoy', d.prog_hoy)}${prog('Esta semana', d.prog_semana)}${prog('Este mes', d.prog_mes)}</div>
      <div class="pnl"><h3>${timelineTitulo} <span style="font-weight:500;color:#6b7280;font-size:13px">(${rango === 'hoy' ? 'Entregas y devoluciones' : 'Entregas programadas'})</span></h3>
        ${timelineHTML}
      </div>
    </div>
    <div class="filt">
      <div class="ft">🔽 Filtros</div>
      <div class="fg"><label>Sede</label><select id="fSede"><option>${escD((ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa')}</option></select></div>
      <div class="fg"><label>Vista</label><select id="fModo">
        <option value="programadas">Programadas (entregas y devoluciones)</option>
        <option value="pendientes">Reservas pendientes</option>
        <option value="confirmadas">Entregas confirmadas (hoy)</option>
        <option value="devoluciones">Devoluciones esperadas</option>
        <option value="stock">Alertas de stock</option></select></div>
      <div class="fg srchfg"><label>Buscar</label><input id="tSrch" placeholder="Estudiante, asignatura o equipo…"></div>
      <a id="fClear">Limpiar filtros</a>
    </div>
    <div class="tbl"><div id="invTblWrap"></div></div>`;

  const renderTabla = () => {
    const q = ($('#tSrch').value || '').toLowerCase();
    const tit = { programadas: 'Entregas programadas – ' + rangoLabel[rango], pendientes: 'Reservas pendientes (por entregar)', confirmadas: 'Entregas confirmadas hoy', devoluciones: 'Devoluciones esperadas', stock: 'Alertas de stock' }[modo];

    if (modo === 'stock') {
      const lista = (d.stock_bajo || []).filter(s => !q || (s.articulo + ' ' + s.categoria).toLowerCase().includes(q));
      $('#invTblWrap').innerHTML = `<div class="tbh"><h3>⚠️ ${tit} (${lista.length})</h3></div>
        <table><thead><tr><th>Artículo</th><th>Categoría</th><th>Disponibles</th><th>Total</th><th>Estado</th></tr></thead><tbody>${
          lista.length ? lista.map(s => `<tr><td><span class="itico">${icon(s.categoria)}</span>${escD(s.articulo)}</td><td>${escD(s.categoria)}</td>
            <td style="text-align:center">${s.disponibles}</td><td style="text-align:center">${s.total}</td>
            <td><span class="st ${s.disponibles === 0 ? 'dev' : 'prep'}" style="${s.disponibles === 0 ? 'background:#fdeeee;color:#dc2626' : ''}">${s.disponibles === 0 ? 'Sin stock' : 'Stock bajo'}</span></td></tr>`).join('')
          : '<tr><td colspan="5" class="muted" style="padding:16px">No hay artículos con stock bajo.</td></tr>'
        }</tbody></table>`;
      return;
    }

    let filas;
    if (modo === 'confirmadas') {
      filas = (d.entregadas_hoy || []).map(p => ({ tipo: 'confirmada', hora: p.fecha_salida, estudiante: p.estudiante, asignatura: '—', item: p.equipo, categoria: p.categoria, ref: p }));
    } else {
      const ent = d.entregas.map(a => ({ tipo: 'entrega', hora: a.fecha_inicio, estudiante: a.estudiante, asignatura: a.asignatura, item: a.item, categoria: a.categoria, por_individualizar: a.por_individualizar, ref: a }));
      const dev = d.devoluciones.map(p => ({ tipo: 'devolucion', hora: p.esperada || p.fecha_salida, estudiante: p.estudiante, asignatura: '—', item: p.equipo, categoria: p.categoria, ref: p }));
      filas = modo === 'pendientes' ? ent : modo === 'devoluciones' ? dev : [...ent, ...dev];
      filas.sort((x, y) => new Date(x.hora) - new Date(y.hora));
    }
    const lista = filas.filter(f => !q || (f.estudiante + ' ' + f.asignatura + ' ' + f.item).toLowerCase().includes(q));
    const colFecha = modo === 'devoluciones' ? 'Fecha devolución ↕' : 'Fecha de entrega ↕';
    $('#invTblWrap').innerHTML = `<div class="tbh"><h3>📦 ${tit} (${lista.length})</h3></div>
      <div style="overflow-x:auto"><table><thead><tr><th>${colFecha}</th><th>Hora ↕</th><th>Estudiante ↕</th><th>Asignatura ↕</th><th>Equipo o Kit ↕</th><th>Cantidad ↕</th><th>Estado ↕</th><th>Acciones</th></tr></thead>
      <tbody>${lista.length ? lista.map((f, i) => {
        const st = f.tipo === 'devolucion' ? '<span class="st dev">↩️ Devolución esperada</span>'
          : f.tipo === 'confirmada' ? '<span class="st conf">✅ Entregada</span>'
          : '<span class="st pend">📅 Pendiente</span>';
        const acc = f.tipo === 'devolucion' ? `<button class="ab pri rec" data-i="${i}">Recepcionar</button>`
          : f.tipo === 'confirmada' ? ''
          : `<button class="ab pri ent" data-i="${i}">Entregar</button>`;
        let fechaTxt = '—'; try { fechaTxt = new Date(f.hora).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit' }); } catch (e) {}
        return `<tr><td style="white-space:nowrap"><span class="st pend" style="background:#eef4ff;color:#2563eb">📅 ${fechaTxt}</span></td><td style="white-space:nowrap">🕐 ${fmtHora(f.hora)}</td><td>${escD(f.estudiante)}</td><td>${escD(f.asignatura)}</td>
          <td><span class="itico">${icon(f.categoria || f.item)}</span>${escD(f.item)}${f.por_individualizar ? ' <span class="st pend" style="font-size:10px">por asignar</span>' : ''}</td>
          <td style="text-align:center">1</td><td>${st}</td>
          <td style="display:flex;gap:6px;align-items:center">${acc}<button class="dots">⋯</button></td></tr>`;
      }).join('') : `<tr><td colspan="8" class="muted" style="padding:16px">No hay registros para ${rangoLabel[rango].toLowerCase()}.</td></tr>`}</tbody></table></div>`;
    $('#invTblWrap').querySelectorAll('.ent').forEach(b => b.onclick = () => modalEntregar(lista[Number(b.dataset.i)].ref));
    $('#invTblWrap').querySelectorAll('.rec').forEach(b => { const r = lista[Number(b.dataset.i)].ref; b.onclick = () => modalRecibir({ prestamo_id: r.id, equipo: r.equipo, codigo_qr: r.codigo_qr, n_serie: r.n_serie, marca: r.marca, modelo: r.modelo }); });
  };

  // Tabs de rango → recarga con el rango (semana/mes empiezan en la fecha actual).
  $('#invDash').querySelectorAll('.segs button').forEach(b => b.onclick = () => viewInventarioDash(b.dataset.r, modo, null));
  // Calendario: elegir la semana / el mes a filtrar.
  const rp = $('#refPick'); if (rp) rp.onchange = () => { if (rp.value) viewInventarioDash(rango, modo, rp.value); };
  // KPIs como filtros del dashboard.
  $('#invDash').querySelectorAll('.kpi').forEach(c => c.onclick = () => {
    const m = c.dataset.modo; modo = (modo === m) ? 'programadas' : m; DASHVIEW.modo = modo;
    $('#fModo').value = modo;
    $('#invDash').querySelectorAll('.kpi').forEach(k => k.classList.toggle('sel', k.dataset.modo === modo));
    renderTabla();
  });
  $('#fModo').onchange = () => { modo = $('#fModo').value; DASHVIEW.modo = modo; $('#invDash').querySelectorAll('.kpi').forEach(k => k.classList.toggle('sel', k.dataset.modo === modo)); renderTabla(); };
  $('#tSrch').oninput = renderTabla;
  $('#fClear').onclick = () => { modo = 'programadas'; DASHVIEW.modo = modo; $('#fModo').value = 'programadas'; $('#tSrch').value = ''; $('#invDash').querySelectorAll('.kpi').forEach(k => k.classList.remove('sel')); renderTabla(); };
  $('#fModo').value = modo;
  if (silent && prevSrch && $('#tSrch')) $('#tSrch').value = prevSrch;
  renderTabla();

  // Panel activo + actualización automática/online (silenciosa) de los cambios de estado.
  DASHVIEW = { fn: 'inv', rango, modo, ref, sig: dashSig(d) };
  startDashPoll('inv');
}

// ===================== Planificación y Ejecución de Entregas (maqueta) =====================
const ENTP_CSS = `
.entp{color:#1f2937}
.entp .ehead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.entp .ehead .ti{display:flex;gap:12px;align-items:flex-start}
.entp .ehead .tk{width:44px;height:44px;border-radius:12px;background:#eef4ff;color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:22px;flex:0 0 auto}
.entp .ehead h1{margin:0;font-size:23px;font-weight:800;font-style:italic;color:#111827}
.entp .ehead p{margin:3px 0 0;color:#6b7280;font-size:13px}
.entp .ehead .btns{display:flex;gap:8px}
.entp .b{border:0;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer}
.entp .b.gh{background:#fff;border:1px solid #d7dce3;color:#374151}
.entp .b.pri{background:#2563eb;color:#fff}
.entp .grid3{display:grid;grid-template-columns:300px 1fr 360px;gap:14px;align-items:start}
@media(max-width:1200px){.entp .grid3{grid-template-columns:1fr}}
.entp .pnl{background:#fff;border:1px solid #eceff3;border-radius:14px;padding:14px}
.entp .pnl h3{margin:0 0 10px;font-size:14.5px;font-weight:700}
.entp .alert{display:flex;gap:10px;align-items:flex-start;border-radius:11px;padding:11px;margin-bottom:9px;cursor:default}
.entp .alert .n{margin-left:auto;font-weight:800}
.entp .alert.r{background:#fdeeee}.entp .alert.o{background:#fff5e6}.entp .alert.y{background:#fffbe6}.entp .alert.p{background:#f3eefe}
.entp .alert b{font-size:13px}.entp .alert small{display:block;color:#6b7280;font-size:11.5px}
.entp .nextit{display:flex;gap:10px;align-items:center;padding:9px 6px;border-bottom:1px solid #f3f5f8;cursor:pointer;border-radius:8px}
.entp .nextit:hover{background:#f6f8fb}
.entp .nextit .hr{font-weight:700;font-size:12.5px;color:#374151;width:42px;flex:0 0 auto}
.entp .nextit .bd b{font-size:12.5px}.entp .nextit .bd small{display:block;color:#6b7280;font-size:11px}
.entp .badge{margin-left:auto;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px}
.entp .badge.prep{background:#fff5e6;color:#b45309}.entp .badge.conf{background:#eafaf0;color:#16a34a}.entp .badge.atr{background:#fdeeee;color:#dc2626}
.entp .seg{display:flex;background:#eef1f5;border-radius:10px;padding:4px}
.entp .seg button{border:0;background:transparent;padding:8px 20px;border-radius:8px;font-weight:700;font-size:13px;color:#475569;cursor:pointer}
.entp .seg button.on{background:#0d9488;color:#fff}
.entp .cal .caltop{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:12px}
.entp .cal .nav{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:800;font-size:14px;max-width:100%}
.entp .cal .nav button{width:36px;height:36px;flex:0 0 auto;border:1px solid #e6e9ef;background:#fff;border-radius:9px;cursor:pointer;font-size:16px;color:#334155;display:flex;align-items:center;justify-content:center}
.entp .cal .nav .mlab{font-weight:800;font-size:14px;text-align:center;min-width:0}
.entp .cal .seg{width:100%;justify-content:center}
.entp .cal .seg button{flex:1;text-align:center}
.entp .vt{position:relative;border-top:1px solid #eef1f5;padding-top:6px}
.entp .vt .hr{position:absolute;left:0;right:0;border-top:1px dashed #eef1f5;font-size:10.5px;color:#9aa3af;padding-left:2px}
.entp .vt .ev{position:absolute;border-radius:10px;padding:8px 11px;background:#fff;color:#1f2937;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden;cursor:pointer;border:1px solid #eef1f5;border-left:5px solid #94a3b8}
.entp .vt .ev.u-verde{border-left-color:#22c55e;background:#f3fbf6}
.entp .vt .ev.u-amar{border-left-color:#f59e0b;background:#fff9ef}
.entp .vt .ev.u-rojo{border-left-color:#ef4444;background:#fdf3f3}
.entp .vt .ev .t1{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:800;align-items:center}
.entp .vt .ev .t1 .hrng{color:#6b7280;font-weight:700;font-size:11px;white-space:nowrap}
.entp .vt .ev .t2{font-size:11.5px;color:#4b5563;margin-top:1px}
.entp .vt .ev .bg{display:inline-block;margin-top:5px;font-size:10px;font-weight:800;padding:2px 9px;border-radius:999px}
.entp .vt .ev.u-verde .bg{background:#eafaf0;color:#16a34a}
.entp .vt .ev.u-amar .bg{background:#fff7e6;color:#b45309}
.entp .vt .ev.u-rojo .bg{background:#fdeeee;color:#dc2626}
.entp .vt .ev.sel{outline:3px solid #2563eb;outline-offset:1px}
.entp .vt .nowl{position:absolute;left:0;right:0;height:2px;background:#2563eb;z-index:5}
.entp .vt .nowl .lb{position:absolute;left:0;top:-9px;background:#2563eb;color:#fff;font-size:10px;font-weight:800;padding:1px 7px;border-radius:9px}
.entp .vt .nowl::after{content:"";position:absolute;left:52px;top:-3px;width:8px;height:8px;border-radius:50%;background:#2563eb}
.entp .ulegend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#6b7280;margin:2px 2px 10px}
.entp .ulegend span{display:inline-flex;align-items:center;gap:5px}
.entp .ulegend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.entp .chips{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:12px}
@media(max-width:620px){.entp .chips{grid-template-columns:repeat(2,1fr)}}
.entp .chip{background:#fff;border:1px solid #eceff3;border-radius:11px;padding:10px;text-align:center}
.entp .chip .v{font-size:20px;font-weight:800}.entp .chip .l{font-size:11px;color:#6b7280}
.entp .ed .edtabs{display:flex;gap:4px;border-bottom:1px solid #eef1f5;margin-bottom:12px}
.entp .ed .edtabs button{border:0;background:transparent;padding:8px 10px;font-size:12.5px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent}
.entp .ed .edtabs button.on{color:#2563eb;border-bottom-color:#2563eb}
.entp .ed .fg{margin-bottom:10px}
.entp .ed .fg label{display:block;font-size:11px;color:#6b7280;margin-bottom:3px}
.entp .ed .fg .inp{border:1px solid #d7dce3;border-radius:9px;padding:8px 10px;font-size:13px;background:#f9fafb;color:#1f2937}
.entp .ed .row2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.entp .ed .qa{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
.entp .ed .qa button{display:flex;align-items:center;gap:7px;justify-content:center;border:1px solid #e3e7ed;border-radius:9px;padding:9px;font-size:12px;font-weight:600;cursor:pointer;background:#fff;color:#374151}
.entp .ed .qa button.ok{background:#eafaf0;border-color:#bfead0;color:#16a34a}
.entp .ed .qa button.bl{background:#eef4ff;border-color:#cfe0ff;color:#2563eb}
.entp .ed .qa button.rd{background:#fdeeee;border-color:#f6cccc;color:#dc2626}
.entp .ed .foot{display:flex;gap:8px;margin-top:10px}
.entp .alert.act{outline:2px solid #2563eb;outline-offset:1px}
.entp .alert{cursor:pointer}
.entp .cal .refpick{border:1px solid #d7dce3;border-radius:8px;padding:5px 9px;font-size:12.5px;background:#fff;color:#374151}
.entp .flag{display:inline-flex;align-items:center;gap:5px;background:#eef4ff;color:#2563eb;border:1px solid #cfe0ff;border-radius:999px;padding:3px 10px;font-size:11.5px;font-weight:700;margin-left:8px}
.entp .flag a{cursor:pointer;text-decoration:underline}
.entp .nextit .dt{font-size:10.5px;color:#2563eb;font-weight:700}
.entp .plan h4{margin:12px 0 6px;font-size:13px;color:#374151}
.entp .plan .ro{display:flex;gap:10px;align-items:center;padding:8px;border:1px solid #eef1f5;border-radius:9px;margin-bottom:6px;background:#f9fafb}
.entp .plan .ro .sl{font-weight:800;color:#2563eb;font-size:13px;width:54px;flex:0 0 auto}
.entp .plan .ro .bd b{font-size:12.5px}.entp .plan .ro .bd small{display:block;color:#6b7280;font-size:11px}
.entp .plan .ro .tag{margin-left:auto;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#fff5e6;color:#b45309}
.entp .modbtns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.entp .modbtns button{flex:1;min-width:120px;border:1px solid #d7dce3;background:#fff;border-radius:9px;padding:9px;font-size:12.5px;font-weight:700;cursor:pointer;color:#374151}
.entp .modbtns button.pri{background:#2563eb;border-color:#2563eb;color:#fff}
/* Grilla de la semana (como Control de Inventario, pantalla adjunta) */
.entp .wkgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.entp .wkcell{border:1px solid #eef1f5;border-radius:10px;padding:10px 3px;text-align:center;background:#f9fafb;cursor:pointer}
.entp .wkcell.has{background:#eef4ff;border-color:#cfe0ff}
.entp .wkcell.today{outline:2px solid #2563eb;outline-offset:-1px}
.entp .wkcell .wd{font-size:10px;color:#6b7280;text-transform:uppercase}
.entp .wkcell .wn{font-size:17px;font-weight:800;color:#111827;margin:1px 0}
.entp .wkcell .wb{font-size:10px;font-weight:700;color:#2563eb;min-height:12px}
/* Mes por semanas (como Control de Inventario, pantalla adjunta) */
.entp .mwk{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid #eef1f5;border-radius:10px;padding:12px;margin:6px 0;background:#f9fafb;cursor:pointer}
.entp .mwk.has{background:#eef4ff;border-color:#cfe0ff}
.entp .mwk.cur{outline:2px solid #2563eb;outline-offset:-1px}
.entp .mwk .ml{font-size:12.5px;color:#374151;font-weight:600}
.entp .mwk .mn{font-size:12px;font-weight:700;color:#2563eb;white-space:nowrap}
@media print{body *{visibility:hidden}#printArea,#printArea *{visibility:visible}#printArea{position:absolute;left:0;top:0;width:100%}}
`;
function viewEntregasPlan(rango = 'hoy', ref = null, keep = null, opts = {}) {
  const silent = !!opts.silent;
  if (!silent) h(`<div class="entp"><style>${ENTP_CSS}</style><div id="epRoot">Cargando…</div></div>`);
  (async () => {
    let d = opts.data;
    if (!d) { try { d = await api('/panol/dashboard?rango=' + rango + (ref ? '&ref=' + ref : '')); } catch (e) { if (!silent && $('#epRoot')) $('#epRoot').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; } }
    if (!$('#epRoot')) return;
    const E = d.entregas;
    const rangoLabel = { hoy: 'hoy', semana: 'esta semana', mes: 'este mes' };
    const now = new Date(); const nowMs = now.getTime();
    const RES = id => 'RES-' + String(id).padStart(6, '0');
    const estadoDe = e => new Date(e.fecha_inicio).getTime() < nowMs ? ['Atrasada', 'atr'] : ['Confirmada', 'conf'];
    const baseD = ref ? new Date(ref + 'T12:00:00') : new Date();
    const isoDay = x => { const y = x.getFullYear(), m = ('0' + (x.getMonth() + 1)).slice(-2), dd = ('0' + x.getDate()).slice(-2); return `${y}-${m}-${dd}`; };
    const fFecha = t => { try { return new Date(t).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' }); } catch (e) { return ''; } };

    // ===== Alertas operativas (banderas por entrega, para poder filtrar) =====
    const esAtr = e => new Date(e.fecha_inicio).getTime() < nowMs;
    const esSinU = e => e.por_individualizar && (!e.unidades || !e.unidades.length);
    const conflSet = new Set();
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const a = E[i], b = E[j];
      if (new Date(a.fecha_inicio) < new Date(b.fecha_fin || b.fecha_inicio) && new Date(b.fecha_inicio) < new Date(a.fecha_fin || a.fecha_inicio)) { conflSet.add(i); conflSet.add(j); }
    }
    const atrasadas = E.filter(esAtr).length;
    const sinUnidad = E.filter(esSinU).length;
    const conflictos = conflSet.size;
    const vencidas = atrasadas; // sin gestión y fuera de plazo (aprox)
    const nAlert = atrasadas + vencidas + conflictos + sinUnidad;

    // Filtro activo por alerta operativa (null = todas).
    let filtro = keep && keep.filtro ? keep.filtro : null;
    const matchFiltro = (e, i) => !filtro
      || (filtro === 'atrasadas' && esAtr(e)) || (filtro === 'vencidas' && esAtr(e))
      || (filtro === 'conflictos' && conflSet.has(i)) || (filtro === 'sinUnidad' && esSinU(e));
    const idxVis = () => E.map((e, i) => i).filter(i => matchFiltro(E[i], i));

    // Selección preservada por N° de reserva (sobrevive al auto-refresh).
    let sel = (keep && keep.keepId != null) ? E.findIndex(e => e.id === keep.keepId) : (E.length ? 0 : -1);
    if (sel < 0 && E.length && !(keep && keep.keepId != null)) sel = 0;

    // ===== Urgencia por cercanía a la hora actual (vista Día) =====
    // Verde = lejos; amarillo = dentro de 4 h; rojo = dentro de 2 h o atrasada.
    const urgencia = e => {
      const diffH = (new Date(e.fecha_inicio).getTime() - nowMs) / 3600000;
      if (diffH <= 2) return { cls: 'u-rojo', lbl: diffH < 0 ? 'Atrasada' : 'Urgente · ≤ 2 h' };
      if (diffH <= 4) return { cls: 'u-amar', lbl: 'Pronto · ≤ 4 h' };
      return { cls: 'u-verde', lbl: 'A tiempo' };
    };

    // Vista DÍA: línea de tiempo vertical (como la pantalla adjunta), coloreada por urgencia.
    // Los solapamientos se reparten en columnas para que ninguna tarjeta tape a otra.
    const dayTimelineHtml = () => {
      const vis = idxVis();
      const leg = `<div class="ulegend"><span><i style="background:#22c55e"></i>A tiempo</span><span><i style="background:#f59e0b"></i>≤ 4 h</span><span><i style="background:#ef4444"></i>≤ 2 h / atrasada</span></div>`;
      if (!vis.length) return leg + '<p class="muted" style="font-size:12.5px;padding:8px">No hay entregas para este día' + (filtro ? ' con ese filtro' : '') + '.</p>';
      // Eje dinámico: incluye las horas reales (y 08–19 por defecto).
      const hrsArr = vis.map(i => { const x = new Date(E[i].fecha_inicio); return x.getHours() + x.getMinutes() / 60; });
      const h0 = Math.max(5, Math.min(8, Math.floor(Math.min(...hrsArr))));
      const h1 = Math.min(23, Math.max(19, Math.ceil(Math.max(...hrsArr)) + 1));
      const SPAN = h1 - h0, H = Math.max(600, SPAN * 62);   // 1 hora ≈ 62px
      const topPx = t => { const x = new Date(t); const hh = x.getHours() + x.getMinutes() / 60; return Math.max(0, Math.min(H - 10, (hh - h0) / SPAN * H)); };
      let hrs = ''; for (let hh = h0; hh <= h1; hh++) { const y = (hh - h0) / SPAN * H; hrs += `<div class="hr" style="top:${y}px">${('0' + hh).slice(-2)}:00</div>`; }
      // Reparto en columnas: cada pedido ocupa como MÁXIMO 1 hora (como la maqueta).
      const its = vis.map(i => { const s = new Date(E[i].fecha_inicio).getTime(); const f = s + 60 * 60000; return { i, s, f }; }).sort((a, b) => a.s - b.s);
      const colEnd = [];
      its.forEach(it => { let c = 0; while (c < colEnd.length && colEnd[c] > it.s) c++; it.col = c; colEnd[c] = it.f; });
      const ncol = Math.max(1, colEnd.length);
      const LEFT = 52; // ancho de la columna de horas
      const cards = its.map(it => {
        const e = E[it.i]; const u = urgencia(e); const top = topPx(e.fecha_inicio);
        const hgt = Math.min(H - top, 62);   // nunca más de 1 hora por pedido
        const wpct = 100 / ncol; const leftPct = it.col * wpct;
        return `<div class="ev ${u.cls} ${it.i === sel ? 'sel' : ''}" data-i="${it.i}"
          style="top:${top}px;height:${hgt}px;left:calc(${LEFT}px + ${leftPct}% - ${LEFT * leftPct / 100}px + 2px);width:calc(${wpct}% - ${LEFT * wpct / 100}px - 6px)">
          <div class="t1"><span>${RES(e.id)} · Entrega</span><span class="hrng">${fmtHora(e.fecha_inicio)}–${fmtHora(e.fecha_fin || e.fecha_inicio)}</span></div>
          <div class="t2">${escD(e.item)} (x1)${e.por_individualizar ? ' · por asignar' : ''}</div>
          <span class="bg">${u.lbl}</span></div>`;
      }).join('');
      const esHoyBase = !ref || ref === isoDay(new Date());
      const nh = now.getHours() + now.getMinutes() / 60;
      const nowL = (esHoyBase && nh >= h0 && nh <= h1) ? `<div class="nowl" style="top:${topPx(now)}px"><span class="lb">Ahora ${fmtHora(now)}</span></div>` : '';
      return leg + `<div class="vt" style="height:${H}px">${hrs}${cards}${nowL}</div>`;
    };

    // Vista SEMANA: grilla de 7 días desde la fecha base (clic → ver ese día).
    const weekGridHtml = () => {
      const l0 = new Date(baseD); l0.setHours(0, 0, 0, 0);
      const porDia = {}; E.forEach(e => { const k = isoDay(new Date(e.fecha_inicio)); porDia[k] = (porDia[k] || 0) + 1; });
      const hoyISO = isoDay(new Date());
      let cells = '';
      for (let i = 0; i < 7; i++) { const x = new Date(l0); x.setDate(l0.getDate() + i); const k = isoDay(x); const n = porDia[k] || 0;
        cells += `<div class="wkcell ${n ? 'has' : ''} ${k === hoyISO ? 'today' : ''}" data-day="${k}">
          <div class="wd">${x.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '')}</div>
          <div class="wn">${x.getDate()}</div><div class="wb">${n ? n + '📦' : ''}</div></div>`; }
      return `<div class="wkgrid">${cells}</div><p class="muted" style="font-size:11px;margin:10px 2px 0">Toca un día para ver sus entregas.</p>`;
    };

    // Vista MES: semanas que parten el día 1 (clic → ver esa semana por días).
    const monthWeeksHtml = () => {
      const y = baseD.getFullYear(), m = baseD.getMonth(); const ult = new Date(y, m + 1, 0).getDate(); const hoyISO = isoDay(new Date());
      let rows = '';
      for (let start = 1; start <= ult; start += 7) { const end = Math.min(start + 6, ult);
        const ini = new Date(y, m, start), fin = new Date(y, m, end);
        const n = E.filter(e => { const dd = new Date(e.fecha_inicio); return dd >= new Date(y, m, start, 0, 0, 0) && dd <= new Date(y, m, end, 23, 59, 59); }).length;
        const cur = (hoyISO >= isoDay(ini) && hoyISO <= isoDay(fin)); const mes = ini.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '');
        rows += `<div class="mwk ${n ? 'has' : ''} ${cur ? 'cur' : ''}" data-week="${isoDay(ini)}">
          <span class="ml">Desde ${start} ${mes} · ${start}–${end}</span><span class="mn">${n} entrega${n === 1 ? '' : 's'}</span></div>`; }
      return rows + `<p class="muted" style="font-size:11px;margin:10px 2px 0">Toca una semana para verla por días.</p>`;
    };

    const centerHtml = () => rango === 'hoy' ? dayTimelineHtml() : rango === 'semana' ? weekGridHtml() : monthWeeksHtml();

    const nextHtml = () => { const vis = idxVis(); return vis.length ? vis.map(i => {
      const e = E[i]; const [elab, ecls] = estadoDe(e);
      return `<div class="nextit" data-i="${i}"><div class="hr">${fmtHora(e.fecha_inicio)}</div>
        <div class="bd"><b>${RES(e.id)}</b><small>${escD(e.item)} (x1)</small><span class="dt">📅 ${fFecha(e.fecha_inicio)}</span></div>
        <span class="badge ${ecls}">${elab}</span></div>`;
    }).join('') : `<p class="muted" style="font-size:12.5px">No hay entregas para ${rangoLabel[rango]}${filtro ? ' con ese filtro' : ''}.</p>`; };

    const alertRow = (cls, ic, t, s, n, key) => `<div class="alert ${cls} ${filtro === key ? 'act' : ''}" data-flt="${key}"><div style="font-size:16px">${ic}</div><div><b>${t} (${n})</b><small>${s}</small></div><span class="n">›</span></div>`;
    const navLbl = rango === 'hoy'
      ? cap(baseD.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }))
      : rango === 'semana'
      ? 'Semana del ' + baseD.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      : cap(baseD.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }));

    $('#epRoot').innerHTML = `
      <div class="ehead">
        <div class="ti"><div class="tk">🚚</div><div><h1>Planificación y Ejecución de Entregas</h1>
          <p>Gestiona las entregas programadas, prepara pedidos, confirma retiros y controla el estado de las reservas.</p></div></div>
        <div class="btns"><button class="b gh" id="epHoy">📅 Hoy</button><button class="b pri" id="epAuto">✨ Automatizar planificación</button></div>
      </div>
      <div class="grid3">
        <div>
          <div class="pnl"><h3>⚠️ Alertas operativas (${nAlert}) ${filtro ? `<span class="flag">Filtrando · <a id="epFltClr">quitar</a></span>` : ''}</h3>
            ${alertRow('r', '📅', 'Entregas atrasadas', 'No retiradas en el horario programado.', atrasadas, 'atrasadas')}
            ${alertRow('o', '⏰', 'Reservas vencidas', 'Sin gestión y fuera del plazo.', vencidas, 'vencidas')}
            ${alertRow('y', '⚠️', 'Conflictos de horario', 'Entrega se superpone con otra.', conflictos, 'conflictos')}
            ${alertRow('p', '📦', 'Equipos no disponibles', 'Sin unidades disponibles para la fecha.', sinUnidad, 'sinUnidad')}
          </div>
          <div class="pnl" style="margin-top:12px"><h3>📅 Próximas entregas (${rangoLabel[rango]}) <span style="color:#6b7280;font-weight:600">${idxVis().length}</span></h3>
            <div id="epNext">${nextHtml()}</div>
          </div>
        </div>
        <div>
          <div class="pnl cal">
            <div class="caltop">
              <div class="nav"><button id="epPrev">‹</button><span class="mlab">📅 ${cap(baseD.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }))}</span><button id="epNext2">›</button></div>
              <div class="seg"><button data-r="hoy" class="${rango === 'hoy' ? 'on' : ''}">Día</button><button data-r="semana" class="${rango === 'semana' ? 'on' : ''}">Semana</button><button data-r="mes" class="${rango === 'mes' ? 'on' : ''}">Mes</button></div>
            </div>
            <div id="epCenter">${centerHtml()}</div>
          </div>
          <div class="chips">
            <div class="chip"><div class="v">${E.length}</div><div class="l">🚚 Programadas ${rangoLabel[rango]}</div></div>
            <div class="chip"><div class="v">${E.length - atrasadas}</div><div class="l">📦 Por entregar</div></div>
            <div class="chip"><div class="v">${atrasadas}</div><div class="l">⚠️ Atrasadas</div></div>
            <div class="chip"><div class="v">${d.entregas_hoy}</div><div class="l">✅ Entregadas hoy</div></div>
            <div class="chip"><div class="v">${d.devoluciones.length}</div><div class="l">↩️ Devoluciones</div></div>
          </div>
        </div>
        <div class="pnl ed"><div id="epEditor"></div></div>
      </div>`;

    // ===== Automatizar planificación: propone orden y horarios del día/semana/mes =====
    const proponerPlan = () => {
      if (!E.length) { openModal('<h3>✨ Planificación automática</h3><p class="muted">No hay entregas programadas para ' + rangoLabel[rango] + '.</p>'); return; }
      const ord = E.map((e, i) => ({ e, i })).sort((a, b) => new Date(a.e.fecha_inicio) - new Date(b.e.fecha_inicio));
      const porDia = {};
      ord.forEach(({ e }) => { const k = new Date(e.fecha_inicio).toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'short' }); (porDia[k] = porDia[k] || []).push(e); });
      const titulo = 'Planificación automática — ' + rangoLabel[rango];
      let cuerpo = '', texto = titulo.toUpperCase() + '\n' + 'Pañol Online · ' + new Date().toLocaleString('es-CL') + '\n';
      Object.keys(porDia).forEach(k => {
        const items = porDia[k];
        cuerpo += `<div class="plan"><h4>${cap(k)} · ${items.length} entrega${items.length === 1 ? '' : 's'}</h4>`;
        texto += `\n${cap(k)} (${items.length} entrega${items.length === 1 ? '' : 's'})\n`;
        let prevFin = null;
        items.forEach((e, n) => {
          const ini = new Date(e.fecha_inicio);
          const prep = new Date(ini.getTime() - 30 * 60000);   // preparar 30 min antes
          const choque = prevFin && ini < prevFin;
          const sug = choque ? ' · escalonar +15 min' : '';
          const estado = e.por_individualizar && (!e.unidades || !e.unidades.length) ? 'asignar unidad' : esAtr(e) ? 'atrasada' : '';
          const tag = estado ? `<span class="tag" ${estado === 'atrasada' ? 'style="background:#fdeeee;color:#dc2626"' : ''}>${estado}</span>` : '';
          cuerpo += `<div class="ro"><div class="sl">${fmtHora(ini)}</div>
            <div class="bd"><b>${n + 1}. ${RES(e.id)} — ${escD(e.item)}</b>
            <small>${escD(e.estudiante)} · preparar antes de ${fmtHora(prep)}${sug}</small></div>${tag}</div>`;
          texto += `  ${fmtHora(ini)}  ${n + 1}. ${RES(e.id)} — ${e.item} · ${e.estudiante} · preparar antes de ${fmtHora(prep)}${sug}${estado ? ' [' + estado + ']' : ''}\n`;
          prevFin = new Date(e.fecha_fin || e.fecha_inicio);
        });
        cuerpo += `</div>`;
      });
      const html = `<div id="printArea"><h3>✨ ${titulo}</h3>
        <p class="muted" style="margin-top:0;font-size:12.5px">Propuesta de orden de preparación y horarios. No modifica las reservas; es una guía para el pañol.</p>
        ${cuerpo}</div>
        <div class="modbtns"><button id="epPlanPrint">🖨️ Imprimir</button><button id="epPlanMail">✉️ Enviar por correo</button><button class="pri" id="epPlanOk">Entendido</button></div>`;
      openModal(html);
      if ($('#epPlanOk')) $('#epPlanOk').onclick = closeModal;
      if ($('#epPlanPrint')) $('#epPlanPrint').onclick = () => {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(`<html><head><title>${titulo}</title><meta charset="utf8"><style>body{font-family:system-ui,Arial;margin:24px;color:#1f2937}h1{font-size:18px}h2{font-size:14px;margin:16px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,monospace}</style></head><body><h1>${titulo}</h1><pre>${escD(texto)}</pre></body></html>`);
          w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
        } else { window.print(); }
      };
      if ($('#epPlanMail')) $('#epPlanMail').onclick = () => {
        const asunto = encodeURIComponent('Pañol Online · ' + titulo);
        const body = encodeURIComponent(texto);
        window.location.href = `mailto:?subject=${asunto}&body=${body}`;
      };
    };

    const renderEditor = () => {
      const e = E[sel];
      if (!e) { $('#epEditor').innerHTML = '<p class="muted" style="font-size:13px">Selecciona una entrega en la lista o en “Próximas entregas”.</p>'; return; }
      const [elab] = estadoDe(e);
      const fecha = new Date(e.fecha_inicio);
      $('#epEditor').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b style="font-size:15px">✏️ Entrega programada</b><button class="dots" id="epClose" style="border:0;background:transparent;cursor:pointer;color:#9aa3af;font-size:18px">×</button></div>
        <div class="edtabs"><button class="on" data-t="datos">Datos de entrega</button><button data-t="equipos">Equipos / Kit</button><button data-t="hist">Historial</button></div>
        <div id="edBody"></div>`;
      const tabs = {
        datos: `
          <div class="row2"><div class="fg"><label>N° de reserva *</label><div class="inp">${RES(e.id)}</div></div>
            <div class="fg"><label>Estado *</label><div class="inp">⏳ ${elab}</div></div></div>
          <div class="fg"><label>Estudiante *</label><div class="inp">${escD(e.estudiante)}</div></div>
          <div class="fg"><label>Asignatura *</label><div class="inp">${escD(e.asignatura)}</div></div>
          <div class="row2"><div class="fg"><label>Equipo / Kit *</label><div class="inp">${escD(e.item)}</div></div>
            <div class="fg"><label>Cantidad *</label><div class="inp">1</div></div></div>
          <div class="row2"><div class="fg"><label>Sede *</label><div class="inp">${escD((ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa')}</div></div>
            <div class="fg"><label>Responsable *</label><div class="inp">${escD(ME.user.nombre)}</div></div></div>
          <div class="row2"><div class="fg"><label>Fecha *</label><div class="inp">${fecha.toLocaleDateString('es-CL')}</div></div>
            <div class="fg"><label>Hora de retiro *</label><div class="inp">${fmtHora(e.fecha_inicio)}</div></div></div>
          <div class="fg"><label>Hora de devolución *</label><div class="inp">${fmtHora(e.fecha_fin || e.fecha_inicio)}</div></div>
          <div style="font-weight:700;font-size:12.5px;margin:10px 0 2px">⚡ Acciones rápidas</div>
          <div class="qa">
            <button class="ok" id="epConf">✅ Confirmar entrega</button>
            <button class="bl" id="epPrep">📦 Preparar pedido</button>
            <button id="epReprog">📅 Reprogramar</button>
            <button class="rd" id="epCanc">✖ Cancelar</button>
            <button id="epParc">📝 Registrar entrega parcial</button>
            <button id="epScan">🔳 Escanear / Validar equipo</button>
          </div>
          <div class="foot"><button class="b gh" style="flex:1" id="epClose2">Cancelar</button><button class="b pri" style="flex:1" id="epSave">Guardar cambios</button></div>`,
        equipos: `<div class="fg"><label>Ítem reservado</label><div class="inp">${escD(e.item)} (x1)</div></div>
          ${e.por_individualizar ? `<p class="muted" style="font-size:12.5px">Reserva por categoría — el pañol asigna la unidad al entregar. Unidades disponibles: <b>${(e.unidades ? e.unidades.length : 0)}</b>.</p>` : `<div class="fg"><label>Unidad asignada</label><div class="inp">${escD(e.equipo || '—')}${e.codigo_qr ? ' · ' + escD(e.codigo_qr) : ''}</div></div>`}`,
        hist: `<p class="muted" style="font-size:12.5px">Reserva ${RES(e.id)} · estado ${elab}.<br>Retiro programado ${fmtHora(e.fecha_inicio)} · devolución ${fmtHora(e.fecha_fin || e.fecha_inicio)}.</p>`,
      };
      const showTab = t => {
        $('#edBody').innerHTML = tabs[t];
        $('#epEditor').querySelectorAll('.edtabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
        if (t === 'datos') {
          $('#epConf').onclick = () => modalEntregar(e);
          $('#epScan').onclick = () => modalEntregar(e);
          $('#epReprog').onclick = () => toast('Reprogramar: disponible desde la agenda de la reserva');
          $('#epPrep').onclick = () => toast('Pedido marcado como preparado (demo)');
          $('#epParc').onclick = () => toast('Entrega parcial: usa "Entregar" por unidad');
          $('#epCanc').onclick = () => toast('Para cancelar, gestiona la reserva del estudiante');
          $('#epSave').onclick = () => toast('Sin cambios que guardar');
          const cl = () => { sel = -1; renderEditorEmpty(); };
          if ($('#epClose')) $('#epClose').onclick = cl;
          if ($('#epClose2')) $('#epClose2').onclick = cl;
        }
      };
      $('#epEditor').querySelectorAll('.edtabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
      showTab('datos');
    };
    const renderEditorEmpty = () => { $('#epEditor').innerHTML = '<p class="muted" style="font-size:13px">Selecciona una entrega en la lista o en “Próximas entregas”. En Semana o Mes, toca un día/semana para ver el detalle.</p>'; };

    const renderCenter = () => { $('#epCenter').innerHTML = centerHtml(); bindCenter(); };
    const bindCenter = () => {
      // Día: seleccionar una entrega (tarjeta de la línea de tiempo).
      $('#epRoot').querySelectorAll('#epCenter .ev').forEach(b => b.onclick = () => selectIdx(Number(b.dataset.i)));
      // Semana: clic en un día → ver ese día.
      $('#epRoot').querySelectorAll('#epCenter .wkcell[data-day]').forEach(b => b.onclick = () => viewEntregasPlan('hoy', b.dataset.day, { filtro }));
      // Mes: clic en una semana → ver esa semana por días.
      $('#epRoot').querySelectorAll('#epCenter .mwk[data-week]').forEach(b => b.onclick = () => viewEntregasPlan('semana', b.dataset.week, { filtro }));
    };
    const selectIdx = i => { sel = i; renderCenter(); renderEditor(); DASHVIEW.keepId = E[sel] ? E[sel].id : null; };
    bindCenter();
    $('#epRoot').querySelectorAll('#epNext .nextit').forEach(b => b.onclick = () => selectIdx(Number(b.dataset.i)));
    // Tabs Día / Semana / Mes (la semana/el mes parten en la fecha actual).
    // Actualización silenciosa (sin "Cargando…"): mantiene la vista actual hasta que llegan los datos.
    $('#epRoot').querySelectorAll('.cal .seg button').forEach(b => b.onclick = () => viewEntregasPlan(b.dataset.r, null, null, { silent: true }));
    // Navegación ‹ › (día ±1, semana ±7, mes ±1).
    const shift = dir => { const x = new Date(baseD); if (rango === 'mes') x.setMonth(x.getMonth() + dir); else x.setDate(x.getDate() + dir * (rango === 'semana' ? 7 : 1)); viewEntregasPlan(rango, isoDay(x), { filtro }, { silent: true }); };
    if ($('#epPrev')) $('#epPrev').onclick = () => shift(-1);
    if ($('#epNext2')) $('#epNext2').onclick = () => shift(1);
    if ($('#epHoy')) $('#epHoy').onclick = () => viewEntregasPlan('hoy', null, null, { silent: true });
    if ($('#epAuto')) $('#epAuto').onclick = proponerPlan;
    // Filtros de alertas operativas (clic para filtrar, clic de nuevo para quitar).
    $('#epRoot').querySelectorAll('.alert[data-flt]').forEach(a => a.onclick = () => {
      const f = a.dataset.flt; viewEntregasPlan(rango, ref, { keepId: E[sel] ? E[sel].id : null, filtro: filtro === f ? null : f }, { silent: true });
    });
    if ($('#epFltClr')) $('#epFltClr').onclick = () => viewEntregasPlan(rango, ref, { keepId: E[sel] ? E[sel].id : null, filtro: null }, { silent: true });
    if (rango === 'hoy' && E.length && sel >= 0) renderEditor(); else renderEditorEmpty();

    // Panel activo + actualización automática/online (silenciosa) de los cambios de estado.
    DASHVIEW = { fn: 'ep', rango, ref, keepId: E[sel] ? E[sel].id : null, filtro, sig: dashSig(d) };
    startDashPoll('ep');
  })();
}

// ===================== Historial de entregas (dashboard de gestión) =====================
const HIST_CSS = `
.hist{color:#0f172a}
.hist .hhd{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.hist .hhd h1{margin:0;font-size:22px;font-weight:800;color:#0f172a}
.hist .hhd p{margin:3px 0 0;color:#64748b;font-size:13px}
.hist .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
@media(max-width:1000px){.hist .kpis{grid-template-columns:repeat(2,1fr)}}
.hist .k{position:relative;border-radius:14px;padding:16px;border:1px solid #eceff4;display:flex;gap:12px;align-items:flex-start;cursor:pointer;transition:transform .08s}
.hist .k:hover{transform:translateY(-1px)}
.hist .k.sel{outline:3px solid #0d9488;outline-offset:1px}
.hist .k .ic{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex:0 0 auto}
.hist .k .lb{font-size:12.5px;color:#475569;font-weight:600}
.hist .k .vl{font-size:30px;font-weight:800;line-height:1.05;margin:2px 0}
.hist .k .sb{font-size:11.5px;color:#64748b}
.hist .k .tr{position:absolute;right:14px;top:16px;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px}
.hist .k.g{background:#eefaf2}.hist .k.g .ic{background:#d7f3e1;color:#15803d}.hist .k.g .vl{color:#15803d}.hist .k.g .tr{background:#d7f3e1;color:#15803d}
.hist .k.b{background:#eef4fe}.hist .k.b .ic{background:#d8e6fd;color:#2563eb}.hist .k.b .vl{color:#1d4ed8}.hist .k.b .tr{background:#d8e6fd;color:#2563eb}
.hist .k.r{background:#fdeeee}.hist .k.r .ic{background:#fbd9d9;color:#dc2626}.hist .k.r .vl{color:#dc2626}.hist .k.r .tr{background:#fbd9d9;color:#dc2626}
.hist .k.a{background:#fef4e6}.hist .k.a .ic{background:#fbe4c2;color:#b45309}.hist .k.a .vl{color:#b45309}.hist .k.a .tr{background:#fbe4c2;color:#b45309}
.hist .filt{background:#fff;border:1px solid #eceff4;border-radius:14px;padding:12px 16px;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px}
.hist .filt .ft{display:flex;align-items:center;gap:8px;color:#334155;font-weight:700;font-size:13px;padding-bottom:7px}
.hist .filt .fg{display:flex;flex-direction:column;gap:3px;min-width:150px}
.hist .filt .fg label{font-size:11px;color:#64748b}
.hist .filt select,.hist .filt input{height:38px;box-sizing:border-box;border:1px solid #d7dce3;border-radius:9px;padding:8px 10px;font-size:13px;background:#fff;color:#0f172a;font-family:inherit;width:100%}
.hist .filt .clr{margin-left:auto;color:#0d9488;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;padding-bottom:8px;white-space:nowrap}
.hist .tbar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.hist .tbar .srch{flex:1;min-width:220px;position:relative}
.hist .tbar .srch input{width:100%;box-sizing:border-box;height:40px;border:1px solid #d7dce3;border-radius:10px;padding:8px 12px 8px 34px;font-size:13px;background:#fff;font-family:inherit}
.hist .tbar .srch::before{content:"🔎";position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:13px;opacity:.6}
.hist .tbar .b{height:40px;border:1px solid #d7dce3;background:#fff;border-radius:10px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer;color:#334155;display:flex;align-items:center;gap:7px}
.hist .tbar .b.tl{background:#0d9488;border-color:#0d9488;color:#fff}
/* Tabla + panel de detalle al costado derecho (se apila en pantallas angostas). */
.hist .grid{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:14px;align-items:start}
@media(max-width:1150px){.hist .grid{grid-template-columns:1fr}}
.hist .card{background:#fff;border:1px solid #eceff4;border-radius:14px;overflow:hidden}
.hist .tw{overflow-x:auto}
.hist table{width:100%;border-collapse:collapse;min-width:720px}
.hist thead th{text-align:left;font-size:11px;color:#64748b;font-weight:700;padding:11px 12px;border-bottom:1px solid #eef1f5;white-space:nowrap;text-transform:none}
.hist tbody td{padding:11px 12px;border-bottom:1px solid #f3f5f8;font-size:13px;color:#1f2937;vertical-align:middle}
.hist tbody tr{cursor:pointer}
.hist tbody tr:hover{background:#f8fafc}
.hist tbody tr.sel{background:#e9f7f4;box-shadow:inset 3px 0 0 #0d9488}
.hist .al b{display:block;font-weight:700}.hist .al small{color:#64748b;font-size:11.5px}
.hist .rz{color:#0d9488;font-weight:700}
.hist .eq{display:flex;align-items:center;gap:8px}
.hist .eq .ei{width:26px;height:26px;border-radius:7px;background:#eef2f7;display:flex;align-items:center;justify-content:center;font-size:13px;flex:0 0 auto}
.hist .fdt b{display:block;font-weight:600}.hist .fdt small{color:#94a3b8;font-size:11px}
.hist .pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap}
.hist .pill.ok{background:#e7f8ee;color:#15803d}
.hist .pill.pend{background:#fef3e2;color:#b45309}
.hist .pill.atr{background:#fdecec;color:#dc2626}
.hist .pill.inc{background:#fff2e0;color:#c2410c}
.hist .acts{display:flex;gap:4px}
.hist .acts button{width:30px;height:30px;border:1px solid #e6e9ef;background:#fff;border-radius:8px;cursor:pointer;color:#475569;font-size:13px}
.hist .acts button:hover{background:#f1f5f9}
.hist .pag{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px}
.hist .pag .pg{display:flex;gap:4px;align-items:center}
.hist .pag .pg button{min-width:32px;height:32px;border:1px solid #e6e9ef;background:#fff;border-radius:8px;cursor:pointer;font-size:12.5px;color:#334155;padding:0 8px}
.hist .pag .pg button.on{background:#0d9488;border-color:#0d9488;color:#fff;font-weight:700}
.hist .pag .pg button:disabled{opacity:.45;cursor:default}
.hist .pag .mut{color:#64748b;font-size:12.5px}
/* Panel de detalle lateral */
.hist .dp{background:#fff;border:1px solid #eceff4;border-radius:14px;padding:16px;position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto}
.hist .dp .kgrid{display:grid;grid-template-columns:1fr;gap:6px}
.hist .dp .kgrid.one{grid-template-columns:1fr}
.hist .dp .kv .l{color:#64748b;display:block;font-size:11px}
.hist .dp .sech{font-size:12px;font-weight:800;color:#0f172a;text-transform:none;margin-bottom:4px;display:flex;align-items:center;gap:6px}
.hist .dp .dh{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.hist .dp .dh b{font-size:15px}
.hist .dp .x{border:0;background:transparent;font-size:18px;color:#94a3b8;cursor:pointer}
.hist .dp .idrow{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
.hist .dp .idrow .cod{font-size:17px;font-weight:800}
.hist .dp .kv{font-size:12.5px;color:#334155;margin:6px 0}
.hist .dp .kv b{color:#0f172a}
.hist .dp .sec{border-top:1px solid #eef1f5;margin-top:12px;padding-top:12px}
.hist .dp .eqi{display:flex;align-items:center;gap:9px;padding:7px 0}
.hist .dp .eqi .ei{width:30px;height:30px;border-radius:8px;background:#eef2f7;display:flex;align-items:center;justify-content:center}
.hist .dp .eqi b{font-size:12.5px;display:block}.hist .dp .eqi small{display:block;color:#64748b;font-size:11px}
.hist .dp .obs{background:#f8fafc;border:1px solid #eef1f5;border-radius:9px;padding:9px;font-size:12px;color:#64748b;min-height:40px}
.hist .dp .btn{width:100%;border:0;border-radius:10px;padding:11px;font-size:13.5px;font-weight:700;cursor:pointer;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:7px}
.hist .dp .btn.tl{background:#0d9488;color:#fff}
.hist .dp .btn.gh{background:#fff;border:1px solid #d7dce3;color:#334155}
.hist .dp .empty{color:#94a3b8;font-size:13px;text-align:center;padding:30px 10px}
/* ===== Detalle completo (pantalla 2) ===== */
.hist .det .dhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.hist .det .dtt{display:flex;gap:12px;align-items:center}
.hist .det .dtt .tk{width:46px;height:46px;border-radius:12px;background:#e9f7f4;color:#0d9488;display:flex;align-items:center;justify-content:center;font-size:22px}
.hist .det .dtt h1{margin:0;font-size:21px;font-weight:800}
.hist .det .dtt p{margin:2px 0 0;color:#64748b;font-size:12.5px}
.hist .det .dbtns{display:flex;gap:8px;flex-wrap:wrap}
.hist .det .b{height:38px;border:1px solid #d7dce3;background:#fff;border-radius:9px;padding:0 13px;font-size:12.5px;font-weight:700;cursor:pointer;color:#334155;display:flex;align-items:center;gap:7px}
.hist .det .b.tl{background:#0d9488;border-color:#0d9488;color:#fff}
.hist .det .stp{display:flex;align-items:center;background:#fff;border:1px solid #eceff4;border-radius:14px;padding:16px;gap:6px;margin-bottom:14px;overflow-x:auto}
.hist .det .stp .st{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:120px;flex:1}
.hist .det .stp .st .c{width:40px;height:40px;border-radius:50%;background:#e9f7f4;color:#0d9488;display:flex;align-items:center;justify-content:center;font-size:18px;position:relative}
.hist .det .stp .st .c .chk{position:absolute;right:-3px;bottom:-3px;width:17px;height:17px;border-radius:50%;background:#16a34a;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
.hist .det .stp .st .t{font-weight:700;font-size:12.5px}
.hist .det .stp .st .d{font-size:11px;color:#64748b;text-align:center}
.hist .det .stp .ln{height:2px;background:#cbe7e1;flex:1;min-width:20px;margin-top:-28px}
.hist .det .cols{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:14px}
@media(max-width:1000px){.hist .det .cols{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.hist .det .cols{grid-template-columns:1fr}}
.hist .det .ic2{background:#fff;border:1px solid #eceff4;border-radius:12px;padding:14px}
.hist .det .ic2 .hd{display:flex;align-items:center;gap:8px;color:#334155;font-weight:700;font-size:13px;margin-bottom:9px}
.hist .det .ic2 .big{font-size:14.5px;font-weight:700}
.hist .det .ic2 small{display:block;color:#64748b;font-size:11.5px;margin-top:2px}
.hist .det .ic2 .ln2{font-size:12.5px;color:#334155;margin:4px 0}
.hist .det .main2{display:grid;grid-template-columns:1.6fr 1fr;gap:12px;align-items:start}
@media(max-width:1000px){.hist .det .main2{grid-template-columns:1fr}}
.hist .det .box{background:#fff;border:1px solid #eceff4;border-radius:12px;padding:16px;margin-bottom:12px}
.hist .det .box h3{margin:0 0 10px;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}
.hist .det table.eq2{width:100%;border-collapse:collapse;min-width:480px}
.hist .det .eq2 th{text-align:left;font-size:11px;color:#64748b;font-weight:700;padding:8px 10px;border-bottom:1px solid #eef1f5}
.hist .det .eq2 td{padding:10px;border-bottom:1px solid #f3f5f8;font-size:12.5px}
.hist .det .cond{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.hist .det .cond .dot{width:8px;height:8px;border-radius:50%;background:#16a34a}
.hist .det .sign{background:#e7f8ee;border:1px solid #c7ecd4;border-radius:10px;padding:11px;font-size:12.5px;color:#15803d;margin-bottom:10px;display:flex;gap:8px;align-items:flex-start}
.hist .det .sg{display:flex;justify-content:space-between;align-items:center;border:1px dashed #cbd5e1;border-radius:10px;padding:12px}
.hist .det .sg .nm{font-family:'Segoe Script','Brush Script MT',cursive;font-size:20px;color:#334155}
.hist .det .rsum{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
@media(max-width:700px){.hist .det .rsum{grid-template-columns:1fr}}
.hist .det .rsum .rc{display:flex;gap:10px;align-items:center;border:1px solid #eceff4;border-radius:11px;padding:12px}
.hist .det .rsum .rc .ri{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;background:#eef2f7}
.hist .det .rsum .rc b{font-size:17px;font-weight:800;display:block}.hist .det .rsum .rc small{display:block;color:#64748b;font-size:11.5px}
.hist .det .inc{background:#e7f8ee;border:1px solid #c7ecd4;border-radius:10px;padding:11px;font-size:12.5px;color:#15803d;display:flex;gap:8px;align-items:center}
.hist .det .inc.bad{background:#fdecec;border-color:#f6cccc;color:#dc2626}
`;
let HIST = null;
const ESTADOS = {
  entregada: ['ok', '✔️', 'Entregada'], completada: ['ok', '✔️', 'Completada'],
  pendiente: ['pend', '⏳', 'Pendiente'], atrasada: ['atr', '⏰', 'Atrasada'], incidencia: ['inc', '⚠️', 'Incidencia']
};
function fFechaDos(t) { if (!t) return '<span style="color:#cbd5e1">—</span>'; try { const d = new Date(t); return `<b>${d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}</b><small>${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</small>`; } catch (e) { return '—'; } }
function fFechaHora(t) { if (!t) return '—'; try { const d = new Date(t); return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }

async function viewHistorialEntregas() {
  h(`<div class="hist"><style>${HIST_CSS}</style><div id="histRoot">Cargando…</div></div>`);
  let d;
  try { d = await api('/entregas/historial'); } catch (e) { $('#histRoot').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
  const rows = Array.isArray(d) ? d : (d.rows || []);
  const kpis = (d && d.kpis) || { realizadas: rows.length, pendientes: 0, atrasadas: 0, incidencias: 0 };
  HIST = { rows, kpis, page: 1, perPage: 8, sel: null, fEstado: 'todos', fResp: 'todos', fDesde: '', fHasta: '', q: '', fKpi: null };
  renderHist();
}

function histFiltradas() {
  const H = HIST; const q = (H.q || '').toLowerCase();
  return H.rows.filter(r => {
    if (H.fKpi === 'realizadas' && r.id == null) return false;              // realizadas = con préstamo
    if (H.fKpi === 'pendientes' && r.id != null) return false;             // pendientes = sin préstamo
    if (H.fKpi === 'atrasadas' && r.estado !== 'atrasada') return false;
    if (H.fKpi === 'incidencias' && !r.incidencia) return false;
    if (H.fEstado !== 'todos' && r.estado !== H.fEstado) return false;
    if (H.fResp !== 'todos' && (r.panolero || '') !== H.fResp) return false;
    if (H.fDesde && (!r.programada || new Date(r.programada) < new Date(H.fDesde))) return false;
    if (H.fHasta && (!r.programada || new Date(r.programada) > new Date(H.fHasta + 'T23:59:59'))) return false;
    if (q && !((r.cod + ' ' + (r.estudiante || '') + ' ' + (r.reserva_cod || '') + ' ' + (r.equipo || '') + ' ' + (r.asignatura || '')).toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderHist() {
  const H = HIST; const k = H.kpis;
  const resp = [...new Set(H.rows.map(r => r.panolero).filter(Boolean))];
  $('#histRoot').innerHTML = `
    <div class="hhd"><div><h1>Historial de entregas</h1><p>Registro y trazabilidad de todas las entregas realizadas por el pañol.</p></div></div>
    <div class="kpis">
      <div class="k g ${H.fKpi === 'realizadas' ? 'sel' : ''}" data-kpi="realizadas"><div class="ic">✅</div><div><div class="lb">Entregas realizadas</div><div class="vl">${k.realizadas.toLocaleString('es-CL')}</div><div class="sb">Total del período</div></div></div>
      <div class="k b ${H.fKpi === 'pendientes' ? 'sel' : ''}" data-kpi="pendientes"><div class="ic">📅</div><div><div class="lb">Entregas pendientes</div><div class="vl">${k.pendientes}</div><div class="sb">Por entregar</div></div></div>
      <div class="k r ${H.fKpi === 'atrasadas' ? 'sel' : ''}" data-kpi="atrasadas"><div class="ic">⏰</div><div><div class="lb">Entregas atrasadas</div><div class="vl">${k.atrasadas}</div><div class="sb">Fuera del horario programado</div></div></div>
      <div class="k a ${H.fKpi === 'incidencias' ? 'sel' : ''}" data-kpi="incidencias"><div class="ic">⚠️</div><div><div class="lb">Incidencias</div><div class="vl">${k.incidencias}</div><div class="sb">Con observaciones o daños</div></div></div>
    </div>
    <div class="filt">
      <div class="ft">🔽 Filtros</div>
      <div class="fg"><label>Desde</label><input type="date" id="hDesde" value="${H.fDesde}"></div>
      <div class="fg"><label>Hasta</label><input type="date" id="hHasta" value="${H.fHasta}"></div>
      <div class="fg"><label>Estado</label><select id="hEstado">
        <option value="todos">Todos</option><option value="entregada">Entregada</option><option value="completada">Completada</option>
        <option value="pendiente">Pendiente</option><option value="atrasada">Atrasada</option><option value="incidencia">Incidencia</option></select></div>
      <div class="fg"><label>Sede</label><select><option>${escD((ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa')}</option></select></div>
      <div class="fg"><label>Responsable</label><select id="hResp"><option value="todos">Todos</option>${resp.map(x => `<option${x === H.fResp ? ' selected' : ''}>${escD(x)}</option>`).join('')}</select></div>
      <a class="clr" id="hClr">↻ Limpiar filtros</a>
    </div>
    <div class="tbar">
      <div class="srch"><input id="hQ" placeholder="Buscar en el historial (ID, alumno, reserva, equipo, asignatura…)" value="${escD(H.q)}"></div>
      <button class="b" id="hExport">⬇️ Exportar</button>
      <button class="b tl" id="hComp">🖨️ Descargar comprobante</button>
    </div>
    <div class="grid">
      <div class="card"><div class="tw"><table>
        <thead><tr><th>ID entrega</th><th>Alumno</th><th>Reserva</th><th>Equipos</th><th>Fecha programada</th><th>Fecha realizada</th><th>Responsable</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody id="hBody"></tbody></table></div>
        <div class="pag" id="hPag"></div>
      </div>
      <div id="hDetail"></div>
    </div>`;
  // Eventos de filtros
  $('#hEstado').value = H.fEstado;
  $('#hEstado').onchange = () => { H.fEstado = $('#hEstado').value; H.page = 1; renderHistBody(); };
  $('#hResp').onchange = () => { H.fResp = $('#hResp').value; H.page = 1; renderHistBody(); };
  $('#hDesde').onchange = () => { H.fDesde = $('#hDesde').value; H.page = 1; renderHistBody(); };
  $('#hHasta').onchange = () => { H.fHasta = $('#hHasta').value; H.page = 1; renderHistBody(); };
  $('#hQ').oninput = () => { H.q = $('#hQ').value; H.page = 1; renderHistBody(); };
  $('#hClr').onclick = () => { H.fEstado = 'todos'; H.fResp = 'todos'; H.fDesde = ''; H.fHasta = ''; H.q = ''; H.fKpi = null; H.page = 1; renderHist(); };
  // Tarjetas KPI como filtros del dashboard (clic para filtrar, clic de nuevo para quitar).
  $('#histRoot').querySelectorAll('.k[data-kpi]').forEach(c => c.onclick = () => {
    const kp = c.dataset.kpi; H.fKpi = (H.fKpi === kp) ? null : kp; H.page = 1; renderHist();
  });
  $('#hExport').onclick = exportHistCSV;
  $('#hComp').onclick = () => { if (H.sel) comprobante(H.sel); else toast('Selecciona una entrega para su comprobante'); };
  renderHistBody();
  renderDetail();
}

function renderHistBody() {
  const H = HIST; const lista = histFiltradas();
  const total = lista.length, pp = H.perPage, pages = Math.max(1, Math.ceil(total / pp));
  if (H.page > pages) H.page = pages;
  const a = (H.page - 1) * pp, b = Math.min(total, a + pp);
  const pageRows = lista.slice(a, b);
  $('#hBody').innerHTML = pageRows.length ? pageRows.map(r => {
    const [cls, ic, lbl] = ESTADOS[r.estado] || ['pend', '•', r.estado];
    return `<tr data-cod="${escD(r.cod)}" class="${H.sel && H.sel.cod === r.cod ? 'sel' : ''}">
      <td style="font-weight:700">${escD(r.cod)}</td>
      <td class="al"><b>${escD(r.estudiante || '—')}</b><small>${escD(r.asignatura || r.categoria || '—')}</small></td>
      <td>${r.reserva_cod ? `<span class="rz">${escD(r.reserva_cod)}</span>` : '—'}</td>
      <td><div class="eq"><span class="ei">${icon(r.categoria || r.equipo)}</span><div><b style="font-weight:600">${escD(r.equipo || r.categoria || '—')}</b></div></div></td>
      <td class="fdt">${fFechaDos(r.programada)}</td>
      <td class="fdt">${fFechaDos(r.realizada)}</td>
      <td>${escD(r.panolero || '—')}</td>
      <td><span class="pill ${cls}">${ic} ${lbl}</span></td>
      <td><div class="acts"><button data-act="ver" title="Ver detalle">👁️</button><button data-act="comp" title="Comprobante">⬇️</button><button data-act="mas" title="Más">⋯</button></div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="9" class="muted" style="padding:22px;text-align:center;color:#94a3b8">No hay entregas que coincidan con los filtros.</td></tr>`;

  // Paginación
  const nums = []; const win = 2;
  for (let p = 1; p <= pages; p++) { if (p === 1 || p === pages || Math.abs(p - H.page) <= win) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…'); }
  $('#hPag').innerHTML = `<div class="mut">Mostrando ${total ? a + 1 : 0}–${b} de ${total.toLocaleString('es-CL')} entregas</div>
    <div class="pg"><button ${H.page <= 1 ? 'disabled' : ''} data-pg="prev">← Anterior</button>
    ${nums.map(n => n === '…' ? `<span class="mut" style="padding:0 4px">…</span>` : `<button data-pg="${n}" class="${n === H.page ? 'on' : ''}">${n}</button>`).join('')}
    <button ${H.page >= pages ? 'disabled' : ''} data-pg="next">Siguiente →</button></div>
    <div class="mut">Filas por página:
      <select id="hPp" style="height:30px;border:1px solid #e6e9ef;border-radius:7px;margin-left:4px">${[8, 15, 25, 50].map(n => `<option${n === pp ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`;

  // Bindings de filas y acciones
  $('#hBody').querySelectorAll('tr[data-cod]').forEach(tr => {
    const r = lista.find(x => x.cod === tr.dataset.cod);
    tr.onclick = (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'ver') return viewEntregaDetalle(r);
      if (act === 'comp') return comprobante(r);
      if (act === 'mas') return;
      HIST.sel = r; renderHistBody(); renderDetail();
    };
  });
  $('#hPag').querySelectorAll('button[data-pg]').forEach(b2 => b2.onclick = () => {
    const v = b2.dataset.pg; if (v === 'prev') H.page--; else if (v === 'next') H.page++; else H.page = Number(v);
    renderHistBody();
  });
  if ($('#hPp')) $('#hPp').onchange = () => { H.perPage = Number($('#hPp').value); H.page = 1; renderHistBody(); };
}

function renderDetail() {
  const r = HIST.sel;
  const el = $('#hDetail'); if (!el) return;
  if (!r) { el.innerHTML = `<div class="dp"><div class="dh"><b>Detalle de entrega</b></div><div class="empty">Selecciona una entrega de la tabla para ver su detalle.</div></div>`; return; }
  const [cls, ic, lbl] = ESTADOS[r.estado] || ['pend', '•', r.estado];
  const sede = (ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa';
  const accionBtn = r.estado === 'pendiente' || r.estado === 'atrasada'
    ? `<button class="btn tl" id="dReg">✔️ Registrar entrega</button>` : '';
  // Duración (entrega → devolución)
  let durTxt = '—';
  if (r.realizada && r.fecha_retorno) { const min = Math.max(0, Math.round((new Date(r.fecha_retorno) - new Date(r.realizada)) / 60000)); durTxt = Math.floor(min / 60) + ' h ' + (min % 60) + ' min'; }
  const kv = (l, v, full) => `<div class="kv ${full ? '' : ''}"><span class="l">${l}</span><b>${v}</b></div>`;
  const condTxt = c => c ? cap(String(c)) : '—';
  el.innerHTML = `<div class="dp">
    <div class="dh"><b>Detalle de entrega</b><button class="x" id="dClose">×</button></div>
    <div class="idrow"><span class="cod">${escD(r.cod)}</span><span class="pill ${cls}">${ic} ${lbl}</span></div>

    <div class="sec"><div class="sech">👤 Alumno y contexto</div>
      <div class="kgrid">
        ${kv('Alumno', escD(r.estudiante || '—'))}
        ${kv('RUT', escD(r.rut || '—'))}
        ${kv('Correo', escD(r.email || '—'))}
        ${kv('Reserva', r.reserva_cod ? `<span class="rz">${escD(r.reserva_cod)}</span>` : '—')}
        ${kv('Asignatura', escD(r.asignatura || '—'))}
        ${kv('Sede', escD(sede))}
        ${kv('Responsable', escD(r.panolero || '—'))}
        ${kv('Uso académico', 'Sí')}
      </div>
    </div>

    <div class="sec"><div class="sech">🕒 Fechas y horarios</div>
      <div class="kgrid">
        ${kv('Programada (retiro)', fFechaHora(r.programada))}
        ${kv('Devolución programada', fFechaHora(r.prog_retorno))}
        ${kv('Entrega real', fFechaHora(r.realizada))}
        ${kv('Devolución real', fFechaHora(r.fecha_retorno))}
        ${kv('Duración del préstamo', durTxt)}
      </div>
    </div>

    <div class="sec"><div class="sech">📦 Equipos entregados (1)</div>
      <div class="eqi"><span class="ei">${icon(r.categoria || r.equipo)}</span>
        <div><b>${escD(r.equipo || r.categoria || '—')}</b><small>${escD(r.categoria || '—')}</small></div>
        <span style="margin-left:auto;color:#64748b;font-size:12px">x1</span></div>
      <div class="kgrid" style="margin-top:4px">
        ${kv('Modelo', escD(r.modelo || '—'))}
        ${kv('N° de serie', escD(r.n_serie || '—'))}
        ${kv('Código QR', escD(r.codigo_qr || '—'))}
        ${kv('Categoría', escD(r.categoria || '—'))}
        ${kv('Condición al entregar', condTxt(r.condicion_salida))}
        ${kv('Condición al devolver', condTxt(r.condicion_retorno))}
      </div>
    </div>

    <div class="sec"><div class="sech">${r.incidencia ? '⚠️' : '✅'} Incidencias</div>
      <div class="obs" style="${r.incidencia ? 'background:#fdecec;border-color:#f6cccc;color:#b91c1c' : 'background:#eefaf2;border-color:#c7ecd4;color:#15803d'}">${r.incidencia ? 'Entrega con observaciones o daños registrados.' : 'Sin incidencias registradas.'}</div>
    </div>

    <div class="sec"><div class="sech">💬 Observaciones</div><div class="obs" style="margin-top:2px">${escD(r.observacion || 'Sin observaciones.')}</div></div>

    <button class="btn tl" id="dVer">🔎 Ver detalle completo</button>
    ${accionBtn}
    <button class="btn gh" id="dComp">🖨️ Descargar comprobante</button>
  </div>`;
  $('#dClose').onclick = () => { HIST.sel = null; renderHistBody(); renderDetail(); };
  $('#dComp').onclick = () => comprobante(r);
  if ($('#dVer')) $('#dVer').onclick = () => viewEntregaDetalle(r);
  if ($('#dReg')) $('#dReg').onclick = () => toast('La entrega se registra desde Entregas → Planificación y ejecución');
}

// ===== Detalle completo de una entrega (pantalla 2) =====
function viewEntregaDetalle(r) {
  const [cls, ic, lbl] = ESTADOS[r.estado] || ['pend', '•', r.estado];
  const sede = (ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa';
  const completada = r.estado === 'completada';
  const entregado = !!r.realizada;
  const prog = r.programada, ent = r.realizada, dev = r.fecha_retorno;
  // Duración total (entrega → devolución)
  let durTxt = '—';
  if (ent && dev) { const min = Math.max(0, Math.round((new Date(dev) - new Date(ent)) / 60000)); durTxt = Math.floor(min / 60) + ' h ' + (min % 60) + ' min'; }
  const step = (ico, t, fecha, nota, done) => `<div class="st"><div class="c">${ico}${done ? '<span class="chk">✓</span>' : ''}</div><div class="t">${t}</div><div class="d">${fecha ? fFechaHora(fecha) : '—'}${nota ? '<br>' + nota : ''}</div></div>`;
  const condDot = c => { const bad = c && ['dañado', 'danado', 'malo', 'perdido'].includes(String(c).toLowerCase()); const reg = c && String(c).toLowerCase() === 'regular'; const color = bad ? '#dc2626' : reg ? '#d97706' : '#16a34a'; const txt = c ? cap(String(c)) : 'En buen estado'; return `<span class="cond"><span class="dot" style="background:${color}"></span>${escD(txt)}</span>`; };
  h(`<div class="hist"><style>${HIST_CSS}</style><div class="det">
    <div class="dhead">
      <div class="dtt"><div class="tk">📦</div><div><h1>Entrega ${escD(r.cod)}</h1><p>Préstamo de equipamiento académico</p></div>
        <span class="pill ${cls}" style="margin-left:6px">${ic} ${lbl}</span></div>
      <div class="dbtns"><button class="b" id="dBack">← Volver al historial</button><button class="b" id="dComp2">⬇️ Descargar comprobante</button>${entregado ? '<button class="b tl" id="dRep">🔁 Repetir entrega</button>' : ''}</div>
    </div>
    <div class="stp">
      ${step('📅', 'Reserva', prog, r.reserva_cod || '', !!r.reserva_cod)}
      <div class="ln"></div>
      ${step('📦', 'Preparación', prog, 'Equipos preparados', entregado)}
      <div class="ln"></div>
      ${step('🤝', 'Entrega', ent, entregado ? escD(r.cod) : 'Pendiente', entregado)}
      <div class="ln"></div>
      ${step('🏁', 'Cierre', dev, completada ? 'Devolución y cierre' : 'En curso', completada)}
    </div>
    <div class="cols">
      <div class="ic2"><div class="hd">👤 Alumno</div><div class="big">${escD(r.estudiante || '—')}</div><small>RUT: ${escD(r.rut || '—')}</small><small>${escD(r.email || '—')}</small></div>
      <div class="ic2"><div class="hd">📘 Asignatura</div><div class="big">${escD(r.asignatura || r.categoria || '—')}</div><small>Equipo: ${escD(r.equipo || '—')}</small></div>
      <div class="ic2"><div class="hd">📍 Contexto de la entrega</div><div class="ln2">📍 Sede<br><b>${escD(sede)}</b></div><div class="ln2">👤 Responsable<br><b>${escD(r.panolero || '—')}</b></div></div>
      <div class="ic2"><div class="hd">🕒 Fechas y horarios</div><div class="ln2">Programada: <b>${fFechaHora(prog)}</b></div><div class="ln2">Real (entrega): <b>${fFechaHora(ent)}</b></div><div class="ln2">Real (devolución): <b>${fFechaHora(dev)}</b></div><div class="ln2">Duración total: <b>${durTxt}</b></div></div>
    </div>
    <div class="main2">
      <div>
        <div class="box"><h3>📦 Equipos entregados (1)</h3>
          <div class="tw"><table class="eq2"><thead><tr><th>#</th><th>Equipo / Accesorio</th><th>Modelo</th><th>N° de serie</th><th>Cantidad</th><th>Condición al entregar</th></tr></thead>
          <tbody><tr><td>1</td><td>${escD(r.equipo || r.categoria || '—')}</td><td>${escD(r.modelo || '—')}</td><td>${escD(r.n_serie || r.codigo_qr || '—')}</td><td>1</td><td>${condDot(r.condicion_salida)}</td></tr></tbody></table></div>
        </div>
        <div class="box"><h3>🧾 Resumen</h3><div class="rsum">
          <div class="rc"><div class="ri" style="background:#eef4fe;color:#2563eb">📦</div><div><b>1</b><small>Total de equipos</small></div></div>
          <div class="rc"><div class="ri" style="background:#eef2f7">📅</div><div><b>${durTxt}</b><small>Duración del préstamo</small></div></div>
          <div class="rc"><div class="ri" style="background:#eefaf2;color:#15803d">✅</div><div><b>${lbl}</b><small>Estado final</small></div></div>
        </div></div>
      </div>
      <div>
        <div class="box"><h3>✍️ Confirmación / Firma digital</h3>
          ${entregado ? `<div class="sign">✔️ <div><b>Entrega confirmada</b><br>Registrada el ${fFechaHora(ent)}</div></div>
          <div class="sg"><span class="nm">${escD((r.estudiante || '').split(' ').slice(0, 2).join(' '))}</span><span style="color:#15803d;font-size:12px;font-weight:700">✔️ Firma válida</span></div>`
          : `<div class="obs" style="background:#f8fafc;border:1px solid #eef1f5;border-radius:9px;padding:11px;color:#64748b;font-size:12.5px">Entrega pendiente de confirmación.</div>`}
        </div>
        <div class="box"><h3>💬 Observaciones</h3><p style="font-size:12.5px;color:#64748b;margin:0">${escD(r.observacion || 'Sin observaciones registradas.')}</p></div>
        <div class="box"><h3>⚠️ Incidencias</h3><div class="inc ${r.incidencia ? 'bad' : ''}">${r.incidencia ? '⚠️ Entrega con observaciones o daños registrados.' : '✔️ Sin incidencias registradas.'}</div></div>
      </div>
    </div>
  </div></div>`);
  $('#dBack').onclick = viewHistorialEntregas;
  $('#dComp2').onclick = () => comprobante(r);
  if ($('#dRep')) $('#dRep').onclick = () => toast('Repetir entrega: crea una nueva reserva con el mismo equipamiento');
}

// Comprobante imprimible de una entrega
function comprobante(r) {
  const sede = (ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa';
  const [, , lbl] = ESTADOS[r.estado] || ['', '', r.estado];
  const linea = (k, v) => `<tr><td style="color:#64748b;padding:4px 10px 4px 0">${k}</td><td style="font-weight:600">${v || '—'}</td></tr>`;
  const w = window.open('', '_blank');
  const body = `<h1 style="font-size:18px;margin:0 0 2px">Comprobante de entrega ${escD(r.cod)}</h1>
    <div style="color:#64748b;font-size:12px;margin-bottom:14px">Pañol Online · ${escD(sede)} · ${new Date().toLocaleString('es-CL')}</div>
    <table style="font-size:13px;border-collapse:collapse">
      ${linea('Reserva', r.reserva_cod)}${linea('Alumno', escD(r.estudiante))}${linea('RUT', escD(r.rut))}
      ${linea('Asignatura', escD(r.asignatura || r.categoria))}${linea('Equipo', escD(r.equipo))}${linea('N° de serie', escD(r.n_serie || r.codigo_qr))}
      ${linea('Fecha programada', fFechaHora(r.programada))}${linea('Fecha de entrega', fFechaHora(r.realizada))}${linea('Fecha de devolución', fFechaHora(r.fecha_retorno))}
      ${linea('Responsable', escD(r.panolero))}${linea('Estado', lbl)}</table>
    <p style="margin-top:28px;font-size:12px;color:#64748b">Firma del estudiante: ____________________________</p>`;
  if (w) { w.document.write(`<html><head><title>Comprobante ${escD(r.cod)}</title><meta charset="utf8"><style>body{font-family:system-ui,Arial;margin:28px;color:#0f172a}td{vertical-align:top}</style></head><body>${body}</body></html>`); w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 300); }
  else toast('Permite las ventanas emergentes para imprimir el comprobante');
}

// Exportar historial filtrado a CSV
function exportHistCSV() {
  const lista = histFiltradas();
  if (!lista.length) return toast('No hay filas para exportar');
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['ID', 'Reserva', 'Alumno', 'RUT', 'Asignatura', 'Equipo', 'N° serie', 'Fecha programada', 'Fecha realizada', 'Devolución', 'Responsable', 'Estado'];
  const linf = r => [r.cod, r.reserva_cod, r.estudiante, r.rut, r.asignatura || r.categoria, r.equipo, r.n_serie || r.codigo_qr, fFechaHora(r.programada), fFechaHora(r.realizada), fFechaHora(r.fecha_retorno), r.panolero, (ESTADOS[r.estado] || ['', '', r.estado])[2]];
  const csv = '﻿' + [head.map(esc).join(','), ...lista.map(r => linf(r).map(esc).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = 'historial_entregas.csv'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  toast('Historial exportado (' + lista.length + ' filas)');
}
async function viewAgenda() {
  h(`<h2 class="page">Agenda de entregas</h2><div id="list"></div>`);
  const ag = await api('/agenda');
  if (!ag.length) { $('#list').innerHTML = '<p class="muted">Sin entregas pendientes.</p>'; return; }
  $('#list').innerHTML = ag.map((a, i) => `<div class="row"><div class="ava">${icon(a.categoria)}</div>
    <div class="info"><b>${escD(a.por_individualizar ? a.categoria : a.equipo)}</b><small>${a.por_individualizar ? `Reserva por categoría · ${(a.unidades?a.unidades.length:0)} unidad(es) disponible(s)` : unidadLinea(a)}<br>${escD(a.usuario)} · ${fmtDate(a.fecha_inicio)}</small></div>
    <div style="display:flex;gap:6px">
      <button class="btn sm ghost" data-r="${i}">Reprogramar</button>
      <button class="btn sm" data-i="${i}">Entregar</button></div></div>`).join('');
  $('#list').querySelectorAll('button[data-i]').forEach(b => b.onclick = () => modalEntregar(ag[Number(b.dataset.i)]));
  $('#list').querySelectorAll('button[data-r]').forEach(b => b.onclick = () => modalReprogramar(ag[Number(b.dataset.r)]));
}
// Reprogramación de horario de retiro (pañolero / jefe de pañol / admin)
function toLocalInput(s){ const d=new Date(s); const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function modalReprogramar(a){
  openModal(`<h3>Reprogramar retiro</h3>
    <div class="aviso ok" style="margin-bottom:10px"><b>${escD(a.equipo)}</b><br>${escD(a.usuario)}</div>
    <p class="muted" style="margin-top:0">Coordina el nuevo horario con el estudiante. Se valida la prioridad de clases (bloqueos) y los choques con otras reservas.</p>
    <div class="field"><label>Nuevo inicio</label><input type="datetime-local" id="rIni" value="${a.fecha_inicio?toLocalInput(a.fecha_inicio):''}"></div>
    <div class="field"><label>Nuevo término</label><input type="datetime-local" id="rFin" value="${a.fecha_fin?toLocalInput(a.fecha_fin):''}"></div>
    <div class="field"><label>Motivo (opcional)</label><input id="rMot" placeholder="Acuerdo con el estudiante"></div>
    <div class="err" id="rErr"></div>
    <button class="btn full" id="rOk">Guardar nuevo horario</button>`);
  $('#rOk').onclick = async () => {
    try {
      await api(`/reservas/${a.id}/reprogramar`, { method:'PUT', body:{
        fecha_inicio: new Date($('#rIni').value).toISOString(),
        fecha_fin: new Date($('#rFin').value).toISOString(),
        motivo: $('#rMot').value.trim() || null } });
      closeModal(); toast('Retiro reprogramado'); viewAgenda();
    } catch(e){ $('#rErr').textContent = e.message; }
  };
}
function modalEntregar(a) {
  const ind = !!a.por_individualizar;         // RF-11: reserva por categoría → asignar unidad
  const unidades = a.unidades || [];
  openModal(`<h3>Entregar equipo</h3>
    <div class="aviso ok" style="margin-bottom:10px">Entregando: <b>${escD(ind ? a.categoria : a.equipo)}</b>${ind ? '<br>Reserva por categoría — selecciona la unidad física a entregar' : '<br>'+unidadLinea(a)}</div>
    ${ind
      ? `<div class="field"><label>Unidad a entregar (individualización)</label><select id="eUnit">${unidades.length ? unidades.map(u=>`<option value="${u.id}">${escD(u.nombre)} · ${escD(u.codigo_qr)}</option>`).join('') : '<option value="">No hay unidades disponibles</option>'}</select></div>`
      : `<p class="muted" style="margin-top:0">Escanea o ingresa el código del equipo para verificar la unidad.</p>
         <div class="field"><label>QR / código del equipo</label><input id="eQr" placeholder="${escD(a.codigo_qr||'')}"></div>`}
    <div class="field"><label>Condición de salida</label><select id="eCond">
      <option value="optimo">Óptimo</option><option value="bueno" selected>Buen estado</option></select></div>
    <div class="err" id="eErr"></div>
    <button class="btn full" id="eOk">Confirmar entrega</button>`);
  $('#eOk').onclick = async () => {
    try {
      const body = { reserva_id: Number(a.id), condicion_salida: $('#eCond').value };
      if (ind) {
        const u = $('#eUnit') ? Number($('#eUnit').value) : 0;
        if (!u) { $('#eErr').textContent = 'No hay unidad disponible para asignar'; return; }
        body.equipo_id = u;
      } else {
        body.qr = $('#eQr').value.trim() || null;
      }
      await api('/entregar', { method: 'POST', body });
      closeModal(); toast('Entrega registrada'); reloadDash(viewAgenda);
    } catch (e) { $('#eErr').textContent = e.message; }
  };
}

// ===================== Devoluciones (dashboard de gestión) =====================
const DEV_CSS = `
.dev .k.p{background:#f3eefe}.dev .k.p .ic{background:#e7ddfb;color:#7c3aed}.dev .k.p .vl{color:#7c3aed}
.dev .tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.dev .tabs button{border:1px solid #e6e9ef;background:#fff;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:700;color:#334155;cursor:pointer;display:flex;align-items:center;gap:7px}
.dev .tabs button.on{background:#0d9488;border-color:#0d9488;color:#fff}
.dev .devgrid{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:14px;align-items:start}
@media(max-width:1250px){.dev .devgrid{grid-template-columns:1fr}}
.dev .cdot{display:inline-flex;align-items:center;gap:6px;font-size:12.5px}
.dev .cdot .d{width:8px;height:8px;border-radius:50%}
.dev .ab2{border:1px solid #cdeee8;background:#eafaf6;color:#0d9488;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.dev .ab2.gh{background:#fff;border-color:#e6e9ef;color:#475569}
/* Panel Devolución rápida */
.dev .qr{background:#fff;border:1px solid #eceff4;border-radius:14px;padding:16px;position:sticky;top:12px}
.dev .qr .qh{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px}
.dev .qr .qh b{font-size:16px;display:flex;align-items:center;gap:7px}
.dev .qr .qh p{margin:2px 0 0;color:#64748b;font-size:12px}
.dev .qr .seg2{display:flex;gap:6px;background:#f1f5f9;border-radius:10px;padding:4px;margin:12px 0}
.dev .qr .seg2 button{flex:1;border:0;background:transparent;border-radius:8px;padding:8px;font-size:12.5px;font-weight:700;color:#475569;cursor:pointer}
.dev .qr .seg2 button.on{background:#0f172a;color:#fff}
.dev .qr .scan{border:2px dashed #cbd5e1;border-radius:12px;padding:20px;text-align:center;color:#64748b;font-size:12.5px;margin-bottom:12px}
.dev .qr .scan .fr{font-size:26px;color:#0d9488}
.dev .qr .rcard{border:1px solid #e6e9ef;border-radius:11px;padding:11px;display:flex;gap:10px;align-items:flex-start;margin-bottom:12px}
.dev .qr .rcard .ri{width:34px;height:34px;border-radius:9px;background:#eef2f7;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.dev .qr .rcard b{font-size:13px}.dev .qr .rcard small{display:block;color:#64748b;font-size:11.5px}
.dev .qr .sect{font-size:12.5px;font-weight:800;margin:12px 0 7px;display:flex;justify-content:space-between;align-items:center}
.dev .qr .chk{display:flex;align-items:center;gap:9px;padding:7px 0;font-size:12.5px;border-bottom:1px solid #f3f5f8}
.dev .qr .chk .cb{width:20px;height:20px;border-radius:6px;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto}
.dev .qr .cnt{font-size:11px;font-weight:700;color:#0d9488;background:#eafaf6;border-radius:999px;padding:2px 9px}
.dev .qr .frow{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.dev .qr label{font-size:11px;color:#64748b;display:block;margin-bottom:3px}
.dev .qr select,.dev .qr textarea{width:100%;box-sizing:border-box;border:1px solid #d7dce3;border-radius:9px;padding:8px 10px;font-size:12.5px;font-family:inherit}
.dev .qr textarea{min-height:58px;resize:vertical}
.dev .qr .tog{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700}
.dev .qr .tg{width:40px;height:22px;border-radius:999px;background:#cbd5e1;position:relative;cursor:pointer;transition:background .15s;flex:0 0 auto}
.dev .qr .tg.on{background:#dc2626}
.dev .qr .tg::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
.dev .qr .tg.on::after{left:20px}
.dev .qr .photo{border:1px dashed #cbd5e1;border-radius:10px;padding:12px;text-align:center;color:#64748b;font-size:11px}
.dev .qr .multas{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;padding:11px 0;margin:12px 0;font-size:13px;font-weight:700}
.dev .qr .conf{display:flex;gap:14px;font-size:12.5px;margin:6px 0 2px}
.dev .qr .conf .o{display:inline-flex;align-items:center;gap:6px;color:#334155}
.dev .qr .qbtns{display:flex;gap:8px;margin-top:12px}
.dev .qr .qbtns button{flex:1;border-radius:10px;padding:10px;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid #d7dce3;background:#fff;color:#334155;display:flex;align-items:center;justify-content:center;gap:6px}
.dev .qr .qbtns button.tl{background:#0d9488;border-color:#0d9488;color:#fff}
.dev .qr .qbtns button.wr{background:#fff7ed;border-color:#fed7aa;color:#c2410c}
.dev .qr .empty{color:#94a3b8;font-size:12.5px;text-align:center;padding:20px 8px}
.dev . hd2{}
`;
let DEV = null;
const DEV_EST = { pendiente: ['pend', '🗂️', 'Pendiente'], atrasada: ['atr', '⏰', 'Atrasada'], incidencia: ['inc', '⚠️', 'Incidencia'], completada: ['ok', '✔️', 'Completada'] };
function devCondDot(c) {
  const t = String(c || '').toLowerCase();
  const color = t.includes('buen') || t.includes('óptim') || t.includes('optim') ? '#16a34a'
    : t.includes('observ') || t.includes('revis') && !t.includes('sin') ? '#d97706'
    : t.includes('daño') || t.includes('dano') || t.includes('observ') ? '#dc2626'
    : '#94a3b8';
  return `<span class="cdot"><span class="d" style="background:${color}"></span>${escD(c || 'Sin revisión')}</span>`;
}
function devEnRango(r, rango) {
  const t = r.prog_devolucion; if (!t) return rango === 'todas';
  const d = new Date(t), n = new Date();
  if (rango === 'todas') return true;
  if (rango === 'hoy') return d.toDateString() === n.toDateString();
  if (rango === 'semana') { const a = new Date(n); a.setHours(0, 0, 0, 0); const b = new Date(a); b.setDate(a.getDate() + 7); return d >= a && d < b; }
  if (rango === 'mes') return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  return true;
}

async function viewDevoluciones() {
  h(`<div class="hist dev"><style>${HIST_CSS}${DEV_CSS}</style><div id="devRoot">Cargando…</div></div>`);
  let d;
  try { d = await api('/devoluciones/dashboard'); } catch (e) { $('#devRoot').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
  const rows = Array.isArray(d) ? d : (d.rows || []);
  const kpis = (d && d.kpis) || { hoy: 0, pendientes: rows.length, atrasadas: 0, incidencias: 0 };
  DEV = { rows, kpis, rango: 'hoy', fKpi: null, fEstado: 'todos', fCarr: 'todas', fResp: 'todos', fDesde: '', fHasta: '', q: '', sel: null, page: 1, perPage: 8, estadoFisico: 'bueno', danos: false, obs: '', metodo: 'qr' };
  renderDev();
}

function devFiltradas() {
  const D = DEV; const q = (D.q || '').toLowerCase();
  return D.rows.filter(r => {
    if (!devEnRango(r, D.rango)) return false;
    if (D.fKpi === 'hoy' && !(!r.devuelto && devEnRango(r, 'hoy'))) return false;
    if (D.fKpi === 'pendientes' && r.devuelto) return false;
    if (D.fKpi === 'atrasadas' && r.estado !== 'atrasada') return false;
    if (D.fKpi === 'incidencias' && !r.incidencia) return false;
    if (D.fEstado !== 'todos' && r.estado !== D.fEstado) return false;
    if (D.fCarr !== 'todas' && (r.asignatura || '') !== D.fCarr) return false;
    if (D.fResp !== 'todos' && (r.panolero || '') !== D.fResp) return false;
    if (D.fDesde && (!r.prog_devolucion || new Date(r.prog_devolucion) < new Date(D.fDesde))) return false;
    if (D.fHasta && (!r.prog_devolucion || new Date(r.prog_devolucion) > new Date(D.fHasta + 'T23:59:59'))) return false;
    if (q && !((r.reserva_cod + ' ' + (r.estudiante || '') + ' ' + (r.equipo || '') + ' ' + (r.asignatura || '')).toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderDev() {
  const D = DEV; const k = D.kpis;
  const carr = [...new Set(D.rows.map(r => r.asignatura).filter(Boolean))];
  const resp = [...new Set(D.rows.map(r => r.panolero).filter(Boolean))];
  const sede = (ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa';
  $('#devRoot').innerHTML = `
    <div class="hhd"><div><h1>Devoluciones</h1><p>Control de devoluciones, estado de equipos y cierre de préstamos.</p></div>
      <button class="b tl" id="dvProg" style="height:40px;border:1px solid #0d9488;background:#0d9488;color:#fff;border-radius:10px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer">📅 Devoluciones programadas</button></div>
    <div class="kpis">
      <div class="k b ${D.fKpi === 'hoy' ? 'sel' : ''}" data-kpi="hoy"><div class="ic">📦</div><div><div class="lb">Devoluciones de hoy</div><div class="vl">${k.hoy}</div><div class="sb">Programadas</div></div></div>
      <div class="k g ${D.fKpi === 'pendientes' ? 'sel' : ''}" data-kpi="pendientes"><div class="ic">✅</div><div><div class="lb">Pendientes</div><div class="vl">${k.pendientes}</div><div class="sb">Por procesar</div></div></div>
      <div class="k r ${D.fKpi === 'atrasadas' ? 'sel' : ''}" data-kpi="atrasadas"><div class="ic">⏰</div><div><div class="lb">Atrasadas</div><div class="vl">${k.atrasadas}</div><div class="sb">Fuera de plazo</div></div></div>
      <div class="k p ${D.fKpi === 'incidencias' ? 'sel' : ''}" data-kpi="incidencias"><div class="ic">⚠️</div><div><div class="lb">Con incidencias</div><div class="vl">${k.incidencias}</div><div class="sb">Con daños o faltantes</div></div></div>
    </div>
    <div class="tabs">
      <button data-r="hoy" class="${D.rango === 'hoy' ? 'on' : ''}">📅 Hoy</button>
      <button data-r="semana" class="${D.rango === 'semana' ? 'on' : ''}">📅 Esta semana</button>
      <button data-r="mes" class="${D.rango === 'mes' ? 'on' : ''}">📅 Este mes</button>
      <button data-r="todas" class="${D.rango === 'todas' ? 'on' : ''}">≣ Todas</button>
    </div>
    <div class="filt">
      <div class="ft">🔽 Filtros</div>
      <div class="fg"><label>Estado</label><select id="dEstado">
        <option value="todos">Todos</option><option value="pendiente">Pendiente</option><option value="atrasada">Atrasada</option><option value="incidencia">Incidencia</option><option value="completada">Completada</option></select></div>
      <div class="fg"><label>Sede</label><select><option>${escD(sede)}</option></select></div>
      <div class="fg"><label>Carrera / Asignatura</label><select id="dCarr"><option value="todas">Todas</option>${carr.map(x => `<option${x === D.fCarr ? ' selected' : ''}>${escD(x)}</option>`).join('')}</select></div>
      <div class="fg"><label>Responsable</label><select id="dResp"><option value="todos">Todos</option>${resp.map(x => `<option${x === D.fResp ? ' selected' : ''}>${escD(x)}</option>`).join('')}</select></div>
      <div class="fg"><label>Desde</label><input type="date" id="dDesde" value="${D.fDesde}"></div>
      <div class="fg"><label>Hasta</label><input type="date" id="dHasta" value="${D.fHasta}"></div>
      <a class="clr" id="dClr">↻ Limpiar filtros</a>
    </div>
    <div class="tbar"><div class="srch"><input id="dQ" placeholder="Buscar reserva, alumno, equipo o kit…" value="${escD(D.q)}"></div>
      <button class="b" id="dExport">⬇️ Exportar</button><button class="b" id="dActual">↻ Actualizar</button></div>
    <div class="devgrid">
      <div class="card"><div class="tbh" style="padding:14px 16px 0"><h3 style="margin:0;font-size:15px">↩️ Devoluciones programadas — ${({ hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', todas: 'Todas' })[D.rango]} <span id="dCount" style="color:#64748b;font-weight:600"></span></h3></div>
        <div class="tw"><table>
          <thead><tr><th>Reserva ↕</th><th>Alumno ↕</th><th>Equipo / Kit ↕</th><th>Fecha y hora programada ↕</th><th>Estado</th><th>Condición</th><th>Acciones</th></tr></thead>
          <tbody id="dBody"></tbody></table></div>
        <div class="pag" id="dPag"></div>
      </div>
      <div id="dQuick"></div>
    </div>`;
  $('#dEstado').value = D.fEstado;
  $('#dvProg').onclick = () => viewDevolucionesProg(DEV.rows);
  $('#devRoot').querySelectorAll('.k[data-kpi]').forEach(c => c.onclick = () => { const kp = c.dataset.kpi; D.fKpi = (D.fKpi === kp) ? null : kp; D.page = 1; renderDev(); });
  $('#devRoot').querySelectorAll('.tabs button').forEach(b => b.onclick = () => { D.rango = b.dataset.r; D.page = 1; renderDev(); });
  $('#dEstado').onchange = () => { D.fEstado = $('#dEstado').value; D.page = 1; renderDevBody(); };
  $('#dCarr').onchange = () => { D.fCarr = $('#dCarr').value; D.page = 1; renderDevBody(); };
  $('#dResp').onchange = () => { D.fResp = $('#dResp').value; D.page = 1; renderDevBody(); };
  $('#dDesde').onchange = () => { D.fDesde = $('#dDesde').value; D.page = 1; renderDevBody(); };
  $('#dHasta').onchange = () => { D.fHasta = $('#dHasta').value; D.page = 1; renderDevBody(); };
  $('#dQ').oninput = () => { D.q = $('#dQ').value; D.page = 1; renderDevBody(); };
  $('#dClr').onclick = () => { Object.assign(D, { fKpi: null, fEstado: 'todos', fCarr: 'todas', fResp: 'todos', fDesde: '', fHasta: '', q: '', page: 1 }); renderDev(); };
  $('#dActual').onclick = viewDevoluciones;
  $('#dExport').onclick = () => toast('Exportación del listado de devoluciones');
  renderDevBody();
  renderQuickReturn();
}

function renderDevBody() {
  const D = DEV; const lista = devFiltradas();
  if ($('#dCount')) $('#dCount').textContent = '(' + lista.length + ')';
  const total = lista.length, pp = D.perPage, pages = Math.max(1, Math.ceil(total / pp));
  if (D.page > pages) D.page = pages;
  const a = (D.page - 1) * pp, b = Math.min(total, a + pp);
  $('#dBody').innerHTML = total ? lista.slice(a, b).map(r => {
    const [cls, ic, lbl] = DEV_EST[r.estado] || ['pend', '•', r.estado];
    const acc = r.devuelto
      ? `<button class="ab2 gh" data-act="ver">👁️ Ver detalle</button>`
      : r.incidencia ? `<button class="ab2" data-act="dev">⚙️ Gestionar</button>`
      : `<button class="ab2" data-act="dev">↩️ Devolver</button>`;
    return `<tr data-cod="${escD(r.cod)}" class="${D.sel && D.sel.cod === r.cod ? 'sel' : ''}">
      <td><span class="rz">${escD(r.reserva_cod || '—')}</span></td>
      <td class="al"><b>${escD(r.estudiante || '—')}</b><small>${escD(r.asignatura || r.categoria || '—')}</small></td>
      <td><div class="eq"><span class="ei">${icon(r.categoria || r.equipo)}</span><b style="font-weight:600">${escD(r.equipo || '—')}</b></div></td>
      <td class="fdt">${fFechaDos(r.prog_devolucion)}</td>
      <td><span class="pill ${cls}">${ic} ${lbl}</span></td>
      <td>${devCondDot(r.condicion)}</td>
      <td style="display:flex;gap:6px;align-items:center">${acc}<button class="dots" data-act="mas">⋯</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="muted" style="padding:22px;text-align:center;color:#94a3b8">No hay devoluciones que coincidan con los filtros.</td></tr>`;

  const nums = []; for (let p = 1; p <= pages; p++) { if (p === 1 || p === pages || Math.abs(p - D.page) <= 1) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…'); }
  $('#dPag').innerHTML = `<div class="mut">Mostrando ${total ? a + 1 : 0}–${b} de ${total} devoluciones</div>
    <div class="pg"><button ${D.page <= 1 ? 'disabled' : ''} data-pg="prev">← Anterior</button>
    ${nums.map(n => n === '…' ? '<span class="mut" style="padding:0 4px">…</span>' : `<button data-pg="${n}" class="${n === D.page ? 'on' : ''}">${n}</button>`).join('')}
    <button ${D.page >= pages ? 'disabled' : ''} data-pg="next">Siguiente →</button></div>`;

  $('#dBody').querySelectorAll('tr[data-cod]').forEach(tr => {
    const r = lista.find(x => x.cod === tr.dataset.cod);
    tr.onclick = (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'mas') return;
      DEV.sel = r; DEV.estadoFisico = 'bueno'; DEV.danos = false; DEV.obs = '';
      renderDevBody(); renderQuickReturn();
    };
  });
  $('#dPag').querySelectorAll('button[data-pg]').forEach(b2 => b2.onclick = () => { const v = b2.dataset.pg; if (v === 'prev') D.page--; else if (v === 'next') D.page++; else D.page = Number(v); renderDevBody(); });
}

function renderQuickReturn() {
  const el = $('#dQuick'); if (!el) return;
  const r = DEV.sel;
  if (!r) {
    el.innerHTML = `<div class="qr">
      <div class="qh"><div><b>↩️ Devolución rápida</b><p>Registra la devolución, verifica el estado y cierra el préstamo.</p></div></div>
      <div class="seg2"><button class="on">🔳 Escanear QR</button><button>⌨️ Código de reserva</button></div>
      <div class="scan"><div class="fr">⌞⌝</div>Escanea el código QR de la reserva o del equipo</div>
      <div class="empty">Selecciona una devolución de la lista para procesarla.</div></div>`;
    return;
  }
  const [cls, ic, lbl] = DEV_EST[r.estado] || ['pend', '•', r.estado];
  const readonly = r.devuelto;
  el.innerHTML = `<div class="qr">
    <div class="qh"><div><b>↩️ Devolución rápida</b><p>Registra la devolución, verifica el estado y cierra el préstamo.</p></div><button class="x" id="qClose" style="border:0;background:transparent;font-size:18px;color:#94a3b8;cursor:pointer">×</button></div>
    <div class="seg2"><button class="${DEV.metodo === 'qr' ? 'on' : ''}" id="qmQr">🔳 Escanear QR</button><button class="${DEV.metodo === 'cod' ? 'on' : ''}" id="qmCod">⌨️ Código de reserva</button></div>
    <div class="scan"><div class="fr">⌞⌝</div>Escanea el código QR de la reserva<br>o del equipo</div>
    <div class="rcard"><div class="ri">${icon(r.categoria || r.equipo)}</div>
      <div style="flex:1"><b>Reserva: ${escD(r.reserva_cod || '—')}</b><small>Alumno: ${escD(r.estudiante || '—')}</small><small>Asignatura: ${escD(r.asignatura || '—')}</small></div>
      <span class="pill ${cls}">${ic} ${lbl}</span></div>
    <div class="sect">Equipos / Accesorios <span class="cnt">1 de 1</span></div>
    <div class="chk"><span class="cb">✓</span>${escD(r.equipo || r.categoria || '—')}${r.n_serie ? ` · <span style="color:#64748b">${escD(r.n_serie)}</span>` : ''}</div>
    <div class="frow">
      <div><label>Estado físico del equipo</label>
        <select id="qEstado" ${readonly ? 'disabled' : ''}>
          <option value="optimo">Óptimo</option>
          <option value="bueno" selected>En buen estado</option>
          <option value="observacion">Con observación</option>
          <option value="con_danio">Con daño</option>
          <option value="inoperativo">Inoperativo / faltante</option></select></div>
      <div><label>¿Daños o faltantes?</label>
        <div class="tog"><span class="tg ${DEV.danos ? 'on' : ''}" id="qTog"></span><span id="qTogL">${DEV.danos ? 'Sí' : 'No'}</span></div></div>
    </div>
    <div style="margin-top:10px"><label>Observaciones</label><textarea id="qObs" placeholder="Ingresa observaciones (opcional)…" ${readonly ? 'disabled' : ''}>${escD(r.observacion || '')}</textarea></div>
    <div style="margin-top:10px"><label>Fotografías (opcional)</label><div class="photo">📷 Agregar fotos<br><span style="color:#94a3b8">JPG, PNG (máx. 5 MB)</span></div></div>
    <div class="multas"><span>🧮 Multas o daños</span><span>${r.incidencia ? '<span style="color:#dc2626">Con cargos</span>' : 'Sin cargos'} <b style="margin-left:8px">$0</b></span></div>
    <div class="sect" style="margin:0 0 4px">🖊️ Confirmación</div>
    <div class="conf"><span class="o">✅ Firma digital en pantalla</span><span class="o">○ Confirmación con RUT</span></div>
    <div class="qbtns"><button class="gh" id="qBorr">Guardar borrador</button><button class="wr" id="qEsc">⚠️ Escalar incidencia</button><button class="tl" id="qReg">✔️ ${readonly ? 'Ver detalle' : 'Registrar devolución'}</button></div>
  </div>`;
  $('#qClose').onclick = () => { DEV.sel = null; renderDevBody(); renderQuickReturn(); };
  if ($('#qmQr')) $('#qmQr').onclick = () => { DEV.metodo = 'qr'; renderQuickReturn(); };
  if ($('#qmCod')) $('#qmCod').onclick = () => { DEV.metodo = 'cod'; renderQuickReturn(); };
  if ($('#qTog')) $('#qTog').onclick = () => { DEV.danos = !DEV.danos; renderQuickReturn(); };
  if ($('#qEstado')) { $('#qEstado').value = DEV.estadoFisico; $('#qEstado').onchange = () => { DEV.estadoFisico = $('#qEstado').value; }; }
  if ($('#qObs')) $('#qObs').oninput = () => { DEV.obs = $('#qObs').value; };
  $('#qBorr').onclick = () => toast('Borrador guardado');
  $('#qEsc').onclick = () => toast('Incidencia escalada a jefe de pañol');
  $('#qReg').onclick = async () => {
    if (readonly) return toast('Esta devolución ya fue registrada');
    let cond = DEV.estadoFisico;
    if (cond === 'observacion') cond = 'bueno';
    if (DEV.danos && cond !== 'inoperativo') cond = 'con_danio';
    try {
      const resp = await api('/recibir', { method: 'POST', body: { prestamo_id: Number(r.id), condicion_retorno: cond, observacion: (DEV.obs || '').trim() || null } });
      toast(resp.requiere_reposicion ? 'Devolución con daño: bloqueo por reposición aplicado' : 'Devolución registrada');
      viewDevoluciones();
    } catch (e) { toast(e.message); }
  };
}

// ===================== Devoluciones Programadas (planificación) =====================
const DEVPROG_CSS = `
.dprog{color:#0f172a}
.dprog .ph{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.dprog .ph h1{margin:0;font-size:22px;font-weight:800}
.dprog .ph p{margin:3px 0 0;color:#64748b;font-size:13px}
.dprog .ph .bk{height:38px;border:1px solid #d7dce3;background:#fff;border-radius:9px;padding:0 13px;font-size:12.5px;font-weight:700;cursor:pointer;color:#334155}
.dprog .calbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #eceff4;border-radius:12px;padding:10px 12px;margin-bottom:12px}
.dprog .calbar .nav{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px}
.dprog .calbar .nav button{width:30px;height:30px;border:1px solid #e6e9ef;background:#fff;border-radius:8px;cursor:pointer}
.dprog .calbar .seg{display:flex;background:#eef2f7;border-radius:9px;padding:3px}
.dprog .calbar .seg button{border:0;background:transparent;padding:6px 16px;border-radius:7px;font-size:12.5px;font-weight:700;color:#475569;cursor:pointer}
.dprog .calbar .seg button.on{background:#0d9488;color:#fff}
.dprog .calbar .sede{margin-left:auto;border:1px solid #d7dce3;border-radius:9px;padding:7px 10px;font-size:12.5px;background:#fff;min-width:200px}
.dprog .tlwrap{display:grid;grid-template-columns:150px minmax(0,1fr) 180px;gap:12px;background:#fff;border:1px solid #eceff4;border-radius:14px;padding:14px;margin-bottom:12px}
@media(max-width:1100px){.dprog .tlwrap{grid-template-columns:1fr}}
.dprog .today{background:#f8fafc;border:1px solid #eef1f5;border-radius:12px;padding:12px}
.dprog .today .d{font-size:30px;font-weight:800;line-height:1}
.dprog .today .wd{color:#64748b;font-size:12px;margin-bottom:8px}
.dprog .today .mini{display:flex;gap:7px;align-items:center;font-size:12px;margin:6px 0;color:#334155}
.dprog .today .mini .dot{width:9px;height:9px;border-radius:50%}
.dprog .today .big{font-size:22px;font-weight:800;margin:2px 0}
.dprog .lanes{position:relative;overflow-x:auto}
.dprog .axis{display:flex;justify-content:space-between;font-size:10.5px;color:#9aa3af;margin:0 0 4px 96px}
.dprog .axis.cols{justify-content:flex-start}
.dprog .axis.cols .c{flex:1;text-align:center}
.dprog .lane{display:flex;align-items:center;gap:8px;min-height:42px;border-top:1px solid #f1f5f9}
.dprog .lane .lb{width:88px;flex:0 0 auto;font-size:11.5px;color:#475569;font-weight:700;display:flex;align-items:center;gap:5px}
.dprog .track{position:relative;flex:1;align-self:stretch;min-width:420px}
.dprog .ev{position:absolute;height:24px;box-sizing:border-box;display:flex;align-items:center;gap:5px;padding:0 7px;border-radius:7px;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border:1px solid}
.dprog .ev .ck{flex:0 0 auto}
.dprog .ev .ck{font-size:10px}
.dprog .nowl{position:absolute;top:-2px;bottom:0;width:2px;background:#2563eb;z-index:3}
.dprog .nowl .pin{position:absolute;top:-16px;left:50%;transform:translateX(-50%);background:#2563eb;color:#fff;font-size:10px;font-weight:800;padding:1px 6px;border-radius:9px}
.dprog .leg{background:#f8fafc;border:1px solid #eef1f5;border-radius:12px;padding:12px}
.dprog .leg h4{margin:0 0 8px;font-size:12px}
.dprog .leg .li{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;margin:7px 0}
.dprog .leg .li .ic{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;flex:0 0 auto}
.dprog .leg .li b{display:block}.dprog .leg .li small{color:#64748b}
.dprog .filt{background:#fff;border:1px solid #eceff4;border-radius:12px;padding:10px 14px;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px}
.dprog .filt .ft{display:flex;align-items:center;gap:7px;color:#334155;font-weight:700;font-size:13px;padding-bottom:7px}
.dprog .filt .fg{display:flex;flex-direction:column;gap:3px;min-width:150px}
.dprog .filt .fg label{font-size:11px;color:#64748b}
.dprog .filt select{height:38px;border:1px solid #d7dce3;border-radius:9px;padding:8px 10px;font-size:13px;background:#fff;font-family:inherit}
.dprog .filt .clr{margin-left:auto;color:#0d9488;font-size:13px;font-weight:700;cursor:pointer;padding-bottom:8px}
.dprog .ptabs{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.dprog .ptabs button{border:1px solid #e6e9ef;background:#fff;border-radius:10px;padding:10px 16px;font-size:12.5px;font-weight:700;cursor:pointer;color:#475569;display:flex;align-items:center;gap:7px}
.dprog .ptabs button.on{background:#0d9488;border-color:#0d9488;color:#fff}
.dprog .ptabs button.on.r{background:#dc2626;border-color:#dc2626}
.dprog .ptabs button.on.y{background:#d97706;border-color:#d97706}
.dprog .pgrid{display:grid;grid-template-columns:minmax(0,1fr) 620px;gap:12px;align-items:start}
@media(max-width:1380px){.dprog .pgrid{grid-template-columns:1fr}}
/* Detalle dividido en dos: info (izquierda) + flujo como línea de tiempo (derecha) */
.dprog .dpcols{display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px;align-items:start}
@media(max-width:620px){.dprog .dpcols{grid-template-columns:1fr}}
.dprog .dpcols .col{min-width:0}
.dprog .dpR{background:#f8fafc;border:1px solid #eef1f5;border-radius:10px;padding:12px}
.dprog .dpR .stt{font-size:12px;font-weight:800;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dprog .dpR .stt .pill{font-size:10px}
/* Flujo horizontal de la reserva (con el estado actual) */
.dprog .hflow{display:flex;align-items:flex-start;background:#f8fafc;border:1px solid #eef1f5;border-radius:10px;padding:12px 8px}
.dprog .hflow .st{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;min-width:0}
.dprog .hflow .c{width:38px;height:38px;border-radius:50%;background:#eef2f7;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:17px;position:relative}
.dprog .hflow .st.done .c{background:#e7f8ee;color:#15803d}
.dprog .hflow .st.now .c{background:#e8f0fe;color:#2563eb}
.dprog .hflow .c .chk{position:absolute;right:-3px;bottom:-3px;width:16px;height:16px;border-radius:50%;background:#16a34a;color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
.dprog .hflow .c .chk.b{background:#2563eb}
.dprog .hflow .t{font-weight:700;font-size:11.5px;color:#1f2937}
.dprog .hflow .d{font-size:10px;color:#64748b;line-height:1.3}
.dprog .hflow .ln{flex:0 0 14px;height:2px;background:#cbe7e1;margin-top:19px}
.dprog .hflow .st.pend+.ln,.dprog .hflow .ln.pend{background:#e2e8f0}
.dprog .card{background:#fff;border:1px solid #eceff4;border-radius:14px;overflow:hidden}
.dprog .tw{overflow-x:auto}
.dprog table{width:100%;border-collapse:collapse;min-width:620px}
.dprog thead th{text-align:left;font-size:11px;color:#64748b;font-weight:700;padding:11px 12px;border-bottom:1px solid #eef1f5;white-space:nowrap}
.dprog tbody td{padding:10px 12px;border-bottom:1px solid #f3f5f8;font-size:12.5px;vertical-align:middle}
.dprog tbody tr{cursor:pointer}.dprog tbody tr:hover{background:#f8fafc}
.dprog tbody tr.sel{background:#e9f7f4;box-shadow:inset 3px 0 0 #0d9488}
.dprog .pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
.dprog .acts{display:flex;gap:4px}
.dprog .acts .rc{border:1px solid #0d9488;color:#0d9488;background:#fff;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px}
.dprog .acts .ib{width:30px;height:30px;border:1px solid #e6e9ef;background:#fff;border-radius:8px;cursor:pointer;color:#475569}
/* Detalle de devolución */
.dprog .dp{background:#fff;border:1px solid #eceff4;border-radius:14px;padding:16px}
.dprog .dp .dh{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.dprog .dp .dh b{font-size:15px}
.dprog .dp .top{display:flex;gap:10px;align-items:center;margin-bottom:12px}
.dprog .dp .top .ph2{width:52px;height:52px;border-radius:10px;background:#eef2f7;display:flex;align-items:center;justify-content:center;font-size:24px;flex:0 0 auto}
.dprog .dp .top b{font-size:14px}.dprog .dp .top small{color:#64748b;font-size:11.5px;display:block}
.dprog .dp .sh{font-size:12px;font-weight:800;margin:12px 0 6px;display:flex;align-items:center;gap:6px}
.dprog .dp .kv{font-size:12px;color:#334155;margin:5px 0;display:flex;gap:7px;align-items:flex-start}
.dprog .dp .kv .i{opacity:.7}
.dprog .dp .hl{background:#fff7e6;border-radius:6px;padding:1px 5px}
.dprog .dp .eqrow{display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid #f3f5f8}
.dprog .dp .vt{position:relative;margin:4px 0 4px 8px;padding-left:18px}
.dprog .dp .vt .st{position:relative;padding:0 0 12px 0;font-size:11.5px}
.dprog .dp .vt .st::before{content:"";position:absolute;left:-18px;top:2px;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #cbd5e1}
.dprog .dp .vt .st.done::before{background:#16a34a;border-color:#16a34a}
.dprog .dp .vt .st.now::before{background:#2563eb;border-color:#2563eb}
.dprog .dp .vt::before{content:"";position:absolute;left:-12px;top:4px;bottom:10px;width:2px;background:#e2e8f0}
.dprog .dp .vt .st b{font-weight:700}.dprog .dp .vt .st small{color:#64748b;display:block}
.dprog .dp .rec{background:#f1e9fe;border:1px solid #e0d2fb;border-radius:10px;padding:10px;font-size:11.5px}
.dprog .dp .rec .r{display:flex;gap:7px;margin:5px 0;color:#5b21b6}
.dprog .dp .dbtns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.dprog .dp .dbtns button{border:1px solid #d7dce3;background:#fff;border-radius:9px;padding:9px;font-size:12px;font-weight:700;cursor:pointer;color:#334155}
.dprog .dp .dbtns button.tl{grid-column:1/-1;background:#0d9488;border-color:#0d9488;color:#fff}
.dprog .sug{background:#fff;border:1px solid #eceff4;border-radius:12px;padding:12px 14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:12px;color:#334155}
.dprog .sug .t{font-weight:800;display:flex;align-items:center;gap:7px}
.dprog .sug .it{display:flex;align-items:center;gap:6px}
.dprog .empty{color:#94a3b8;font-size:13px;text-align:center;padding:30px 10px}
`;
let PROG = null;
// Estado operativo de una devolución para la planificación (5 estados de la leyenda).
const PROG_EST = {
  confirmada:   ['#16a34a', '#e7f8ee', '✓', 'Confirmada', 'Recepción registrada'],
  proceso:      ['#d97706', '#fdf1dd', '⏳', 'En proceso', 'En recepción'],
  programada:   ['#2563eb', '#e8f0fe', '📅', 'Programada', 'Pendiente de recibir'],
  reprogramada: ['#7c3aed', '#f1e9fe', '↻', 'Reprogramada', 'Con nueva fecha'],
  atrasada:     ['#dc2626', '#fdecec', '⚠', 'Atrasada', 'Fuera de plazo']
};
const progEstado = r => r.devuelto ? (r.incidencia ? 'proceso' : 'confirmada')
  : r.estado === 'atrasada' ? 'atrasada' : r.incidencia ? 'proceso' : 'programada';
const laneCat = c => { const t = String(c || '').toLowerCase();
  if (t.includes('cámar') || t.includes('camar') || t.includes('foto')) return 'Cámaras';
  if (t.includes('ilum') || t.includes('luz') || t.includes('led')) return 'Iluminación';
  if (t.includes('son') || t.includes('audio') || t.includes('micr')) return 'Sonido';
  if (t.includes('kit')) return 'Kits';
  return 'Otros'; };
const LANE_IC = { 'Cámaras': '📷', 'Iluminación': '💡', 'Sonido': '🎙️', 'Kits': '🧰', 'Otros': '🗂️' };

async function viewDevolucionesProg(preRows) {
  h(`<div class="dprog"><style>${HIST_CSS}${DEVPROG_CSS}</style><div id="progRoot">Cargando…</div></div>`);
  // Reusa los datos ya cargados en la pantalla de Devoluciones (navegación instantánea);
  // sólo consulta la API si no hay datos disponibles.
  let rows = Array.isArray(preRows) ? preRows : (DEV && Array.isArray(DEV.rows) ? DEV.rows : null);
  if (!rows) {
    let d;
    try { d = await api('/devoluciones/dashboard'); } catch (e) { if ($('#progRoot')) $('#progRoot').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
    if (!$('#progRoot')) return;
    rows = (d && d.rows) || [];
  }
  PROG = { rows, ref: null, rango: 'dia', tab: 'proximas', sel: null, fCarr: 'todas', fTipo: 'todos', fResp: 'todos' };
  try { renderProg(); } catch (e) { if ($('#progRoot')) $('#progRoot').innerHTML = `<div class="aviso bad">No se pudo mostrar la planificación: ${escD(e.message)}</div>`; }
}

const progIso = x => { const y = x.getFullYear(), m = ('0' + (x.getMonth() + 1)).slice(-2), dd = ('0' + x.getDate()).slice(-2); return `${y}-${m}-${dd}`; };
const progLunes = b => { const d = new Date(b); const wd = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - wd); return d; };

// Devoluciones (no devueltas) dentro del rango seleccionado alrededor de la fecha base.
function progDelRango(rango, ref) {
  const base = ref ? new Date(ref + 'T12:00:00') : new Date();
  return PROG.rows.filter(r => {
    if (r.devuelto) return false; const t = r.prog_devolucion; if (!t) return false;
    const d = new Date(t);
    if (rango === 'dia') return d.toDateString() === base.toDateString();
    if (rango === 'semana') { const a = progLunes(base); const b = new Date(a); b.setDate(a.getDate() + 7); return d >= a && d < b; }
    return d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth(); // mes
  });
}

// Construye el eje y los carriles (swimlanes) según el rango. Apila las tarjetas que
// comparten posición para que ninguna tape a otra; devuelve también la marca de "hoy".
function progBuildTimeline(rango, base, set) {
  const lanesCat = ['Cámaras', 'Iluminación', 'Sonido', 'Kits', 'Otros'];
  const porLane = {}; lanesCat.forEach(l => porLane[l] = []);
  set.forEach(r => porLane[laneCat(r.categoria)].push(r));
  const hoy = new Date();
  let axisHtml = '', axisCls = '', chipW, posOf, todayPos = null;

  if (rango === 'dia') {
    const AX0 = 8, AX1 = 19, SPAN = AX1 - AX0;
    for (let x = AX0; x <= AX1; x++) axisHtml += `<span>${('0' + x).slice(-2)}:00</span>`;
    chipW = 11;
    posOf = r => { const dt = new Date(r.prog_devolucion); const hh = dt.getHours() + dt.getMinutes() / 60; return Math.max(0, Math.min(100 - chipW, (hh - AX0) / SPAN * 100)); };
    if (!PROG.ref || PROG.ref === progIso(hoy)) { const hh = hoy.getHours() + hoy.getMinutes() / 60; if (hh >= AX0 && hh <= AX1) todayPos = (hh - AX0) / SPAN * 100; }
  } else if (rango === 'semana') {
    axisCls = 'cols';
    const mon = progLunes(base); const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); days.push(d); }
    axisHtml = days.map(d => `<span class="c">${cap(d.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', ''))} ${d.getDate()}</span>`).join('');
    const colW = 100 / 7, gap = 2; chipW = colW - gap;
    const idxOf = r => { const dd = new Date(r.prog_devolucion); return Math.round((new Date(dd.getFullYear(), dd.getMonth(), dd.getDate()) - mon) / 86400000); };
    posOf = r => idxOf(r) * colW + gap / 2;
    const ti = days.findIndex(d => d.toDateString() === hoy.toDateString()); if (ti >= 0) todayPos = ti * colW + colW / 2;
  } else { // mes
    axisCls = 'cols';
    const y = base.getFullYear(), m = base.getMonth(); const ult = new Date(y, m + 1, 0).getDate();
    const weeks = []; for (let s = 1; s <= ult; s += 7) weeks.push([s, Math.min(s + 6, ult)]);
    const nW = weeks.length; axisHtml = weeks.map(w => `<span class="c">${w[0]}–${w[1]}</span>`).join('');
    const colW = 100 / nW, gap = 2; chipW = colW - gap;
    const widxOf = r => { const dd = new Date(r.prog_devolucion); return Math.floor((dd.getDate() - 1) / 7); };
    posOf = r => widxOf(r) * colW + gap / 2;
    if (hoy.getFullYear() === y && hoy.getMonth() === m) { const th = Math.floor((hoy.getDate() - 1) / 7); todayPos = th * colW + colW / 2; }
  }

  const laneHtml = lanesCat.map(l => {
    const items = porLane[l].slice().sort((a, b) => posOf(a) - posOf(b));
    const rowsEnd = [];
    const placed = items.map(r => { const left = posOf(r); let row = 0; while (row < rowsEnd.length && rowsEnd[row] > left + 0.3) row++; rowsEnd[row] = left + chipW; return { r, left, row }; });
    const nRows = Math.max(1, rowsEnd.length); const H = nRows * 28 + 8;
    const chips = placed.map(({ r, left, row }) => { const st = progEstado(r); const [c, bg, ck] = PROG_EST[st];
      const nm = (r.estudiante || '—').split(' '); const corto = nm[0] + (nm[1] ? ' ' + nm[1][0] + '.' : '');
      return `<div class="ev" data-cod="${escD(r.cod)}" style="top:${row * 28 + 4}px;left:${left}%;width:${chipW}%;background:${bg};border-color:${c};color:${c}" title="${escD(r.estudiante)} · ${fFechaHora(r.prog_devolucion)}"><span class="ck">${ck}</span>${escD(corto)}</div>`; }).join('');
    return `<div class="lane" style="height:${H}px"><div class="lb">${LANE_IC[l]} ${l} (${items.length})</div><div class="track">${chips}</div></div>`;
  }).join('');

  return { axisHtml, axisCls, laneHtml, todayPos };
}

function renderProg() {
  const P = PROG;
  const base = P.ref ? new Date(P.ref + 'T12:00:00') : new Date();
  const isoDay = x => { const y = x.getFullYear(), m = ('0' + (x.getMonth() + 1)).slice(-2), dd = ('0' + x.getDate()).slice(-2); return `${y}-${m}-${dd}`; };
  const sede = (ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa';
  const lanesCat = ['Cámaras', 'Iluminación', 'Sonido', 'Kits', 'Otros'];
  const set = progDelRango(P.rango, P.ref);

  // ----- Resumen del rango por estado -----
  const cnt = { confirmada: 0, proceso: 0, programada: 0, reprogramada: 0, atrasada: 0 };
  set.forEach(r => cnt[progEstado(r)]++);
  const totDia = set.length || 0;
  const pct = n => totDia ? Math.round(n / totDia * 100) : 0;
  const miniLine = (st, label) => { const [c] = PROG_EST[st]; return `<div class="mini"><span class="dot" style="background:${c}"></span>${label} <b style="margin-left:auto">${cnt[st]} <small style="color:#94a3b8">(${pct(cnt[st])}%)</small></b></div>`; };

  // ----- Línea de tiempo (swimlanes) sensible al rango -----
  const TL = progBuildTimeline(P.rango, base, set);
  const nowMark = TL.todayPos != null ? `<div class="nowl" style="left:calc(96px + ${TL.todayPos}% * (100% - 96px) / 100)"><span class="pin">${P.rango === 'dia' ? fmtHora(new Date()) : 'Hoy'}</span></div>` : '';

  // ----- Leyenda -----
  const leg = Object.keys(PROG_EST).map(st => { const [c, bg, ic, lbl, sub] = PROG_EST[st]; return `<div class="li"><span class="ic" style="background:${bg};color:${c}">${ic}</span><div><b>${lbl}</b><small>${sub}</small></div></div>`; }).join('');

  // ----- Conteos de pestañas -----
  const proximas = P.rows.filter(r => !r.devuelto && r.estado !== 'atrasada');
  const atrasadas = P.rows.filter(r => !r.devuelto && r.estado === 'atrasada');
  const incidencias = P.rows.filter(r => r.incidencia && !r.devuelto);
  const carr = [...new Set(P.rows.map(r => r.asignatura).filter(Boolean))];
  const resp = [...new Set(P.rows.map(r => r.panolero).filter(Boolean))];
  const mesLbl = base.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

  $('#progRoot').innerHTML = `
    <div class="ph"><div><h1>Devoluciones Programadas</h1><p>Planificación, seguimiento y cierre de devoluciones.</p></div>
      <button class="bk" id="pBack">← Volver a devoluciones</button></div>
    <div class="calbar">
      <div class="nav"><button id="pPrev">‹</button>📅 ${cap(mesLbl)}<button id="pNext">›</button></div>
      <div class="seg"><button data-r="dia" class="${P.rango === 'dia' ? 'on' : ''}">Día</button><button data-r="semana" class="${P.rango === 'semana' ? 'on' : ''}">Semana</button><button data-r="mes" class="${P.rango === 'mes' ? 'on' : ''}">Mes</button></div>
      <select class="sede"><option>📍 ${escD(sede)}</option></select>
    </div>
    <div class="tlwrap">
      <div class="today">${(() => {
        if (P.rango === 'dia') return `<div class="wd">${cap(base.toLocaleDateString('es-CL', { weekday: 'long' }))}</div><div class="d">${base.getDate()}</div><div class="wd">${cap(base.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }))}</div>`;
        if (P.rango === 'semana') { const mon = progLunes(base), dom = new Date(mon); dom.setDate(mon.getDate() + 6); return `<div class="wd">Semana</div><div class="d" style="font-size:20px;line-height:1.2">${mon.getDate()} ${mon.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')} – ${dom.getDate()} ${dom.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')}</div><div class="wd">${cap(base.toLocaleDateString('es-CL', { year: 'numeric' }))}</div>`; }
        return `<div class="wd">Mes</div><div class="d" style="font-size:23px">${cap(base.toLocaleDateString('es-CL', { month: 'long' }))}</div><div class="wd">${base.getFullYear()}</div>`;
      })()}
        <div style="border-top:1px solid #eef1f5;margin:10px 0 6px;padding-top:8px;font-size:11px;color:#64748b">Devoluciones programadas</div><div class="big">${totDia}</div>
        ${miniLine('confirmada', 'Confirmadas')}${miniLine('proceso', 'En proceso')}${miniLine('programada', 'Programadas')}${miniLine('reprogramada', 'Reprogramadas')}${miniLine('atrasada', 'Atrasadas')}</div>
      <div class="lanes"><div class="axis ${TL.axisCls}">${TL.axisHtml}</div>${TL.laneHtml}${nowMark}</div>
      <div class="leg"><h4>Leyenda de estados</h4>${leg}</div>
    </div>
    <div class="filt"><div class="ft">🔽 Filtros</div>
      <div class="fg"><label>Sede</label><select><option>${escD(sede)}</option></select></div>
      <div class="fg"><label>Carrera</label><select id="pCarr"><option value="todas">Todas</option>${carr.map(x => `<option${x === P.fCarr ? ' selected' : ''}>${escD(x)}</option>`).join('')}</select></div>
      <div class="fg"><label>Tipo de equipo</label><select id="pTipo"><option value="todos">Todos</option>${lanesCat.map(x => `<option${x === P.fTipo ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="fg"><label>Responsable</label><select id="pResp"><option value="todos">Todos</option>${resp.map(x => `<option${x === P.fResp ? ' selected' : ''}>${escD(x)}</option>`).join('')}</select></div>
      <a class="clr" id="pClr">↻ Limpiar filtros</a>
    </div>
    <div class="ptabs">
      <button data-t="proximas" class="${P.tab === 'proximas' ? 'on' : ''}">📅 Próximas devoluciones (${proximas.length})</button>
      <button data-t="atrasadas" class="${P.tab === 'atrasadas' ? 'on r' : ''}">⚠️ Devoluciones atrasadas (${atrasadas.length})</button>
      <button data-t="incidencias" class="${P.tab === 'incidencias' ? 'on y' : ''}">🧰 Incidencias abiertas (${incidencias.length})</button>
    </div>
    <div class="pgrid">
      <div class="card"><div class="tw"><table>
        <thead><tr><th>Hora ↕</th><th>Estudiante ↕</th><th>Asignatura / Carrera</th><th>Equipo / Kit</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody id="pBody"></tbody></table></div></div>
      <div id="pDetail"></div>
    </div>
    <div class="sug"><span class="t">🎯 Sugerencias operativas (hoy)</span>
      <span class="it">✅ ${atrasadas.length} devoluciones atrasadas · Gestionar primero</span>
      <span class="it">📦 ${set.length} equipos en el rango · Priorizar recepción</span>
      <span class="it">📊 Capacidad del pañol: ${Math.min(99, 60 + set.length)}%</span></div>`;

  // Bindings
  $('#pBack').onclick = viewDevoluciones;
  const shift = dir => { const x = new Date(base); if (P.rango === 'mes') x.setMonth(x.getMonth() + dir); else x.setDate(x.getDate() + dir * (P.rango === 'semana' ? 7 : 1)); P.ref = isoDay(x); renderProg(); };
  $('#pPrev').onclick = () => shift(-1);
  $('#pNext').onclick = () => shift(1);
  $('#progRoot').querySelectorAll('.calbar .seg button').forEach(b => b.onclick = () => { P.rango = b.dataset.r; renderProg(); });
  $('#progRoot').querySelectorAll('.ptabs button').forEach(b => b.onclick = () => { P.tab = b.dataset.t; renderProg(); });
  $('#pCarr').onchange = () => { P.fCarr = $('#pCarr').value; renderProgBody(); };
  $('#pTipo').onchange = () => { P.fTipo = $('#pTipo').value; renderProgBody(); };
  $('#pResp').onchange = () => { P.fResp = $('#pResp').value; renderProgBody(); };
  $('#pClr').onclick = () => { P.fCarr = 'todas'; P.fTipo = 'todos'; P.fResp = 'todos'; renderProg(); };
  $('#progRoot').querySelectorAll('.lanes .ev').forEach(e => e.onclick = () => { const r = PROG.rows.find(x => x.cod === e.dataset.cod); if (r) { PROG.sel = r; renderProgBody(); renderProgDetail(); } });
  renderProgBody();
  renderProgDetail();
}

function progListaTab() {
  const P = PROG;
  let base = P.rows.filter(r => {
    if (P.tab === 'proximas') return !r.devuelto && r.estado !== 'atrasada';
    if (P.tab === 'atrasadas') return !r.devuelto && r.estado === 'atrasada';
    if (P.tab === 'incidencias') return r.incidencia && !r.devuelto;
    return true;
  });
  return base.filter(r => {
    if (P.fCarr !== 'todas' && (r.asignatura || '') !== P.fCarr) return false;
    if (P.fTipo !== 'todos' && laneCat(r.categoria) !== P.fTipo) return false;
    if (P.fResp !== 'todos' && (r.panolero || '') !== P.fResp) return false;
    return true;
  }).sort((a, b) => new Date(a.prog_devolucion || 0) - new Date(b.prog_devolucion || 0));
}

function renderProgBody() {
  const P = PROG; const lista = progListaTab();
  $('#pBody').innerHTML = lista.length ? lista.map(r => {
    const st = progEstado(r); const [c, bg, ic, lbl] = PROG_EST[st];
    const accion = r.devuelto ? `<button class="rc" data-act="ver">👁️ Ver</button>`
      : st === 'reprogramada' ? `<button class="rc" data-act="dev">📅 Reprogramar</button>`
      : `<button class="rc" data-act="dev">✔️ Recibir</button>`;
    return `<tr data-cod="${escD(r.cod)}" class="${P.sel && P.sel.cod === r.cod ? 'sel' : ''}">
      <td style="font-weight:700">${fmtHora(r.prog_devolucion)}</td>
      <td>${escD((r.estudiante || '—'))}</td>
      <td>${escD(r.asignatura || r.categoria || '—')}</td>
      <td><div style="display:flex;align-items:center;gap:7px"><span>${icon(r.categoria || r.equipo)}</span>${escD(r.equipo || '—')}</div></td>
      <td><span class="pill" style="background:${bg};color:${c}">${ic} ${lbl}</span></td>
      <td><div class="acts">${accion}<button class="ib" data-act="chat" title="Contactar">💬</button><button class="ib" data-act="ver" title="Ver">👁️</button><button class="ib" data-act="mas">⋯</button></div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="muted" style="padding:22px;text-align:center;color:#94a3b8">No hay devoluciones en esta vista.</td></tr>`;
  $('#pBody').querySelectorAll('tr[data-cod]').forEach(tr => {
    const r = lista.find(x => x.cod === tr.dataset.cod);
    tr.onclick = (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'mas') return;
      if (act === 'chat') return toast('Contactar al estudiante (correo/WhatsApp)');
      if (act === 'dev') { PROG.sel = r; renderProgBody(); renderProgDetail(); return registrarDevolucionRapida(r); }
      PROG.sel = r; renderProgBody(); renderProgDetail();
    };
  });
}

// Reutiliza el flujo de recepción (pantalla 1) para una devolución concreta.
function registrarDevolucionRapida(r) {
  if (r.devuelto) { toast('Esta devolución ya fue registrada'); return; }
  openModal(`<h3>↩️ Registrar devolución — ${escD(r.reserva_cod || r.cod)}</h3>
    <p class="muted" style="font-size:12.5px;margin-top:0">${escD(r.estudiante || '')} · ${escD(r.equipo || '')}</p>
    <div style="margin:8px 0"><label style="font-size:12px;color:#475569">Estado físico del equipo</label>
      <select id="mrEst" style="width:100%;height:38px;border:1px solid #d7dce3;border-radius:9px;padding:0 10px;margin-top:4px">
        <option value="bueno">En buen estado</option><option value="con_danio">Con daño</option><option value="inoperativo">Inoperativo / faltante</option></select></div>
    <div style="margin:8px 0"><label style="font-size:12px;color:#475569">Observaciones</label>
      <textarea id="mrObs" style="width:100%;min-height:60px;border:1px solid #d7dce3;border-radius:9px;padding:8px;margin-top:4px" placeholder="Opcional…"></textarea></div>
    <button class="btn full" id="mrOk" style="margin-top:6px;width:100%;border:0;border-radius:10px;padding:11px;background:#0d9488;color:#fff;font-weight:700;cursor:pointer">✔️ Registrar devolución</button>`);
  $('#mrOk').onclick = async () => {
    try {
      const resp = await api('/recibir', { method: 'POST', body: { prestamo_id: Number(r.id), condicion_retorno: $('#mrEst').value, observacion: ($('#mrObs').value || '').trim() || null } });
      closeModal(); toast(resp.requiere_reposicion ? 'Devolución con daño: bloqueo por reposición' : 'Devolución registrada');
      viewDevolucionesProg();
    } catch (e) { toast(e.message); }
  };
}

function renderProgDetail() {
  const el = $('#pDetail'); if (!el) return;
  const r = PROG.sel;
  if (!r) { el.innerHTML = `<div class="dp"><div class="dh"><b>Detalle de devolución</b></div><div class="empty">Selecciona una devolución para ver su detalle, línea de tiempo y recomendaciones.</div></div>`; return; }
  const st = progEstado(r); const [c, bg, ic, lbl] = PROG_EST[st];
  const sede = (ME.sedes && (ME.sedes.find(s => s.id === SEDE) || {}).nombre) || 'Sede activa';
  const entregado = !!r.fecha_salida;
  // Flujo horizontal (línea de tiempo) como la maqueta, con la etapa actual.
  const hs = (cls, ico, t, fecha, nota) => `<div class="st ${cls}"><div class="c">${ico}${cls === 'done' ? `<span class="chk">✓</span>` : cls === 'now' ? `<span class="chk b">•</span>` : ''}</div><div class="t">${t}</div><div class="d">${fecha || '—'}${nota ? '<br>' + nota : ''}</div></div>`;
  const ln = done => `<div class="ln ${done ? '' : 'pend'}"></div>`;
  const timeline = `<div class="hflow">
      ${hs('done', '📅', 'Reserva', fFechaHora(r.retiro), escD(r.reserva_cod || ''))}
      ${ln(entregado)}
      ${hs(entregado ? 'done' : 'pend', '📦', 'Preparación', entregado ? fFechaHora(r.fecha_salida) : '—', 'Equipos preparados')}
      ${ln(entregado)}
      ${hs(entregado ? 'done' : 'pend', '🤝', 'Entrega', entregado ? fFechaHora(r.fecha_salida) : '—', entregado ? escD(r.cod) : 'Pendiente')}
      ${ln(r.devuelto)}
      ${hs(r.devuelto ? 'done' : 'now', '🏁', 'Cierre', r.devuelto ? fFechaHora(r.fecha_retorno) : '—', r.devuelto ? 'Cerrada' : 'En curso')}
    </div>`;
  el.innerHTML = `<div class="dp">
    <div class="dh"><b>Detalle de devolución</b><button class="x" id="pClose" style="border:0;background:transparent;font-size:18px;color:#94a3b8;cursor:pointer">×</button></div>
    <div class="top"><div class="ph2">${icon(r.categoria || r.equipo)}</div><div style="flex:1"><b>${escD(r.equipo || r.categoria || '—')}</b><small>Reserva ${escD(r.reserva_cod || r.cod)}</small></div><span class="pill" style="background:${bg};color:${c}">${ic} ${lbl}</span></div>
    <div class="dpcols">
      <div class="col dpL">
        <div class="sh">📄 Información de la reserva</div>
        <div class="kv"><span class="i">👤</span>${escD(r.estudiante || '—')}</div>
        <div class="kv"><span class="i">📘</span>${escD(r.asignatura || r.categoria || '—')}</div>
        <div class="kv"><span class="i">📅</span>Retiro: ${fFechaHora(r.retiro || r.fecha_salida)}</div>
        <div class="kv"><span class="i">↩️</span><span class="hl">Devolución programada: ${fFechaHora(r.prog_devolucion)}</span></div>
        <div class="kv"><span class="i">📍</span>Sede: ${escD(sede)}</div>
        <div class="sh">📦 Equipamiento y accesorios esperados</div>
        <div class="eqrow"><span>${escD(r.equipo || r.categoria || '—')}${r.n_serie ? ' · ' + escD(r.n_serie) : ''}</span><b>1</b></div>
        ${r.modelo ? `<div class="eqrow"><span style="color:#64748b">Modelo: ${escD(r.modelo)}</span><span></span></div>` : ''}
      </div>
      <div class="col dpR">
        <div class="stt">🕒 Línea de tiempo <span class="pill" style="background:${bg};color:${c}">${ic} ${lbl}</span></div>
        ${timeline}
      </div>
    </div>
    <div class="sh">✨ Recomendaciones de priorización</div>
    <div class="rec">
      ${st === 'atrasada' ? '<div class="r">⚠️ Devolución atrasada: contactar al estudiante.</div>' : '<div class="r">✓ Equipo con alta demanda: priorizar recepción.</div>'}
      <div class="r">✓ Verificar accesorios completos antes del cierre.</div>
      <div class="r">✓ Registrar condición y fotografías del estado.</div>
    </div>
    <div class="dbtns">
      ${r.devuelto ? '<button class="tl" id="pVer">👁️ Ver comprobante</button>' : '<button class="tl" id="pConf">✔️ Confirmar recepción</button>'}
      <button id="pRep">↻ Reprogramar</button><button id="pCont">💬 Contactar</button></div>
  </div>`;
  $('#pClose').onclick = () => { PROG.sel = null; renderProgBody(); renderProgDetail(); };
  if ($('#pConf')) $('#pConf').onclick = () => registrarDevolucionRapida(r);
  if ($('#pVer')) $('#pVer').onclick = () => toast('Comprobante de la devolución');
  $('#pRep').onclick = () => toast('Reprogramar la fecha de devolución');
  $('#pCont').onclick = () => toast('Contactar al estudiante');
}

// ----- Pañolero: Recibir (naranja) — legado -----
async function viewRecibir() {
  h(`<h2 class="page" style="color:var(--recibir)">Recibir devoluciones</h2><div id="list"></div>`);
  const pr = await api('/por-recibir');
  if (!pr.length) { $('#list').innerHTML = '<p class="muted">No hay equipos por recibir.</p>'; return; }
  $('#list').innerHTML = pr.map((p, i) => `<div class="row"><div class="ava">${icon(p.categoria)}</div>
    <div class="info"><b>${escD(p.equipo)}</b><small>${unidadLinea(p)}<br>${escD(p.usuario)} · entregado ${fmtDate(p.fecha_salida)}</small></div>
    <button class="btn sm orange" data-i="${i}">Recibir</button></div>`).join('');
  $('#list').querySelectorAll('button[data-i]').forEach(b => b.onclick = () => modalRecibir(pr[Number(b.dataset.i)]));
}
function modalRecibir(p) {
  openModal(`<h3 style="color:var(--recibir)">Recibir equipo</h3>
    <div class="aviso warn" style="margin-bottom:10px">Recibiendo: <b>${escD(p.equipo)}</b><br>${unidadLinea(p)}</div>
    <div class="field"><label>Condición a la devolución</label>
      <select id="cCond">
        <option value="optimo">Óptimo</option><option value="bueno" selected>Buen estado</option>
        <option value="con_danio">Con daño</option><option value="inoperativo">Inoperativo</option>
      </select></div>
    <div class="field"><label>Observación</label><input id="cObs" placeholder="Opcional"></div>
    <div class="aviso warn">Si el equipo presenta daño, se bloqueará por reposición y se aplicará sanción automática (RF-59).</div>
    <button class="btn full orange" id="cOk">Confirmar devolución</button>`);
  $('#cOk').onclick = async () => {
    const r = await api('/recibir', { method: 'POST', body: { prestamo_id: Number(p.prestamo_id),
      condicion_retorno: $('#cCond').value, observacion: $('#cObs').value.trim() || null } });
    closeModal();
    toast(r.requiere_reposicion ? 'Devolución con daño: bloqueo por reposición aplicado' : 'Devolución registrada');
    reloadDash(viewRecibir);
  };
}

// ----- Admin: Panel estratégico -----
function escD(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function topChart(top){
  const rows = (top||[]).filter(t => t.total > 0);
  if (!rows.length) return '<p class="muted">Aún no hay reservas registradas.</p>';
  const max = Math.max(...rows.map(t => t.total), 1);
  return rows.map(t => `<div class="bar-row"><span class="nm" title="${escD(t.nombre)}">${escD(t.nombre)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${Math.round(t.total/max*100)}%"></span></span>
    <span class="vl">${t.total}</span></div>`).join('');
}

function invChart(inv){
  const COL = {disponible:'#1C7A46', prestado:'#0E8F86', reservado:'#B07209', mantencion:'#E8590C', baja:'#9AA7B4'};
  const LAB = {disponible:'Disponible', prestado:'Prestado', reservado:'Reservado', mantencion:'Mantención', baja:'De baja'};
  const total = (inv||[]).reduce((a,s) => a + s.n, 0);
  if (!total) return '<p class="muted">Sin equipos registrados aún.</p>';
  let acc = 0, segs = '';
  inv.forEach(s => { if (!s.n) return; const pct = s.n/total*100;
    segs += `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${COL[s.estado]||'#9AA7B4'}" stroke-width="5.5" stroke-dasharray="${pct.toFixed(2)} ${(100-pct).toFixed(2)}" stroke-dashoffset="${(25-acc).toFixed(2)}"/>`;
    acc += pct;
  });
  const legend = inv.filter(s => s.n).map(s => `<span><i style="background:${COL[s.estado]||'#9AA7B4'}"></i>${LAB[s.estado]||s.estado} · <b>${s.n}</b></span>`).join('');
  return `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
    <svg viewBox="0 0 42 42" style="width:118px;height:118px">
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF2F7" stroke-width="5.5"/>${segs}
      <text x="21" y="20.5" text-anchor="middle" font-size="7" font-weight="700" fill="#152230">${total}</text>
      <text x="21" y="26" text-anchor="middle" font-size="3.4" fill="#6B7785">equipos</text>
    </svg>
    <div class="legend" style="flex-direction:column;gap:7px">${legend}</div>
  </div>`;
}

function trendChart(tend){
  tend = tend || [];
  if (!tend.length) return '<p class="muted">Sin préstamos en el período.</p>';
  const W = 320, H = 130, n = tend.length;
  const max = Math.max(...tend.map(t => t.n), 1);
  const bw = Math.max(10, Math.min(34, (W-20)/n - 8));
  const gap = (W-20 - bw*n)/(n+1);
  let bars = '';
  tend.forEach((t,i) => { const bh = Math.round((t.n/max)*90); const x = 10 + gap*(i+1) + bw*i; const y = 100 - bh;
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${bh}" rx="3" fill="url(#tg)"/>
      <text x="${(x+bw/2).toFixed(1)}" y="${y-3}" text-anchor="middle" font-size="8" font-weight="700" fill="#152230">${t.n}</text>
      <text x="${(x+bw/2).toFixed(1)}" y="118" text-anchor="middle" font-size="7.5" fill="#6B7785">${escD(t.semana)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16b8a8"/><stop offset="1" stop-color="#0E8F86"/></linearGradient></defs>
    <line x1="10" y1="100" x2="${W-10}" y2="100" stroke="#E4E8ED"/>${bars}
  </svg>`;
}

function devList(dev){
  dev = dev || [];
  if (!dev.length) return '<p class="muted">Sin préstamos abiertos.</p>';
  return dev.map(x => {
    const f = x.fecha_salida ? new Date(x.fecha_salida) : null;
    const fecha = f ? f.toLocaleDateString('es-CL',{day:'2-digit',month:'short'}) : '—';
    return `<div class="row"><div class="ava">📦</div><div class="info"><b>${escD(x.equipo)}</b><small>${escD(x.usuario)}</small></div><span class="pill info">salió ${fecha}</span></div>`;
  }).join('');
}

async function viewKpis() {
  h(`<h2 class="page">Panel de control</h2>
     <p class="muted" style="margin:-8px 0 14px;font-size:13px">Visión general de todas las sedes. Selecciona una sede para profundizar en su detalle.</p>
     <div id="sedeSw" class="segbar"></div>
     <div id="dash" class="muted">Cargando…</div>`);
  let g;
  try { g = await api('/admin/dashboard/global'); }
  catch (e) { $('#sedeSw').innerHTML=''; return renderSedeDetalle(null); } // sin multisede → detalle de la sede activa
  const sedes = g.por_sede || [];
  const chips = [['', '🏛️ Todas las sedes'], ...sedes.map(s => [String(s.id), '🏫 ' + s.nombre])];
  const sw = $('#sedeSw');
  const initV = (PANEL_SEDE && sedes.some(s => String(s.id) === PANEL_SEDE)) ? PANEL_SEDE : '';
  sw.innerHTML = chips.map(([v, l]) => `<button class="seg-chip${v===initV?' active':''}" data-s="${v}">${escD(l)}</button>`).join('');
  const activar = (v) => {
    PANEL_SEDE = v;
    sw.querySelectorAll('.seg-chip').forEach(b => b.classList.toggle('active', b.dataset.s === v));
    const sel = $('#sedeSel');                 // sincronizar con el selector del encabezado
    if (v) {
      SEDE = Number(v);
      if (sel) sel.value = v;
      renderSedeDetalle(Number(v));
    } else {
      renderGlobal(g);                         // "Todas las sedes": panel agregado (el encabezado mantiene su sede)
    }
  };
  sw.querySelectorAll('.seg-chip').forEach(b => b.onclick = () => activar(b.dataset.s));
  if (initV) renderSedeDetalle(Number(initV)); else renderGlobal(g);
}

function renderGlobal(g) {
  const gl = g.global || {}, sedes = g.por_sede || [], inv = g.inventario || [], top = g.top_solicitados || [];
  const totalEq = gl.total_equipos || 0;
  const dispPct = totalEq ? Math.round((gl.equipos_disponibles / totalEq) * 100) : 0;
  const cards = [
    ['Sedes', gl.sedes || 0, 'en operación', 'brand'],
    ['Préstamos activos', gl.prestamos_activos || 0, gl.atrasados ? `${gl.atrasados} atrasados` : 'al día', gl.atrasados ? 'bad' : 'ok'],
    ['Reservas vigentes', gl.reservas_vigentes || 0, 'en curso', 'brand'],
    ['Solicitudes pend.', gl.solicitudes_pendientes || 0, gl.solicitudes_pendientes ? 'por aprobar' : 'al día', gl.solicitudes_pendientes ? 'warn' : 'ok'],
    ['Disponibilidad', dispPct + '%', `${gl.equipos_disponibles || 0} de ${totalEq} eq.`, dispPct >= 50 ? 'ok' : 'warn'],
    ['En mantención', gl.en_mantencion || 0, gl.en_mantencion ? 'fuera de servicio' : 'ninguno', gl.en_mantencion ? 'warn' : 'ok'],
  ];
  const kpisHtml = cards.map(([l, n, ctx, tone]) => `<div class="kpi ${tone}"><div class="n">${n}</div><div class="l">${l}</div><div class="ctx ${tone}">${ctx}</div></div>`).join('');
  const rows = sedes.map(s => {
    const dp = s.total_equipos ? Math.round((s.equipos_disponibles / s.total_equipos) * 100) : 0;
    return `<tr>
      <td><b>${escD(s.nombre)}</b></td>
      <td>${s.total_equipos}</td>
      <td>${s.equipos_disponibles} <span class="muted">(${dp}%)</span></td>
      <td>${s.prestamos_activos}${s.atrasados ? ` <span class="pill bad">${s.atrasados} atr.</span>` : ''}</td>
      <td>${s.reservas_vigentes}</td>
      <td>${s.solicitudes_pendientes ? `<span class="pill warn">${s.solicitudes_pendientes}</span>` : '0'}</td>
      <td>${s.en_mantencion || 0}</td>
      <td><button class="btn sm ghost" data-ver="${s.id}">Ver detalle →</button></td>
    </tr>`;
  }).join('');
  $('#dash').innerHTML = `
    <div class="kpis">${kpisHtml}</div>
    <div class="panel" style="margin-bottom:14px"><h3>Comparativa por sede</h3>
      <div style="overflow-x:auto"><table><thead><tr>
        <th>Sede</th><th>Equipos</th><th>Disponibles</th><th>Préstamos act.</th><th>Reservas</th><th>Solic.</th><th>Mant.</th><th></th>
      </tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted">Sin sedes.</td></tr>'}</tbody></table></div>
    </div>
    <div class="dash-grid">
      <div class="panel"><h3>Equipos más solicitados <span class="sub">· todas las sedes</span></h3>${topChart(top)}</div>
      <div class="panel"><h3>Estado del inventario <span class="sub">· todas las sedes</span></h3>${invChart(inv)}</div>
    </div>`;
  $('#dash').querySelectorAll('button[data-ver]').forEach(b => b.onclick = () => {
    const chip = document.querySelector('#sedeSw .seg-chip[data-s="' + b.dataset.ver + '"]');
    if (chip) chip.click();                    // delega en el chip → sincroniza panel + encabezado
    else renderSedeDetalle(Number(b.dataset.ver));
  });
}

async function renderSedeDetalle(sedeId) {
  $('#dash').innerHTML = '<p class="muted">Cargando detalle…</p>';
  let d;
  try { d = await api('/admin/dashboard' + (sedeId ? '?sede=' + sedeId : '')); }
  catch (e) { $('#dash').innerHTML = '<div class="aviso bad">No se pudo cargar el detalle de la sede.</div>'; return; }
  const k = d.kpis || {}, inv = d.inventario || [], top = d.top_solicitados || [], dev = d.devoluciones_proximas || [], tend = d.tendencia || [];
  const totalEq = k.total_equipos || 0;
  const dispPct = totalEq ? Math.round((k.equipos_disponibles/totalEq)*100) : 0;

  const alerts = [];
  if (k.atrasados > 0) alerts.push(['bad','⚠',`${k.atrasados} préstamo(s) atrasado(s) requieren seguimiento`]);
  if (k.reposiciones > 0) alerts.push(['warn','🔁',`${k.reposiciones} equipo(s) bloqueado(s) por reposición`]);
  if (k.solicitudes_pendientes > 0) alerts.push(['warn','📝',`${k.solicitudes_pendientes} solicitud(es) especial(es) por aprobar`]);
  if (!alerts.length) alerts.push(['ok','✓','Todo al día: sin atrasos ni bloqueos pendientes']);
  const alertsHtml = alerts.map(([t,ic,msg]) => `<div class="alert ${t}"><span>${ic}</span>${msg}</div>`).join('');

  const cards = [
    ['Préstamos activos', k.prestamos_activos||0, k.atrasados ? `${k.atrasados} atrasados` : 'al día', k.atrasados?'bad':'ok','📦'],
    ['Reservas vigentes', k.reservas_vigentes||0, 'en curso','brand','📅'],
    ['Solicitudes pend.', k.solicitudes_pendientes||0, k.solicitudes_pendientes?'por aprobar':'al día', k.solicitudes_pendientes?'warn':'ok','📝'],
    ['Disponibilidad', dispPct+'%', `${k.equipos_disponibles||0} de ${totalEq} eq.`, dispPct>=50?'ok':'warn','✅'],
    ['En mantención', k.en_mantencion||0, k.en_mantencion?'fuera de servicio':'ninguno', k.en_mantencion?'warn':'ok','🔧'],
    ['Sanciones vigentes', k.sanciones_vigentes||0, k.sanciones_vigentes?'alumnos restringidos':'ninguna', k.sanciones_vigentes?'warn':'ok','⛔'],
  ];
  const kpisHtml = cards.map(([l,n,ctx,tone,ic]) => `<div class="kpi ${tone}"><span class="ic">${ic}</span><div class="n">${n}</div><div class="l">${l}</div><div class="ctx ${tone}">${ctx}</div></div>`).join('');

  $('#dash').innerHTML = `
    <div class="alerts">${alertsHtml}</div>
    <div class="kpis">${kpisHtml}</div>
    <div class="dash-grid">
      <div class="panel"><h3>Equipos más solicitados <span class="sub">por reservas</span></h3>${topChart(top)}</div>
      <div class="panel"><h3>Estado del inventario</h3>${invChart(inv)}</div>
    </div>
    <div class="dash-grid" style="margin-top:14px">
      <div class="panel"><h3>Tendencia de préstamos <span class="sub">últimas 8 semanas</span></h3>${trendChart(tend)}</div>
      <div class="panel"><h3>Próximas devoluciones y atrasos</h3><div class="dev-list">${devList(dev)}</div></div>
    </div>`;
}

// ----- Admin: Inventario -----
async function viewInventario() {
  const multi = !!(ME.sedes && ME.sedes.length > 1);
  h(`<h2 class="page">Inventario</h2>
     <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
       <button class="btn sm" id="addEq">+ Nuevo equipo</button>
       ${multi ? `<label class="muted" style="font-size:13px">Sede:
         <select id="invSede" style="margin-left:4px"><option value="">Sede activa</option><option value="todos">Todas las sedes</option></select></label>` : ''}
     </div>
     <div id="resumen"></div>
     <h3 class="muted" style="margin:16px 0 8px;font-size:15px">Detalle por unidad</h3>
     <div id="tbl"></div>`);

  async function cargar() {
    const todos = multi && $('#invSede') && $('#invSede').value === 'todos';
    const sc = todos ? '?scope=todos' : '';
    const [resumen, eq] = await Promise.all([ api('/inventario/resumen' + sc), api('/equipos' + sc) ]);
    const totG = eq.length, dispG = eq.filter(e => e.estado === 'disponible').length;
    const kpi = (n, t) => `<div style="flex:1;min-width:120px;background:#fff;border:1px solid var(--line,#DCE2EA);border-radius:12px;padding:12px 14px">
       <b style="font-size:24px;display:block;color:#0A463B">${n}</b><span class="muted" style="font-size:12.5px">${t}</span></div>`;
    $('#resumen').innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        ${kpi(totG, 'Unidades totales')}${kpi(dispG, 'Disponibles')}${kpi(totG - dispG, 'No disponibles')}
      </div>
      <table><thead><tr><th>Categoría</th><th>Artículo</th>${todos ? '<th>Sede</th>' : ''}<th>Total</th><th>Disp.</th><th>Prest.</th><th>Mant.</th></tr></thead><tbody>${
        resumen.map(r => `<tr><td>${escD(r.categoria)}</td><td><b>${escD(r.articulo)}</b></td>${todos ? `<td>${escD(r.sede)}</td>` : ''}
          <td>${r.total}</td><td><b style="color:#1B7A3D">${r.disponible}</b></td><td>${r.prestado}</td><td>${r.mantencion}</td></tr>`).join('')
      }</tbody></table>`;

    $('#tbl').innerHTML = `<table><thead><tr><th>Equipo</th><th>Categoría</th>${todos ? '<th>Sede</th>' : ''}<th>N° serie</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${
      eq.map(e => {
        const [lab, cls] = ESTADO_EQ[e.estado] || [e.estado, 'info'];
        return `<tr><td><b>${escD(e.nombre)}</b><br><small class="muted">${escD(e.codigo_qr)}</small> · <button class="btn sm ghost" data-ficha="${e.id}" style="padding:1px 8px">Ficha</button></td><td>${escD(e.categoria)}</td>${todos ? `<td>${escD(e.sede || '')}</td>` : ''}
          <td>${escD(e.n_serie || '—')}</td><td><span class="pill ${cls}">${lab}</span></td>
          <td><select data-id="${e.id}" class="estSel">
            <option ${e.estado === 'disponible' ? 'selected' : ''} value="disponible">Disponible</option>
            <option ${e.estado === 'mantencion' ? 'selected' : ''} value="mantencion">Mantención</option>
            <option ${e.estado === 'baja' ? 'selected' : ''} value="baja">De baja</option>
          </select></td></tr>`;
      }).join('')}</tbody></table>`;
    $('#tbl').querySelectorAll('.estSel').forEach(s => s.onchange = async () => {
      try { await api(`/admin/equipos/${s.dataset.id}/estado`, { method: 'POST', body: { estado: s.value } }); toast('Estado actualizado'); }
      catch (e) { toast(e.message); }
    });
    $('#tbl').querySelectorAll('button[data-ficha]').forEach(b => b.onclick = () => fichaEquipo(b.dataset.ficha));
  }
  if ($('#invSede')) $('#invSede').onchange = cargar;
  $('#addEq').onclick = modalNuevoEquipo;
  await cargar();
}
async function modalNuevoEquipo() {
  openModal(`<h3>Nuevo equipo</h3>
    <div class="field"><label>Código QR</label><input id="nQr" placeholder="QR-CAM-010"></div>
    <div class="field"><label>Nombre</label><input id="nNom"></div>
    <div class="field"><label>Marca / modelo</label><input id="nMar"></div>
    <div class="field"><label>N° de serie</label><input id="nSerie" placeholder="SN-..."></div>
    <div class="field"><label>Categoría (id)</label><input id="nCat" type="number" placeholder="1=Cámaras … 6=Recintos"></div>
    <div class="field"><label>Tipo</label><select id="nTipo"><option value="equipo">Equipo</option><option value="recinto">Recinto</option></select></div>
    <div class="err" id="nErr"></div>
    <button class="btn full" id="nOk">Crear</button>`);
  $('#nOk').onclick = async () => {
    try {
      await api('/admin/equipos', { method:'POST', body:{
        codigo_qr:$('#nQr').value.trim(), nombre:$('#nNom').value.trim(), marca:$('#nMar').value.trim(),
        n_serie:$('#nSerie').value.trim(), categoria_id:Number($('#nCat').value), tipo:$('#nTipo').value }});
      closeModal(); toast('Equipo creado'); viewInventario();
    } catch (e) { $('#nErr').textContent = e.message; }
  };
}

// ----- Admin: Mantenciones -----
async function viewMantenciones() {
  h(`<h2 class="page">Mantenciones</h2>
     <button class="btn sm" id="addM" style="margin-bottom:12px">+ Registrar mantención</button>
     <div id="tbl"></div>`);
  const m = await api('/admin/mantenciones');
  $('#tbl').innerHTML = m.length ? `<table><thead><tr><th>Equipo</th><th>Tipo</th><th>Fecha</th><th>Detalle</th><th>Costo</th></tr></thead><tbody>${
    m.map(x => `<tr><td><b>${x.equipo}</b><br><small class="muted">${x.codigo_qr}</small></td><td>${x.tipo}</td>
      <td>${x.fecha}</td><td>${x.detalle||'—'}</td><td>${x.costo?('$'+Number(x.costo).toLocaleString('es-CL')):'—'}</td></tr>`).join('')
    }</tbody></table>` : '<p class="muted">Sin mantenciones registradas.</p>';
  $('#addM').onclick = modalMantencion;
}
async function modalMantencion() {
  const eq = await api('/equipos');
  openModal(`<h3>Registrar mantención</h3>
    <div class="field"><label>Equipo</label><select id="mEq">${eq.map(e=>`<option value="${e.id}">${e.nombre} · ${e.codigo_qr}</option>`).join('')}</select></div>
    <div class="field"><label>Tipo</label><select id="mTipo">
      <option value="preventiva">Preventiva</option><option value="correctiva">Correctiva</option>
      <option value="calibracion">Calibración</option><option value="reposicion">Reposición</option></select></div>
    <div class="field"><label>Detalle</label><input id="mDet" placeholder="Descripción del trabajo"></div>
    <div class="field"><label>Costo (opcional)</label><input id="mCosto" type="number" placeholder="0"></div>
    <div class="toggle"><input type="checkbox" id="mCerrar"><label for="mCerrar" style="margin:0">Marcar equipo como disponible al cerrar</label></div>
    <div class="err" id="mErr"></div>
    <button class="btn full" id="mOk">Registrar</button>`);
  $('#mOk').onclick = async () => {
    try {
      await api('/admin/mantenciones', { method:'POST', body:{
        equipo_id:Number($('#mEq').value), tipo:$('#mTipo').value, detalle:$('#mDet').value.trim(),
        costo:$('#mCosto').value?Number($('#mCosto').value):null, cerrar:$('#mCerrar').checked }});
      closeModal(); toast('Mantención registrada'); viewMantenciones();
    } catch (e) { $('#mErr').textContent = e.message; }
  };
}

// ----- Admin: Importar Excel (RF-11/44) -----
function viewImportar() {
  const esPanolero = ME.user.rol === 'panolero';
  const titulo = esPanolero ? 'Importar inventario' : 'Importar desde Excel';
  const cards = cardImport('equipos', 'Inventario de equipos', 'codigo_qr · nombre · modelo · marca · n_serie · categoria · tipo')
    + (esPanolero ? '' : cardImport('nomina', 'Nómina de usuarios', 'rut · nombre · email · rol'));
  h(`<h2 class="page">${titulo}</h2>
     <p class="muted">Carga masiva con validación por fila para tu sede. Descarga la plantilla, complétala y súbela.</p>
     <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
       ${cards}
     </div>
     <div id="impRes" style="margin-top:16px"></div>`);
  view().querySelectorAll('[data-tpl]').forEach(b => b.onclick = async () => {
    const r = await fetch('/api/admin/import/plantilla/'+b.dataset.tpl, { headers:{ Authorization:'Bearer '+TOKEN }});
    const blob = await r.blob(); const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = 'plantilla_'+b.dataset.tpl+'.xlsx'; a.click(); URL.revokeObjectURL(u);
  });
  view().querySelectorAll('[data-imp]').forEach(inp => inp.onchange = async () => {
    const tipo = inp.dataset.imp, file = inp.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('archivo', file);
    $('#impRes').innerHTML = '<p class="muted">Procesando…</p>';
    try {
      const r = await fetch('/api/admin/import/'+tipo, { method:'POST', headers:{ Authorization:'Bearer '+TOKEN }, body:fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.error||'Error');
      renderImport(tipo, d);
    } catch (e) { $('#impRes').innerHTML = `<div class="aviso bad">${e.message}</div>`; }
    inp.value = '';
  });
}
function cardImport(tipo, titulo, cols) {
  return `<div class="card"><h3>${titulo}</h3><div class="cat">${cols}</div>
    <button class="btn sm ghost" data-tpl="${tipo}" style="margin:6px 8px 6px 0">Descargar plantilla</button>
    <label class="btn sm" style="display:inline-block">Subir archivo
      <input type="file" accept=".xlsx" data-imp="${tipo}" style="display:none"></label></div>`;
}
function renderImport(tipo, d) {
  const okMsg = tipo === 'nomina'
    ? `${d.insertados} nuevos · ${d.actualizados} actualizados`
    : `${d.insertados} insertados`;
  const errs = (d.errores||[]).length
    ? `<table style="margin-top:10px"><thead><tr><th>Fila</th><th>Error</th></tr></thead><tbody>${
        d.errores.map(e=>`<tr><td>${e.fila}</td><td>${e.error}</td></tr>`).join('')}</tbody></table>`
    : '<div class="aviso ok" style="margin-top:10px">Sin errores.</div>';
  $('#impRes').innerHTML = `<div class="aviso ok">Procesado: ${d.total} filas · ${okMsg} · ${(d.errores||[]).length} con error.</div>${errs}`;
  toast('Importación completada');
}

// ----- Admin: Autorizaciones -----
async function viewAutoriz() {
  h(`<h2 class="page">Autorizaciones de recintos</h2><div id="tbl"></div>`);
  const a = await api('/autorizaciones');
  if (!a.length) { $('#tbl').innerHTML = '<p class="muted">Sin autorizaciones pendientes.</p>'; return; }
  const niveles = { jefatura_carrera:'Jefatura de Carrera', direccion_academica:'Dirección Académica (DAO)' };
  $('#tbl').innerHTML = `<table><thead><tr><th>Recinto</th><th>Solicitante</th><th>Fecha</th><th>Nivel</th><th>Decisión</th></tr></thead><tbody>${
    a.map(x => `<tr><td>${x.recinto}</td><td>${x.solicitante}</td><td>${fmtDate(x.fecha_inicio)}</td>
      <td>${niveles[x.nivel]||x.nivel}</td>
      <td><button class="btn sm" data-ok="${x.id}">Aprobar</button> <button class="btn sm danger" data-no="${x.id}">Rechazar</button></td></tr>`).join('')
    }</tbody></table>`;
  const act = async (id, decision) => { await api(`/autorizaciones/${id}`, { method:'POST', body:{ decision }}); toast('Autorización '+decision); viewAutoriz(); };
  $('#tbl').querySelectorAll('button[data-ok]').forEach(b => b.onclick = () => act(b.dataset.ok,'aprobada'));
  $('#tbl').querySelectorAll('button[data-no]').forEach(b => b.onclick = () => act(b.dataset.no,'rechazada'));
}

// ----- Admin: Sanciones -----
async function viewSanciones() {
  h(`<h2 class="page">Sanciones</h2><div id="tbl"></div>`);
  const s = await api('/admin/sanciones');
  if (!s.length) { $('#tbl').innerHTML = '<p class="muted">Sin sanciones.</p>'; return; }
  $('#tbl').innerHTML = `<table><thead><tr><th>Usuario</th><th>Motivo</th><th>Tramo</th><th>Hasta</th><th>Estado</th><th></th></tr></thead><tbody>${
    s.map(x => `<tr><td>${x.nombre}<br><small class="muted">${x.usuario_rut}</small></td><td>${x.motivo}</td>
      <td>${x.tramo}${x.solidaria?' · solidaria':''}</td><td>${x.fecha_fin}</td>
      <td><span class="pill ${x.vigente?'bad':'info'}">${x.vigente?'Vigente':'Levantada'}</span></td>
      <td>${x.vigente?`<button class="btn sm ghost" data-l="${x.id}">Levantar</button>`:''}</td></tr>`).join('')
    }</tbody></table>`;
  $('#tbl').querySelectorAll('button[data-l]').forEach(b => b.onclick = async () => {
    await api(`/admin/sanciones/${b.dataset.l}/levantar`, { method:'POST', body:{} }); toast('Sanción levantada'); viewSanciones();
  });
}

// ----- Admin: Usuarios (gestión) -----
const ROL_LBL = {alumno:'Alumno',docente:'Docente',panolero:'Pañolero',jefe_panol:'Jefe de Pañol',admin:'Administrador'};
const EST_OPTS = ['activo','inactivo','suspendido'];

async function viewUsuarios() {
  h(`<h2 class="page">Usuarios</h2>
     <button class="btn sm" id="nu" style="margin-bottom:12px">+ Nuevo usuario</button>
     <div id="tbl">Cargando…</div>`);
  $('#nu').onclick = () => usuarioForm();
  const u = await api('/admin/usuarios');
  if (!u.length) { $('#tbl').innerHTML = '<p class="muted">Sin usuarios.</p>'; return; }
  const byRut = Object.fromEntries(u.map(x => [x.rut, x]));
  $('#tbl').innerHTML = `<table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${
    u.map(x => `<tr>
      <td><b>${escD(x.nombre)}</b><br><small class="muted">${escD(x.rut)}</small></td>
      <td>${escD(x.email||'—')}</td>
      <td><select class="rolSel" data-rut="${escD(x.rut)}">${Object.keys(ROL_LBL).map(r=>`<option value="${r}" ${x.rol===r?'selected':''}>${ROL_LBL[r]}</option>`).join('')}</select></td>
      <td><select class="estSelU" data-rut="${escD(x.rut)}">${EST_OPTS.map(e=>`<option value="${e}" ${x.estado===e?'selected':''}>${e}</option>`).join('')}</select></td>
      <td><button class="btn sm ghost ed" data-rut="${escD(x.rut)}">Editar</button>
          <button class="btn sm ghost cl" data-rut="${escD(x.rut)}">Clave</button></td>
    </tr>`).join('')}</tbody></table>`;
  $('#tbl').querySelectorAll('.rolSel').forEach(s => s.onchange = async () => {
    try { await api(`/admin/usuarios/${encodeURIComponent(s.dataset.rut)}`, { method:'PUT', body:{ rol:s.value }}); toast('Rol actualizado'); }
    catch(e){ toast(e.message||'Error'); }
  });
  $('#tbl').querySelectorAll('.estSelU').forEach(s => s.onchange = async () => {
    try { await api(`/admin/usuarios/${encodeURIComponent(s.dataset.rut)}/estado`, { method:'POST', body:{ estado:s.value }}); toast('Estado actualizado'); }
    catch(e){ toast(e.message||'Error'); }
  });
  $('#tbl').querySelectorAll('.ed').forEach(b => b.onclick = () => usuarioForm(byRut[b.dataset.rut]));
  $('#tbl').querySelectorAll('.cl').forEach(b => b.onclick = () => claveForm(b.dataset.rut));
}

function usuarioForm(u) {
  const edit = !!u;
  openModal(`<h3>${edit?'Editar usuario':'Nuevo usuario'}</h3>
    <div class="field"><label>RUT</label><input id="fRut" value="${edit?escD(u.rut):''}" ${edit?'disabled':''} placeholder="12.345.678-9"></div>
    <div class="field"><label>Nombre</label><input id="fNom" value="${edit?escD(u.nombre):''}"></div>
    <div class="field"><label>Correo</label><input id="fEmail" value="${edit?escD(u.email||''):''}" placeholder="correo@ust.cl"></div>
    <div class="field"><label>Rol</label><select id="fRol">${Object.keys(ROL_LBL).map(r=>`<option value="${r}" ${edit&&u.rol===r?'selected':''}>${ROL_LBL[r]}</option>`).join('')}</select></div>
    <div class="field"><label>Estado</label><select id="fEst">${EST_OPTS.map(e=>`<option value="${e}" ${edit&&u.estado===e?'selected':''}>${e}</option>`).join('')}</select></div>
    ${edit?'':'<div class="field"><label>Clave inicial (opcional)</label><input id="fPass" type="password" placeholder="mín. 6 caracteres"></div>'}
    <button class="btn full" id="fOk">${edit?'Guardar':'Crear'}</button>
    <div class="err" id="fErr"></div>`);
  $('#fOk').onclick = async () => {
    $('#fErr').textContent = '';
    const body = { nombre:$('#fNom').value.trim(), email:$('#fEmail').value.trim()||null, rol:$('#fRol').value, estado:$('#fEst').value };
    try {
      if (edit) {
        await api(`/admin/usuarios/${encodeURIComponent(u.rut)}`, { method:'PUT', body });
      } else {
        body.rut = formatRut($('#fRut').value);
        const p = $('#fPass').value; if (p) body.password = p;
        if (!body.rut || !body.nombre) { $('#fErr').textContent = 'RUT y nombre son obligatorios'; return; }
        await api('/admin/usuarios', { method:'POST', body });
      }
      closeModal(); toast(edit?'Usuario actualizado':'Usuario creado'); viewUsuarios();
    } catch(e){ $('#fErr').textContent = e.message || 'Error'; }
  };
}

function claveForm(rut) {
  openModal(`<h3>Cambiar clave</h3><p class="muted" style="font-size:12.5px">Usuario ${escD(rut)}</p>
    <div class="field"><label>Nueva clave</label><input id="cPass" type="password" placeholder="mín. 6 caracteres"></div>
    <button class="btn full" id="cOk">Guardar clave</button><div class="err" id="cErr"></div>`);
  $('#cOk').onclick = async () => {
    const p = $('#cPass').value;
    if (!p || p.length < 6) { $('#cErr').textContent = 'La clave debe tener al menos 6 caracteres'; return; }
    try { await api(`/admin/usuarios/${encodeURIComponent(rut)}/clave`, { method:'POST', body:{ password:p }}); closeModal(); toast('Clave actualizada'); }
    catch(e){ $('#cErr').textContent = e.message || 'Error'; }
  };
}

// ----- Mi perfil (todos los roles) -----
async function viewPerfil() {
  const u = ME.user;
  h(`<h2 class="page">Mi perfil</h2>
     <div class="card" style="max-width:460px">
       <div class="field"><label>RUT</label><input value="${escD(u.rut)}" disabled></div>
       <div class="field"><label>Rol</label><input value="${({alumno:'Alumno',docente:'Docente',panolero:'Pañolero',jefe_panol:'Jefe de Pañol',admin:'Administrador'})[u.rol]||u.rol}" disabled></div>
       <div class="field"><label>Nombre</label><input id="pNom" value="${escD(u.nombre||'')}"></div>
       <div class="field"><label>Correo</label><input id="pEmail" value="${escD(u.email||'')}" placeholder="correo@ust.cl"></div>
       <button class="btn full" id="pGuardar">Guardar datos</button>
       <div class="err" id="pErr"></div>
       <div style="border-top:1px solid var(--line);margin:16px 0 12px"></div>
       <h3 style="font-size:15px;margin:0 0 8px">Cambiar clave</h3>
       <div class="field"><label>Nueva clave</label><input id="pPass" type="password" placeholder="mín. 6 caracteres"></div>
       <button class="btn full ghost" id="pClave">Actualizar clave</button>
       <div class="err" id="pErr2"></div>
     </div>`);
  $('#pGuardar').onclick = async () => {
    $('#pErr').textContent = '';
    const nombre = $('#pNom').value.trim(), email = $('#pEmail').value.trim();
    if (!nombre) { $('#pErr').textContent = 'El nombre no puede quedar vacío'; return; }
    try {
      await api('/perfil', { method:'PUT', body:{ nombre, email: email || null } });
      ME.user.nombre = nombre; ME.user.email = email;
      $('#whoName').textContent = nombre;
      toast('Datos actualizados');
    } catch(e){ $('#pErr').textContent = e.message || 'Error'; }
  };
  $('#pClave').onclick = async () => {
    $('#pErr2').textContent = '';
    const p = $('#pPass').value;
    if (!p || p.length < 6) { $('#pErr2').textContent = 'La clave debe tener al menos 6 caracteres'; return; }
    try { await api('/perfil', { method:'PUT', body:{ password:p } }); $('#pPass').value=''; toast('Clave actualizada'); }
    catch(e){ $('#pErr2').textContent = e.message || 'Error'; }
  };
}

// ----- Admin: Estructura académica -----
async function viewAcademico() {
  h(`<h2 class="page">Estructura académica</h2>
     <button class="btn sm" id="nc" style="margin-bottom:14px">+ Nueva carrera</button>
     <div id="aca">Cargando…</div>`);
  $('#nc').onclick = () => carreraForm();
  await renderAcademico();
}
async function renderAcademico() {
  const d = await api('/academico');
  const carreras = d.carreras || [], asigs = d.asignaturas || [];
  if (!carreras.length) { $('#aca').innerHTML = '<p class="muted">Sin carreras. Crea la primera con "+ Nueva carrera".</p>'; return; }
  const byCar = {};
  asigs.forEach(a => { (byCar[a.carrera_id] = byCar[a.carrera_id] || []).push(a); });
  $('#aca').innerHTML = carreras.map(c => `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <b style="font-size:15px;flex:1;min-width:140px">${escD(c.nombre)}</b>
        <button class="btn sm ghost ec" data-id="${c.id}" data-nom="${escD(c.nombre)}">Editar</button>
        <button class="btn sm ghost dc" data-id="${c.id}">Eliminar</button>
        <button class="btn sm na" data-id="${c.id}">+ Asignatura</button>
      </div>
      ${(byCar[c.id]||[]).length ? `<table><thead><tr><th>Asignatura</th><th>Sección</th><th>Acciones</th></tr></thead><tbody>${
        (byCar[c.id]||[]).map(a => `<tr>
          <td>${escD(a.nombre)}</td><td>${escD(a.seccion||'—')}</td>
          <td><button class="btn sm ghost ea" data-id="${a.id}" data-nom="${escD(a.nombre)}" data-sec="${escD(a.seccion||'')}">Editar</button>
              <button class="btn sm ghost ins" data-id="${a.id}" data-nom="${escD(a.nombre)}">Inscritos</button>
              <button class="btn sm ghost eqp" data-id="${a.id}" data-nom="${escD(a.nombre)}">Equipos</button>
              <button class="btn sm ghost da" data-id="${a.id}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table>` : '<p class="muted" style="font-size:12.5px">Sin asignaturas aún.</p>'}
    </div>`).join('');
  $('#aca').querySelectorAll('.ec').forEach(b => b.onclick = () => carreraForm({ id:b.dataset.id, nombre:b.dataset.nom }));
  $('#aca').querySelectorAll('.dc').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar la carrera y todas sus asignaturas?')) return;
    try { await api(`/admin/carreras/${b.dataset.id}`, { method:'DELETE' }); toast('Carrera eliminada'); renderAcademico(); } catch(e){ toast(e.message||'Error'); }
  });
  $('#aca').querySelectorAll('.na').forEach(b => b.onclick = () => asignaturaForm(b.dataset.id));
  $('#aca').querySelectorAll('.ea').forEach(b => b.onclick = () => asignaturaForm(null, { id:b.dataset.id, nombre:b.dataset.nom, seccion:b.dataset.sec }));
  $('#aca').querySelectorAll('.da').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar la asignatura?')) return;
    try { await api(`/admin/asignaturas/${b.dataset.id}`, { method:'DELETE' }); toast('Asignatura eliminada'); renderAcademico(); } catch(e){ toast(e.message||'Error'); }
  });
  $('#aca').querySelectorAll('.ins').forEach(b => b.onclick = () => inscritosModal(b.dataset.id, b.dataset.nom));
  $('#aca').querySelectorAll('.eqp').forEach(b => b.onclick = () => elegibilidadModal(b.dataset.id, b.dataset.nom));
}

// Opción 1: categorías de equipo habilitadas por asignatura (elegibilidad)
async function elegibilidadModal(asigId, nombre) {
  openModal(`<h3>Equipos habilitados</h3>
    <p class="muted" style="margin-top:0">${escD(nombre)} — marca las <b>categorías</b> de equipo que esta asignatura puede reservar.</p>
    <div id="elList" style="max-height:48vh;overflow:auto;margin-bottom:12px">Cargando…</div>
    <div class="err" id="elErr"></div>
    <button class="btn full" id="elOk">Guardar</button>`);
  let cats = [];
  try { cats = await api(`/admin/asignaturas/${asigId}/elegibilidad`); }
  catch (e) { $('#elList').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
  $('#elList').innerHTML = cats.map(c => `
    <label class="toggle" style="justify-content:flex-start;gap:10px;padding:6px 0">
      <input type="checkbox" class="elchk" value="${c.id}" ${c.habilitada ? 'checked' : ''}>
      <span style="margin:0"><b>${escD(c.nombre)}</b> <small class="muted">· ${c.equipos} equipo(s) en esta sede</small></span>
    </label>`).join('') || '<p class="muted">No hay categorías registradas.</p>';
  $('#elOk').onclick = async () => {
    const categorias = [...document.querySelectorAll('.elchk:checked')].map(c => Number(c.value));
    try {
      const r = await api(`/admin/asignaturas/${asigId}/elegibilidad`, { method: 'PUT', body: { categorias } });
      closeModal(); toast(`Categorías habilitadas: ${r.habilitadas}`);
    } catch (e) { $('#elErr').textContent = e.message || 'Error'; }
  };
}
function carreraForm(c) {
  const edit = !!c;
  openModal(`<h3>${edit?'Editar carrera':'Nueva carrera'}</h3>
    <div class="field"><label>Nombre</label><input id="cN" value="${edit?escD(c.nombre):''}" placeholder="Ej. Comunicación Audiovisual Digital"></div>
    <button class="btn full" id="cOkk">${edit?'Guardar':'Crear'}</button><div class="err" id="cE"></div>`);
  $('#cOkk').onclick = async () => {
    const nombre = $('#cN').value.trim();
    if (!nombre) { $('#cE').textContent = 'El nombre es obligatorio'; return; }
    try {
      if (edit) await api(`/admin/carreras/${c.id}`, { method:'PUT', body:{ nombre } });
      else await api('/admin/carreras', { method:'POST', body:{ nombre } });
      closeModal(); toast(edit?'Carrera actualizada':'Carrera creada'); renderAcademico();
    } catch(e){ $('#cE').textContent = e.message || 'Error'; }
  };
}
function asignaturaForm(carreraId, a) {
  const edit = !!a;
  openModal(`<h3>${edit?'Editar asignatura':'Nueva asignatura'}</h3>
    <div class="field"><label>Nombre</label><input id="aN" value="${edit?escD(a.nombre):''}"></div>
    <div class="field"><label>Sección</label><input id="aS" value="${edit?escD(a.seccion||''):''}" placeholder="Ej. 01"></div>
    <button class="btn full" id="aOk">${edit?'Guardar':'Crear'}</button><div class="err" id="aE"></div>`);
  $('#aOk').onclick = async () => {
    const nombre = $('#aN').value.trim(), seccion = $('#aS').value.trim() || null;
    if (!nombre) { $('#aE').textContent = 'El nombre es obligatorio'; return; }
    try {
      if (edit) await api(`/admin/asignaturas/${a.id}`, { method:'PUT', body:{ nombre, seccion } });
      else await api('/admin/asignaturas', { method:'POST', body:{ nombre, seccion, carrera_id:Number(carreraId) } });
      closeModal(); toast(edit?'Asignatura actualizada':'Asignatura creada'); renderAcademico();
    } catch(e){ $('#aE').textContent = e.message || 'Error'; }
  };
}
async function inscritosModal(asigId, nom) {
  openModal(`<h3>Inscritos</h3><p class="muted" style="font-size:12.5px;margin:-4px 0 10px">${escD(nom)}</p>
    <div id="insList">Cargando…</div>
    <div style="border-top:1px solid var(--line);margin:12px 0 10px"></div>
    <div class="field"><label>Inscribir (RUT)</label><input id="iR" list="usrList" placeholder="12.345.678-9"></div>
    <div class="field"><label>Rol en la asignatura</label><select id="iRol"><option value="alumno">Alumno</option><option value="docente">Docente</option></select></div>
    <datalist id="usrList"></datalist>
    <button class="btn full" id="iOk">Inscribir</button><div class="err" id="iE"></div>`);
  try {
    const us = await api('/admin/usuarios');
    $('#usrList').innerHTML = us.map(u => `<option value="${escD(u.rut)}">${escD(u.nombre)}</option>`).join('');
  } catch(e){}
  async function pintarInscritos() {
    const list = await api(`/admin/asignaturas/${asigId}/inscritos`);
    $('#insList').innerHTML = list.length ? list.map(x => `<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(x.nombre)}</b><small>${escD(x.rut)} · ${x.rol_en_asig}</small></div><button class="btn sm ghost rm" data-rut="${escD(x.rut)}">Quitar</button></div>`).join('') : '<p class="muted" style="font-size:12.5px">Sin inscritos.</p>';
    $('#insList').querySelectorAll('.rm').forEach(b => b.onclick = async () => {
      try { await api(`/admin/asignaturas/${asigId}/inscritos/${encodeURIComponent(b.dataset.rut)}`, { method:'DELETE' }); pintarInscritos(); } catch(e){ toast(e.message||'Error'); }
    });
  }
  await pintarInscritos();
  $('#iOk').onclick = async () => {
    $('#iE').textContent = '';
    const rut = $('#iR').value.trim(); if (!rut) { $('#iE').textContent = 'Ingresa un RUT'; return; }
    try { await api(`/admin/asignaturas/${asigId}/inscritos`, { method:'POST', body:{ usuario_rut:rut, rol_en_asig:$('#iRol').value } }); $('#iR').value=''; pintarInscritos(); toast('Inscrito'); }
    catch(e){ $('#iE').textContent = e.message || 'Error'; }
  };
}

// ----- Tareas (docente / alumno) -----
function dtLocal(iso){ if(!iso) return ''; const d=new Date(iso); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

async function viewTareas() {
  const docente = ME.user.rol === 'docente' || ME.user.rol === 'admin';
  h(`<h2 class="page">Tareas</h2>
     ${docente ? '<button class="btn sm" id="nt" style="margin-bottom:14px">+ Nueva tarea</button>' : '<p class="muted" style="margin:-8px 0 14px;font-size:13px">Tareas vigentes de tus asignaturas. Entra para reservar los equipos habilitados.</p>'}
     <div id="tl">Cargando…</div>`);
  if (docente) $('#nt').onclick = () => tareaForm();
  const ts = await api('/tareas');
  if (!ts.length) { $('#tl').innerHTML = '<p class="muted">No hay tareas.</p>'; return; }
  $('#tl').innerHTML = ts.map(t => `
    <div class="row tareaItem" data-id="${t.id}" style="cursor:pointer">
      <div class="ava">📝</div>
      <div class="info"><b>${escD(t.titulo)}</b><small>${escD(t.asignatura)}${t.seccion?(' · '+escD(t.seccion)):''} · ${t.tipo} · ${fmtDate(t.fecha_inicio)} → ${fmtDate(t.fecha_fin)}</small></div>
      ${docente ? `<span class="pill info">${t.reservas||0} reservas</span>` : '<span class="pill ok">ver</span>'}
    </div>`).join('');
  $('#tl').querySelectorAll('.tareaItem').forEach(el => el.onclick = () => tareaDetalle(el.dataset.id));
}

async function tareaDetalle(id) {
  const d = await api(`/tareas/${id}`);
  const t = d.tarea, docente = ME.user.rol==='docente'||ME.user.rol==='admin';
  const cats = d.categorias || [];
  const catsHtml = cats.length
    ? cats.map(c=>`<span class="pill info" style="margin:2px 4px 2px 0;display:inline-block">${escD(c.nombre)} · ${c.disponibles} disp.</span>`).join('')
    : '<span class="muted" style="font-size:12.5px">Sin categorías habilitadas.</span>';
  let bodyEquipos = '';
  if (docente) {
    bodyEquipos = `<h3 style="font-size:15px;margin:12px 0 8px">Categorías habilitadas</h3><div>${catsHtml}</div>`;
  } else {
    // RF-11: el alumno ve un RESUMEN del equipamiento (categorías) y reserva una CATEGORÍA.
    // La unidad física la individualiza el pañol al entregar.
    const items = cats.length
      ? cats.map(c=>{
          const ya = c.ya_reservada;
          const sinStock = c.disponibles < 1;
          const btn = ya
            ? `<button class="btn sm ghost" disabled>Reservado ✓</button>`
            : `<button class="btn sm rsvcat" data-cid="${c.id}" data-cnom="${escD(c.nombre)}" ${sinStock?'disabled title="Sin unidades disponibles"':''}>Reservar</button>`;
          return `<div class="row" style="margin-bottom:6px"><div class="ava">${icon(c.nombre)}</div><div class="info"><b>${escD(c.nombre)}</b><small>${ya?'Ya reservaste esta categoría':c.disponibles+' unidad(es) disponible(s)'}</small></div>${btn}</div>`;
        }).join('')
      : '<p class="muted">Sin categorías habilitadas.</p>';
    bodyEquipos = `<h3 style="font-size:15px;margin:12px 0 8px">Equipamiento solicitado para la tarea</h3>
      <p class="muted" style="font-size:11.5px;margin:-4px 0 8px">Reservas por categoría; el pañol asigna la unidad al entregar. Las fechas coinciden con las de la tarea.</p>
      <div id="tcats">${items}</div>`;
  }
  const resHtml = docente ? (d.reservas.length ? `<h3 style="font-size:15px;margin:14px 0 8px">Reservas de alumnos</h3>`+d.reservas.map(r=>`<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(r.alumno)}</b><small>${escD(r.equipo)} · ${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)}</small></div><span class="pill ${(ESTADO_RES[r.estado]||['','info'])[1]}">${(ESTADO_RES[r.estado]||[r.estado])[0]}</span></div>`).join('') : '<p class="muted" style="margin-top:14px">Aún sin reservas de alumnos.</p>') : '';
  openModal(`<h3>${escD(t.titulo)}</h3>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 8px">${escD(t.asignatura)}${t.seccion?(' · '+escD(t.seccion)):''} · ${t.tipo}<br>${fmtDate(t.fecha_inicio)} → ${fmtDate(t.fecha_fin)}</p>
    ${t.descripcion?`<p style="font-size:13px">${escD(t.descripcion)}</p>`:''}
    ${bodyEquipos}
    ${resHtml}
    ${docente?`<button class="btn full ghost danger" id="delT" style="margin-top:14px">Eliminar tarea</button>`:''}`);
  if (!docente) {
    (document.querySelector('#tcats')||document).querySelectorAll('.rsvcat').forEach(b => b.onclick = () => reservarCategoriaForm(id, b.dataset.cid, b.dataset.cnom, t));
  } else {
    $('#delT').onclick = async () => { if(!confirm('¿Eliminar la tarea?'))return; try{ await api(`/tareas/${id}`,{method:'DELETE'}); closeModal(); toast('Tarea eliminada'); viewTareas(); }catch(e){ toast(e.message||'Error'); } };
  }
}

function reservarCategoriaForm(tareaId, catId, catNom, t) {
  const grupal = t.tipo === 'grupal';
  openModal(`<h3>Reservar categoría: ${escD(catNom)}</h3>
    <p class="muted" style="font-size:12px;margin:-4px 0 8px">Dentro de la tarea · fechas fijadas por el docente · la unidad la asigna el pañol al entregar</p>
    <div class="field"><label>Inicio</label><input type="datetime-local" value="${dtLocal(t.fecha_inicio)}" disabled></div>
    <div class="field"><label>Término</label><input type="datetime-local" value="${dtLocal(t.fecha_fin)}" disabled></div>
    ${grupal ? `<label style="font-size:12px;font-weight:600;color:var(--muted)">Integrantes del grupo (deben estar en la misma asignatura y sección)</label>
      <div id="tInts"></div>
      <button class="btn sm ghost" id="tAddInt" style="margin:4px 0 8px">+ Agregar integrante</button>` : ''}
    <button class="btn full" id="rOk">Confirmar reserva</button><div class="err" id="rE"></div>`);
  if (grupal) {
    const cont = $('#tInts');
    $('#tAddInt').onclick = () => {
      const d = document.createElement('div'); d.className = 'integrantes-row';
      d.innerHTML = `<input placeholder="Nombre (opcional)" class="i-nom"><input placeholder="RUT" class="i-rut"><button class="btn sm danger">×</button>`;
      d.querySelector('button').onclick = () => d.remove();
      cont.appendChild(d);
    };
  }
  $('#rOk').onclick = async () => {
    $('#rE').textContent='';
    const integrantes = grupal
      ? [...document.querySelectorAll('#tInts .integrantes-row')].map(r=>({ nombre:r.querySelector('.i-nom').value.trim(), rut:r.querySelector('.i-rut').value.trim() })).filter(x=>x.rut)
      : [];
    try { await api(`/tareas/${tareaId}/reservar`,{method:'POST',body:{categoria_id:Number(catId), integrantes}}); closeModal(); toast('Reserva de categoría confirmada'); tareaDetalle(tareaId); }
    catch(e){ $('#rE').textContent=e.message||'Error'; }
  };
}

async function tareaForm() {
  const asigs = ME.asignaturas || [];
  if (!asigs.length) { openModal('<h3>Nueva tarea</h3><p class="muted">No tienes asignaturas a cargo. Pide al administrador que te inscriba como docente en una asignatura (menú Académico).</p>'); return; }
  openModal(`<h3>Nueva tarea</h3>
    <div class="field"><label>Asignatura</label><select id="tAsig">${asigs.map(a=>`<option value="${a.id}">${escD(a.nombre)}${a.seccion?(' · '+escD(a.seccion)):''}</option>`).join('')}</select></div>
    <div class="field"><label>Título</label><input id="tTit"></div>
    <div class="field"><label>Descripción</label><input id="tDesc"></div>
    <div class="field"><label>Inicio</label><input id="tIni" type="datetime-local"></div>
    <div class="field"><label>Término</label><input id="tFin" type="datetime-local"></div>
    <div class="field"><label>Tipo</label><select id="tTipo"><option value="individual">Individual</option><option value="grupal">Grupal</option></select></div>
    <label style="font-size:12px;font-weight:600;color:var(--muted)">Categorías habilitadas (solo las elegibles para la asignatura)</label>
    <div id="tCats" style="max-height:170px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0 10px"><span class="muted" style="font-size:12.5px">Cargando…</span></div>
    <button class="btn full" id="tOk">Crear tarea</button><div class="err" id="tE"></div>`);
  const cargarCats = async () => {
    const aid = Number($('#tAsig').value);
    $('#tCats').innerHTML = '<span class="muted" style="font-size:12.5px">Cargando…</span>';
    try {
      const cats = await api('/asignaturas/' + aid + '/categorias');
      $('#tCats').innerHTML = cats.length
        ? cats.map(c=>`<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:3px 0"><input type="checkbox" class="catchk" value="${c.id}">${escD(c.nombre)} <span class="muted" style="font-size:11px">${c.disponibles} disp. / ${c.total}</span></label>`).join('')
        : '<span class="muted" style="font-size:12.5px">Esta asignatura no tiene categorías habilitadas (elegibilidad). Pide al administrador que las configure en Académico.</span>';
    } catch(e){ $('#tCats').innerHTML = `<span class="muted" style="font-size:12.5px">${escD(e.message||'Error')}</span>`; }
  };
  $('#tAsig').onchange = cargarCats;
  cargarCats();
  $('#tOk').onclick = async () => {
    $('#tE').textContent='';
    const categorias = Array.from(document.querySelectorAll('.catchk:checked')).map(c=>Number(c.value));
    const body = { asignatura_id:Number($('#tAsig').value), titulo:$('#tTit').value.trim(), descripcion:$('#tDesc').value.trim()||null,
      fecha_inicio:$('#tIni').value, fecha_fin:$('#tFin').value, tipo:$('#tTipo').value, categorias };
    if(!body.titulo||!body.fecha_inicio||!body.fecha_fin){ $('#tE').textContent='Título y fechas son obligatorios'; return; }
    if(!categorias.length){ $('#tE').textContent='Selecciona al menos una categoría habilitada'; return; }
    try { await api('/tareas',{method:'POST',body}); closeModal(); toast('Tarea creada'); viewTareas(); }
    catch(e){ $('#tE').textContent=e.message||'Error'; }
  };
}

// ----- Solicitudes especiales (alumno / docente) -----
async function viewSolicitudes() {
  if (ME.user.rol==='docente' || ME.user.rol==='admin') return viewSolicDocente();
  h(`<h2 class="page">Solicitudes especiales</h2>
     <button class="btn sm" id="ns" style="margin-bottom:14px">+ Nueva solicitud</button>
     <div id="sl">Cargando…</div>`);
  $('#ns').onclick = () => solicitudForm();
  const ss = await api('/solicitudes/mias');
  $('#sl').innerHTML = ss.length ? ss.map(s=>`<div class="card" style="margin-bottom:10px">
    <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${escD(s.asignatura||'Solicitud general')}</b><span class="pill ${s.estado==='aprobada'?'ok':s.estado==='rechazada'?'bad':'warn'}">${s.estado}</span></div>
    <p style="font-size:13px;margin:8px 0 4px">${escD(s.descripcion)}</p>
    ${(s.fecha_inicio||s.fecha_fin)?`<p class="muted" style="font-size:12.5px;margin:2px 0">📅 ${s.fecha_inicio?fmtDate(s.fecha_inicio):''}${s.fecha_fin?' → '+fmtDate(s.fecha_fin):''}${s.duracion?' · '+escD(s.duracion):''}</p>`:''}
    ${(s.categorias&&s.categorias.length)?`<p class="muted" style="font-size:12.5px;margin:2px 0">📷 ${s.categorias.map(escD).join(', ')}</p>`:(s.equipos&&s.equipos.length)?`<p class="muted" style="font-size:12.5px;margin:2px 0">📷 ${s.equipos.map(escD).join(', ')}</p>`:''}
    ${s.respuesta?`<p class="muted" style="font-size:12.5px"><b>Respuesta:</b> ${escD(s.respuesta)}</p>`:''}
    <small class="muted">${fmtDate(s.created_at)}</small></div>`).join('') : '<p class="muted">No has enviado solicitudes.</p>';
}
function solicitudForm() {
  const asigs = ME.asignaturas || [];
  const solicitados = [];     // {id, nombre} — categorías solicitadas
  let disponibles = [];       // categorías elegibles de la asignatura
  h(`<h2 class="page">Nueva solicitud especial</h2>
    <div class="dash-grid">
      <div class="panel"><h3>📘 Información</h3>
        <div class="field"><label>Asignatura</label><select id="sAsig"><option value="">——————</option>${asigs.map(a => `<option value="${a.id}">${escD(a.nombre)}${a.seccion ? (' · ' + escD(a.seccion)) : ''}</option>`).join('')}</select></div>
        <div class="field"><label>Descripción</label><textarea id="sDesc" rows="4" style="padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;font-family:inherit" placeholder="Motivo de la solicitud"></textarea></div>
        <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Fecha inicio</label><input type="date" id="sFi"></div><div class="field" style="flex:1"><label>Hora inicio</label><input type="time" id="sHi"></div></div>
        <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Fecha fin</label><input type="date" id="sFf"></div><div class="field" style="flex:1"><label>Hora fin</label><input type="time" id="sHf"></div></div>
        <div class="field" style="max-width:180px"><label>Duración</label><input id="sDur" placeholder="(automática)" readonly></div>
        <div class="err" id="sE"></div>
        <div style="text-align:right"><button class="btn" id="sOk">Crear</button></div>
      </div>
      <div class="panel"><h3>📷 Categorías solicitadas</h3><div id="sSel"></div></div>
    </div>
    <div class="panel" style="margin-top:14px"><h3>Categorías disponibles para la asignatura</h3><p class="muted" style="font-size:11.5px;margin-top:-4px">Se pide por categoría; el pañol asigna la unidad al entregar.</p><div id="sDisp"><p class="muted">Selecciona una asignatura para ver sus categorías.</p></div></div>`);

  const calcDur = () => {
    const fi = $('#sFi').value, hi = $('#sHi').value, ff = $('#sFf').value, hf = $('#sHf').value;
    if (fi && hi && ff && hf) {
      const d1 = new Date(fi + 'T' + hi), d2 = new Date(ff + 'T' + hf);
      const ms = d2 - d1;
      $('#sDur').value = ms > 0 ? (Math.round(ms / 3600000 * 10) / 10) + ' h' : '';
    } else $('#sDur').value = '';
  };
  ['sFi', 'sHi', 'sFf', 'sHf'].forEach(id => $('#' + id).addEventListener('change', calcDur));

  const renderSel = () => {
    $('#sSel').innerHTML = solicitados.length
      ? `<table><thead><tr><th>Icono</th><th>Categoría</th><th>Operación</th></tr></thead><tbody>${solicitados.map(c => `<tr>
          <td style="font-size:20px">${icon(c.nombre)}</td><td>${escD(c.nombre)}</td>
          <td><button class="btn sm ghost danger" data-q="${c.id}">Quitar</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Aún no agregas categorías. Agrégalas desde la lista inferior.</p>';
    $('#sSel').querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const i = solicitados.findIndex(x => String(x.id) === b.dataset.q);
      if (i >= 0) solicitados.splice(i, 1); renderSel(); renderDisp();
    });
  };
  const renderDisp = () => {
    const libres = disponibles.filter(c => !solicitados.some(s => s.id === c.id));
    $('#sDisp').innerHTML = libres.length
      ? `<table><thead><tr><th>Icono</th><th>Categoría</th><th>Disponibles</th><th>Operación</th></tr></thead><tbody>${libres.map(c => `<tr>
          <td style="font-size:20px">${icon(c.nombre)}</td><td>${escD(c.nombre)}</td><td>${c.disponibles} / ${c.total}</td>
          <td><button class="btn sm" data-a="${c.id}" ${c.disponibles < 1 ? 'disabled title="Sin unidades disponibles"' : ''}>Agregar</button></td></tr>`).join('')}</tbody></table>`
      : (disponibles.length ? '<p class="muted">Todas las categorías ya fueron agregadas.</p>' : '<p class="muted">No hay categorías habilitadas para esta asignatura.</p>');
    $('#sDisp').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const c = disponibles.find(x => String(x.id) === b.dataset.a);
      if (c && !solicitados.some(s => s.id === c.id)) solicitados.push({ id: c.id, nombre: c.nombre });
      renderSel(); renderDisp();
    });
  };
  renderSel(); renderDisp();

  $('#sAsig').onchange = async () => {
    const aid = $('#sAsig').value;
    if (!aid) { disponibles = []; renderDisp(); return; }
    $('#sDisp').innerHTML = '<p class="muted">Cargando categorías…</p>';
    try { disponibles = await api('/asignaturas/' + aid + '/categorias'); }
    catch (e) { disponibles = []; $('#sDisp').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
    renderDisp();
  };

  $('#sOk').onclick = async () => {
    $('#sE').textContent = '';
    const descripcion = $('#sDesc').value.trim();
    if (!descripcion) { $('#sE').textContent = 'Escribe la descripción'; return; }
    if (!solicitados.length) { $('#sE').textContent = 'Debe seleccionar al menos una categoría'; return; }
    const asignatura_id = $('#sAsig').value ? Number($('#sAsig').value) : null;
    const fi = $('#sFi').value, hi = $('#sHi').value, ff = $('#sFf').value, hf = $('#sHf').value;
    const fecha_inicio = (fi && hi) ? new Date(fi + 'T' + hi).toISOString() : null;
    const fecha_fin = (ff && hf) ? new Date(ff + 'T' + hf).toISOString() : null;
    try {
      await api('/solicitudes', { method: 'POST', body: {
        asignatura_id, descripcion, fecha_inicio, fecha_fin,
        duracion: $('#sDur').value || null, categorias: solicitados.map(c => c.id),
      }});
      toast('Solicitud creada'); viewSolicitudes();
    } catch (e) { $('#sE').textContent = e.message || 'Error'; }
  };
}
async function viewSolicDocente() {
  h(`<h2 class="page">Solicitudes por responder</h2><div id="sl">Cargando…</div>`);
  const ss = await api('/solicitudes/pendientes');
  if (!ss.length) { $('#sl').innerHTML='<p class="muted">No hay solicitudes pendientes.</p>'; return; }
  $('#sl').innerHTML = ss.map(s=>`<div class="card" style="margin-bottom:10px">
    <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${escD(s.alumno)}</b><small class="muted">${escD(s.asignatura||'')}</small></div>
    <p style="font-size:13px;margin:8px 0">${escD(s.descripcion)}</p>
    ${(s.fecha_inicio||s.fecha_fin)?`<p class="muted" style="font-size:12.5px;margin:2px 0">📅 ${s.fecha_inicio?fmtDate(s.fecha_inicio):''}${s.fecha_fin?' → '+fmtDate(s.fecha_fin):''}${s.duracion?' · '+escD(s.duracion):''}</p>`:''}
    ${(s.categorias&&s.categorias.length)?`<p class="muted" style="font-size:12.5px;margin:2px 0 8px">📷 ${s.categorias.map(escD).join(', ')}</p>`:(s.equipos&&s.equipos.length)?`<p class="muted" style="font-size:12.5px;margin:2px 0 8px">📷 ${s.equipos.map(escD).join(', ')}</p>`:''}
    <div style="display:flex;gap:8px"><button class="btn sm ap" data-id="${s.id}">Aprobar</button><button class="btn sm ghost danger rc" data-id="${s.id}">Rechazar</button></div>
  </div>`).join('');
  $('#sl').querySelectorAll('.ap').forEach(b=>b.onclick=()=>responderSolic(b.dataset.id,'aprobada'));
  $('#sl').querySelectorAll('.rc').forEach(b=>b.onclick=()=>responderSolic(b.dataset.id,'rechazada'));
}
function responderSolic(id, estado) {
  openModal(`<h3>${estado==='aprobada'?'Aprobar':'Rechazar'} solicitud</h3>
    <div class="field"><label>Comentario (opcional)</label><input id="rpT" placeholder="Mensaje para el alumno"></div>
    <button class="btn full ${estado==='rechazada'?'danger':''}" id="rpOk">${estado==='aprobada'?'Aprobar':'Rechazar'}</button><div class="err" id="rpE"></div>`);
  $('#rpOk').onclick = async () => {
    try { await api(`/solicitudes/${id}/responder`,{method:'POST',body:{estado,respuesta:$('#rpT').value.trim()||null}}); closeModal(); toast('Solicitud respondida'); viewSolicDocente(); }
    catch(e){ $('#rpE').textContent=e.message||'Error'; }
  };
}

// ===================== Calendario de disponibilidad =====================
async function viewDisponibilidad() {
  h(`<h2 class="page">Disponibilidad</h2>
    <p class="muted">Disponibilidad por asignatura y categoría, considerando las reservas solicitadas (pendientes) y las confirmadas.</p>
    <div class="card" style="margin-bottom:14px">
      <div class="field"><label>Asignatura</label><select id="dAsig"><option value="todos">Todas</option></select></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Desde</label><input type="date" id="dDesde"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Hasta</label><input type="date" id="dHasta"></div>
      </div>
      <button class="btn full" id="dBtn">Ver disponibilidad</button>
    </div>
    <div id="dRes"></div>`);
  const hoy = new Date();
  const en3 = new Date(hoy.getTime() + 21 * 864e5);
  const iso = d => d.toISOString().slice(0, 10);
  $('#dDesde').value = iso(hoy); $('#dHasta').value = iso(en3);
  let data = [];
  const render = () => {
    const sel = $('#dAsig').value;
    const items = sel === 'todos' ? data : data.filter(x => String(x.asignatura.id) === sel);
    if (!items.length) { $('#dRes').innerHTML = '<p class="muted">Sin asignaturas con equipamiento habilitado.</p>'; return; }
    $('#dRes').innerHTML = items.map(x => {
      const rows = x.categorias.length
        ? x.categorias.map(c => `<tr>
            <td><b>${escD(c.nombre)}</b></td>
            <td style="text-align:center">${c.total}</td>
            <td style="text-align:center">${c.confirmadas}</td>
            <td style="text-align:center">${c.solicitadas}</td>
            <td style="text-align:center"><span class="pill ${c.disponibles > 0 ? 'ok' : 'bad'}">${c.disponibles}</span></td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="muted">Sin categorías habilitadas.</td></tr>';
      return `<h3 style="margin:16px 0 8px;font-size:15px">${escD(x.asignatura.nombre)}${x.asignatura.seccion ? ' · ' + escD(x.asignatura.seccion) : ''}</h3>
        <table style="width:100%"><thead><tr><th>Categoría</th><th>Total</th><th>Confirmadas</th><th>Solicitadas</th><th>Disponibles</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    }).join('');
  };
  const consultar = async () => {
    $('#dRes').innerHTML = '<p class="muted">Consultando…</p>';
    try {
      data = await api(`/disponibilidad?desde=${$('#dDesde').value}&hasta=${$('#dHasta').value}`);
      const cur = $('#dAsig').value;
      $('#dAsig').innerHTML = '<option value="todos">Todas</option>' +
        data.map(x => `<option value="${x.asignatura.id}">${escD(x.asignatura.nombre)}${x.asignatura.seccion ? ' · ' + escD(x.asignatura.seccion) : ''}</option>`).join('');
      if (cur && data.some(x => String(x.asignatura.id) === cur)) $('#dAsig').value = cur;
      render();
    } catch (e) { $('#dRes').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  };
  $('#dAsig').onchange = render;
  $('#dBtn').onclick = consultar;
  consultar();
}

// ===================== Gestión completa de pedidos (admin/pañolero) =====================
const PEDIDO_ESTADOS = ['pendiente', 'confirmada', 'en_uso', 'completada', 'cancelada', 'expirada'];
async function viewPedidos() {
  h(`<h2 class="page">Gestión de pedidos</h2>
    <p class="muted">Todas las reservas de equipos, con filtro por estado y búsqueda.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
      <div class="field" style="margin:0"><label>Estado</label><select id="pEstado">
        <option value="">Todos</option>${PEDIDO_ESTADOS.map(e => `<option value="${e}">${(ESTADO_RES[e] || [e])[0]}</option>`).join('')}
      </select></div>
      <div class="field" style="margin:0;flex:1;min-width:160px"><label>Buscar (usuario, RUT o equipo)</label><input id="pQ" placeholder="Escribe y presiona Buscar"></div>
      <button class="btn" id="pBuscar">Buscar</button>
      <button class="btn ghost" id="pNuevo">+ Pedido presencial</button>
    </div>
    <div id="pList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const qs = [];
    if ($('#pEstado').value) qs.push('estado=' + encodeURIComponent($('#pEstado').value));
    if ($('#pQ').value.trim()) qs.push('q=' + encodeURIComponent($('#pQ').value.trim()));
    $('#pList').innerHTML = '<p class="muted">Cargando…</p>';
    try {
      const rs = await api('/admin/pedidos' + (qs.length ? '?' + qs.join('&') : ''));
      if (!rs.length) { $('#pList').innerHTML = '<p class="muted">No hay pedidos con esos criterios.</p>'; return; }
      $('#pList').innerHTML = `<table><thead><tr><th>#</th><th>Usuario</th><th>Equipo</th><th>Periodo</th><th>Estado</th><th></th></tr></thead><tbody>${rs.map(r => {
        const [lab, cls] = ESTADO_RES[r.estado] || [r.estado, 'info'];
        return `<tr><td>${r.id}</td><td>${escD(r.usuario)}<br><small class="muted">${escD(r.rut)}</small></td>
          <td>${escD(r.equipo)}${r.tarea_id ? ' <span class="pill info">Tarea</span>' : ''}</td>
          <td style="font-size:12px">${fmtDate(r.fecha_inicio)}<br>${fmtDate(r.fecha_fin)}</td>
          <td><span class="pill ${cls}">${lab}</span></td>
          <td><button class="btn sm ghost" data-id="${r.id}">Ver</button></td></tr>`;
      }).join('')}</tbody></table>`;
      $('#pList').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => pedidoDetalle(b.dataset.id));
    } catch (e) { $('#pList').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  };
  $('#pBuscar').onclick = cargar;
  $('#pQ').addEventListener('keydown', e => { if (e.key === 'Enter') cargar(); });
  $('#pEstado').onchange = cargar;
  $('#pNuevo').onclick = pedidoPresencialForm;
  cargar();
}

async function pedidoDetalle(id) {
  const d = await api('/admin/pedidos/' + id);
  const r = d.reserva;
  const [lab, cls] = ESTADO_RES[r.estado] || [r.estado, 'info'];
  const ints = d.integrantes.length
    ? d.integrantes.map(i => `<li>${escD(i.nombre)} (${escD(i.rut)})${i.es_responsable ? ' · <b>responsable</b>' : ''}</li>`).join('')
    : '<li class="muted">Sin integrantes registrados</li>';
  const prest = d.prestamo
    ? `<p>Préstamo #${d.prestamo.id} · ${escD(d.prestamo.estado)}${d.prestamo.fecha_salida ? ' · salida ' + fmtDate(d.prestamo.fecha_salida) : ''}${d.prestamo.fecha_retorno ? ' · retorno ' + fmtDate(d.prestamo.fecha_retorno) : ''}</p>`
    : '<p class="muted">Sin préstamo asociado todavía.</p>';
  openModal(`<h3>Pedido #${r.id}</h3>
    <p style="margin:2px 0 10px"><span class="pill ${cls}">${lab}</span></p>
    <p><b>${escD(r.equipo)}</b> · ${escD(r.codigo_qr || '')}</p>
    <p>Solicitante: ${escD(r.usuario)} (${escD(r.rut)})</p>
    <p>Periodo: ${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)}</p>
    ${r.motivo ? `<p>Motivo: ${escD(r.motivo)}</p>` : ''}
    <p style="margin-bottom:2px"><b>Integrantes</b></p><ul style="margin:0 0 10px;padding-left:18px;font-size:13px">${ints}</ul>
    ${prest}
    <button class="btn full" id="pImp">🖨️ Imprimir comprobante</button>`);
  $('#pImp').onclick = () => imprimirComprobante(d);
}

function imprimirComprobante(d) {
  const r = d.reserva;
  const w = window.open('', '_blank');
  if (!w) { toast('Permite ventanas emergentes para imprimir'); return; }
  const ints = d.integrantes.map(i => `${escD(i.nombre)} (${escD(i.rut)})${i.es_responsable ? ' — responsable' : ''}`).join('<br>') || '—';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Comprobante pedido #${r.id}</title>
    <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#152230;max-width:560px;margin:30px auto;padding:0 20px}
    h1{color:#0E8F86;font-size:20px;margin:0 0 2px}.s{color:#6B7785;font-size:12px;margin:0 0 18px}
    table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 4px;border-bottom:1px solid #E4E8ED;vertical-align:top}
    td.k{color:#6B7785;width:34%}.ft{margin-top:26px;font-size:11px;color:#90a0b0;text-align:center}</style></head>
    <body><h1>Pañol 2.0 · Comprobante de pedido</h1><p class="s">Instituto Profesional Santo Tomás — Área de Comunicación Audiovisual</p>
    <table>
      <tr><td class="k">N° de pedido</td><td>#${r.id}</td></tr>
      <tr><td class="k">Estado</td><td>${(ESTADO_RES[r.estado] || [r.estado])[0]}</td></tr>
      <tr><td class="k">Equipo</td><td>${escD(r.equipo)} (${escD(r.codigo_qr || '')})</td></tr>
      <tr><td class="k">Solicitante</td><td>${escD(r.usuario)} — ${escD(r.rut)}</td></tr>
      <tr><td class="k">Periodo</td><td>${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)}</td></tr>
      ${r.motivo ? `<tr><td class="k">Motivo</td><td>${escD(r.motivo)}</td></tr>` : ''}
      <tr><td class="k">Integrantes</td><td>${ints}</td></tr>
    </table>
    <p class="ft">Documento generado por Pañol 2.0 · ${new Date().toLocaleString('es-CL')}</p>
    </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

async function pedidoPresencialForm() {
  const eq = await api('/equipos');
  const disp = eq.filter(e => e.estado === 'disponible');
  openModal(`<h3>Pedido presencial</h3>
    <p class="muted" style="margin-top:0;font-size:13px">Registra un préstamo a nombre de un usuario presente en el pañol.</p>
    <div class="field"><label>RUT del usuario</label><input id="ppRut" placeholder="11.111.111-1"></div>
    <div class="field"><label>Equipo (solo disponibles)</label><select id="ppEq">
      ${disp.length ? disp.map(e => `<option value="${e.id}">${escD(e.nombre)} · ${escD(e.codigo_qr)}</option>`).join('') : '<option value="">No hay equipos disponibles</option>'}
    </select></div>
    <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Inicio</label><input type="datetime-local" id="ppIni"></div>
    <div class="field" style="flex:1"><label>Término</label><input type="datetime-local" id="ppFin"></div></div>
    <div class="field"><label>Motivo (opcional)</label><input id="ppMot" placeholder="Pedido presencial"></div>
    <div class="err" id="ppErr"></div>
    <button class="btn full" id="ppOk" ${disp.length ? '' : 'disabled'}>Registrar pedido</button>`);
  const now = new Date();
  $('#ppIni').value = dtLocal(new Date(now.getTime() + 5 * 60000).toISOString());
  $('#ppFin').value = dtLocal(new Date(now.getTime() + 3 * 3600000).toISOString());
  $('#ppOk').onclick = async () => {
    $('#ppErr').textContent = '';
    try {
      await api('/admin/pedidos', { method: 'POST', body: {
        usuario_rut: formatRut($('#ppRut').value),
        equipo_id: Number($('#ppEq').value),
        fecha_inicio: new Date($('#ppIni').value).toISOString(),
        fecha_fin: new Date($('#ppFin').value).toISOString(),
        motivo: $('#ppMot').value.trim() || null,
      }});
      closeModal(); toast('Pedido presencial registrado'); viewPedidos();
    } catch (e) { $('#ppErr').textContent = e.message; }
  };
}

// ===================== Categorías y Laboratorios (admin) =====================
async function viewCatalogos() {
  h(`<h2 class="page">Catálogos</h2>
    <p class="muted">Administra las categorías de equipos y los laboratorios/recintos.</p>
    <div class="dash-grid">
      <div class="panel"><h3>Categorías <button class="btn sm ghost" id="catNew" style="float:right">+ Nueva</button></h3><div id="catList" class="muted">Cargando…</div></div>
      <div class="panel"><h3>Laboratorios <button class="btn sm ghost" id="labNew" style="float:right">+ Nuevo</button></h3><div id="labList" class="muted">Cargando…</div></div>
    </div>`);
  const cargar = async () => {
    const [cats, labs] = await Promise.all([api('/categorias'), api('/laboratorios')]);
    $('#catList').innerHTML = cats.length ? cats.map(c => `<div class="row"><div class="ava">${escD(c.simbolo || '📦')}</div>
      <div class="info"><b>${escD(c.nombre)}</b></div>
      <button class="btn sm ghost" data-ed="${c.id}" data-n="${escD(c.nombre)}" data-s="${escD(c.simbolo || '')}">Editar</button>
      <button class="btn sm ghost danger" data-del="${c.id}">×</button></div>`).join('') : '<p class="muted">Sin categorías.</p>';
    $('#labList').innerHTML = labs.length ? labs.map(l => `<div class="row"><div class="ava">🏢</div>
      <div class="info"><b>${escD(l.nombre)}</b><small>${escD(l.ubicacion || '')}</small></div>
      <button class="btn sm ghost" data-led="${l.id}" data-n="${escD(l.nombre)}" data-u="${escD(l.ubicacion || '')}">Editar</button>
      <button class="btn sm ghost danger" data-ldel="${l.id}">×</button></div>`).join('') : '<p class="muted">Sin laboratorios.</p>';
    $('#catList').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => catForm(b.dataset.ed, b.dataset.n, b.dataset.s));
    $('#catList').querySelectorAll('[data-del]').forEach(b => b.onclick = () => delCatalogo('categorias', b.dataset.del, '¿Eliminar esta categoría?', cargar));
    $('#labList').querySelectorAll('[data-led]').forEach(b => b.onclick = () => labForm(b.dataset.led, b.dataset.n, b.dataset.u));
    $('#labList').querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => delCatalogo('laboratorios', b.dataset.ldel, '¿Eliminar este laboratorio?', cargar));
  };
  function catForm(id, nombre, simbolo) {
    openModal(`<h3>${id ? 'Editar' : 'Nueva'} categoría</h3>
      <div class="field"><label>Nombre</label><input id="cN" value="${id ? escD(nombre) : ''}"></div>
      <div class="field"><label>Símbolo / emoji (opcional)</label><input id="cS" value="${id ? escD(simbolo) : ''}" placeholder="📷"></div>
      <div class="err" id="cE"></div><button class="btn full" id="cOk">Guardar</button>`);
    $('#cOk').onclick = async () => {
      $('#cE').textContent = '';
      try {
        await api('/admin/categorias' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { nombre: $('#cN').value.trim(), simbolo: $('#cS').value.trim() || null } });
        closeModal(); toast('Categoría guardada'); cargar();
      } catch (e) { $('#cE').textContent = e.message; }
    };
  }
  function labForm(id, nombre, ubicacion) {
    openModal(`<h3>${id ? 'Editar' : 'Nuevo'} laboratorio</h3>
      <div class="field"><label>Nombre</label><input id="lN" value="${id ? escD(nombre) : ''}"></div>
      <div class="field"><label>Ubicación (opcional)</label><input id="lU" value="${id ? escD(ubicacion) : ''}" placeholder="Piso 2, Sala 210"></div>
      <div class="err" id="lE"></div><button class="btn full" id="lOk">Guardar</button>`);
    $('#lOk').onclick = async () => {
      $('#lE').textContent = '';
      try {
        await api('/admin/laboratorios' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { nombre: $('#lN').value.trim(), ubicacion: $('#lU').value.trim() || null } });
        closeModal(); toast('Laboratorio guardado'); cargar();
      } catch (e) { $('#lE').textContent = e.message; }
    };
  }
  $('#catNew').onclick = () => catForm(null);
  $('#labNew').onclick = () => labForm(null);
  cargar();
}
async function delCatalogo(tipo, id, msg, cb) {
  openModal(`<h3>Confirmar</h3><p>${msg}</p><div class="err" id="dcE"></div>
    <div style="display:flex;gap:8px"><button class="btn ghost" id="dcNo" style="flex:1">Cancelar</button><button class="btn danger" id="dcYes" style="flex:1">Eliminar</button></div>`);
  $('#dcNo').onclick = closeModal;
  $('#dcYes').onclick = async () => {
    try { await api('/admin/' + tipo + '/' + id, { method: 'DELETE' }); closeModal(); toast('Eliminado'); cb(); }
    catch (e) { $('#dcE').textContent = e.message; }
  };
}

// ===================== Anuncios (tablón) =====================
async function viewAnuncios() {
  const esAdmin = ME.user.rol === 'admin';
  h(`<h2 class="page">Anuncios</h2>
    <p class="muted">Avisos del pañol para tu sede.</p>
    ${esAdmin ? '<button class="btn" id="anNew" style="margin-bottom:14px">+ Nuevo anuncio</button>' : ''}
    <div id="anList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const rows = await api('/anuncios');
    marcarAnunciosLeidos(rows); updateAnunciosBadge();   // al abrir, quedan leídos
    if (!rows.length) { $('#anList').innerHTML = '<p class="muted">No hay anuncios por ahora.</p>'; return; }
    $('#anList').innerHTML = rows.map(a => `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:start"><b style="flex:1;font-size:15px">${escD(a.titulo)}</b>
        ${esAdmin ? `<button class="btn sm ghost danger" data-del="${a.id}">Eliminar</button>` : ''}</div>
      <p style="font-size:13.5px;margin:8px 0;white-space:pre-wrap">${escD(a.cuerpo)}</p>
      <small class="muted">${escD(a.autor || 'Pañol')} · ${fmtDate(a.created_at)}</small></div>`).join('');
    if (esAdmin) $('#anList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      try { await api('/admin/anuncios/' + b.dataset.del, { method: 'DELETE' }); toast('Anuncio eliminado'); cargar(); }
      catch (e) { toast(e.message); }
    });
  };
  if (esAdmin) $('#anNew').onclick = () => {
    openModal(`<h3>Nuevo anuncio</h3>
      <div class="field"><label>Título</label><input id="anT" placeholder="Ej: Cierre del pañol el viernes"></div>
      <div class="field"><label>Contenido</label><textarea id="anC" rows="4" style="padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;font-family:inherit"></textarea></div>
      <div class="err" id="anErr"></div><button class="btn full" id="anOk">Publicar</button>`);
    $('#anOk').onclick = async () => {
      $('#anErr').textContent = '';
      try { await api('/admin/anuncios', { method: 'POST', body: { titulo: $('#anT').value.trim(), cuerpo: $('#anC').value.trim() } }); closeModal(); toast('Anuncio publicado'); cargar(); }
      catch (e) { $('#anErr').textContent = e.message; }
    };
  };
  cargar();
}

// ===================== Mis asignaturas (alumno/docente) =====================
async function viewAsignaturas() {
  h(`<h2 class="page">Mis asignaturas</h2>
    <p class="muted">Entra a una asignatura para ver sus tareas y sus compañeros.</p>
    <div id="asList"><p class="muted">Cargando…</p></div>`);
  let rows;
  try { rows = await api('/mis-asignaturas'); }
  catch (e) { $('#asList').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
  if (!rows.length) { $('#asList').innerHTML = '<p class="muted">No estás inscrito en asignaturas. Contacta al administrador o al pañol.</p>'; return; }
  $('#asList').innerHTML = rows.map((a, i) => {
    const cats = (a.categorias || []).length
      ? a.categorias.map(c => `<span class="pill info" style="margin:2px 4px 2px 0;display:inline-block">${escD(c)}</span>`).join('')
      : '<span class="muted" style="font-size:12.5px">Sin categorías habilitadas aún</span>';
    const rol = a.rol_en_asig === 'docente' ? 'Docente' : 'Alumno';
    return `<div class="card asItem" data-i="${i}" style="margin-bottom:12px;cursor:pointer">
      <div style="display:flex;gap:8px;align-items:start">
        <div style="flex:1"><b style="font-size:15px">${escD(a.nombre)}</b>
          <div class="muted" style="font-size:12.5px">${escD(a.carrera || '')}${a.seccion ? ' · Sección ' + escD(a.seccion) : ''}</div></div>
        <span class="pill ${a.rol_en_asig === 'docente' ? 'warn' : 'ok'}">${rol}</span>
      </div>
      <div style="margin-top:10px"><span class="muted" style="font-size:12px;font-weight:600">Equipos habilitados:</span><br>${cats}</div>
      <div style="margin-top:10px;text-align:right"><span class="pill ok">Ver tareas y compañeros →</span></div>
    </div>`;
  }).join('');
  $('#asList').querySelectorAll('.asItem').forEach(el => el.onclick = () => asignaturaDetalle(rows[el.dataset.i]));
}

async function asignaturaDetalle(a) {
  h(`<button class="btn sm ghost" id="asBack" style="margin-bottom:12px">← Mis asignaturas</button>
    <h2 class="page" style="margin-top:4px">${escD(a.nombre)}</h2>
    <p class="muted" style="margin:-8px 0 8px">${escD(a.carrera || '')}${a.seccion ? ' · Sección ' + escD(a.seccion) : ''}</p>
    <div style="margin-bottom:16px">${(a.categorias || []).map(c => `<span class="pill info" style="margin:2px 4px 2px 0;display:inline-block">${escD(c)}</span>`).join('')}</div>
    <div class="dash-grid">
      <div class="panel"><h3>📝 Tareas de la asignatura</h3><div id="asTar" class="muted">Cargando…</div></div>
      <div class="panel"><h3>🧑‍🤝‍🧑 Compañeros</h3><div id="asComp" class="muted">Cargando…</div></div>
    </div>`);
  $('#asBack').onclick = () => viewAsignaturas();
  try {
    const ts = await api('/asignaturas/' + a.id + '/tareas');
    $('#asTar').innerHTML = ts.length
      ? ts.map(t => `<div class="row tItem" data-id="${t.id}" style="margin-bottom:6px;cursor:pointer"><div class="ava">📝</div>
          <div class="info"><b>${escD(t.titulo)}</b><small>${escD(t.tipo)} · ${fmtDate(t.fecha_inicio)} → ${fmtDate(t.fecha_fin)}</small></div>
          <span class="pill ok">ver</span></div>`).join('')
      : '<p class="muted">Sin tareas vigentes en esta asignatura.</p>';
    $('#asTar').querySelectorAll('.tItem').forEach(el => el.onclick = () => tareaDetalle(el.dataset.id));
  } catch (e) { $('#asTar').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  try {
    const cs = await api('/asignaturas/' + a.id + '/companeros');
    $('#asComp').innerHTML = cs.length
      ? cs.map(c => `<div class="row" style="margin-bottom:6px"><div class="ava">${c.rol_en_asig === 'docente' ? '🧑‍🏫' : '🎓'}</div>
          <div class="info"><b>${escD(c.nombre)}</b><small>${c.rol_en_asig === 'docente' ? 'Docente' : 'Alumno'}</small></div></div>`).join('')
      : '<p class="muted">No hay otros inscritos en esta asignatura.</p>';
  } catch (e) { $('#asComp').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
}

// ===================== Compañeros inscritos (alumno/docente) =====================
async function viewCompaneros() {
  h(`<h2 class="page">Compañeros inscritos</h2>
    <p class="muted">Personas inscritas en tus mismas asignaturas.</p>
    <div id="coList"><p class="muted">Cargando…</p></div>`);
  const rows = await api('/companeros');
  if (!rows.length) { $('#coList').innerHTML = '<p class="muted">No hay compañeros en tus asignaturas.</p>'; return; }
  const porAsig = {};
  rows.forEach(r => { const k = r.asignatura + (r.seccion ? ' · ' + r.seccion : ''); (porAsig[k] = porAsig[k] || []).push(r); });
  $('#coList').innerHTML = Object.entries(porAsig).map(([asig, gente]) => `<div class="panel" style="margin-bottom:12px">
    <h3>${escD(asig)} <span class="muted" style="font-weight:400">(${gente.length})</span></h3>
    ${gente.map(g => `<div class="row" style="margin-bottom:6px"><div class="ava">${g.rol === 'docente' ? '🧑‍🏫' : '🎓'}</div>
      <div class="info"><b>${escD(g.nombre)}</b><small>${g.rol === 'docente' ? 'Docente' : 'Alumno'}</small></div></div>`).join('')}
  </div>`).join('');
}

// ===================== Multisede: gestión de sedes (admin) =====================
async function viewSedes() {
  h(`<h2 class="page">Sedes</h2>
    <p class="muted">Administra las sedes (instituciones/campus). Cambia la sede activa desde el selector de la barra superior para gestionar sus datos.</p>
    <button class="btn" id="seNew" style="margin-bottom:14px">+ Nueva sede</button>
    <div id="seList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const s = await api('/sedes');
    const sedes = s.sedes || [];
    const rolTxt = { docente: 'Docente', jefe_panol: 'Jefe de pañol', admin: 'Admin' };
    $('#seList').innerHTML = sedes.map(x => {
      const pse = x.permite_solicitud_especial !== false;
      const hae = x.horas_anticipacion_excepcional != null ? x.horas_anticipacion_excepcional : 0;
      const ra = x.rol_autoriza_especial || 'docente';
      const excep = pse ? `Excepción: ${hae > 0 ? hae + ' h mín' : 'sin límite'} · autoriza ${rolTxt[ra] || ra}` : 'Sin solicitudes excepcionales';
      return `<div class="row"><div class="ava">🏫</div>
      <div class="info"><b>${escD(x.nombre)}</b><small>Pañol: ${escD(x.bodega_label || 'Pañol')} · Reserva: ${x.horas_anticipacion != null ? x.horas_anticipacion : 48} h · ${excep}${x.activo === false ? ' · inactiva' : ''}${x.id === SEDE ? ' · <b>activa</b>' : ''}</small></div>
      <button class="btn sm ghost" data-ed="${x.id}" data-n="${escD(x.nombre)}" data-b="${escD(x.bodega_label || '')}" data-a="${x.activo !== false}" data-h="${x.horas_anticipacion != null ? x.horas_anticipacion : 48}" data-pse="${pse}" data-hae="${hae}" data-ra="${ra}">Editar</button></div>`;
    }).join('');
    $('#seList').querySelectorAll('[data-ed]').forEach(b => b.onclick = () =>
      form(b.dataset.ed, b.dataset.n, b.dataset.b, b.dataset.a === 'true', b.dataset.h, b.dataset.pse === 'true', b.dataset.hae, b.dataset.ra));
  };
  function form(id, nombre, bodega, activo, horas, pse, hae, ra) {
    const permite = id ? (pse !== false) : true;
    const rolSel = (r) => `<option value="docente"${(ra||'docente')==='docente'?' selected':''}>Docente</option><option value="jefe_panol"${ra==='jefe_panol'?' selected':''}>Jefe de pañol</option><option value="admin"${ra==='admin'?' selected':''}>Admin</option>`;
    openModal(`<h3>${id ? 'Editar' : 'Nueva'} sede</h3>
      <div class="field"><label>Nombre</label><input id="seN" value="${id ? escD(nombre) : ''}" placeholder="UST Santiago Centro"></div>
      <div class="field"><label>Cómo se llama el pañol/bodega</label><input id="seB" value="${id ? escD(bodega) : 'Pañol'}" placeholder="Pañol"></div>
      <div class="field"><label>Plazo de reserva (horas de anticipación)</label><input id="seH" type="number" min="0" value="${id ? (horas || 48) : 48}" placeholder="48"><small class="muted">Regla común: 48 h. Ajusta solo si esta sede necesita otro plazo.</small></div>
      <hr style="border:none;border-top:1px solid var(--line,#e5e7eb);margin:14px 0">
      <p class="muted" style="margin:0 0 8px;font-weight:600">Solicitudes excepcionales (flujo especial)</p>
      <div class="toggle"><input type="checkbox" id="sePSE" ${permite ? 'checked' : ''}><label for="sePSE" style="margin:0">Esta sede permite solicitudes excepcionales</label></div>
      <div class="field"><label>Plazo mínimo excepcional (horas)</label><input id="seHAE" type="number" min="0" value="${id ? (hae || 0) : 0}" placeholder="0"><small class="muted">0 = sin límite de tiempo; la excepción queda sujeta a autorización y disponibilidad.</small></div>
      <div class="field"><label>Quién autoriza las excepciones</label><select id="seRA">${rolSel(ra)}</select></div>
      ${id ? `<hr style="border:none;border-top:1px solid var(--line,#e5e7eb);margin:14px 0"><div class="toggle"><input type="checkbox" id="seA" ${activo ? 'checked' : ''}><label for="seA" style="margin:0">Sede activa</label></div>` : ''}
      <div class="err" id="seErr"></div><button class="btn full" id="seOk">Guardar</button>`);
    $('#seOk').onclick = async () => {
      $('#seErr').textContent = '';
      const body = {
        nombre: $('#seN').value.trim(), bodega_label: $('#seB').value.trim(),
        horas_anticipacion: Number($('#seH').value),
        permite_solicitud_especial: $('#sePSE').checked,
        horas_anticipacion_excepcional: Number($('#seHAE').value),
        rol_autoriza_especial: $('#seRA').value,
      };
      if (id) body.activo = $('#seA').checked;
      try {
        await api('/admin/sedes' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
        closeModal(); toast('Sede guardada'); await buildSedeSelector(); cargar();
      } catch (e) { $('#seErr').textContent = e.message; }
    };
  }
  $('#seNew').onclick = () => form(null);
  cargar();
}

// ===================== Respaldos (admin) =====================
async function viewRespaldos() {
  h(`<h2 class="page">Respaldos</h2>
    <p class="muted">Descarga un respaldo de los datos de tu sede activa en un archivo Excel (equipos, usuarios y reservas).</p>
    <div class="card" style="max-width:460px">
      <p style="margin-top:0;font-size:13.5px">El archivo incluye una hoja por cada conjunto de datos. Guárdalo en un lugar seguro.</p>
      <div class="aviso info">Supabase mantiene además respaldos automáticos de la base completa. Este export es para uso operativo y auditoría.</div>
      <button class="btn full" id="rsBtn">⬇ Descargar respaldo (.xlsx)</button>
      <div class="err" id="rsErr"></div>
    </div>`);
  $('#rsBtn').onclick = async () => {
    $('#rsErr').textContent = '';
    try {
      const res = await fetch('/api/admin/respaldo', { headers: { ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}), ...(SEDE ? { 'X-Sede-Id': String(SEDE) } : {}) } });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error al generar respaldo'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `respaldo_panol2_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Respaldo descargado');
    } catch (e) { $('#rsErr').textContent = e.message; }
  };
}

// ===================== Manuales / Ayuda (estático) =====================
function viewManuales() {
  const rol = ME.user.rol;
  const secciones = [
    ['🔑 Ingreso', 'Puedes iniciar sesión con tu RUT o tu correo institucional. El sistema te lleva automáticamente al menú de tu perfil (alumno, docente, pañolero o administrador).'],
    ['📅 Reservar un equipo', 'En Catálogo elige el equipo y pulsa Reservar. Declara el uso académico, elige fecha de inicio y término, y agrega integrantes si es grupal. Los recintos requieren 72 h de anticipación y autorización.'],
    ['🗓️ Disponibilidad', 'Antes de reservar, revisa en Disponibilidad los periodos ya ocupados del equipo y el horario de atención del pañol.'],
    ['⏰ Devoluciones y sanciones', 'Devuelve dentro del plazo. La devolución tardía o el no-show generan sanciones que bloquean nuevas reservas hasta su término.'],
    ['🙋 Solicitudes especiales', 'Si necesitas algo fuera de lo habilitado para tu asignatura, envía una Solicitud al docente desde el menú Solicitudes.'],
  ];
  const adminExtra = [
    ['🏫 Multisede', 'Como administrador puedes cambiar la sede activa desde el selector de la barra superior. Todo lo que gestiones (equipos, usuarios, reservas) corresponde a la sede seleccionada.'],
    ['📈 Reportes y respaldos', 'En Reportes generas y exportas datos a Excel/PDF. En Respaldos descargas un respaldo operativo de tu sede.'],
    ['📢 Anuncios', 'Publica avisos para los usuarios de la sede desde el menú Anuncios.'],
  ];
  const lista = rol === 'admin' ? secciones.concat(adminExtra) : secciones;
  h(`<h2 class="page">Ayuda y manuales</h2>
    <p class="muted">Guía rápida de uso de Pañol 2.0.</p>
    <div style="display:flex;flex-direction:column;gap:10px;max-width:720px">
      ${lista.map(([t, d]) => `<div class="card"><h3 style="margin:0 0 6px">${t}</h3><p style="margin:0;font-size:13.5px;line-height:1.5">${d}</p></div>`).join('')}
    </div>
    <p class="muted" style="margin-top:16px;font-size:12.5px">¿Dudas que no están aquí? Acércate al pañol o contacta al administrador del sistema.</p>`);
}

// ===================== Ficha completa del equipo =====================
// Redimensiona/comprime una imagen en el navegador a un data URI JPEG liviano.
function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, hh = img.height;
      if (w > maxDim || hh > maxDim) { const s = Math.min(maxDim / w, maxDim / hh); w = Math.round(w * s); hh = Math.round(hh * s); }
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      c.getContext('2d').drawImage(img, 0, 0, w, hh);
      try { resolve(c.toDataURL('image/jpeg', quality)); } catch (e) { reject(new Error('No se pudo procesar la imagen')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

async function fichaEquipo(id) {
  openModal('<h3>Ficha del equipo</h3><p class="muted">Cargando…</p>');
  try {
    const e = await api('/equipos/' + id);
    const [lab, cls] = ESTADO_EQ[e.estado] || [e.estado, 'info'];
    const row = (k, v) => v ? `<tr><td class="k" style="color:var(--muted);width:40%">${k}</td><td>${escD(v)}</td></tr>` : '';
    // Alumno/docente: ficha de consulta (sin QR, N° de serie ni condición), con foto de referencia.
    const esConsulta = ME.user.rol === 'alumno' || ME.user.rol === 'docente';
    const foto = e.foto_referencia
      ? `<img src="${escD(e.foto_referencia)}" alt="Foto de referencia" style="width:100%;max-height:220px;object-fit:contain;border-radius:10px;background:#f4f6f5;margin:4px 0 12px">`
      : `<div style="width:100%;height:130px;display:flex;align-items:center;justify-content:center;background:#f4f6f5;border-radius:10px;font-size:46px;margin:4px 0 12px">${icon(e.categoria)}</div>`;
    let html = `<h3>${escD(e.nombre)}</h3>
      <p style="margin:2px 0 10px"><span class="pill ${cls}">${lab}</span>${e.requiere_autorizacion ? ' <span class="pill warn">Requiere autorización</span>' : ''}</p>
      ${foto}
      <table style="box-shadow:none"><tbody>
        ${row('Categoría', e.categoria)}${row('Marca', e.marca)}${row('Modelo', e.modelo)}${row('Tipo', e.tipo)}
        ${esConsulta ? '' : row('Código QR', e.codigo_qr) + row('N° de serie', e.n_serie) + row('Condición', e.condicion)}
        ${row('Laboratorio', e.laboratorio)}${row('Accesorios', e.accesorios)}
      </tbody></table>`;
    // Gestión de foto de referencia (roles operativos).
    const puedeFoto = ['panolero', 'jefe_panol', 'admin'].includes(ME.user.rol);
    if (puedeFoto) {
      html += `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <label class="btn sm ghost" style="cursor:pointer;margin:0">📷 ${e.foto_referencia ? 'Cambiar' : 'Agregar'} foto
          <input id="fFoto" type="file" accept="image/*" style="display:none"></label>
        ${e.foto_referencia ? '<button class="btn sm ghost danger" id="fFotoDel" type="button">Quitar foto</button>' : ''}
        <span class="err" id="fFotoE" style="flex-basis:100%"></span></div>`;
    }
    if (ME.user.rol === 'admin' || ME.user.rol === 'panolero') {
      html += '<div id="fHist" class="muted" style="margin-top:12px">Cargando historial…</div>';
    }
    $('#modalRoot .modal').innerHTML = `<button class="close">×</button>${html}`;
    $('#modalRoot .close').onclick = closeModal;
    if (puedeFoto) {
      const fin = $('#fFoto');
      if (fin) fin.onchange = async () => {
        const file = fin.files && fin.files[0]; if (!file) return;
        $('#fFotoE').textContent = 'Procesando imagen…';
        try {
          const dataUrl = await resizeImage(file, 1000, 0.72);
          await api('/equipos/' + id + '/foto', { method: 'PUT', body: { foto: dataUrl } });
          toast('Foto actualizada'); fichaEquipo(id);
        } catch (err) { $('#fFotoE').textContent = err.message || 'Error al subir la foto'; }
      };
      const del = $('#fFotoDel');
      if (del) del.onclick = async () => {
        try { await api('/equipos/' + id + '/foto', { method: 'PUT', body: { foto: null } }); toast('Foto quitada'); fichaEquipo(id); }
        catch (err) { toast(err.message || 'Error'); }
      };
    }
    if (ME.user.rol === 'admin' || ME.user.rol === 'panolero') {
      const hist = await api('/equipos/' + id + '/historial');
      const pr = hist.prestamos.length
        ? hist.prestamos.map(p => `<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(p.usuario || '—')}</b><small>${p.fecha_salida ? fmtDate(p.fecha_salida) : ''}${p.fecha_retorno ? ' → ' + fmtDate(p.fecha_retorno) : ''} · ${escD(p.estado)}</small></div></div>`).join('')
        : '<p class="muted">Sin préstamos registrados.</p>';
      const mt = hist.mantenciones.length
        ? hist.mantenciones.map(m => `<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(m.tipo)}</b><small>${m.fecha ? fmtDate(m.fecha) : ''}${m.detalle ? ' · ' + escD(m.detalle) : ''}</small></div></div>`).join('')
        : '<p class="muted">Sin mantenciones registradas.</p>';
      $('#fHist').innerHTML = `<h4 style="margin:4px 0 6px;font-size:13px">Últimos préstamos</h4>${pr}
        <h4 style="margin:12px 0 6px;font-size:13px">Mantenciones</h4>${mt}`;
    }
  } catch (e) { $('#modalRoot .modal').innerHTML = `<button class="close" onclick="closeModal()">×</button><div class="aviso bad">${escD(e.message)}</div>`; $('#modalRoot .close').onclick = closeModal; }
}

// ===================== Bloqueo de horarios (admin/pañolero) =====================
async function viewBloqueos() {
  h(`<h2 class="page">Bloqueo de horarios</h2>
    <p class="muted">Define periodos en que un equipo (o todos) no puede reservarse: mantención, feriados, eventos.</p>
    <button class="btn" id="blNew" style="margin-bottom:14px">+ Nuevo bloqueo</button>
    <div id="blList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const data = await api('/admin/bloqueos');
    if (data && data._pendiente_migracion) { $('#blList').innerHTML = '<div class="aviso warn">Falta correr la migración <b>05</b> en Supabase para activar los bloqueos.</div>'; return; }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) { $('#blList').innerHTML = '<p class="muted">No hay bloqueos vigentes.</p>'; return; }
    $('#blList').innerHTML = rows.map(b => `<div class="row"><div class="ava">🚫</div>
      <div class="info"><b>${escD(b.equipo || 'Todos los equipos')}</b><small>${fmtDate(b.fecha_inicio)} → ${fmtDate(b.fecha_fin)} · ${escD(b.motivo)}</small></div>
      <button class="btn sm ghost danger" data-del="${b.id}">Quitar</button></div>`).join('');
    $('#blList').querySelectorAll('[data-del]').forEach(x => x.onclick = async () => {
      try { await api('/admin/bloqueos/' + x.dataset.del, { method: 'DELETE' }); toast('Bloqueo eliminado'); cargar(); }
      catch (e) { toast(e.message); }
    });
  };
  $('#blNew').onclick = async () => {
    const eq = await api('/equipos');
    openModal(`<h3>Nuevo bloqueo</h3>
      <div class="field"><label>Equipo</label><select id="blEq"><option value="">— Todos los equipos —</option>
        ${eq.map(e => `<option value="${e.id}">${escD(e.nombre)} · ${escD(e.codigo_qr)}</option>`).join('')}</select></div>
      <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Desde</label><input type="datetime-local" id="blIni"></div>
      <div class="field" style="flex:1"><label>Hasta</label><input type="datetime-local" id="blFin"></div></div>
      <div class="field"><label>Motivo</label><input id="blMot" placeholder="Mantención programada"></div>
      <div class="err" id="blErr"></div><button class="btn full" id="blOk">Crear bloqueo</button>`);
    const now = new Date();
    $('#blIni').value = dtLocal(now.toISOString());
    $('#blFin').value = dtLocal(new Date(now.getTime() + 3 * 3600000).toISOString());
    $('#blOk').onclick = async () => {
      $('#blErr').textContent = '';
      try {
        await api('/admin/bloqueos', { method: 'POST', body: {
          equipo_id: $('#blEq').value ? Number($('#blEq').value) : null,
          fecha_inicio: new Date($('#blIni').value).toISOString(),
          fecha_fin: new Date($('#blFin').value).toISOString(),
          motivo: $('#blMot').value.trim(),
        }});
        closeModal(); toast('Bloqueo creado'); cargar();
      } catch (e) { $('#blErr').textContent = e.message; }
    };
  };
  cargar();
}

// ===================== Aprobación de grupos (docente/admin) =====================
async function viewGrupos() {
  h(`<h2 class="page">Aprobación de grupos</h2>
    <p class="muted">Reservas grupales pendientes de validar la composición del grupo.</p>
    <div id="grList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const rows = await api('/grupos/pendientes');
    if (!rows.length) { $('#grList').innerHTML = '<p class="muted">No hay grupos pendientes de aprobación.</p>'; return; }
    $('#grList').innerHTML = rows.map(g => `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${escD(g.equipo)}</b><small class="muted">${fmtDate(g.fecha_inicio)} → ${fmtDate(g.fecha_fin)}</small></div>
      <p style="font-size:13px;margin:6px 0 4px">Solicitante: ${escD(g.solicitante)} (${escD(g.rut)})</p>
      <p style="font-size:12px;margin:0 0 8px" class="muted">Integrantes: ${g.integrantes.map(i => escD(i.nombre) + (i.es_responsable ? ' (resp.)' : '')).join(', ') || '—'}</p>
      <div style="display:flex;gap:8px"><button class="btn sm ap" data-id="${g.id}">Aprobar grupo</button><button class="btn sm ghost danger rc" data-id="${g.id}">Rechazar</button></div>
    </div>`).join('');
    const resolver = async (id, estado) => {
      try { await api('/grupos/' + id + '/aprobar', { method: 'POST', body: { estado } }); toast(estado === 'aprobado' ? 'Grupo aprobado' : 'Grupo rechazado'); cargar(); }
      catch (e) { toast(e.message); }
    };
    $('#grList').querySelectorAll('.ap').forEach(b => b.onclick = () => resolver(b.dataset.id, 'aprobado'));
    $('#grList').querySelectorAll('.rc').forEach(b => b.onclick = () => resolver(b.dataset.id, 'rechazado'));
  };
  cargar();
}

// ===================== Reportes (admin): Excel / PDF =====================
const REPORTES = { reservas: 'Reservas por periodo', equipos: 'Equipos más solicitados', inventario: 'Inventario de equipos' };
async function viewReportes() {
  h(`<h2 class="page">Reportes</h2>
    <p class="muted">Genera reportes de gestión y expórtalos a Excel o PDF.</p>
    <div class="card" style="margin-bottom:14px">
      <div class="field"><label>Tipo de reporte</label><select id="rpTipo">${Object.entries(REPORTES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap" id="rpFechas">
        <div class="field" style="flex:1;min-width:140px"><label>Desde</label><input type="date" id="rpDesde"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Hasta</label><input type="date" id="rpHasta"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="rpVer" style="flex:1">Ver</button>
        <button class="btn ghost" id="rpXlsx">⬇ Excel</button>
        <button class="btn ghost" id="rpPdf">⬇ PDF</button>
      </div>
    </div>
    <div id="rpRes"></div>`);
  const hoy = new Date(), hace30 = new Date(hoy.getTime() - 30 * 864e5);
  const iso = d => d.toISOString().slice(0, 10);
  $('#rpDesde').value = iso(hace30); $('#rpHasta').value = iso(hoy);
  const qs = () => `?tipo=${$('#rpTipo').value}&desde=${$('#rpDesde').value}&hasta=${$('#rpHasta').value}`;
  const toggleFechas = () => { $('#rpFechas').style.display = $('#rpTipo').value === 'inventario' ? 'none' : 'flex'; };
  $('#rpTipo').onchange = toggleFechas; toggleFechas();
  let ultimo = null;
  const ver = async () => {
    $('#rpRes').innerHTML = '<p class="muted">Generando…</p>';
    try {
      const d = await api('/admin/reportes' + qs());
      ultimo = d;
      if (!d.filas.length) { $('#rpRes').innerHTML = `<h3>${escD(d.titulo)}</h3><p class="muted">Sin datos para el periodo.</p>`; return; }
      $('#rpRes').innerHTML = `<h3 style="margin-bottom:8px">${escD(d.titulo)} <span class="muted" style="font-size:13px;font-weight:400">(${d.filas.length})</span></h3>
        <table><thead><tr>${d.columnas.map(c => `<th>${escD(c)}</th>`).join('')}</tr></thead>
        <tbody>${d.filas.map(f => `<tr>${f.map(v => `<td>${escD(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } catch (e) { $('#rpRes').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  };
  $('#rpVer').onclick = ver;
  $('#rpTipo').addEventListener('change', ver);
  $('#rpXlsx').onclick = async () => {
    try {
      const res = await fetch('/api/admin/reportes/xlsx' + qs(), { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error al exportar'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `reporte_${$('#rpTipo').value}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast(e.message); }
  };
  $('#rpPdf').onclick = async () => {
    if (!ultimo) await ver();
    if (!ultimo || !ultimo.filas.length) { toast('Primero genera un reporte con datos'); return; }
    const w = window.open('', '_blank');
    if (!w) { toast('Permite ventanas emergentes para exportar PDF'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escD(ultimo.titulo)}</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#152230;margin:28px}
      h1{color:#0E8F86;font-size:18px;margin:0 0 2px}.s{color:#6B7785;font-size:11px;margin:0 0 16px}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E4E8ED}
      th{background:#EFF2F7}</style></head><body>
      <h1>Pañol 2.0 · ${escD(ultimo.titulo)}</h1><p class="s">Instituto Profesional Santo Tomás — ${new Date().toLocaleString('es-CL')}</p>
      <table><thead><tr>${ultimo.columnas.map(c => `<th>${escD(c)}</th>`).join('')}</tr></thead>
      <tbody>${ultimo.filas.map(f => `<tr>${f.map(v => `<td>${escD(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };
  ver();
}

// ---------- Kits de equipos por asignatura (build v20) ----------
async function viewKits() {
  const gestor = ['docente','admin'].includes(ME.user.rol);
  h(`<h2 class="page">Kits de equipos</h2>
     ${gestor ? '<div style="margin:0 0 12px"><button class="btn sm" id="kNew">+ Nuevo kit</button></div>' : '<p class="muted">Reserva un kit completo asociado a tu asignatura.</p>'}
     <div id="klist"></div>`);
  if (gestor) $('#kNew').onclick = () => modalKitNuevo();
  let kits = [];
  try { kits = await api('/kits'); } catch (e) { $('#klist').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
  if (!kits.length) { $('#klist').innerHTML = '<p class="muted">No hay kits definidos todavía.</p>'; return; }
  $('#klist').innerHTML = kits.map((k,i) => `<div class="row"><div class="ava">🎒</div>
    <div class="info"><b>${escD(k.nombre)}</b><small>${escD(k.asignatura)}${k.seccion?' · '+escD(k.seccion):''} · ${k.n_items} equipo(s)</small></div>
    <div style="display:flex;gap:6px">
      <button class="btn sm" data-res="${i}">Reservar</button>
      ${gestor?`<button class="btn sm ghost" data-ed="${i}">Editar</button><button class="btn sm ghost" data-del="${i}">Eliminar</button>`:''}
    </div></div>`).join('');
  $('#klist').querySelectorAll('button[data-res]').forEach(b => b.onclick = () => modalKitReservar(kits[Number(b.dataset.res)]));
  if (gestor) {
    $('#klist').querySelectorAll('button[data-ed]').forEach(b => b.onclick = () => modalKitNuevo(kits[Number(b.dataset.ed)]));
    $('#klist').querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => {
      const k = kits[Number(b.dataset.del)];
      if (!confirm(`¿Eliminar el kit "${k.nombre}"?`)) return;
      try { await api(`/kits/${k.id}`, { method:'DELETE' }); toast('Kit eliminado'); viewKits(); } catch(e){ toast(e.message||'Error'); }
    });
  }
}
async function modalKitReservar(kit) {
  let d; try { d = await api(`/kits/${kit.id}`); } catch(e){ return toast(e.message||'Error'); }
  const faltan = d.items.some(it => it.disponibles < it.cantidad);
  openModal(`<h3>Reservar kit — ${escD(d.nombre)}</h3>
    <div class="aviso ${faltan?'warn':'ok'}" style="margin-bottom:10px">${escD(d.asignatura)}</div>
    <table class="tbl" style="width:100%;margin-bottom:10px"><thead><tr><th>Equipo (modelo)</th><th>Pide</th><th>Disp.</th></tr></thead>
      <tbody>${d.items.map(it => `<tr><td>${escD(it.nombre)}${it.marca?' · '+escD(it.marca):''}</td><td style="text-align:center">${it.cantidad}</td>
        <td style="text-align:center;color:${it.disponibles<it.cantidad?'#C0392B':'#1C7A46'}">${it.disponibles}</td></tr>`).join('')}</tbody></table>
    <div class="field"><label>Inicio</label><input type="datetime-local" id="kIni"></div>
    <div class="field"><label>Término</label><input type="datetime-local" id="kFin"></div>
    <div class="err" id="kErr">${faltan?'Algún modelo no tiene stock suficiente en esta sede.':''}</div>
    <button class="btn full" id="kOk" ${faltan?'disabled':''}>Reservar kit completo</button>`);
  $('#kOk').onclick = async () => {
    try {
      const r = await api(`/kits/${kit.id}/reservar`, { method:'POST', body:{
        fecha_inicio: new Date($('#kIni').value).toISOString(),
        fecha_fin: new Date($('#kFin').value).toISOString() } });
      closeModal(); toast(`Kit reservado (${r.reservas} equipos)`);
    } catch(e){ $('#kErr').textContent = e.message; }
  };
}
async function modalKitNuevo(kit) {
  // Asignaturas gestionables
  let asigs = [];
  try {
    if (ME.user.rol === 'docente') asigs = (await api('/mis-asignaturas')).filter(a => a.rol_en_asig === 'docente');
    else { const ac = await api('/academico'); asigs = (ac.carreras||ac||[]).flatMap(c => (c.asignaturas||[]).map(a => ({id:a.id, nombre:a.nombre, seccion:a.seccion, carrera:c.nombre}))); }
  } catch(e){}
  let modelos = [];
  let lineas = kit ? (await api(`/kits/${kit.id}`)).items.map(it => ({categoria_id:it.categoria_id, nombre:it.nombre, modelo:it.modelo, marca:it.marca, categoria:it.categoria, cantidad:it.cantidad})) : [];
  const optA = asigs.map(a => `<option value="${a.id}" ${kit&&kit.asignatura_id===a.id?'selected':''}>${escD(a.nombre)}${a.seccion?' ('+escD(a.seccion)+')':''}</option>`).join('');
  openModal(`<h3>${kit?'Editar kit':'Definir un kit de equipos'}</h3>
    <div class="field"><label>Nombre del kit</label><input id="knNom" value="${kit?escD(kit.nombre):''}" placeholder="Kit Reportería"></div>
    <div class="field"><label>Asociado a la asignatura</label><select id="knAsig" ${kit?'disabled':''}>${optA||'<option value="">— sin asignaturas —</option>'}</select></div>
    <hr style="border:none;border-top:1px solid #e3eae7;margin:12px 0">
    <label style="font-weight:700;font-size:13px">Agregar equipamiento</label>
    <p class="muted" style="font-size:11.5px;margin:2px 0 6px">Solo el equipamiento permitido para la asignatura, con sus unidades disponibles. Indica la cantidad a reservar.</p>
    <div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap">
      <select id="knMod" style="flex:1;min-width:0"><option value="">Cargando…</option></select>
      <input id="knCant" type="number" min="1" value="1" style="width:56px;flex:0 0 auto" title="Cantidad a reservar">
      <button class="btn sm" id="knAdd" type="button" style="flex:0 0 auto">Agregar</button></div>
    <div id="knList"></div>
    <div class="err" id="knErr"></div>
    <button class="btn full" id="knOk">${kit?'Guardar cambios':'Crear kit'}</button>`);
  const pintar = () => {
    $('#knList').innerHTML = lineas.length ? lineas.map((l,i) => `<div class="row" style="padding:6px 8px">
      <div class="info"><b>${escD(l.nombre)}</b><small>${escD(l.categoria||'')}${l.marca?' · '+escD(l.marca):''} · x${l.cantidad}</small></div>
      <button class="btn sm ghost" data-rm="${i}" type="button">Quitar</button></div>`).join('')
      : '<p class="muted" style="margin:4px 0">Aún no agregas equipamiento al kit.</p>';
    $('#knList').querySelectorAll('button[data-rm]').forEach(b => b.onclick = () => { lineas.splice(Number(b.dataset.rm),1); pintar(); });
  };
  pintar();
  const setMax = () => {
    const m = modelos[Number($('#knMod').value)];
    const max = m ? Math.max(1, m.disponibles) : 1;
    $('#knCant').max = max;
    if (Number($('#knCant').value) > max) $('#knCant').value = max;
  };
  const refreshMod = () => {
    $('#knMod').innerHTML = modelos.length
      ? modelos.map((m,i) => `<option value="${i}">${escD(m.categoria)} · ${escD(m.nombre)}${m.marca?' · '+escD(m.marca):''} — ${m.disponibles} disp.</option>`).join('')
      : '<option value="">— sin equipamiento habilitado para la asignatura —</option>';
    setMax();
  };
  const loadModelos = async (aid) => {
    $('#knMod').innerHTML = '<option value="">Cargando…</option>';
    try { modelos = aid ? await api('/modelos?asignatura_id=' + aid) : []; } catch(e){ modelos = []; }
    refreshMod();
  };
  $('#knMod').onchange = setMax;
  $('#knAsig').onchange = () => { lineas = []; pintar(); loadModelos(Number($('#knAsig').value)); };
  await loadModelos(kit ? kit.asignatura_id : Number($('#knAsig').value || 0));
  $('#knAdd').onclick = () => {
    const mi = Number($('#knMod').value); if (isNaN(mi) || !modelos[mi]) return $('#knErr').textContent = 'Selecciona un equipo del listado.';
    const m = modelos[mi]; const cant = Math.max(1, Number($('#knCant').value)||1);
    if (cant > m.disponibles) { $('#knErr').textContent = `Solo hay ${m.disponibles} unidad(es) disponible(s) de ${m.nombre}.`; return; }
    $('#knErr').textContent = '';
    const ex = lineas.find(l => l.nombre===m.nombre && l.categoria_id===m.categoria_id && (l.marca||'')===(m.marca||''));
    if (ex) ex.cantidad = Math.min(m.disponibles, ex.cantidad + cant);
    else lineas.push({categoria_id:m.categoria_id, nombre:m.nombre, modelo:m.modelo, marca:m.marca, categoria:m.categoria, cantidad:cant});
    pintar();
  };
  $('#knOk').onclick = async () => {
    const nombre = $('#knNom').value.trim();
    const asignatura_id = Number($('#knAsig').value);
    if (!nombre) return $('#knErr').textContent = 'Indica un nombre para el kit.';
    if (!kit && !asignatura_id) return $('#knErr').textContent = 'Selecciona una asignatura.';
    if (!lineas.length) return $('#knErr').textContent = 'Agrega al menos un equipo.';
    const items = lineas.map(l => ({categoria_id:l.categoria_id, nombre:l.nombre, modelo:l.modelo, marca:l.marca, cantidad:l.cantidad}));
    try {
      if (kit) await api(`/kits/${kit.id}`, { method:'PUT', body:{ nombre, items } });
      else await api('/kits', { method:'POST', body:{ nombre, asignatura_id, items } });
      closeModal(); toast('Kit guardado'); viewKits();
    } catch(e){ $('#knErr').textContent = e.message; }
  };
}

// ---------- Modal utils ----------
function openModal(html) {
  $('#modalRoot').innerHTML = `<div class="modal-bg"><div class="modal"><button class="close">×</button>${html}</div></div>`;
  $('#modalRoot .close').onclick = closeModal;
  $('#modalRoot .modal-bg').onclick = e => { if (e.target.classList.contains('modal-bg')) closeModal(); };
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

// ---------- Arranque ----------
if (TOKEN) boot().catch(() => { TOKEN = null; localStorage.removeItem('prestalo_token'); });
