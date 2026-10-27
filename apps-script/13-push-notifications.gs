/* ============================================================
   AVISOS (notificaciones push propias, sin servicios externos)
   - Hoja "Avisos": dispositivos que activaron los avisos (ID | Endpoint | Creado | Resultado)
   - Hoja "Avisos cola": mensajes pendientes (ID | Tipo | Clave | Título | Texto | Url | Creado | Entregado)
   - El push va SIN texto (firmado con VAPID); el teléfono pide el mensaje al servidor al recibirlo.
   - La clave privada vive en Propiedades de la secuencia (VAPID_PRIV), nunca en el código.
   ============================================================ */
// Public key: Script property VAPID_PUB (the same value goes in web/config.js). Generate both with tools/generate-vapid-keys.js
function vapidPub_() { return PropertiesService.getScriptProperties().getProperty('VAPID_PUB') || ''; }
const VAPID_SUB = 'mailto:admin@example.com';   // contact required by the push services; change it to yours
const HOJA_AVISOS = 'Avisos';
const HOJA_COLA = 'Avisos cola';
const AVISOS_MAX_DISP = 3;                 // dispositivos por alumno
const AVISOS_POR_MINUTO = 30;
const BONO_DIAS = 2;                       // días extra por renovar a tiempo
const HOST_PUSH_OK = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

/* ---- ES256 (ECDSA P-256 + SHA-256) en JS puro, para firmar el VAPID ---- */
const P256 = {
  p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  a: BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
  gx: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
  gy: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')
};
function ecMod_(x, m) { const r = x % m; return r >= BigInt(0) ? r : r + m; }
function ecInv_(a, m) {
  let [r0, r1] = [ecMod_(a, m), m], [s0, s1] = [BigInt(1), BigInt(0)];
  while (r1 !== BigInt(0)) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return ecMod_(s0, m);
}
function ecSuma_(P, Q) {
  if (!P) return Q; if (!Q) return P;
  const p = P256.p;
  let l;
  if (P[0] === Q[0]) {
    if (ecMod_(P[1] + Q[1], p) === BigInt(0)) return null;
    l = ecMod_((BigInt(3) * P[0] * P[0] + P256.a) * ecInv_(BigInt(2) * P[1], p), p);
  } else l = ecMod_((Q[1] - P[1]) * ecInv_(Q[0] - P[0], p), p);
  const x = ecMod_(l * l - P[0] - Q[0], p);
  return [x, ecMod_(l * (P[0] - x) - P[1], p)];
}
function ecMul_(k, P) {
  let R = null, A = P;
  while (k > BigInt(0)) { if (k & BigInt(1)) R = ecSuma_(R, A); A = ecSuma_(A, A); k >>= BigInt(1); }
  return R;
}
function bytesABig_(b) { let x = BigInt(0); for (let i = 0; i < b.length; i++) x = (x << BigInt(8)) | BigInt(b[i] & 255); return x; }
function bigABytes_(x, len) { const o = new Array(len); for (let i = len - 1; i >= 0; i--) { o[i] = Number(x & BigInt(255)); x >>= BigInt(8); } return o; }
function sg_(b) { return b.map((v) => (v > 127 ? v - 256 : v)); }
function hmacSha256_(clave, datos) { return Array.prototype.slice.call(Utilities.computeHmacSha256Signature(sg_(datos), sg_(clave))).map((v) => v & 255); }
function sha256_(datos) { return Array.prototype.slice.call(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sg_(datos))).map((v) => v & 255); }
// k determinista (RFC 6979): sin depender de un generador aleatorio
function ecK_(d, h1) {
  const x = bigABytes_(d, 32), h = bigABytes_(ecMod_(bytesABig_(h1), P256.n), 32);
  let V = new Array(32).fill(1), K = new Array(32).fill(0);
  K = hmacSha256_(K, V.concat([0], x, h)); V = hmacSha256_(K, V);
  K = hmacSha256_(K, V.concat([1], x, h)); V = hmacSha256_(K, V);
  for (;;) {
    V = hmacSha256_(K, V);
    const k = bytesABig_(V);
    if (k > BigInt(0) && k < P256.n) return k;
    K = hmacSha256_(K, V.concat([0])); V = hmacSha256_(K, V);
  }
}
// Devuelve la firma r||s (64 bytes) de "datos" (bytes) con la clave privada "dBytes" (32 bytes)
function es256Firmar_(dBytes, datos) {
  const d = bytesABig_(dBytes), h1 = sha256_(datos), z = bytesABig_(h1);
  const k = ecK_(d, h1), R = ecMul_(k, [P256.gx, P256.gy]);
  const r = ecMod_(R[0], P256.n);
  const s = ecMod_(ecInv_(k, P256.n) * (z + r * d), P256.n);
  return bigABytes_(r, 32).concat(bigABytes_(s, 32));
}
function es256Publica_(dBytes) {
  const Q = ecMul_(bytesABig_(dBytes), [P256.gx, P256.gy]);
  return [4].concat(bigABytes_(Q[0], 32), bigABytes_(Q[1], 32));
}


