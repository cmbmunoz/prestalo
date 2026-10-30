/* =====================================================================
   Préstalo — Asistente IA flotante (web). Auto-contenido: inyecta su
   propio estilo y DOM, y conversa contra POST /api/asistente.
   Alcance: solo app Préstalo + normativa del pañol (lo acota el backend).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__prestaloAsistente) return;
  window.__prestaloAsistente = true;

  var BRAND = '#194136', BRAND2 = '#237A5F';
  var historial = [];           // {rol:'usuario'|'asistente', texto}
  var abierto = false, cargando = false;

  // ---------- estilos ----------
  var css = ''
    + '.pa-fab{position:fixed;right:20px;bottom:20px;z-index:99998;width:60px;height:60px;border:none;border-radius:50%;'
    + 'cursor:pointer;color:#fff;background:linear-gradient(135deg,' + BRAND + ',' + BRAND2 + ');'
    + 'box-shadow:0 8px 24px -6px rgba(14,143,134,.6);display:grid;place-items:center;transition:transform .15s}'
    + '.pa-fab:hover{transform:scale(1.06)}.pa-fab svg{width:28px;height:28px}'
    + '.pa-panel{position:fixed;right:20px;bottom:92px;z-index:99999;width:360px;max-width:calc(100vw - 32px);'
    + 'height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;overflow:hidden;'
    + 'box-shadow:0 20px 60px -15px rgba(15,23,42,.4);display:none;flex-direction:column;font-family:inherit}'
    + '.pa-panel.open{display:flex}'
    + '.pa-head{background:linear-gradient(135deg,' + BRAND + ',' + BRAND2 + ');color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}'
    + '.pa-head .pa-t{font-weight:700;font-size:15px;line-height:1.1}.pa-head .pa-s{font-size:11px;opacity:.85}'
    + '.pa-head .pa-x{margin-left:auto;background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:16px}'
    + '.pa-body{flex:1;overflow-y:auto;padding:14px;background:#f6f8fa;display:flex;flex-direction:column;gap:10px}'
    + '.pa-msg{max-width:84%;padding:10px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}'
    + '.pa-bot{align-self:flex-start;background:#fff;border:1px solid #e3e8ef;border-bottom-left-radius:4px;color:#0f172a}'
    + '.pa-user{align-self:flex-end;background:' + BRAND + ';color:#fff;border-bottom-right-radius:4px}'
    + '.pa-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}'
    + '.pa-chip{background:#fff;border:1px solid #cfe0dd;color:' + BRAND + ';border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer}'
    + '.pa-chip:hover{background:#eefaf8}'
    + '.pa-foot{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e8ef;background:#fff}'
    + '.pa-foot input{flex:1;border:1px solid #d6dee8;border-radius:10px;padding:10px 12px;font-size:13.5px;outline:none;font-family:inherit}'
    + '.pa-foot input:focus{border-color:' + BRAND + '}'
    + '.pa-foot button{border:none;background:' + BRAND + ';color:#fff;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:600}'
    + '.pa-foot button:disabled{opacity:.5;cursor:default}'
    + '.pa-dots span{display:inline-block;width:6px;height:6px;margin:0 1px;border-radius:50%;background:#9aa7b6;animation:pa-b 1s infinite}'
    + '.pa-dots span:nth-child(2){animation-delay:.2s}.pa-dots span:nth-child(3){animation-delay:.4s}'
    + '@keyframes pa-b{0%,60%,100%{opacity:.3}30%{opacity:1}}'
    + '.pa-note{font-size:10.5px;color:#90a0b0;text-align:center;padding:0 10px 8px;background:#fff}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------- DOM ----------
  var fab = document.createElement('button');
  fab.className = 'pa-fab'; fab.setAttribute('aria-label', 'Abrir asistente');
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'pa-panel';
  panel.innerHTML = ''
    + '<div class="pa-head"><div><div class="pa-t">Asistente Préstalo</div><div class="pa-s">App y normativa del pañol UST</div></div>'
    + '<button class="pa-x" aria-label="Cerrar">×</button></div>'
    + '<div class="pa-body" id="paBody"></div>'
    + '<div class="pa-note">Responde solo sobre Préstalo y el pañol de la UST. Verifica datos críticos con el personal de Pañol.</div>'
    + '<div class="pa-foot"><input id="paInput" type="text" placeholder="Escribe tu consulta..." autocomplete="off">'
    + '<button id="paSend" aria-label="Enviar">Enviar</button></div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var body = panel.querySelector('#paBody');
  var input = panel.querySelector('#paInput');
  var send = panel.querySelector('#paSend');

  function addMsg(texto, who) {
    var d = document.createElement('div');
    d.className = 'pa-msg ' + (who === 'user' ? 'pa-user' : 'pa-bot');
    d.textContent = texto;
    body.appendChild(d); body.scrollTop = body.scrollHeight;
    return d;
  }
  function typing() {
    var d = document.createElement('div');
    d.className = 'pa-msg pa-bot pa-dots';
    d.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(d); body.scrollTop = body.scrollHeight;
    return d;
  }

  function sugerencias() {
    var chips = ['¿Con cuánta anticipación debo reservar?', '¿Qué pasa si devuelvo tarde?',
      '¿Cómo recupero mi clave?', '¿Para qué sirve Préstalo?'];
    var wrap = document.createElement('div'); wrap.className = 'pa-chips';
    chips.forEach(function (c) {
      var b = document.createElement('button'); b.className = 'pa-chip'; b.textContent = c;
      b.onclick = function () { enviar(c); };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }

  var saludado = false;
  function saludar() {
    if (saludado) return; saludado = true;
    addMsg('¡Hola! Soy el asistente de Préstalo. Puedo ayudarte con el uso de la app y con la normativa del pañol de la UST. ¿En qué te ayudo?', 'bot');
    sugerencias();
  }

  async function enviar(texto) {
    texto = (texto != null ? texto : input.value).trim();
    if (!texto || cargando) return;
    input.value = '';
    addMsg(texto, 'user');
    historial.push({ rol: 'usuario', texto: texto });
    cargando = true; send.disabled = true;
    var t = typing();
    try {
      var resp = await fetch('/api/asistente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta: texto, historial: historial.slice(0, -1) })
      });
      var data = await resp.json().catch(function () { return {}; });
      t.remove();
      if (!resp.ok) {
        addMsg(data.error ? ('Lo siento, hubo un problema: ' + data.error) : 'Lo siento, no pude responder en este momento.', 'bot');
      } else {
        var r = data.respuesta || 'No tengo una respuesta para eso.';
        addMsg(r, 'bot');
        historial.push({ rol: 'asistente', texto: r });
      }
    } catch (e) {
      t.remove();
      addMsg('No pude conectar con el asistente. Revisa tu conexión e inténtalo de nuevo.', 'bot');
    } finally {
      cargando = false; send.disabled = false; input.focus();
    }
  }

  function toggle() {
    abierto = !abierto;
    panel.classList.toggle('open', abierto);
    if (abierto) { saludar(); setTimeout(function () { input.focus(); }, 50); }
  }

  fab.onclick = toggle;
  panel.querySelector('.pa-x').onclick = toggle;
  send.onclick = function () { enviar(); };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); enviar(); } });
})();