function aSigned_(b) { return b.map((v) => (v > 127 ? v - 256 : v)); }
function b64u_(bytes) { return Utilities.base64EncodeWebSafe(aSigned_(bytes)).replace(/=+$/, ''); }
function b64uTexto_(t) { return b64u_(Array.prototype.slice.call(Utilities.newBlob(t).getBytes()).map((v) => v & 255)); }
function b64uABytes_(s) { return Array.prototype.slice.call(Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4))).map((v) => v & 255); }

function jwtVapid_(audiencia, cache) {
  if (cache[audiencia]) return cache[audiencia];
  const priv = PropertiesService.getScriptProperties().getProperty('VAPID_PRIV');
  if (!priv) throw new Error('Falta VAPID_PRIV');
  const cuerpo = b64uTexto_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' +
    b64uTexto_(JSON.stringify({ aud: audiencia, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUB }));
  const datos = Array.prototype.slice.call(Utilities.newBlob(cuerpo).getBytes()).map((v) => v & 255);
  const jwt = cuerpo + '.' + b64u_(es256Firmar_(b64uABytes_(priv), datos));
  cache[audiencia] = jwt;
  return jwt;
}

// Envía un push vacío. Devuelve el código HTTP (201 = entregado al servicio de notificaciones)
function enviarPush_(endpoint, cache) {
  const m = /^(https:\/\/[^\/]+)/.exec(endpoint);
  if (!m) return 0;
  const r = UrlFetchApp.fetch(endpoint, {
    method: 'post', muteHttpExceptions: true, payload: '',
    headers: { Authorization: 'vapid t=' + jwtVapid_(m[1], cache) + ', k=' + vapidPub_(), TTL: '43200', Urgency: 'high' }
  });
  return r.getResponseCode();
}

function endpointValido_(e) {
  e = String(e || '');
  if (e.length < 40 || e.length > 700 || !/^https:\/\/[A-Za-z0-9.\-]+\/[\x21-\x7E]*$/.test(e)) return false;
  const host = /^https:\/\/([^\/]+)/.exec(e)[1].toLowerCase();
  return HOST_PUSH_OK.test(host);
}

function asegurarHojaAvisos_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_AVISOS);
  if (h) return h;
  h = ss.insertSheet(HOJA_AVISOS);
  h.getRange(1, 1, 1, 4).setValues([['ID', 'Endpoint', 'Creado', 'Resultado']]).setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1); h.getRange('A2:D').setNumberFormat('@');
  [110, 420, 150, 200].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Dispositivos con avisos: los escribe el sistema').setWarningOnly(true);
  return h;
}
function asegurarHojaCola_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_COLA);
  if (h) return h;
  h = ss.insertSheet(HOJA_COLA);
  h.getRange(1, 1, 1, 8).setValues([['ID', 'Tipo', 'Clave', 'Título', 'Texto', 'Url', 'Creado', 'Entregado']]).setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1); h.getRange('A2:H').setNumberFormat('@');
  [110, 70, 170, 260, 420, 160, 150, 150].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Cola de avisos: la escribe el sistema').setWarningOnly(true);
  return h;
}

function dispositivosDe_(hoja) {            // { id: [{fila, endpoint}] }
  const n = hoja.getLastRow() - 1, out = {};
  if (n < 1) return out;
  hoja.getRange(2, 1, n, 2).getValues().forEach((f, i) => {
    const id = String(f[0]); if (!id) return;
    (out[id] = out[id] || []).push({ fila: i + 2, endpoint: String(f[1]) });
  });
  return out;
}

function manejarPush_(id, d) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id) || !idExiste_(id)) return { ok: false, error: 'invalido' };
  const endpoint = String(d.endpoint || '');
  if (!endpointValido_(endpoint)) return { ok: false, error: 'endpoint' };
  const cache = CacheService.getScriptCache();
  const clave = 'psh:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ps|' + id)) + ':' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(clave) || 0) + 1;
  cache.put(clave, String(n), 120);
  if (n > AVISOS_POR_MINUTO) return { ok: false, error: 'ocupado' };

  const accion = String(d.accion || '');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaAvisos_();
    const mios = (dispositivosDe_(hoja)[id] || []);
    const mio = mios.filter((x) => x.endpoint === endpoint)[0];

    if (accion === 'push_estado') return { ok: true, activo: !!mio };
    if (accion === 'push_baja') { if (mio) hoja.deleteRow(mio.fila); return { ok: true, activo: false }; }
    if (accion === 'push_registrar') {
      if (!mio) {
        if (mios.length >= AVISOS_MAX_DISP) return { ok: false, error: 'limite' };      // un dispositivo nuevo no desplaza a los existentes
        if (!limiteMin_('pshmin:' + hashCorto_(id), 6)) return { ok: false, error: 'ocupado' };
        hoja.getRange(hoja.getLastRow() + 1, 1, 1, 4).setNumberFormat('@')
          .setValues([[id, endpoint, Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'), 'registrado']]);
      }
      return { ok: true, activo: true };
    }
    if (accion === 'push_mensaje') {
      if (!mio) return { ok: false, error: 'sin_registro' };
      const cola = asegurarHojaCola_(), nc = cola.getLastRow() - 1;
      if (nc >= 1) {
        const desde = Math.max(2, cola.getLastRow() - 399);
        const v = cola.getRange(desde, 1, cola.getLastRow() - desde + 1, 8).getValues();
        const lim = Date.now() - 36 * 3600 * 1000;
        for (let i = 0; i < v.length; i++) {
          if (String(v[i][0]) !== id || v[i][7]) continue;
          const t = Date.parse(String(v[i][6]).replace(' ', 'T') + '-04:00');
          if (t && t < lim) continue;
          cola.getRange(desde + i, 8).setValue(Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'));
          return { ok: true, titulo: String(v[i][3]), texto: String(v[i][4]), url: String(v[i][5]) };
        }
      }
      return { ok: true, titulo: '🦍 Kalos', texto: 'Tienes un aviso en tu tarjeta.', url: './?app=1' };
    }
    return { ok: false, error: 'accion' };
  } finally { lock.releaseLock(); }
}

/* ---- Mensajes ---- */
const DIAS_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
function primerNombre_(n) {
  const p = String(n || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : 'Hola';
}
function ddmm_(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function mensajeAviso_(tipo, a) {   // a = { nombre, fin (iso), racha, faltan, modo }
  const n = primerNombre_(a.nombre), r = Number(a.racha) || 0;
  const rt = r + (r === 1 ? ' día' : ' días');
  const REN = './?app=1&ir=renovar';
  if (tipo === 'v3') return { titulo: '⏰ Tu mes en Kalos vence en 3 días', texto: n + ', tu plan vence el ' + DIAS_ES[rcDow_(a.fin)] + ' ' + ddmm_(a.fin) + '. Renueva antes y gana ' + BONO_DIAS + ' días extra 🎁', url: REN };
  if (tipo === 'v0') return { titulo: '⚠️ Hoy vence tu mes', texto: n + ', hoy es tu último día. Si renuevas hoy, todavía ganas ' + BONO_DIAS + ' días extra 🎁', url: REN };
  if (tipo === 'p1') return { titulo: 'Tu mes venció', texto: n + ', tu plan venció ayer. Renueva para seguir entrenando' + (r > 0 ? ' y no perder tu racha de ' + rt + ' 🔥' : ' 💪'), url: REN };
  if (tipo === 'p3') return { titulo: '🦍 Te extrañamos en Kalos', texto: n + ', hace 3 días que venció tu plan. Tu barra te espera, renueva y vuelve esta semana 💪', url: REN };
  if (tipo === 'racha') {
    if (r <= 0) return { titulo: '💪 Hoy es buen día para empezar', texto: n + ', ve al gym hoy y comienza tu racha.', url: './?app=1' };
    const f = Number(a.faltan) || 0;
    const t = a.modo === '3x' && f > 0
      ? n + ', ' + (f === 1 ? 'te falta 1 día' : 'te faltan ' + f + ' días') + ' esta semana. Ve hoy y mantén tu racha de ' + rt + '.'
      : n + ', ve al gym hoy y mantén tu racha de ' + rt + '.';
    return { titulo: '🔥 ¡Hoy toca entrenar!', texto: t, url: './?app=1' };
  }
  return null;
}

/* ---- Envío ---- */
function encolarYEnviar_(id, tipo, clave, a, disp, hojas, cache) {
  const cola = hojas.cola;
  if (hojas.claves[id + '|' + clave]) return 'repetido';
  const m = mensajeAviso_(tipo, a);
  if (!m) return 'tipo';
  const seguro = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t);
  cola.getRange(cola.getLastRow() + 1, 1, 1, 8).setNumberFormat('@')
    .setValues([[id, tipo, clave, seguro(m.titulo), seguro(m.texto), m.url, Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss'), '']]);
  hojas.claves[id + '|' + clave] = true;
  let ok = 0;
  disp.forEach((x) => {
    let cod = 0;
    try { cod = enviarPush_(x.endpoint, cache); } catch (e) { cod = -1; }
    hojas.avisos.getRange(x.fila, 4).setValue(cod + ' · ' + tipo + ' · ' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'));
    if (cod === 404 || cod === 410) hojas.borrar.push(x.fila);
    if (cod === 201 || cod === 200 || cod === 202) ok++;
  });
  return ok ? 'enviado' : 'fallo';
}

function prepararEnvio_() {
  const avisos = asegurarHojaAvisos_(), cola = asegurarHojaCola_();
  const claves = {};
  const n = cola.getLastRow() - 1;
  if (n >= 1) {
    const desde = Math.max(2, cola.getLastRow() - 799);
    cola.getRange(desde, 1, cola.getLastRow() - desde + 1, 3).getValues().forEach((f) => { claves[f[0] + '|' + f[2]] = true; });
  }
  return { avisos: avisos, cola: cola, claves: claves, borrar: [], disp: dispositivosDe_(avisos) };
}
function limpiarCaducados_(h) {
  h.borrar.sort((a, b) => b - a).forEach((f) => h.avisos.deleteRow(f));
}

function alumnosConAvisos_(h) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS), col = mapaColumnas_(hoja);
  const ult = hoja.getLastRow(); if (ult < 2) return [];
  const out = [];
  hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues().forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    if (!id || !h.disp[id]) return;
    const fin = r[col['Fecha fin']];
    if (!(fin instanceof Date) || fin.getFullYear() >= 2090 || esStaff_(r[col['Notas internas']])) return;
    out.push({ id: id, nombre: String(r[col['Nombre']] || ''), plan: String(r[col['Plan']] || ''), fin: Utilities.formatDate(fin, CFG.TZ, 'yyyy-MM-dd') });
  });
  return out;
}
function difDias_(a, b) {   // días de a hasta b (iso)
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}

// 9:00 · vence en 3 días, vence hoy, venció ayer, venció hace 3 días
function enviarAvisosVencimiento(e) {
  soloDuenoOAlarma_(e);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const h = prepararEnvio_(), hoy = isoHoy_(), cache = {}, res = { enviado: 0, otros: 0 };
    alumnosConAvisos_(h).forEach((a) => {
      const d = difDias_(hoy, a.fin);
      const tipo = d === 3 ? 'v3' : d === 0 ? 'v0' : d === -1 ? 'p1' : d === -3 ? 'p3' : '';
      if (!tipo) return;
      if (tipo === 'p1') { const r = rachaDeAlumno_(a.id, a.plan); a.racha = r ? r.racha : 0; }
      const s = encolarYEnviar_(a.id, tipo, tipo + '|' + a.fin, a, h.disp[a.id], h, cache);
      if (s === 'enviado') res.enviado++; else res.otros++;
    });
    limpiarCaducados_(h);
    Logger.log('Avisos de vencimiento: ' + JSON.stringify(res));
  } finally { lock.releaseLock(); }
}

// 16:30 · recordatorio diario de racha (lunes a viernes hábiles)
function enviarAvisoRacha(e) {
  soloDuenoOAlarma_(e);
  const hoy = isoHoy_(), fer = feriados_();
  if (!rcHabil_(hoy, fer)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const h = prepararEnvio_(), cache = {}, res = { enviado: 0, omitido: 0 };
    alumnosConAvisos_(h).forEach((a) => {
      if (a.fin < hoy) { res.omitido++; return; }                         // plan vencido
      const r = rachaDeAlumno_(a.id, a.plan);
      if (!r || !r.semana || !r.semana.hoyToca) { res.omitido++; return; }  // ya vino hoy / semana completa
      a.racha = r.racha; a.faltan = r.semana.faltan; a.modo = r.modo;
      const s = encolarYEnviar_(a.id, 'racha', 'racha|' + hoy, a, h.disp[a.id], h, cache);
      if (s === 'enviado') res.enviado++; else res.omitido++;
    });
    limpiarCaducados_(h);
    Logger.log('Avisos de racha: ' + JSON.stringify(res));
  } finally { lock.releaseLock(); }
}

// Se ejecuta UNA vez desde el editor: crea las dos alarmas diarias (9:00 y 16:30, hora de Bolivia)
function instalarAlarmas() {
  soloDueno_();
  ScriptApp.getProjectTriggers().forEach((t) => {
    const f = t.getHandlerFunction();
    if (f === 'enviarAvisosVencimiento' || f === 'enviarAvisoRacha') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarAvisosVencimiento').timeBased().everyDays(1).atHour(9).nearMinute(0).inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('enviarAvisoRacha').timeBased().everyDays(1).atHour(16).nearMinute(30).inTimezone(CFG.TZ).create();
  Logger.log('Alarmas instaladas: 09:00 vencimientos · 16:30 racha');
}

// Cuántos alumnos tienen los avisos activados (para el panel)
function resumenAvisos_() {
  const d = dispositivosDe_(asegurarHojaAvisos_());
  return { alumnos: Object.keys(d).length };
}
