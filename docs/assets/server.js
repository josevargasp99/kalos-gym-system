/*
 * Minimal Google Apps Script runtime emulator (browser + Node).
 * It implements only the services this project uses, backed by in-memory sheets, so the REAL
 * server code (apps-script/*.gs) can run unchanged in the demo. Nothing here talks to Google.
 */
(function (g) {
  'use strict';

  /* ---------- synchronous SHA-256 / HMAC (Apps Script's Utilities is synchronous; WebCrypto is not) ---------- */
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, bits = l * 8, pad = (l + 9 + 63) & ~63, m = new Uint8Array(pad);
    m.set(bytes); m[l] = 0x80;
    var dv = new DataView(m.buffer); dv.setUint32(pad - 8, Math.floor(bits / 4294967296)); dv.setUint32(pad - 4, bits >>> 0);
    var w = new Uint32Array(64);
    for (var o = 0; o < pad; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (i = 16; i < 64; i++) {
        var a = w[i - 15], b = w[i - 2];
        var s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        var s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var h = H.slice();
      for (i = 0; i < 64; i++) {
        var e = h[4], S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & h[5]) ^ (~e & h[6]), t1 = (h[7] + S1 + ch + K[i] + w[i]) >>> 0;
        var A = h[0], S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
        var mj = (A & h[1]) ^ (A & h[2]) ^ (h[1] & h[2]), t2 = (S0 + mj) >>> 0;
        h = [(t1 + t2) >>> 0, h[0], h[1], h[2], (h[3] + t1) >>> 0, h[4], h[5], h[6]];
      }
      for (i = 0; i < 8; i++) H[i] = (H[i] + h[i]) >>> 0;
    }
    var out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }
  function hmac256(key, msg) {
    if (key.length > 64) key = sha256(key);
    var k = new Uint8Array(64); k.set(key);
    var ip = new Uint8Array(64 + msg.length), op = new Uint8Array(96);
    for (var i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
    ip.set(msg, 64); op.set(sha256(ip), 64);
    return sha256(op);
  }

  /* ---------- helpers ---------- */
  function utf8(s) { return new TextEncoder().encode(String(s)); }
  function toBytes(x) { return typeof x === 'string' ? utf8(x) : Uint8Array.from(Array.prototype.slice.call(x), function (v) { return v & 255; }); }
  function signed(u8) { return Array.prototype.map.call(u8, function (v) { return v > 127 ? v - 256 : v; }); }
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/')); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function colNum(L) { var n = 0; for (var i = 0; i < L.length; i++) n = n * 26 + (L.charCodeAt(i) - 64); return n; }

  var Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: function (alg, v) { return signed(sha256(toBytes(v))); },
    computeHmacSha256Signature: function (v, key) { return signed(hmac256(toBytes(key), toBytes(v))); },
    base64Encode: function (v) { return b64(toBytes(v)); },
    base64EncodeWebSafe: function (v) { return b64(toBytes(v)).replace(/\+/g, '-').replace(/\//g, '_'); },
    base64Decode: function (s) { return signed(unb64(s)); },
    base64DecodeWebSafe: function (s) { return signed(unb64(s)); },
    getUuid: function () { return (g.crypto && g.crypto.randomUUID) ? g.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); },
    newBlob: function (data, type, name) { return { getBytes: function () { return signed(toBytes(data)); }, getContentType: function () { return type || ''; }, setName: function () { return this; } }; },
    sleep: function () {},
    formatDate: function (d, tz, pattern) {
      var p = {}, fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz === 'UTC' ? 'UTC' : tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      fmt.formatToParts(new Date(d)).forEach(function (x) { p[x.type] = x.value; });
      return String(pattern).replace(/yyyy|MM|dd|HH|mm|ss/g, function (t) { return ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second })[t]; });
    }
  };

  /* ---------- in-memory spreadsheet ---------- */
  function Sheet(name, ss) { this._name = name; this._ss = ss; this._d = []; this._cols = 0; }
  Sheet.prototype.getName = function () { return this._name; };
  Sheet.prototype.getSheetId = function () { return 1; };
  Sheet.prototype.getLastRow = function () { for (var r = this._d.length; r > 0; r--) { if (this._d[r - 1] && this._d[r - 1].some(function (v) { return v !== '' && v !== null && v !== undefined; })) return r; } return 0; };
  Sheet.prototype.getLastColumn = function () { var m = 0; this._d.forEach(function (row) { if (!row) return; for (var c = row.length; c > 0; c--) { if (row[c - 1] !== '' && row[c - 1] !== null && row[c - 1] !== undefined) { if (c > m) m = c; break; } } }); return m; };
  Sheet.prototype._get = function (r, c) { var row = this._d[r - 1]; var v = row ? row[c - 1] : ''; return v === undefined || v === null ? '' : v; };
  Sheet.prototype._set = function (r, c, v) { while (this._d.length < r) this._d.push([]); var row = this._d[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v === undefined || v === null ? '' : v; };
  Sheet.prototype.getRange = function (a, b, c, d) {
    if (typeof a === 'string') {
      var m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(a);
      if (!m) throw new Error('Rango no soportado: ' + a);
      var c1 = colNum(m[1]), c2 = m[3] ? colNum(m[3]) : c1, r1 = m[2] ? +m[2] : 1;
      var r2 = m[4] ? +m[4] : (m[3] || !m[2] ? Math.max(this.getLastRow(), r1) : r1);
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  };
  Sheet.prototype.getDataRange = function () { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); };
  Sheet.prototype.appendRow = function (vals) { var r = this.getLastRow() + 1; for (var i = 0; i < vals.length; i++) this._set(r, i + 1, vals[i]); return this; };
  Sheet.prototype.deleteRow = function (r) { this._d.splice(r - 1, 1); return this; };
  ['setColumnWidth', 'setFrozenRows', 'setConditionalFormatRules', 'setTabColor', 'hideSheet', 'autoResizeColumns', 'clearFormats'].forEach(function (n) { Sheet.prototype[n] = function () { return this; }; });
  Sheet.prototype.protect = function () { var p = { }; ['setDescription', 'setWarningOnly', 'setUnprotectedRanges', 'removeEditors', 'addEditor'].forEach(function (n) { p[n] = function () { return p; }; }); return p; };

  function Range(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () { var out = []; for (var i = 0; i < this.nr; i++) { var row = []; for (var j = 0; j < this.nc; j++) row.push(this.s._get(this.r + i, this.c + j)); out.push(row); } return out; };
  Range.prototype.getValue = function () { return this.s._get(this.r, this.c); };
  Range.prototype.setValues = function (v) { for (var i = 0; i < v.length; i++) for (var j = 0; j < v[i].length; j++) this.s._set(this.r + i, this.c + j, v[i][j]); return this; };
  Range.prototype.setValue = function (v) { for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.s._set(this.r + i, this.c + j, v); return this; };
  Range.prototype.getRow = function () { return this.r; };
  Range.prototype.getColumn = function () { return this.c; };
  Range.prototype.getNumRows = function () { return this.nr; };
  Range.prototype.getNumColumns = function () { return this.nc; };
  Range.prototype.clearContent = function () { for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.s._set(this.r + i, this.c + j, ''); return this; };
  Range.prototype.createTextFinder = function (text) {
    var self = this, opt = { cs: false, whole: false };
    var f = { matchCase: function (b) { opt.cs = b; return f; }, matchEntireCell: function (b) { opt.whole = b; return f; },
      findNext: function () {
        var needle = opt.cs ? String(text) : String(text).toLowerCase();
        for (var i = 0; i < self.nr; i++) for (var j = 0; j < self.nc; j++) {
          var v = String(self.s._get(self.r + i, self.c + j)); if (!opt.cs) v = v.toLowerCase();
          if (opt.whole ? v === needle : v.indexOf(needle) > -1) return new Range(self.s, self.r + i, self.c + j, 1, 1);
        }
        return null;
      } };
    return f;
  };
  ['setNumberFormat', 'setNumberFormats', 'setFontWeight', 'setBackground', 'setFontColor', 'setWrap', 'setVerticalAlignment', 'setHorizontalAlignment', 'setFormula', 'setRichTextValue', 'setFontSize', 'setNote', 'setDataValidation', 'setFormulas'].forEach(function (n) { Range.prototype[n] = function () { return this; }; });

  var rule = { }; ['whenTextEqualTo', 'setBackground', 'setFontColor', 'setRanges'].forEach(function (n) { rule[n] = function () { return rule; }; }); rule.build = function () { return {}; };

  function Spreadsheet() { this._sheets = []; }
  Spreadsheet.prototype.getSheetByName = function (n) { return this._sheets.filter(function (s) { return s._name === n; })[0] || null; };
  Spreadsheet.prototype.insertSheet = function (n, i) { var s = new Sheet(n, this); if (typeof i === 'number') this._sheets.splice(i, 0, s); else this._sheets.push(s); return s; };
  Spreadsheet.prototype.getSheets = function () { return this._sheets.slice(); };
  Spreadsheet.prototype.getId = function () { return 'demo-spreadsheet'; };
  Spreadsheet.prototype.setSpreadsheetTimeZone = function () { return this; };
  Spreadsheet.prototype.toast = function () {};
  Spreadsheet.prototype.getActiveSheet = function () { return this._sheets[0]; };
  var SS = new Spreadsheet();
  var ui = { alert: function () {}, createMenu: function () { var m = { addItem: function () { return m; }, addSeparator: function () { return m; }, addToUi: function () {} }; return m; } };

  g.SpreadsheetApp = {
    getActive: function () { return SS; }, getActiveSpreadsheet: function () { return SS; }, getActiveSheet: function () { return SS._sheets[0]; },
    getUi: function () { return ui; }, newConditionalFormatRule: function () { return rule; }, newRichTextValue: function () { var r = { setText: function () { return r; }, setLinkUrl: function () { return r; }, build: function () { return {}; } }; return r; }
  };

  /* ---------- other services ---------- */
  var cacheStore = {};
  g.CacheService = { getScriptCache: function () { return {
    get: function (k) { var e = cacheStore[k]; if (!e) return null; if (e.t && e.t < Date.now()) { delete cacheStore[k]; return null; } return e.v; },
    put: function (k, v, s) { cacheStore[k] = { v: String(v), t: s ? Date.now() + s * 1000 : 0 }; },
    remove: function (k) { delete cacheStore[k]; } }; } };
  g.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} }; } };
  var props = {};
  g.PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); } }; } };
  g.Session = { getActiveUser: function () { return { getEmail: function () { return 'owner@demo.example'; } }; }, getEffectiveUser: function () { return { getEmail: function () { return 'owner@demo.example'; } }; } };
  g.ScriptApp = { getProjectTriggers: function () { return []; }, deleteTrigger: function () {}, newTrigger: function () { var t = {}; ['timeBased', 'everyDays', 'atHour', 'nearMinute', 'inTimezone'].forEach(function (n) { t[n] = function () { return t; }; }); t.create = function () {}; return t; } };
  var unsupported = function (what) { return function () { throw new Error('Not available in the demo: ' + what); }; };
  g.DriveApp = { getFileById: unsupported('Drive'), getFolderById: unsupported('Drive'), getRootFolder: unsupported('Drive'), searchFiles: function () { return { hasNext: function () { return false; } }; } };
  g.SlidesApp = { openById: unsupported('Slides') };
  g.UrlFetchApp = { fetch: function () { return { getResponseCode: function () { return 201; }, getContentText: function () { return ''; } }; } };
  g.MimeType = { PDF: 'application/pdf' };
  g.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { _t: String(t), setMimeType: function () { return this; }, getContent: function () { return this._t; } }; } };
  g.Utilities = Utilities;

  /* ---------- demo-only hooks ---------- */
  g.__GAS_DEMO__ = {
    ss: SS, props: props,
    reset: function () { SS._sheets.length = 0; Object.keys(cacheStore).forEach(function (k) { delete cacheStore[k]; }); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

;
/* ---- apps-script/01-config-and-menu.gs ---- */
/**
 * ============================================================
 *  KALOS CALISTENIA · Tarjetas de alumno con QR dinámico
 * ============================================================
 *  - La hoja "Alumnos" es la base de datos.
 *  - El QR de cada tarjeta apunta a esta Web App con el ID del alumno.
 *  - Al escanear, la página lee el Sheet EN VIVO: si el alumno renueva,
 *    solo se actualizan las fechas en el Sheet y el mismo QR ya sirve.
 *
 *  Menú en el Sheet:  Kalos → Generar tarjeta / Asignar IDs / Ver enlace
 * ============================================================
 */

const CFG = {
  HOJA_ALUMNOS: 'Alumnos',
  HOJA_CONFIG: 'Config',
  TZ: 'America/La_Paz',
  DIAS_AVISO: 5,                          // días antes del vencimiento → "POR VENCER"
  NOMBRE_PLANTILLA: 'Plantilla Tarjeta Kalos',
  NOMBRE_CARPETA_PDF: 'Tarjetas PDF',
  PREFIJO_ID: 'KAL-',
  ALFABETO_ID: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // sin O/0, I/1, L para evitar confusiones
  LARGO_ID: 6,
  LIMITE_POR_MINUTO: 60,                  // consultas nuevas por minuto (anti-spam)
  CACHE_SEGUNDOS: 60,                     // cuánto se recuerda cada consulta
  HOJA_SUGERENCIAS: 'Sugerencias',
  SUGERENCIAS_POR_TARJETA_DIA: 3,         // máximo por tarjeta cada 6 h (anti-spam)
  SUGERENCIAS_POR_MINUTO: 20,             // máximo global por minuto
  SUGERENCIA_MAX: 500,                    // caracteres
  HOJA_LOGROS: 'Logros',
  LOGROS_POR_RONDA: 3,
  LOGRO_MIN: 3,                           // caracteres por meta
  LOGRO_MAX: 60,
  LOGROS_ACCIONES_POR_MINUTO: 30,         // por tarjeta
  HOJA_RENOVACIONES: 'Renovaciones',
  ASISTENCIA_DESDE: '2026-10-26',          // día en que se instaló el QR de la puerta
  HOJA_ASISTENCIA: 'Asistencia',
  ASISTENCIA_POR_MINUTO: 120,             // consultas de asistencia por minuto (global)
  ASISTENCIA_FALLOS_POR_MINUTO: 30,       // celulares no encontrados por minuto (frena a quien prueba números al azar)
  COL_ULTIMA_VISITA: 'Última visita',
  HOJA_RUTINAS: 'Rutinas',
  NOMBRE_CARPETA_RUTINAS: 'Rutinas',
  RUTINAS_MAX_DIA: 3,                     // imágenes por día
  RUTINA_MAX_CHARS: 1500000,              // tamaño máximo de una imagen (base64)
  RUTINAS_POR_MINUTO_TARJETA: 40,         // consultas de rutina por alumno por minuto
  COACH_FALLOS_POR_MINUTO: 10,            // claves incorrectas por minuto (frena adivinanzas)
  COACH_ACCIONES_POR_MINUTO: 120
};

// Instructores con panel propio: nombre tal como aparece en la columna Instructor → clave en la hoja Config
const COACHES = { 'coach': { nombre: 'Coach', claveConfig: 'COACH_CLAVE' } };

const ENCABEZADOS = [
  'ID', 'Nombre', 'Teléfono', 'Plan', 'Fecha inicio', 'Fecha fin',
  'Horario', 'Instructor', 'Notas internas', 'Estado', 'Días restantes', 'Tarjeta PDF'
];

/* ------------------------------------------------------------
 *  MENÚ
 * ---------------------------------------------------------- */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏋️ Kalos')
    .addItem('Generar tarjeta PDF (filas seleccionadas)', 'generarTarjetasSeleccion')
    .addItem('Ver enlace de verificación (fila seleccionada)', 'mostrarEnlace')
    .addItem('Asignar IDs faltantes', 'asignarIdsFaltantes')
    .addSeparator()
    .addItem('Configuración inicial / revisar', 'setup')
    .addToUi();
}

;
/* ---- apps-script/02-web-app.gs ---- */
/* ------------------------------------------------------------
 *  WEB APP — esto es lo que se abre al escanear el QR
 * ---------------------------------------------------------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const id = normalizarId_(p.id || '');

  // Panel privado: solo se abre sin código y solo si quien entra es el dueño del script
  if (!p.id && !p.format && esDueno_()) {
    return HtmlService.createHtmlOutputFromFile('Panel')
      .setTitle('Kalos · Panel')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  }

  // Pantalla de la puerta: QR que cambia cada minuto (solo dueño; se deja abierta en una tablet fija)
  if (p.pantalla === 'puerta' && esDueno_()) {
    return HtmlService.createHtmlOutputFromFile('Door')
      .setTitle('Kalos · Puerta')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Modo API: lo usa la página pública de GitHub Pages
  if (p.format === 'json') {
    return ContentService
      .createTextOutput(JSON.stringify(consultar_(id)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Modo página (respaldo): se ve directo desde script.google.com
  const res = id ? consultar_(id) : { ok: false };
  const t = HtmlService.createTemplateFromFile('Verify');
  t.id = id;
  t.data = res.ok ? res.alumno : null;
  return t.evaluate()
    .setTitle('Kalos · Verificación de inscripción')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/**
 * BUZÓN DE SUGERENCIAS (anónimo)
 * La página envía {id, msg}. El id SOLO sirve para comprobar que la tarjeta es
 * válida y para limitar abusos; nunca se escribe en el Sheet.
 */
function doPost(e) {
  let data = {};
  try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { data = {}; }
  const id = normalizarId_(data.id || '');
  const accion = String(data.accion || '');
  let res;
  if (accion.indexOf('asistencia_') === 0) res = manejarAsistencia_(data);
  else if (accion.indexOf('logros_') === 0) res = manejarLogros_(id, data);
  else if (accion.indexOf('coach_') === 0) res = manejarCoach_(data);
  else if (accion.indexOf('rutina_') === 0) res = manejarRutinaAlumno_(id, data);
  else if (accion === 'fisio_contacto') res = manejarFisio_(id);
  else if (accion.indexOf('apuntes_') === 0) res = manejarApuntes_(id, data);
  else if (accion.indexOf('push_') === 0) res = manejarPush_(id, data);
  else res = guardarSugerencia_(id, data.msg);
  return ContentService
    .createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

function guardarSugerencia_(id, msg) {
  // 1) mensaje válido
  let texto = String(msg === undefined || msg === null ? '' : msg)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')   // caracteres de control
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!texto) return { ok: false, error: 'vacio' };
  if (texto.length > CFG.SUGERENCIA_MAX) return { ok: false, error: 'largo' };

  // 2) tarjeta válida (el id no se guarda)
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id) || !idExiste_(id)) return { ok: false, error: 'invalido' };

  // 3) límites: global por minuto y por tarjeta por día (contadores temporales en caché)
  const cache = CacheService.getScriptCache();
  const claveMin = 'sgm:' + Math.floor(Date.now() / 60000);
  const nMin = Number(cache.get(claveMin) || 0) + 1;
  cache.put(claveMin, String(nMin), 120);
  if (nMin > CFG.SUGERENCIAS_POR_MINUTO) return { ok: false, error: 'ocupado' };

  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'sg|' + id));
  const claveDia = 'sgd:' + huella;
  const nDia = Number(cache.get(claveDia) || 0);
  if (nDia >= CFG.SUGERENCIAS_POR_TARJETA_DIA) return { ok: false, error: 'limite' };
  cache.put(claveDia, String(nDia + 1), 21600);   // 6 h (máximo permitido por CacheService)

  // 4) escribir: solo fecha, hora y mensaje. Nunca como fórmula.
  const hoja = asegurarHojaSugerencias_();
  const ahora = new Date();
  if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
  hoja.appendRow([
    Utilities.formatDate(ahora, CFG.TZ, 'dd/MM/yyyy'),
    Utilities.formatDate(ahora, CFG.TZ, 'HH:mm'),
    texto
  ]);
  return { ok: true };
}

function idExiste_(id) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  if (!hoja) return false;
  const celda = hoja.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
  return !!celda && celda.getRow() > 1;
}

function asegurarHojaSugerencias_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_SUGERENCIAS);
  if (h) return h;
  h = ss.insertSheet(CFG.HOJA_SUGERENCIAS);
  h.getRange('A:C').setNumberFormat('@');            // todo texto: nada se interpreta como fórmula
  h.getRange(1, 1, 1, 3).setValues([['Fecha', 'Hora', 'Mensaje']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.setColumnWidth(1, 100).setColumnWidth(2, 70).setColumnWidth(3, 700);
  h.getRange('C:C').setWrap(true).setVerticalAlignment('top');
  h.getRange('A:B').setVerticalAlignment('top');
  h.protect().setDescription('Sugerencias: las escribe el sistema, no editar a mano').setWarningOnly(true);
  return h;
}

;
/* ---- apps-script/03-goals.gs ---- */
/* ------------------------------------------------------------
 *  LOGROS: 3 metas por ronda, checklist por alumno
 *  Hoja "Logros": ID | Nombre | Ronda | N° | Logro | Estado | Registrado | Logrado
 * ---------------------------------------------------------- */
function manejarLogros_(id, d) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id) || !idExiste_(id)) return { ok: false, error: 'invalido' };

  // límite de acciones por minuto por tarjeta
  const cache = CacheService.getScriptCache();
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'lg|' + id));
  const clave = 'lgm:' + huella + ':' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(clave) || 0) + 1;
  cache.put(clave, String(n), 120);
  if (n > CFG.LOGROS_ACCIONES_POR_MINUTO) return { ok: false, error: 'ocupado' };

  // un solo escritor a la vez: evita duplicar rondas con doble toque
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaLogros_();
    const filas = leerLogros_(hoja, id);
    const est = estadoLogros_(filas);

    switch (String(d.accion)) {
      case 'logros_leer':
        return { ok: true, estado: est };

      case 'logros_crear': {
        if (est.actual > 0 && !est.completa) return { ok: false, error: 'ronda_abierta' };
        const metas = Array.isArray(d.metas) ? d.metas : [];
        if (metas.length !== CFG.LOGROS_POR_RONDA) return { ok: false, error: 'metas' };
        const limpias = metas.map((m) => limpiarMeta_(m));
        if (limpias.some((m) => !m)) return { ok: false, error: 'meta_invalida' };
        const nombre = nombreDe_(id);
        const ahora = new Date();
        const nueva = est.actual + 1;
        const datos = limpias.map((m, i) => [id, nombre, nueva, i + 1, m, 'Pendiente', ahora, '']);
        const primera = hoja.getLastRow() + 1;
        hoja.getRange(primera, 5, datos.length, 1).setNumberFormat('@');   // la meta es texto (un '1/2' no se vuelve fecha)
        hoja.getRange(primera, 1, datos.length, 8).setValues(datos);
        return { ok: true, estado: estadoLogros_(leerLogros_(hoja, id)) };
      }

      case 'logros_marcar': {
        const f = buscarMeta_(filas, est, d);
        if (f.error) return { ok: false, error: f.error };
        const valor = d.valor === true;
        if (f.meta.hecho !== valor) {
          hoja.getRange(f.meta.fila, 6).setValue(valor ? '✅ Logrado' : 'Pendiente');
          hoja.getRange(f.meta.fila, 8).setValue(valor ? new Date() : '');
        }
        return { ok: true, estado: estadoLogros_(leerLogros_(hoja, id)) };
      }

      case 'logros_editar': {
        const f = buscarMeta_(filas, est, d);
        if (f.error) return { ok: false, error: f.error };
        if (f.meta.hecho) return { ok: false, error: 'logrado' };
        const texto = limpiarMeta_(d.texto);
        if (!texto) return { ok: false, error: 'meta_invalida' };
        hoja.getRange(f.meta.fila, 5).setNumberFormat('@').setValue(texto);
        return { ok: true, estado: estadoLogros_(leerLogros_(hoja, id)) };
      }

      default:
        return { ok: false, error: 'accion' };
    }
  } finally {
    lock.releaseLock();
  }
}

// Solo la ronda actual se puede marcar, desmarcar o editar
function buscarMeta_(filas, est, d) {
  const ronda = Number(d.ronda), n = Number(d.n);
  if (!est.actual || ronda !== est.actual) return { error: 'cerrada' };
  const meta = filas.filter((f) => f.ronda === ronda && f.n === n)[0];
  return meta ? { meta: meta } : { error: 'no_existe' };
}

function limpiarMeta_(m) {
  const t = String(m === undefined || m === null ? '' : m)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < CFG.LOGRO_MIN || t.length > CFG.LOGRO_MAX) return '';
  if (/^[=+\-@]/.test(t)) return '';          // nunca puede empezar como fórmula (setValues las evaluaría)
  return t;
}

function leerLogros_(hoja, id) {
  const ult = hoja.getLastRow();
  if (ult < 2) return [];
  const vals = hoja.getRange(2, 1, ult - 1, 8).getValues();
  const out = [];
  vals.forEach((r, i) => {
    if (normalizarId_(r[0]) !== id) return;
    out.push({
      fila: i + 2,
      ronda: Number(r[2]),
      n: Number(r[3]),
      texto: String(r[4]),
      hecho: String(r[5]).indexOf('Logrado') > -1,
      logrado: r[7] instanceof Date ? r[7] : null
    });
  });
  return out;
}

// Estado que ve la página: rondas, metas ordenadas (logradas arriba, la más reciente primero)
function estadoLogros_(filas) {
  const porRonda = {};
  filas.forEach((f) => { (porRonda[f.ronda] = porRonda[f.ronda] || []).push(f); });
  const nums = Object.keys(porRonda).map(Number).sort((a, b) => a - b);
  const actual = nums.length ? nums[nums.length - 1] : 0;

  const rondas = nums.map((r) => {
    const metas = porRonda[r].slice().sort((a, b) => {
      if (a.hecho !== b.hecho) return a.hecho ? -1 : 1;
      if (a.hecho) return (b.logrado ? b.logrado.getTime() : 0) - (a.logrado ? a.logrado.getTime() : 0);
      return a.n - b.n;
    }).map((f) => ({
      n: f.n,
      texto: f.texto,
      hecho: f.hecho,
      logrado: f.logrado ? Utilities.formatDate(f.logrado, CFG.TZ, 'dd/MM/yyyy') : ''
    }));
    return { ronda: r, cerrada: r < actual, metas: metas };
  });

  const ultima = rondas.length ? rondas[rondas.length - 1] : null;
  const completa = !!ultima && ultima.metas.length === CFG.LOGROS_POR_RONDA && ultima.metas.every((m) => m.hecho);
  return {
    actual: actual,
    completa: completa,
    total: filas.filter((f) => f.hecho).length,
    rondas: rondas
  };
}

function nombreDe_(id) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const celda = hoja.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
  if (!celda || celda.getRow() === 1) return '';
  const col = mapaColumnas_(hoja);
  return String(hoja.getRange(celda.getRow(), col['Nombre'] + 1).getValue() || '').trim();
}

function asegurarHojaLogros_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_LOGROS);
  if (h) return h;
  h = ss.insertSheet(CFG.HOJA_LOGROS);
  h.getRange(1, 1, 1, 8).setValues([['ID', 'Nombre', 'Ronda', 'N°', 'Logro', 'Estado', 'Registrado', 'Logrado']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('E2:E').setNumberFormat('@');                    // la meta siempre es texto
  h.getRange('G2:G').setNumberFormat('dd/mm/yyyy');
  h.getRange('H2:H').setNumberFormat('dd/mm/yyyy hh:mm');
  [110, 200, 60, 40, 380, 100, 100, 130].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Logros: los escribe el sistema, corregir solo si hace falta').setWarningOnly(true);
  return h;
}

;
/* ---- apps-script/04-attendance-and-door.gs ---- */
/* ------------------------------------------------------------
 *  ASISTENCIA: QR en la puerta + calendario anual por alumno
 *  Hoja "Asistencia": Fecha (yyyy-MM-dd) | Hora | ID | Nombre | Mes (yyyy-MM)
 *  El alumno se identifica con su celular (columna Teléfono de Alumnos).
 *  El celular NUNCA se devuelve ni se guarda en Asistencia.
 * ---------------------------------------------------------- */
function telNormal_(x) {
  let t = String(x === undefined || x === null ? '' : x).replace(/\D/g, '').replace(/^00/, '');
  if (t.length > 8 && t.indexOf('591') === 0) t = t.slice(3);
  return t;
}

function fechaTxt_(v) {
  return v instanceof Date ? Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd') : String(v || '').trim();
}

function buscarPorTelefono_(tel) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja ? hoja.getLastRow() : 0;
  if (ult < 2) return [];
  const col = mapaColumnas_(hoja);
  const vals = hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    if (telNormal_(r[col['Teléfono']]) !== tel) return;
    const est = calcularEstado_(r[col['Fecha inicio']], r[col['Fecha fin']]);
    out.push({ id: id, nombre: nombre, fila: i + 2, estado: est.estado, textoDias: est.textoDias });
  });
  return out;
}

function fallaTel_(cache, error) {
  const k = 'asf:' + Math.floor(Date.now() / 60000);
  cache.put(k, String(Number(cache.get(k) || 0) + 1), 120);
  return { ok: false, error: error };
}

/* ------------------------------------------------------------
 *  PRUEBA DE PRESENCIA
 *  Una pantalla fija en la puerta muestra un QR que cambia cada minuto (Door.html, solo dueño).
 *  Las acciones que identifican al alumno por celular exigen ese código: una foto del QR deja de servir en pocos minutos.
 *  El secreto vive en Propiedades del script (PUERTA_SECRETO) y se crea solo la primera vez.
 * ------------------------------------------------------------ */
const PUERTA_PASO_S = 60;           // el código cambia cada 60 s
const PUERTA_VENTANAS = 3;          // se aceptan el actual y los 2 anteriores (~3 min)

function secretoPuerta_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('PUERTA_SECRETO');
  if (!s) {
    s = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now()));
    p.setProperty('PUERTA_SECRETO', s);
  }
  return s;
}

function firmaCorta_(texto, largo) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secretoPuerta_())).replace(/[=]/g, '').slice(0, largo);
}

function tokenPuerta_(ventana) { return firmaCorta_('door|' + ventana, 10); }

function puertaValida_(t) {
  t = String(t || '');
  if (!/^[A-Za-z0-9_-]{10}$/.test(t)) return false;
  const v = Math.floor(Date.now() / (PUERTA_PASO_S * 1000));
  let ok = false;
  for (let i = 0; i < PUERTA_VENTANAS; i++) if (igualConstante_(t, tokenPuerta_(v - i))) ok = true;
  return ok;
}

// Recibo del día: lo entrega el servidor tras un registro válido, para ver el calendario sin repetir el QR
function sesionPuerta_(id) { return firmaCorta_('ses|' + id + '|' + isoHoy_(), 16); }
function sesionValida_(id, ses) { return /^[A-Za-z0-9_-]{16}$/.test(String(ses || '')) && igualConstante_(String(ses), sesionPuerta_(id)); }

// Lo llama la pantalla de la puerta (Door.html); solo el dueño
function puertaTokenActual() {
  verificarDueno_();
  const v = Math.floor(Date.now() / (PUERTA_PASO_S * 1000));
  const base = String(leerConfig_().PAGINA_URL || '').replace(/\/+$/, '');
  return { token: tokenPuerta_(v), url: base ? base + '/?puerta=' + tokenPuerta_(v) : '', resta: PUERTA_PASO_S - (Math.floor(Date.now() / 1000) % PUERTA_PASO_S) };
}

function hashCorto_(t) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t))).slice(0, 16);
}

function manejarAsistencia_(d) {
  const accion = String(d.accion || '');
  if (accion !== 'asistencia_ver' && accion !== 'asistencia_registrar' && accion !== 'asistencia_tarjeta') return { ok: false, error: 'accion' };

  const cache = CacheService.getScriptCache();
  const min = Math.floor(Date.now() / 60000);
  const n = Number(cache.get('asm:' + min) || 0) + 1;
  cache.put('asm:' + min, String(n), 120);
  if (n > CFG.ASISTENCIA_POR_MINUTO) return { ok: false, error: 'ocupado' };

  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  const idTarjeta = normalizarId_(d.id || '');
  let alumno = null;

  if (idTarjeta) {
    // Calendario desde la tarjeta: se identifica con el código de la tarjeta (solo lectura)
    if (accion !== 'asistencia_ver') return { ok: false, error: 'invalido' };   // (tarjeta/registrar no aceptan código)
    if (!formato.test(idTarjeta) || !idExiste_(idTarjeta)) return { ok: false, error: 'invalido' };
    alumno = { id: idTarjeta, nombre: '' };
  } else {
    // Puerta: se identifica con el celular + prueba de presencia (QR rotativo). El calendario también acepta el recibo del día.
    const presente = puertaValida_(d.pt);
    if (!presente && !(accion === 'asistencia_ver' && d.ses)) return { ok: false, error: 'presencia' };
    if (Number(cache.get('asf:' + min) || 0) >= CFG.ASISTENCIA_FALLOS_POR_MINUTO) return { ok: false, error: 'ocupado' };
    const tel = telNormal_(d.tel);
    if (tel.length !== 8) return fallaTel_(cache, 'telefono');
    if (!limiteMin_('tel:' + hashCorto_(tel), 8)) return { ok: false, error: 'ocupado' };   // límite por persona
    const m = buscarPorTelefono_(tel);
    if (!m.length) return fallaTel_(cache, 'no_encontrado');
    if (m.length === 1) alumno = m[0];
    else {
      const sel = d.sel === undefined || d.sel === null || d.sel === '' ? -1 : Number(d.sel);
      if (!(sel >= 0 && sel < m.length && sel % 1 === 0)) {
        return { ok: true, eleccion: m.map((x) => x.nombre) };      // celular compartido: que elija su nombre
      }
      alumno = m[sel];
    }
  }

  if (!idTarjeta && accion === 'asistencia_ver' && !puertaValida_(d.pt) && !sesionValida_(alumno.id, d.ses)) return { ok: false, error: 'presencia' };

  if (accion === 'asistencia_tarjeta') {
    // App: con el celular devuelve solo el código de la tarjeta y el nombre (nunca el celular)
    return { ok: true, id: alumno.id, nombre: alumno.nombre };
  }

  if (accion === 'asistencia_ver') {
    const res = resumenAsistencia_(alumno.id);
    res.ok = true;
    res.nombre = alumno.nombre;
    return res;
  }

  // Registrar: un solo escritor a la vez, una asistencia por día
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaAsistencia_();
    const ahora = new Date();
    const fecha = Utilities.formatDate(ahora, CFG.TZ, 'yyyy-MM-dd');
    const hora = Utilities.formatDate(ahora, CFG.TZ, 'HH:mm');

    let ya = false;
    const ult = hoja.getLastRow();
    if (ult >= 2) {
      const desde = Math.max(2, ult - 799);
      ya = hoja.getRange(desde, 1, ult - desde + 1, 3).getValues()
        .some((r) => fechaTxt_(r[0]) === fecha && normalizarId_(r[2]) === alumno.id);
    }
    if (!ya) {
      let nombre = alumno.nombre;
      if (/^[=+\-@]/.test(nombre)) nombre = "'" + nombre;
      const fila = ult + 1;
      hoja.getRange(fila, 1, 1, 5).setNumberFormat('@')
        .setValues([[fecha, hora, alumno.id, nombre, fecha.slice(0, 7)]]);
      marcarUltimaVisita_(alumno.fila, Utilities.formatDate(ahora, CFG.TZ, 'dd/MM/yyyy'));
      try { cache.remove('al:' + alumno.id); } catch (e) {}                    // la racha de la tarjeta se actualiza al instante
    }
    const res = resumenAsistencia_(alumno.id);
    res.ok = true;
    res.ya = ya;
    res.nombre = alumno.nombre;
    res.fecha = Utilities.formatDate(ahora, CFG.TZ, 'dd/MM/yyyy');
    res.hora = hora;
    res.estado = alumno.estado;
    res.textoDias = alumno.textoDias;
    res.id = alumno.id;                          // quien está en la puerta puede vincular su tarjeta
    res.ses = sesionPuerta_(alumno.id);
    return res;
  } finally {
    lock.releaseLock();
  }
}

function marcarUltimaVisita_(fila, texto) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map((x) => String(x).trim());
  const c = enc.indexOf(CFG.COL_ULTIMA_VISITA);
  if (c < 0 || !fila) return;
  hoja.getRange(fila, c + 1).setNumberFormat('@').setValue(texto);
}

// Calendario del año en curso (1 ene – 31 dic) + contadores + racha de semanas seguidas
function resumenAsistencia_(id) {
  const hoja = asegurarHojaAsistencia_();
  const ult = hoja.getLastRow();
  const hoy = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  const anio = hoy.slice(0, 4), mes = hoy.slice(0, 7);

  const set = {};
  if (ult >= 2) {
    hoja.getRange(2, 1, ult - 1, 3).getValues().forEach((r) => {
      if (normalizarId_(r[2]) === id) set[fechaTxt_(r[0])] = true;
    });
  }
  const todos = Object.keys(set).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  const delAnio = todos.filter((f) => f.slice(0, 4) === anio);

  const semana = (f) => Math.floor((Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) / 86400000 + 3) / 7);
  const semanas = {};
  todos.forEach((f) => { semanas[semana(f)] = true; });
  let w = semana(hoy);
  if (!semanas[w]) w--;                      // si aún no vino esta semana, cuenta desde la anterior
  let racha = 0;
  while (semanas[w]) { racha++; w--; }

  return {
    anio: Number(anio),
    hoy: hoy,
    dias: delAnio,
    mes: delAnio.filter((f) => f.slice(0, 7) === mes).length,
    total: delAnio.length,
    racha: racha
  };
}

function asegurarHojaAsistencia_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_ASISTENCIA);
  if (h) return h;
  h = ss.insertSheet(CFG.HOJA_ASISTENCIA);
  h.getRange('A2:E').setNumberFormat('@');                    // todo texto: nada se vuelve fecha ni fórmula
  h.getRange(1, 1, 1, 5).setValues([['Fecha', 'Hora', 'ID', 'Nombre', 'Mes']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  [100, 70, 110, 220, 80].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Asistencia: la escribe el sistema, corregir solo si hace falta').setWarningOnly(true);
  return h;
}

// Alumnos: "Última visita" (la escribe el sistema) y "Visitas este mes" (fórmula)
function asegurarColumnasAsistencia_() {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map((x) => String(x).trim());
  let c = enc.length;
  const estilo = (celda) => celda.setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  if (enc.indexOf(CFG.COL_ULTIMA_VISITA) < 0) { c++; estilo(hoja.getRange(1, c)).setValue(CFG.COL_ULTIMA_VISITA); hoja.setColumnWidth(c, 110); }
  if (enc.indexOf('Visitas este mes') < 0) {
    c++;
    estilo(hoja.getRange(1, c)).setValue('Visitas este mes');
    hoja.getRange(2, c).setFormula(
      '=ARRAYFORMULA(IF(A2:A="","",COUNTIFS(Asistencia!C:C,A2:A,Asistencia!E:E,TEXT(TODAY(),"yyyy-MM"))))'
    );
    hoja.setColumnWidth(c, 120);
  }
}

;
/* ---- apps-script/05-owner-panel.gs ---- */
/* ------------------------------------------------------------
 *  PANEL PRIVADO (solo el dueño del script)
 *  Doble candado: la implementación "Solo yo" de Google + esta verificación en cada acción.
 *  Hoja "Renovaciones": ID | Nombre | Teléfono | Fecha | Fecha de inicio | Fecha fin | Plan | Monto pagado (Bs)
 * ---------------------------------------------------------- */
function verificarDueno_() {
  const activo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const dueno = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!activo || !dueno || activo !== dueno) throw new Error('No autorizado');
}

// Toda función pública (sin "_") se puede invocar desde el navegador con google.script.run.
// Las de administración exigen que quien llama sea el dueño del script.
function soloDueno_() { verificarDueno_(); }

// Los envíos masivos solo corren desde un disparador horario real (trae e.triggerUid) o si los lanza el dueño a mano.
function soloDuenoOAlarma_(e) {
  if (e && e.triggerUid) return;
  verificarDueno_();
}

function esDueno_() {
  try { verificarDueno_(); return true; } catch (e) { return false; }
}

function normTexto_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function isoHoy_() {
  return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
}

// Mediodía de Bolivia en ese día: la fecha se guarda correcta en cualquier zona horaria
function fechaDia_(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 16, 0, 0));
}

// 1 mes menos 1 día: 10/09 → 09/10 · 20/12 → 19/01 · si el mes siguiente no tiene ese día (31/01) → último día del mes (28/02)
function finDePlan_(y, m, d, meses) {
  const n = meses || 1;
  let ny = y + Math.floor((m - 1 + n) / 12), nm = ((m - 1 + n) % 12) + 1;
  const ultimo = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  if (d > ultimo) return { y: ny, m: nm, d: ultimo };
  const t = new Date(Date.UTC(ny, nm - 1, d - 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function panelBuscar(q) {
  verificarDueno_();
  const texto = normTexto_(q);
  const dig = String(q || '').replace(/\D/g, '');
  if (texto.length < 2 && dig.length < 3) return [];

  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  if (ult < 2) return [];
  const col = mapaColumnas_(hoja);
  const vals = hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues();
  const hoy = isoHoy_();
  const out = [];
  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    const tel = telNormal_(r[col['Teléfono']]);
    const coincide = (texto.length >= 2 && normTexto_(nombre).indexOf(texto) > -1) ||
                     (dig.length >= 3 && tel.indexOf(dig) > -1);
    if (!coincide || out.length >= 8) return;
    const fin = r[col['Fecha fin']];
    const est = calcularEstado_(r[col['Fecha inicio']], fin);
    let sugerido = hoy;                                             // vencido o sin fecha → hoy
    if (fin instanceof Date) {
      const f = Utilities.formatDate(fin, CFG.TZ, 'yyyy-MM-dd');
      if (f >= hoy) {                                               // a tiempo → día siguiente al vencimiento
        const t = new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10) + 1));
        sugerido = Utilities.formatDate(t, 'UTC', 'yyyy-MM-dd');
      }
    }
    out.push({
      id: id, nombre: nombre, tel: tel, plan: String(r[col['Plan']] || '').trim(),
      estado: est.estado, textoDias: est.textoDias, fin: fmtFecha_(fin), sugerido: sugerido, bono: sugerido !== hoy,
      precio: precios_().antiguo[String(r[col['Plan']] || '').trim()] || ''
    });
  });
  return out;
}

/**
 * CONTROL DE INSCRIPCIONES
 * 1) Renuevan esta semana (lunes a domingo, hora de Bolivia)
 * 2) No renovaron: venció en los últimos 10 días (y no está en la lista 1)
 * 3) Activos que no vienen: 5 o más días hábiles (lun–vie) sin escanear la puerta
 */
function panelControl() {
  verificarDueno_();
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MIN_HABILES = 5, VENTANA_DIAS = 10;
  const num = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;   // día entero
  const dow = (n) => new Date(n * 86400000).getUTCDay();
  const fmt = (n) => Utilities.formatDate(new Date(n * 86400000), 'UTC', 'dd/MM');
  const etiqueta = (n) => DIAS[dow(n)] + ' ' + fmt(n);

  const hoyIso = isoHoy_();
  const hoy = num(hoyIso);
  const lunes = hoy - ((dow(hoy) + 6) % 7);
  const domingo = lunes + 6;
  const desdeQr = num(CFG.ASISTENCIA_DESDE);

  // Última visita de cada alumno según el QR de la puerta
  const ultima = {};
  const hAs = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ASISTENCIA);
  if (hAs && hAs.getLastRow() >= 2) {
    hAs.getRange(2, 1, hAs.getLastRow() - 1, 3).getValues().forEach((r) => {
      const f = fechaTxt_(r[0]), id = normalizarId_(r[2]);
      if (id && /^\d{4}-\d{2}-\d{2}$/.test(f) && (!ultima[id] || f > ultima[id])) ultima[id] = f;
    });
  }

  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  const col = mapaColumnas_(hoja);
  const vals = ult >= 2 ? hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues() : [];
  const l1 = [], l2 = [], l3 = [];

  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    const fin = r[col['Fecha fin']], ini = r[col['Fecha inicio']];
    if (!id || !nombre || !(fin instanceof Date) || esPrueba_(r[col['Notas internas']])) return;
    const finN = num(Utilities.formatDate(fin, CFG.TZ, 'yyyy-MM-dd'));
    const base = { id: id, nombre: nombre, plan: String(r[col['Plan']] || '').trim(), tel: telNormal_(r[col['Teléfono']]) };

    if (finN >= lunes && finN <= domingo) {
      const venc = finN < hoy;
      l1.push(Object.assign({ orden: finN, rojo: venc,
        detalle: venc ? 'Venció ' + etiqueta(finN) : (finN === hoy ? 'Vence hoy' : 'Vence ' + etiqueta(finN)) }, base));
    } else if (finN < lunes && hoy - finN <= VENTANA_DIAS) {
      const hace = hoy - finN;
      const uv = ultima[id] ? ' · última visita ' + fmt(num(ultima[id])) : '';
      l2.push(Object.assign({ orden: -finN, rojo: true,
        detalle: 'Venció hace ' + hace + (hace === 1 ? ' día' : ' días') + ' (' + fmt(finN) + ')' + uv }, base));
    }

    // Activo: plan vigente hoy
    const iniN = ini instanceof Date ? num(Utilities.formatDate(ini, CFG.TZ, 'yyyy-MM-dd')) : null;
    if (finN >= hoy && (iniN === null || iniN <= hoy)) {
      const baseN = ultima[id] ? num(ultima[id]) : Math.max(iniN === null ? desdeQr : iniN, desdeQr);
      let habiles = 0;
      for (let d = baseN + 1; d < hoy; d++) { const w = dow(d); if (w !== 0 && w !== 6) habiles++; }
      if (habiles >= MIN_HABILES) {
        l3.push(Object.assign({ orden: -habiles, rojo: false,
          detalle: habiles + ' días hábiles sin venir · ' + (ultima[id] ? 'última visita ' + etiqueta(num(ultima[id])) : 'sin visitas registradas') }, base));
      }
    }
  });

  const ordenar = (l) => l.sort((a, b) => a.orden - b.orden).map((x) => { delete x.orden; return x; });
  return { hoy: fmt(hoy), semana: fmt(lunes) + ' – ' + fmt(domingo), l1: ordenar(l1), l2: ordenar(l2), l3: ordenar(l3) };
}

// Alumnos de prueba / instructores: su nota interna EMPIEZA con "PRUEBA" y no cuentan en ninguna cifra
function esStaff_(notas) {
  return /^\s*staff\b/i.test(String(notas || ''));       // equipo de Kalos: tiene tarjeta pero no cuenta en ninguna cifra
}
function esPrueba_(notas) {
  if (esStaff_(notas)) return true;                        // STAFF se excluye de las cifras igual que PRUEBA
  return /^\s*prueba\b/i.test(String(notas || ''));      // solo si la nota EMPIEZA con PRUEBA ("clase de prueba" no cuenta)
}

// Precios de la pestaña Config (con valores por defecto si faltan)
function precios_() {
  const c = leerConfig_();
  const n = (k, d) => { const v = Number(String(c[k] || '').replace(',', '.')); return v > 0 ? v : d; };
  return {
    nuevo: { 'Mensual': n('PRECIO_NUEVO_MENSUAL', 100), '3 veces por semana': n('PRECIO_NUEVO_3X', 80) },
    antiguo: { 'Mensual': n('PRECIO_ANTIGUO_MENSUAL', 90), '3 veces por semana': n('PRECIO_ANTIGUO_3X', 70) }
  };
}

/**
 * NÚMEROS DEL MES
 * mesIso: 'yyyy-MM' (vacío = mes actual). Gracia de renovación: 10 días (igual que Control).
 */
function panelNumeros(mesIso) {
  verificarDueno_();
  const GRACIA = 10;
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const num = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  const isoDe = (d) => Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd');
  const nDate = (d) => (d instanceof Date ? num(isoDe(d)) : null);
  const fmt = (n) => Utilities.formatDate(new Date(n * 86400000), 'UTC', 'dd/MM');
  const hoyIso = isoHoy_(), hoy = num(hoyIso), mesActual = hoyIso.slice(0, 7);
  let mes = /^\d{4}-\d{2}$/.test(String(mesIso || '')) ? String(mesIso) : mesActual;
  if (mes > mesActual) mes = mesActual;
  const rango = (m) => {
    const y = +m.slice(0, 4), mo = +m.slice(5, 7);
    return { ini: Date.UTC(y, mo - 1, 1) / 86400000, fin: Date.UTC(y, mo, 0) / 86400000, nombre: MESES[mo - 1] + ' ' + y };
  };
  const mover = (m, k) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; const t = new Date(Date.UTC(y, mo, 1)); return Utilities.formatDate(t, 'UTC', 'yyyy-MM'); };
  const R = rango(mes), anterior = mover(mes, -1), RA = rango(anterior);
  const ref = (rg) => Math.min(rg.fin, hoy);                     // día de referencia: hoy o cierre del mes

  // ---- Alumnos (sin PRUEBA)
  const ss = SpreadsheetApp.getActive();
  const hA = ss.getSheetByName(CFG.HOJA_ALUMNOS);
  const col = mapaColumnas_(hA);
  const ultA = hA.getLastRow();
  const alumnos = {}, prueba = {};
  (ultA >= 2 ? hA.getRange(2, 1, ultA - 1, hA.getLastColumn()).getValues() : []).forEach((r) => {
    const id = normalizarId_(r[col['ID']]), nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    if (esPrueba_(r[col['Notas internas']])) { prueba[id] = true; return; }
    alumnos[id] = {
      id: id, nombre: nombre, tel: telNormal_(r[col['Teléfono']]), plan: String(r[col['Plan']] || '').trim(),
      horario: String(r[col['Horario']] || '').trim() || 'Sin horario', instructor: String(r[col['Instructor']] || '').trim() || 'Sin instructor',
      ini: nDate(r[col['Fecha inicio']]), fin: nDate(r[col['Fecha fin']])
    };
  });

  // ---- Pagos y periodos (Renovaciones + periodo actual de Alumnos)
  const pagos = [];
  const periodos = {};                                            // id -> [{ini, fin}]
  const agregarPeriodo = (id, ini, fin) => {
    if (ini === null || fin === null) return;
    const l = periodos[id] = periodos[id] || [];
    if (!l.some((p) => p.ini === ini && p.fin === fin)) l.push({ ini: ini, fin: fin });
  };
  const hR = ss.getSheetByName(CFG.HOJA_RENOVACIONES);
  if (hR && hR.getLastRow() >= 2) {
    hR.getRange(2, 1, hR.getLastRow() - 1, 9).getValues().forEach((p) => {
      const id = normalizarId_(p[0]);
      if (!id || prueba[id]) return;
      const f = nDate(p[3]);
      if (f === null) return;
      pagos.push({ id: id, fecha: f, plan: String(p[6] || '').trim() || 'Sin plan', monto: Number(p[7]) || 0, tipo: String(p[8] || '').trim() === 'Inscripción' ? 'alta' : 'renov' });
      agregarPeriodo(id, nDate(p[4]), nDate(p[5]));
    });
  }
  Object.keys(alumnos).forEach((id) => agregarPeriodo(id, alumnos[id].ini, alumnos[id].fin));

  const enMes = (n, rg) => n >= rg.ini && n <= rg.fin;
  const resumenPagos = (rg) => {
    const out = { ingresos: 0, altas: 0, renov: 0, porPlan: {} };
    pagos.forEach((p) => {
      if (!enMes(p.fecha, rg)) return;
      out.ingresos += p.monto;
      if (p.tipo === 'alta') out.altas++; else out.renov++;
      out.porPlan[p.plan] = (out.porPlan[p.plan] || 0) + p.monto;
    });
    out.ingresos = Math.round(out.ingresos * 100) / 100;
    return out;
  };
  const activosEn = (dia) => {
    const ids = Object.keys(periodos).concat(Object.keys(alumnos).filter((id) => !periodos[id]));
    return ids.filter((id) => (periodos[id] || []).some((p) => p.ini <= dia && dia <= p.fin) ||
      (dia === hoy && alumnos[id] && alumnos[id].fin !== null && alumnos[id].fin >= hoy));
  };

  const act = resumenPagos(R), ant = resumenPagos(RA);
  const coachMes = repartoMesIan_(mes);
  const activosHoy = activosEn(ref(R)), activosAnt = activosEn(ref(RA));

  // ---- Tasa de renovación: periodos que terminaron en el mes
  let vencieron = 0, renovaron = 0, enPlazo = 0;
  const noVolvieron = [];
  Object.keys(periodos).forEach((id) => {
    const l = periodos[id];
    l.forEach((p) => {
      if (!enMes(p.fin, R) || p.fin >= hoy) return;               // aún no vence
      const siguio = l.some((q) => q !== p && q.ini > p.ini && q.ini <= p.fin + 1 + GRACIA);
      if (siguio) { vencieron++; renovaron++; return; }
      if (hoy <= p.fin + GRACIA) { enPlazo++; return; }           // todavía puede renovar
      vencieron++;
      const a = alumnos[id];
      const despues = l.filter((q) => q.ini > p.fin + 1 + GRACIA).sort((x, y) => x.ini - y.ini)[0];
      noVolvieron.push({ id: id, nombre: a ? a.nombre : id, tel: a ? a.tel : '', fin: fmt(p.fin), volvio: despues ? fmt(despues.ini) : '' });
    });
  });

  // ---- Asistencia (QR de la puerta)
  const visitas = {}, porDia = [0, 0, 0, 0, 0, 0, 0], porHora = {};
  const hAs = ss.getSheetByName(CFG.HOJA_ASISTENCIA);
  if (hAs && hAs.getLastRow() >= 2) {
    hAs.getRange(2, 1, hAs.getLastRow() - 1, 3).getValues().forEach((r) => {
      const f = fechaTxt_(r[0]), id = normalizarId_(r[2]);
      if (!id || prueba[id] || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
      const n = num(f);
      if (!enMes(n, R)) return;
      const k = id + '|' + f;
      if (visitas[k]) return;
      visitas[k] = true;
      porDia[(new Date(n * 86400000).getUTCDay() + 6) % 7]++;   // 0 = lunes
      const hTxt = r[1] instanceof Date ? Utilities.formatDate(r[1], CFG.TZ, 'HH') : String(r[1] || '').slice(0, 2);
      if (/^\d{2}$/.test(hTxt)) porHora[hTxt] = (porHora[hTxt] || 0) + 1;
    });
  }
  const totalVisitas = Object.keys(visitas).length;

  // ---- Ocupación (alumnos activos por horario e instructor)
  const porHorario = {}, porInstructor = {};
  activosHoy.forEach((id) => {
    const a = alumnos[id];
    if (!a) return;
    porHorario[a.horario] = (porHorario[a.horario] || 0) + 1;
    porInstructor[a.instructor] = (porInstructor[a.instructor] || 0) + 1;
  });

  // ---- Tendencia: últimos 6 meses
  const tendencia = [];
  for (let k = 5; k >= 0; k--) {
    const m = mover(mes, -k), rg = rango(m);
    tendencia.push({ mes: MESES[+m.slice(5, 7) - 1].slice(0, 3), ingresos: resumenPagos(rg).ingresos });
  }

  const lista = (o) => Object.keys(o).map((k) => ({ k: k, v: o[k] })).sort((a, b) => b.v - a.v);
  let primerMes = mesActual;
  pagos.forEach((p) => { const m = Utilities.formatDate(new Date(p.fecha * 86400000), 'UTC', 'yyyy-MM'); if (m < primerMes) primerMes = m; });

  return {
    mes: mes, nombre: R.nombre, anterior: RA.nombre, esActual: mes === mesActual,
    hayAnterior: mes > primerMes, haySiguiente: mes < mesActual,
    previo: anterior, siguiente: mover(mes, 1),
    ingresos: act.ingresos, ingresosAnt: ant.ingresos,
    altas: act.altas, altasAnt: ant.altas,
    renov: act.renov, renovAnt: ant.renov,
    activos: activosHoy.length, activosAnt: activosAnt.length,
    tasa: { vencieron: vencieron, renovaron: renovaron, enPlazo: enPlazo, noVolvieron: noVolvieron },
    porPlan: lista(act.porPlan), tendencia: tendencia,
    asistencia: { visitas: totalVisitas, promedio: activosHoy.length ? Math.round(totalVisitas / activosHoy.length * 10) / 10 : 0, porDia: porDia,
      porHora: Object.keys(porHora).sort().map((h) => ({ k: h + ':00', v: porHora[h] })) },
    porHorario: lista(porHorario), porInstructor: lista(porInstructor),
    coach: coachMes,
    kalos: {
      ingresos: act.ingresos,
      otros: r2_(act.ingresos - coachMes.cobrado),
      deCoach: coachMes.kalos,
      partner: coachMes.partner,
      coach: coachMes.coach,
      total: r2_(act.ingresos - coachMes.partner - coachMes.coach),
      pct: coachMes.pct
    },
    fisio: fisioMes_(mes),
    avisos: resumenAvisos_()
  };
}

/**
 * ALUMNOS: lista liviana de todos los inscritos (la ficha completa se pide aparte)
 */
function panelAlumnos() {
  verificarDueno_();
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  const col = mapaColumnas_(hoja);
  const vals = ult >= 2 ? hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues() : [];
  const lista = [];
  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    const fin = r[col['Fecha fin']];
    const est = calcularEstado_(r[col['Fecha inicio']], fin);
    const grupo = esStaff_(r[col['Notas internas']]) ? 'staff'
      : esPrueba_(r[col['Notas internas']]) ? 'prueba'
      : est.estado === 'ACTIVO' ? 'activo'
      : (est.estado === 'POR VENCER' || est.estado === 'VENCE HOY') ? 'porvencer'
      : est.estado === 'VENCIDO' ? 'vencido' : 'otro';
    lista.push({
      id: id, nombre: nombre, tel: telNormal_(r[col['Teléfono']]),
      plan: String(r[col['Plan']] || '').trim(),
      estado: est.estado, textoDias: est.textoDias, grupo: grupo, fin: fmtFecha_(fin), prueba: grupo === 'prueba' || grupo === 'staff'
    });
  });
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return { alumnos: lista };
}

/**
 * Ficha completa de un alumno: datos, asistencia, pagos, logros y notas
 */
function panelFicha(idEntrada) {
  verificarDueno_();
  const id = normalizarId_(idEntrada);
  if (!/^KAL-[A-Z0-9]{6}$/.test(id)) return { ok: false, error: 'alumno' };
  const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
  if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
  const col = mapaColumnas_(alumnos);
  const r = alumnos.getRange(celda.getRow(), 1, 1, alumnos.getLastColumn()).getValues()[0];
  const txt = (n) => String(r[col[n]] || '').trim();
  const fin = r[col['Fecha fin']], ini = r[col['Fecha inicio']];
  const est = calcularEstado_(ini, fin);
  const hoy = isoHoy_();

  let sugerido = hoy;
  if (fin instanceof Date) {
    const f = Utilities.formatDate(fin, CFG.TZ, 'yyyy-MM-dd');
    if (f >= hoy) sugerido = Utilities.formatDate(new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10) + 1)), 'UTC', 'yyyy-MM-dd');
  }

  // Asistencia
  const as = resumenAsistencia_(id);
  const ultimaVisita = as.dias.length ? as.dias[as.dias.length - 1] : '';

  // Pagos (hoja Renovaciones)
  const pagos = [];
  let totalPagado = 0;
  const hRen = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_RENOVACIONES);
  if (hRen && hRen.getLastRow() >= 2) {
    hRen.getRange(2, 1, hRen.getLastRow() - 1, 9).getValues().forEach((p) => {
      if (normalizarId_(p[0]) !== id) return;
      const monto = Number(p[7]) || 0;
      totalPagado += monto;
      pagos.push({ fecha: fmtFecha_(p[3]), inicio: fmtFecha_(p[4]), fin: fmtFecha_(p[5]), plan: String(p[6] || '').trim(), monto: monto, tipo: String(p[8] || '').trim() });
    });
    pagos.reverse();
  }

  // Logros
  let logros = { actual: 0, total: 0, metas: [] };
  const hLog = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_LOGROS);
  if (hLog) {
    const e = estadoLogros_(leerLogros_(hLog, id));
    const ultima = e.rondas.length ? e.rondas[e.rondas.length - 1] : null;
    logros = { actual: e.actual, total: e.total, metas: ultima ? ultima.metas.map((m) => ({ texto: m.texto, hecho: m.hecho })) : [] };
  }

  // Rutinas cargadas por el instructor (solo alumnos de instructores con panel)
  let rutina = { aplica: false, dias: [0, 0, 0, 0, 0], fechas: ['', '', '', '', ''] };
  if (COACHES[instructorDe_(txt('Instructor'))]) {
    const hRut = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_RUTINAS);
    const rd = hRut ? diasDe_(leerRutinas_(hRut), id) : { dias: [[], [], [], [], []], fechas: ['', '', '', '', ''] };
    rutina = { aplica: true, dias: rd.dias.map((x) => x.length), fechas: rd.fechas };
  }

  // Enlace a la tarjeta (la misma que ve el alumno)
  let tarjeta = '';
  try {
    const u = urlVerificacion_(leerConfig_(), id);
    if (/^https:\/\//.test(u)) tarjeta = u;
  } catch (e) { tarjeta = ''; }

  return {
    ok: true,
    id: id,
    nombre: txt('Nombre'),
    tel: telNormal_(r[col['Teléfono']]),
    plan: txt('Plan'),
    horario: txt('Horario'),
    instructor: txt('Instructor'),
    inicio: fmtFecha_(ini),
    fin: fmtFecha_(fin),
    estado: est.estado,
    textoDias: est.textoDias,
    progreso: est.progreso,
    sugerido: sugerido, bono: sugerido !== hoy,
    precio: precios_().antiguo[txt('Plan')] || '',
    notas: txt('Notas internas'),
    asistencia: { anio: as.anio, hoy: as.hoy, dias: as.dias, mes: as.mes, total: as.total, racha: as.racha, ultima: ultimaVisita },
    pagos: pagos,
    totalPagado: totalPagado,
    logros: logros,
    rutina: rutina,
    racha: rachaDeAlumno_(id, txt('Plan')),
    tarjeta: tarjeta
  };
}

// Guarda las notas internas del alumno (siempre como texto, nunca como fórmula)
function panelNotas(idEntrada, texto) {
  verificarDueno_();
  const id = normalizarId_(idEntrada);
  const limpio = String(texto == null ? '' : texto).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (limpio.length > 1000) return { ok: false, error: 'largo' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const col = mapaColumnas_(alumnos);
    alumnos.getRange(celda.getRow(), col['Notas internas'] + 1).setNumberFormat('@').setValue(limpio);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * NUEVO ALUMNO: opciones para el formulario (horarios e instructores que ya usas)
 */
function panelNuevoOpciones() {
  verificarDueno_();
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  const col = mapaColumnas_(hoja);
  const vals = ult >= 2 ? hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues() : [];
  const uniq = (nombre) => {
    const vistos = {}, out = [];
    vals.forEach((r) => {
      const t = String(r[col[nombre]] || '').trim();
      const k = normTexto_(t);
      if (t && !vistos[k]) { vistos[k] = true; out.push(t); }
    });
    return out.sort((a, b) => a.localeCompare(b, 'es'));
  };
  return { hoy: isoHoy_(), horarios: uniq('Horario'), instructores: uniq('Instructor'), precios: precios_().nuevo };
}

// Nombres "parecidos": iguales, o todas las palabras del más corto están en el más largo (mín. 2 palabras)
function nombresParecidos_(a, b) {
  const ta = normTexto_(a).split(/\s+/).filter(String), tb = normTexto_(b).split(/\s+/).filter(String);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return corto.length >= 2 && corto.every((w) => largo.indexOf(w) > -1);
}

function limpiarTexto_(t, max) {
  return String(t == null ? '' : t).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim().slice(0, max);
}

/**
 * Inscribe a un alumno nuevo: fila en Alumnos + primer pago en Renovaciones (Tipo = Inscripción) + tarjeta PDF
 */
function panelNuevo(d) {
  verificarDueno_();
  d = d || {};
  const nombre = limpiarTexto_(d.nombre, 80);
  const esStaffNuevo = esStaff_(limpiarTexto_(d.notas, 1000));                 // equipo de Kalos: nombre corto, 0 Bs, sin vencimiento
  const esPruebaNuevo = d.prueba === true && !esStaffNuevo;                    // usuario de prueba: sin pago, dura N días
  let motivo = '', diasPrueba = 0;
  if (esPruebaNuevo) {
    motivo = limpiarTexto_(d.motivo, 40);
    if (motivo.length < 2) return { ok: false, error: 'motivo' };
    diasPrueba = Math.floor(Number(d.dias));
    if (!(diasPrueba >= 1 && diasPrueba <= 365)) return { ok: false, error: 'dias' };
  }
  if (nombre.length < 3 || (!esStaffNuevo && !esPruebaNuevo && nombre.split(' ').length < 2)) return { ok: false, error: 'nombre' };
  const tel = telNormal_(d.tel);
  if (!/^\d{8}$/.test(tel)) return { ok: false, error: 'tel' };

  const PLANES = { 'Mensual': 1, '3 veces por semana': 1 };
  let plan, meses = 1, finManual = null;
  if (d.plan === 'Otro') {
    plan = limpiarTexto_(d.planOtro, 40);
    if (plan.length < 2) return { ok: false, error: 'plan' };
    const mf = esPruebaNuevo ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.inicio || '')) : /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.fin || ''));      // plan especial: la fecha fin la pones tú
    if (!mf) return { ok: false, error: 'finfecha' };
    const cf = new Date(Date.UTC(+mf[1], +mf[2] - 1, +mf[3]));
    if (cf.getUTCFullYear() !== +mf[1] || cf.getUTCMonth() !== +mf[2] - 1 || cf.getUTCDate() !== +mf[3]) return { ok: false, error: 'finfecha' };
    finManual = { y: +mf[1], m: +mf[2], d: +mf[3], t: cf.getTime() };
  } else if (PLANES[d.plan]) {
    plan = d.plan; meses = 1;
  } else {
    return { ok: false, error: 'plan' };
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.inicio || ''));
  if (!m) return { ok: false, error: 'fecha' };
  const y = +m[1], mo = +m[2], da = +m[3];
  const chk = new Date(Date.UTC(y, mo - 1, da));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== da) return { ok: false, error: 'fecha' };
  const h = isoHoy_();
  const hoyMs = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10));
  if (Math.abs(chk.getTime() - hoyMs) > 366 * 86400000) return { ok: false, error: 'fecha' };
  if (finManual && (finManual.t < chk.getTime() || finManual.t - chk.getTime() > 3 * 366 * 86400000)) return { ok: false, error: 'finrango' };
  const monto = esPruebaNuevo ? 0 : Math.round(Number(d.monto) * 100) / 100;
  if (!isFinite(monto) || monto < 0 || (monto === 0 && !esStaffNuevo && !esPruebaNuevo) || monto > 100000) return { ok: false, error: 'monto' };

  const horario = limpiarTexto_(d.horario, 40), instructor = limpiarTexto_(d.instructor, 40);
  const notasLibres = limpiarTexto_(d.notas, 1000);
  const notas = esPruebaNuevo ? ('PRUEBA · ' + motivo + (notasLibres ? ' — ' + notasLibres : '')) : notasLibres;   // la marca PRUEBA excluye de cifras

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  let id, fila, dInicio, dFin;
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const col = mapaColumnas_(alumnos);
    const max = alumnos.getMaxRows();
    const n = Math.max(1, max - 1);
    const ids = alumnos.getRange(2, col['ID'] + 1, n, 1).getValues();
    const nombres = alumnos.getRange(2, col['Nombre'] + 1, n, 1).getValues();
    const tels = alumnos.getRange(2, col['Teléfono'] + 1, n, 1).getValues();

    // 1) Celular repetido: la puerta identifica por celular, no puede haber dos iguales
    for (let i = 0; i < n; i++) {
      if (nombres[i][0] && telNormal_(tels[i][0]) === tel) return { ok: false, error: 'telrepetido', nombre: String(nombres[i][0]).trim() };
    }
    // 2) Nombre parecido: probablemente es un exalumno que vuelve
    if (d.forzar !== true) {
      for (let i = 0; i < n; i++) {
        if (nombres[i][0] && nombresParecidos_(nombres[i][0], nombre)) {
          return { ok: false, error: 'parecido', nombre: String(nombres[i][0]).trim(), id: normalizarId_(ids[i][0]) };
        }
      }
    }

    // Primera fila libre (no usamos getLastRow: las fórmulas de Estado llegan hasta el final de la hoja)
    fila = 0;
    for (let i = 0; i < n; i++) { if (!ids[i][0] && !nombres[i][0]) { fila = i + 2; break; } }
    if (!fila) { alumnos.insertRowAfter(max); fila = max + 1; }

    const existentes = new Set(ids.map((x) => normalizarId_(x[0])));
    do {
      id = CFG.PREFIJO_ID;
      for (let i = 0; i < CFG.LARGO_ID; i++) id += CFG.ALFABETO_ID.charAt(Math.floor(Math.random() * CFG.ALFABETO_ID.length));
    } while (existentes.has(id));

    let f = esStaffNuevo ? { y: 2099, m: 12, d: 31 } : finManual ? { y: finManual.y, m: finManual.m, d: finManual.d } : finDePlan_(y, mo, da, meses);
    if (esPruebaNuevo) { const t = new Date(Date.UTC(y, mo - 1, da + diasPrueba - 1)); f = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }   // N días contando el de inicio
    dInicio = fechaDia_(y, mo, da); dFin = fechaDia_(f.y, f.m, f.d);
    const dHoy = fechaDia_(+h.slice(0, 4), +h.slice(5, 7), +h.slice(8, 10));

    // 3) Alumnos (solo las columnas de datos: Estado y Días restantes se calculan solos)
    const reg = (nombreCol, valor, fmt) => {
      const c = alumnos.getRange(fila, col[nombreCol] + 1);
      if (fmt) c.setNumberFormat(fmt);
      c.setValue(valor);
    };
    reg('ID', id, '@'); reg('Nombre', nombre, '@'); reg('Teléfono', tel, '@'); reg('Plan', plan, '@');
    reg('Fecha inicio', dInicio, 'dd/mm/yyyy'); reg('Fecha fin', dFin, 'dd/mm/yyyy');
    reg('Horario', horario, '@'); reg('Instructor', instructor, '@'); reg('Notas internas', notas, '@');

    // 4) Primer pago en Renovaciones (un usuario de prueba no paga: no se registra nada)
    if (!esPruebaNuevo) {
      const hRen = asegurarHojaRenovaciones_();
      const nueva = hRen.getLastRow() + 1;
      hRen.getRange(nueva, 1, 1, 10)
        .setNumberFormats([['@', '@', '@', 'dd/mm/yyyy', 'dd/mm/yyyy', 'dd/mm/yyyy', '@', '#,##0.00', '@', '@']])
        .setValues([[id, nombre, tel, dHoy, dInicio, dFin, plan, monto, 'Inscripción', instructor]]);
    }
  } finally {
    lock.releaseLock();
  }

  // 5) Tarjeta PDF (puede tardar ~10 s; si falla, el alumno ya quedó inscrito)
  const conf = leerConfig_();
  let pdf = '', pdfError = '';
  try {
    if (!conf.PLANTILLA_ID || !conf.CARPETA_PDF_ID) throw new Error('Falta PLANTILLA_ID o CARPETA_PDF_ID en la hoja Config');
    pdf = crearPdf_(conf, id, nombre, plan);
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const col = mapaColumnas_(alumnos);
    alumnos.getRange(fila, col['Tarjeta PDF'] + 1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Ver PDF').setLinkUrl(pdf).build());
  } catch (err) {
    pdf = ''; pdfError = String(err && err.message ? err.message : err).slice(0, 200);
  }

  let tarjeta = '';
  try { const u = urlVerificacion_(conf, id); if (/^https:\/\//.test(u)) tarjeta = u; } catch (e) { tarjeta = ''; }

  const fmt = (x) => Utilities.formatDate(x, CFG.TZ, 'dd/MM/yyyy');
  return { ok: true, id: id, nombre: nombre, tel: tel, plan: plan, inicio: fmt(dInicio), fin: fmt(dFin), monto: monto, tarjeta: tarjeta, pdf: pdf, pdfError: pdfError, prueba: esPruebaNuevo, dias: diasPrueba, motivo: motivo };
}

// Convierte un usuario de prueba en alumno regular: quita la marca PRUEBA y registra su primer pago (Inscripción)
function panelConvertirPrueba(d) {
  verificarDueno_();
  const id = normalizarId_(d && d.id);
  if (!id) return { ok: false, error: 'datos' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const col = mapaColumnas_(alumnos), fila = celda.getRow();
    const notas = String(alumnos.getRange(fila, col['Notas internas'] + 1).getValue() || '');
    if (!/^\s*prueba\b/i.test(notas) || esStaff_(notas)) return { ok: false, error: 'noprueba' };
    const i = notas.indexOf(' — ');
    alumnos.getRange(fila, col['Notas internas'] + 1).setNumberFormat('@').setValue(i >= 0 ? notas.slice(i + 3) : '');   // deja solo sus notas libres
    CacheService.getScriptCache().remove('al:' + id);
  } finally { lock.releaseLock(); }
  const r = panelRenovar({ id: id, inicio: d.inicio, monto: d.monto, bono: false, forzar: true });
  if (!r || !r.ok) {                                   // si el pago falla, vuelve a quedar como prueba
    try {
      const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
      const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
      const col = mapaColumnas_(alumnos);
      alumnos.getRange(celda.getRow(), col['Notas internas'] + 1).setNumberFormat('@').setValue('PRUEBA · convertir pendiente');
    } catch (e) {}
    return r;
  }
  try {                                               // su primer pago es una inscripción, no una renovación
    const h = asegurarHojaRenovaciones_(), ult = h.getLastRow();
    if (String(h.getRange(ult, 1).getValue()) === id) h.getRange(ult, 9).setValue('Inscripción');
  } catch (e) {}
  return r;
}

function panelRenovar(d) {
  verificarDueno_();
  const id = normalizarId_(d && d.id);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String((d && d.inicio) || ''));
  if (!id || !m) return { ok: false, error: 'datos' };
  const y = +m[1], mo = +m[2], da = +m[3];
  const chk = new Date(Date.UTC(y, mo - 1, da));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== da) return { ok: false, error: 'fecha' };
  const h = isoHoy_();
  const hoyMs = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10));
  if (Math.abs(chk.getTime() - hoyMs) > 366 * 86400000) return { ok: false, error: 'fecha' };
  const monto = Math.round(Number(d.monto) * 100) / 100;
  if (!isFinite(monto) || monto <= 0 || monto > 100000) return { ok: false, error: 'monto' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const fila = celda.getRow();
    const col = mapaColumnas_(alumnos);
    const reg = alumnos.getRange(fila, 1, 1, alumnos.getLastColumn()).getValues()[0];
    const nombre = String(reg[col['Nombre']] || '').trim();
    const tel = telNormal_(reg[col['Teléfono']]);
    const plan = String(reg[col['Plan']] || '').trim();

    const hoja = asegurarHojaRenovaciones_();

    // Aviso de posible doble registro (últimos 3 días)
    if (d.forzar !== true) {
      const ult = hoja.getLastRow();
      if (ult >= 2) {
        const filas = hoja.getRange(Math.max(2, ult - 299), 1, ult - Math.max(2, ult - 299) + 1, 4).getValues();
        for (let i = filas.length - 1; i >= 0; i--) {
          if (normalizarId_(filas[i][0]) !== id || !(filas[i][3] instanceof Date)) continue;
          const f = Utilities.formatDate(filas[i][3], CFG.TZ, 'yyyy-MM-dd');
          const dias = (hoyMs - Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10))) / 86400000;
          if (dias >= 0 && dias < 3) return { ok: false, error: 'duplicado', fecha: Utilities.formatDate(filas[i][3], CFG.TZ, 'dd/MM/yyyy') };
          break;
        }
      }
    }

    let f = finDePlan_(y, mo, da);
    const bono = d.bono === true;                                  // renovó a tiempo: días extra de regalo
    if (bono) { const t = new Date(Date.UTC(f.y, f.m - 1, f.d + BONO_DIAS)); f = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
    const dInicio = fechaDia_(y, mo, da), dFin = fechaDia_(f.y, f.m, f.d);
    const dHoy = fechaDia_(+h.slice(0, 4), +h.slice(5, 7), +h.slice(8, 10));
    const seguro = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t);

    // 1) Historial
    const nueva = hoja.getLastRow() + 1;
    hoja.getRange(nueva, 1, 1, 10)
      .setNumberFormats([['@', '@', '@', 'dd/mm/yyyy', 'dd/mm/yyyy', 'dd/mm/yyyy', '@', '#,##0.00', '@', '@']])
      .setValues([[id, seguro(nombre), tel, dHoy, dInicio, dFin, seguro(plan), monto, 'Renovación', seguro(String(reg[col['Instructor']] || '').trim())]]);

    // 2) Alumnos: nuevas fechas (Estado y Días restantes se recalculan solos)
    alumnos.getRange(fila, col['Fecha inicio'] + 1).setValue(dInicio);
    alumnos.getRange(fila, col['Fecha fin'] + 1).setValue(dFin);

    // 3) La tarjeta del alumno debe mostrar lo nuevo ya
    CacheService.getScriptCache().remove('al:' + id);

    const fmt = (x) => Utilities.formatDate(x, CFG.TZ, 'dd/MM/yyyy');
    return { ok: true, nombre: nombre, tel: tel, plan: plan, inicio: fmt(dInicio), fin: fmt(dFin), monto: monto, bono: bono ? BONO_DIAS : 0 };
  } finally {
    lock.releaseLock();
  }
}

function asegurarHojaRenovaciones_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_RENOVACIONES);
  if (h) {
    if (!h.getRange('I1').getValue()) {              // hojas creadas antes de existir la columna Tipo
      h.getRange('I1').setValue('Tipo').setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
      h.getRange('I2:I').setNumberFormat('@');
      h.setColumnWidth(9, 110);
    }
    if (!h.getRange('J1').getValue()) {              // columna Instructor: quién entrenaba al alumno cuando pagó
      h.getRange('J1').setValue('Instructor').setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
      h.getRange('J2:J').setNumberFormat('@');
      h.setColumnWidth(10, 110);
    }
    return h;
  }
  h = ss.insertSheet(CFG.HOJA_RENOVACIONES);
  h.getRange(1, 1, 1, 10).setValues([['ID', 'Nombre', 'Teléfono', 'Fecha', 'Fecha de inicio', 'Fecha fin', 'Plan', 'Monto pagado (Bs)', 'Tipo', 'Instructor']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.getRange('I2:J').setNumberFormat('@');
  h.setFrozenRows(1);
  h.getRange('A2:C').setNumberFormat('@');
  h.getRange('D2:F').setNumberFormat('dd/mm/yyyy');
  h.getRange('G2:G').setNumberFormat('@');
  h.getRange('H2:H').setNumberFormat('#,##0.00');
  [110, 200, 100, 100, 110, 100, 170, 130, 110, 110].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Renovaciones: las escribe el panel, corregir solo si hace falta').setWarningOnly(true);
  return h;
}

/**
 * Consulta pública con protección anti-spam:
 * 1) rechaza códigos con formato inválido sin tocar el Sheet
 * 2) recuerda cada respuesta unos segundos (caché)
 * 3) limita las consultas nuevas por minuto
 */
function consultar_(id) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id)) return { ok: false };

  const cache = CacheService.getScriptCache();
  const guardado = cache.get('al:' + id);
  if (guardado) return JSON.parse(guardado);

  const clave = 'rl:' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(clave) || 0) + 1;
  cache.put(clave, String(n), 120);
  if (n > CFG.LIMITE_POR_MINUTO * 5) return { ok: false, ocupado: true };         // tope global generoso

  const alumno = buscarAlumno_(id);
  // Los códigos que no existen tienen un cupo aparte: quien prueba códigos al azar no bloquea a los alumnos reales
  if (!alumno && !limiteMin_('rlmiss', CFG.LIMITE_POR_MINUTO / 2)) return { ok: false, ocupado: true };
  const res = alumno ? { ok: true, alumno: alumno } : { ok: false };
  cache.put('al:' + id, JSON.stringify(res), CFG.CACHE_SEGUNDOS);
  return res;
}

function buscarAlumno_(id) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  if (!hoja) return null;
  const celda = hoja.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
  if (!celda || celda.getRow() === 1) return null;

  const col = mapaColumnas_(hoja);
  const fila = hoja.getRange(celda.getRow(), 1, 1, hoja.getLastColumn()).getValues()[0];
  const v = (nombre) => fila[col[nombre]];

  const inicio = v('Fecha inicio');
  const fin = v('Fecha fin');
  const est = calcularEstado_(inicio, fin);

  // Datos visibles al escanear: nombre completo, horario, plan, fechas. Nunca teléfono ni notas
  return {
    id: id,
    nombre: String(v('Nombre') || '').trim(),
    plan: String(v('Plan') || '').trim(),
    horario: String(v('Horario') || '').trim(),
    instructor: String(v('Instructor') || '').trim(),
    inicio: fmtFecha_(inicio),
    fin: fmtFecha_(fin),
    estado: est.estado,
    clase: est.clase,
    textoDias: est.textoDias,
    progreso: est.progreso,
    staff: esStaff_(v('Notas internas')),
    racha: rachaDeAlumno_(id, String(v('Plan') || ''))
  };
}

function calcularEstado_(inicio, fin) {
  if (!(fin instanceof Date)) {
    return { estado: 'SIN FECHA', clase: 'neutral', textoDias: 'Consulta en recepción', progreso: 0 };
  }
  if (fin.getFullYear() >= 2090) {                                   // fecha 2099 = equipo de Kalos: sin vencimiento
    return { estado: 'ACTIVO', clase: 'ok', textoDias: 'STAFF · Kalos', progreso: 0 };
  }
  const hoy = diaLocal_(new Date());
  const dFin = diaLocal_(fin);
  const dIni = inicio instanceof Date ? diaLocal_(inicio) : null;
  const DIA = 86400000;
  const dias = Math.round((dFin - hoy) / DIA);

  let progreso = 100;
  if (dIni !== null && dFin > dIni) {
    progreso = Math.round(Math.min(1, Math.max(0, (hoy - dIni) / (dFin - dIni))) * 100);
  }

  // Ya no existe "POR INICIAR": una renovación anticipada mueve Fecha inicio al futuro
  // y el alumno sigue activo hasta su Fecha fin. El estado depende solo de la fecha fin.
  if (dias < 0) {
    const hace = Math.abs(dias);
    return { estado: 'VENCIDO', clase: 'bad', textoDias: 'Venció hace ' + hace + (hace === 1 ? ' día' : ' días'), progreso: 100 };
  }
  if (dias === 0) {
    return { estado: 'VENCE HOY', clase: 'warn', textoDias: 'Último día de tu plan', progreso: 100 };
  }
  if (dias <= CFG.DIAS_AVISO) {
    return { estado: 'POR VENCER', clase: 'warn', textoDias: 'Quedan ' + dias + (dias === 1 ? ' día' : ' días'), progreso: progreso };
  }
  return { estado: 'ACTIVO', clase: 'ok', textoDias: 'Quedan ' + dias + ' días', progreso: progreso };
}

;
/* ---- apps-script/06-cards-and-links.gs ---- */
/* ------------------------------------------------------------
 *  GENERAR TARJETAS PDF
 * ---------------------------------------------------------- */
function generarTarjetasSeleccion() {
  soloDueno_();
  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (hoja.getName() !== CFG.HOJA_ALUMNOS) {
    ui.alert('Ve a la hoja "' + CFG.HOJA_ALUMNOS + '" y selecciona la(s) fila(s) del alumno.');
    return;
  }
  const conf = validarConfig_();
  if (!conf) return;

  const filas = filasSeleccionadas_(hoja);
  if (!filas.length) { ui.alert('Selecciona al menos una fila de alumno (desde la fila 2).'); return; }

  const col = mapaColumnas_(hoja);
  let ok = 0;
  const errores = [];
  filas.forEach((r, i) => {
    const nombre = String(hoja.getRange(r, col['Nombre'] + 1).getValue() || '').trim();
    if (!nombre) return;
    try {
      ss.toast('Generando ' + (i + 1) + ' de ' + filas.length + ': ' + nombre, 'Kalos', 30);
      const id = asegurarId_(hoja, r, col);
      const urlPdf = crearPdf_(conf, id, nombre, String(hoja.getRange(r, col['Plan'] + 1).getValue() || ''));
      const link = SpreadsheetApp.newRichTextValue().setText('Ver PDF').setLinkUrl(urlPdf).build();
      hoja.getRange(r, col['Tarjeta PDF'] + 1).setRichTextValue(link);
      ok++;
    } catch (err) {
      errores.push(nombre + ': ' + err.message);
    }
  });

  let msg = ok + (ok === 1 ? ' tarjeta generada.' : ' tarjetas generadas.');
  if (errores.length) msg += '\n\nErrores:\n' + errores.join('\n');
  ui.alert(msg);
}

function crearPdf_(conf, id, nombre, plan) {
  const carpeta = DriveApp.getFolderById(conf.CARPETA_PDF_ID);
  const copia = DriveApp.getFileById(conf.PLANTILLA_ID).makeCopy('tmp_' + id, carpeta);
  try {
    const pres = SlidesApp.openById(copia.getId());
    pres.replaceAllText('{{NOMBRE}}', nombre.toUpperCase());
    pres.replaceAllText('{{ID}}', id);
    pres.replaceAllText('{{PLAN}}', plan.toUpperCase());

    const qr = obtenerQr_(urlVerificacion_(conf, id));
    let qrPuesto = false;
    pres.getSlides().forEach((slide) => {
      slide.getShapes().forEach((shape) => {
        if (shape.getText().asString().indexOf('{{QR}}') > -1) {
          shape.replaceWithImage(qr);
          qrPuesto = true;
        }
      });
    });
    if (!qrPuesto) throw new Error('La plantilla no tiene una forma con el texto {{QR}}.');
    pres.saveAndClose();

    // Reemplaza el PDF anterior del mismo alumno, si existía
    const viejos = carpeta.searchFiles('title contains "' + id + '" and mimeType = "application/pdf" and trashed = false');
    while (viejos.hasNext()) viejos.next().setTrashed(true);

    const pdf = copia.getAs(MimeType.PDF).setName('Tarjeta Kalos - ' + nombre + ' (' + id + ').pdf');
    return carpeta.createFile(pdf).getUrl();
  } finally {
    copia.setTrashed(true);
  }
}

// QR generado aquí mismo (Qr.gs): el código de la tarjeta nunca sale hacia servicios externos de QR.
function obtenerQr_(texto) {
  const q = qrcode(0, 'M');
  q.addData(String(texto));
  q.make();
  const uri = q.createDataURL(16, 40);          // GIF en base64 (celda de 16 px, margen de 40 px)
  return Utilities.newBlob(Utilities.base64Decode(uri.split(',')[1]), 'image/gif', 'qr.gif');
}

/* ------------------------------------------------------------
 *  ENLACE (para mandar por WhatsApp sin tarjeta física)
 * ---------------------------------------------------------- */
function mostrarEnlace() {
  soloDueno_();
  const hoja = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  const conf = validarConfig_(true);
  if (!conf) return;
  const r = hoja.getActiveRange().getRow();
  if (hoja.getName() !== CFG.HOJA_ALUMNOS || r < 2) { ui.alert('Selecciona la fila de un alumno.'); return; }
  const col = mapaColumnas_(hoja);
  const id = asegurarId_(hoja, r, col);
  const url = urlVerificacion_(conf, id);
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:13px">' +
    '<p>Enlace de verificación de <b>' + escapar_(hoja.getRange(r, col['Nombre'] + 1).getValue()) + '</b>:</p>' +
    '<input style="width:100%;padding:6px" value="' + escapar_(url) + '" onclick="this.select()" readonly>' +
    '<p><a href="' + escapar_(url) + '" target="_blank">Abrir página</a></p></div>'
  ).setWidth(460).setHeight(150);
  ui.showModalDialog(html, 'Kalos · Enlace');
}

/* ------------------------------------------------------------
 *  IDs
 * ---------------------------------------------------------- */
function asignarIdsFaltantes() {
  soloDueno_();
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const col = mapaColumnas_(hoja);
  const n = Math.max(1, hoja.getLastRow() - 1);
  const ids = hoja.getRange(2, col['ID'] + 1, n, 1).getValues();
  const nombres = hoja.getRange(2, col['Nombre'] + 1, n, 1).getValues();
  let asignados = 0;
  for (let i = 0; i < n; i++) {
    if (nombres[i][0] && !ids[i][0]) { asegurarId_(hoja, i + 2, col); asignados++; }
  }
  SpreadsheetApp.getActive().toast(asignados + ' IDs asignados.', 'Kalos');
}

function asegurarId_(hoja, fila, col) {
  const celda = hoja.getRange(fila, col['ID'] + 1);
  const actual = normalizarId_(celda.getValue());
  if (actual) return actual;
  const existentes = new Set(
    hoja.getRange(2, col['ID'] + 1, Math.max(1, hoja.getLastRow() - 1), 1).getValues().map((x) => normalizarId_(x[0]))
  );
  let id;
  do {
    id = CFG.PREFIJO_ID;
    for (let i = 0; i < CFG.LARGO_ID; i++) {
      id += CFG.ALFABETO_ID.charAt(Math.floor(Math.random() * CFG.ALFABETO_ID.length));
    }
  } while (existentes.has(id));
  celda.setValue(id);
  return id;
}

function normalizarId_(x) {
  return String(x || '').trim().toUpperCase();
}

;
/* ---- apps-script/07-config-and-utils.gs ---- */
/* ------------------------------------------------------------
 *  CONFIGURACIÓN
 * ---------------------------------------------------------- */
function setup() {
  soloDueno_();
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(CFG.TZ);

  // Hoja Alumnos
  let alumnos = ss.getSheetByName(CFG.HOJA_ALUMNOS);
  if (!alumnos) alumnos = ss.insertSheet(CFG.HOJA_ALUMNOS, 0);
  if (!alumnos.getRange('A1').getValue()) prepararHojaAlumnos_(alumnos);

  // Hoja Config
  let config = ss.getSheetByName(CFG.HOJA_CONFIG);
  if (!config) {
    config = ss.insertSheet(CFG.HOJA_CONFIG);
    config.getRange(1, 1, 4, 3).setValues([
      ['Clave', 'Valor', 'Qué es'],
      ['PLANTILLA_ID', '', 'ID de la presentación de Google Slides "' + CFG.NOMBRE_PLANTILLA + '"'],
      ['CARPETA_PDF_ID', '', 'ID de la carpeta de Drive donde se guardan los PDFs'],
      ['WEBAPP_URL', '', 'URL de la Web App (termina en /exec)']
    ]);
    config.getRange('A1:C1').setFontWeight('bold');
    config.setColumnWidth(1, 160).setColumnWidth(2, 420).setColumnWidth(3, 380);
  }

  asegurarHojaSugerencias_();
  asegurarHojaLogros_();
  asegurarHojaAsistencia_();
  asegurarColumnasAsistencia_();
  asegurarHojaRenovaciones_();

  if (leerConfig_().PAGINA_URL === undefined) escribirConfig_('PAGINA_URL', '');
  const conf = leerConfig_();

  // Plantilla: la busca por nombre en tu Drive
  if (!conf.PLANTILLA_ID) {
    const it = DriveApp.searchFiles(
      'title contains "' + CFG.NOMBRE_PLANTILLA + '" and mimeType = "application/vnd.google-apps.presentation" and trashed = false'
    );
    if (it.hasNext()) escribirConfig_('PLANTILLA_ID', it.next().getId());
  }

  // Carpeta de PDFs: junto al Sheet
  if (!conf.CARPETA_PDF_ID) {
    const padres = DriveApp.getFileById(ss.getId()).getParents();
    const base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
    const existentes = base.getFoldersByName(CFG.NOMBRE_CARPETA_PDF);
    const carpeta = existentes.hasNext() ? existentes.next() : base.createFolder(CFG.NOMBRE_CARPETA_PDF);
    escribirConfig_('CARPETA_PDF_ID', carpeta.getId());
  }

  // Permisos de QR: prueba la conexión
  try { obtenerQr_('kalos-test'); } catch (e) { /* se reporta abajo */ }

  const final = leerConfig_();
  const faltan = [];
  if (!final.PLANTILLA_ID) faltan.push('• PLANTILLA_ID: sube "Plantilla Tarjeta Kalos.pptx" a Drive y ábrela con Google Slides, luego vuelve a correr esta opción.');
  if (!/\/exec$/.test(final.WEBAPP_URL || '')) faltan.push('• WEBAPP_URL: implementa la Web App y pega la URL (termina en /exec) en la hoja Config.');
  SpreadsheetApp.getUi().alert(faltan.length ? 'Casi listo. Falta:\n\n' + faltan.join('\n') : '✅ Todo configurado. Ya puedes generar tarjetas.');
}

function prepararHojaAlumnos_(h) {
  h.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  // Fórmulas en la fila 2 (notación en inglés, que Apps Script acepta en cualquier idioma)
  h.getRange('J2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(F2:F="","SIN FECHA",' +
    'IF(F2:F<TODAY(),"VENCIDO",IF(F2:F-TODAY()<=' + CFG.DIAS_AVISO + ',"POR VENCER","ACTIVO")))))'
  );
  h.getRange('K2').setFormula('=ARRAYFORMULA(IF(F2:F="","",IF(F2:F<TODAY(),0,F2:F-TODAY())))');
  h.getRange('E2:F').setNumberFormat('dd/mm/yyyy');
  h.getRange('K2:K').setNumberFormat('0');
  h.setFrozenRows(1);
  const anchos = [110, 220, 110, 130, 100, 100, 150, 120, 220, 110, 110, 100];
  anchos.forEach((w, i) => h.setColumnWidth(i + 1, w));
  const rango = h.getRange('J2:J');
  h.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ACTIVO').setBackground('#d9f7e1').setFontColor('#0b6b2b').setRanges([rango]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('POR VENCER').setBackground('#fff2cc').setFontColor('#8a5a00').setRanges([rango]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('VENCIDO').setBackground('#fde0e0').setFontColor('#a10f0f').setRanges([rango]).build()
  ]);
}

function leerConfig_() {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_CONFIG);
  const out = {};
  if (!hoja) return out;
  hoja.getRange(1, 1, hoja.getLastRow(), 2).getValues().forEach((r) => {
    if (r[0]) out[String(r[0]).trim()] = String(r[1] || '').trim();
  });
  return out;
}

function escribirConfig_(clave, valor) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_CONFIG);
  const datos = hoja.getRange(1, 1, hoja.getLastRow(), 1).getValues();
  for (let i = 0; i < datos.length; i++) {
    if (String(datos[i][0]).trim() === clave) { hoja.getRange(i + 1, 2).setValue(valor); return; }
  }
  hoja.appendRow([clave, valor]);
}

function validarConfig_(soloUrl) {
  const conf = leerConfig_();
  const faltan = [];
  if (!/\/exec$/.test(conf.WEBAPP_URL || '')) faltan.push('WEBAPP_URL (la URL de la Web App, termina en /exec)');
  if (!soloUrl) {
    if (!conf.PLANTILLA_ID) faltan.push('PLANTILLA_ID');
    if (!conf.CARPETA_PDF_ID) faltan.push('CARPETA_PDF_ID');
  }
  if (faltan.length) {
    SpreadsheetApp.getUi().alert('Falta configurar en la hoja "Config":\n\n• ' + faltan.join('\n• ') +
      '\n\nTip: corre Kalos → Configuración inicial.');
    return null;
  }
  return conf;
}

/* ------------------------------------------------------------
 *  UTILIDADES
 * ---------------------------------------------------------- */
function urlVerificacion_(conf, id) {
  // Si hay página pública (GitHub Pages), el QR apunta ahí; si no, a la Web App
  const base = conf.PAGINA_URL || conf.WEBAPP_URL;
  return base + (base.indexOf('?') > -1 ? '&' : '?') + 'id=' + encodeURIComponent(id);
}

function mapaColumnas_(hoja) {
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const m = {};
  enc.forEach((n, i) => { m[String(n).trim()] = i; });
  ENCABEZADOS.forEach((n) => {
    if (m[n] === undefined) throw new Error('Falta la columna "' + n + '" en la hoja ' + hoja.getName());
  });
  return m;
}

function filasSeleccionadas_(hoja) {
  const set = new Set();
  hoja.getActiveRangeList().getRanges().forEach((rg) => {
    for (let r = rg.getRow(); r < rg.getRow() + rg.getNumRows(); r++) if (r > 1) set.add(r);
  });
  return Array.from(set).sort((a, b) => a - b);
}

function diaLocal_(d) {
  const s = Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd');
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
}

function fmtFecha_(d) {
  return d instanceof Date ? Utilities.formatDate(d, CFG.TZ, 'dd/MM/yyyy') : '—';
}

// "Viviana Gutierrez Rojas" → "Viviana G."
function nombrePublico_(n) {
  const partes = String(n || '').trim().split(/\s+/).filter(String);
  if (partes.length < 2) return partes[0] || '';
  return partes[0] + ' ' + partes[1].charAt(0).toUpperCase() + '.';
}

function escapar_(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

;
/* ---- apps-script/08-coach-routines.gs ---- */
/* ------------------------------------------------------------
 *  RUTINAS DEL INSTRUCTOR
 *  Hoja "Rutinas": ID | Nombre | Día (1=lun … 5=vie) | Orden (1–3) | Archivo ID | Actualizada | Subida por
 *  Las imágenes viven en una carpeta privada de Drive; solo el servidor las entrega.
 * ---------------------------------------------------------- */
const DIAS_RUTINA_ = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

function limiteMin_(clave, max) {
  const cache = CacheService.getScriptCache();
  const k = clave + ':' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), 120);
  return n <= max;
}

function igualConstante_(a, b) {
  a = String(a); b = String(b);
  let r = a.length === b.length ? 0 : 1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

// Devuelve { coach } si la clave es válida; si no, { error }
function coachAuth_(d) {
  const cache = CacheService.getScriptCache();
  const min = Math.floor(Date.now() / 60000);
  if (Number(cache.get('cof:' + min) || 0) >= CFG.COACH_FALLOS_POR_MINUTO) return { error: 'ocupado' };
  if (!limiteMin_('coa', CFG.COACH_ACCIONES_POR_MINUTO)) return { error: 'ocupado' };
  const clave = String(d.clave || '');
  const conf = leerConfig_();
  let coach = null;
  Object.keys(COACHES).forEach((k) => {
    const esp = conf[COACHES[k].claveConfig];
    if (esp && esp.length >= 20 && clave && igualConstante_(clave, esp)) coach = COACHES[k];
  });
  if (!coach) {
    cache.put('cof:' + min, String(Number(cache.get('cof:' + min) || 0) + 1), 120);
    return { error: 'clave' };
  }
  return { coach: coach };
}

function instructorDe_(txt) { return String(txt || '').trim().toLowerCase(); }

function alumnosDeCoach_(coach) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja ? hoja.getLastRow() : 0;
  if (ult < 2) return [];
  const col = mapaColumnas_(hoja);
  const vals = hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues();
  const out = [];
  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    if (instructorDe_(r[col['Instructor']]) !== instructorDe_(coach.nombre)) return;
    const est = calcularEstado_(r[col['Fecha inicio']], r[col['Fecha fin']]);
    out.push({
      id: id, nombre: nombre, tel: telNormal_(r[col['Teléfono']]),
      plan: String(r[col['Plan']] || '').trim(), horario: String(r[col['Horario']] || '').trim(),
      estado: est.estado, textoDias: est.textoDias,
      prueba: /^\s*prueba\b/i.test(String(r[col['Notas internas']] || ''))
    });
  });
  return out;
}

function asegurarHojaRutinas_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_RUTINAS);
  if (h) return h;
  h = ss.insertSheet(CFG.HOJA_RUTINAS);
  h.getRange('A:G').setNumberFormat('@');
  h.getRange(1, 1, 1, 7).setValues([['ID', 'Nombre', 'Día', 'Orden', 'Archivo ID', 'Actualizada', 'Subida por']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.setColumnWidth(1, 100).setColumnWidth(2, 180).setColumnWidth(5, 260).setColumnWidth(6, 110);
  h.protect().setDescription('Rutinas: las escribe el sistema, corregir solo si hace falta').setWarningOnly(true);
  return h;
}

function carpetaRutinas_() {
  const conf = leerConfig_();
  if (conf.CARPETA_RUTINAS_ID) {
    try { return DriveApp.getFolderById(conf.CARPETA_RUTINAS_ID); } catch (e) { /* se vuelve a crear */ }
  }
  const padres = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  const base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const it = base.getFoldersByName(CFG.NOMBRE_CARPETA_RUTINAS);
  const carpeta = it.hasNext() ? it.next() : base.createFolder(CFG.NOMBRE_CARPETA_RUTINAS);
  escribirConfig_('CARPETA_RUTINAS_ID', carpeta.getId());
  return carpeta;
}

// Todas las filas de la hoja como objetos
function leerRutinas_(hoja) {
  const ult = hoja.getLastRow();
  if (ult < 2) return [];
  return hoja.getRange(2, 1, ult - 1, 7).getValues().map((r, i) => ({
    fila: i + 2, id: normalizarId_(r[0]), nombre: String(r[1] || ''), dia: Number(r[2]), orden: Number(r[3]),
    archivo: String(r[4] || ''), fecha: String(r[5] || '')
  })).filter((x) => x.id && x.archivo);
}

// 5 listas (lun–vie) con las imágenes de un alumno
function diasDe_(filas, id) {
  const dias = [[], [], [], [], []];
  let ultima = ['', '', '', '', ''];
  filas.filter((x) => x.id === id && x.dia >= 1 && x.dia <= 5).sort((a, b) => a.orden - b.orden).forEach((x) => {
    dias[x.dia - 1].push({ orden: x.orden, fecha: x.fecha });
    ultima[x.dia - 1] = x.fecha;
  });
  return { dias: dias, fechas: ultima };
}

function imagenBase64_(archivoId) {
  const blob = DriveApp.getFileById(archivoId).getBlob();
  return 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function ahoraTxt_() { return Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy'); }

function papelera_(archivoId) { try { DriveApp.getFileById(archivoId).setTrashed(true); } catch (e) { /* ya no existe */ } }

function manejarCoach_(d) {
  const auth = coachAuth_(d);
  if (auth.error) return { ok: false, error: auth.error };
  const coach = auth.coach;
  const accion = String(d.accion || '');
  const mios = alumnosDeCoach_(coach);
  const porId = {}; mios.forEach((a) => { porId[a.id] = a; });
  const id = normalizarId_(d.id || '');

  if (accion === 'coach_lista') {
    const filas = leerRutinas_(asegurarHojaRutinas_());
    return {
      ok: true, coach: coach.nombre,
      alumnos: mios.map((a) => {
        const r = diasDe_(filas, a.id);
        a.cuenta = r.dias.map((x) => x.length);
        return a;
      })
    };
  }

  if (accion === 'coach_pagos') return coachPagos_(coach, d.semana);

  const dia = Number(d.dia);
  const conDia = accion !== 'coach_ver' && accion !== 'coach_aviso';
  if (!porId[id] && accion !== 'coach_copiar') return { ok: false, error: 'alumno' };

  if (accion === 'coach_apuntes') return { ok: true, items: leerApuntes_(asegurarHojaApuntes_(), id) };   // solo lectura

  if (accion === 'coach_ver') {
    const r = diasDe_(leerRutinas_(asegurarHojaRutinas_()), id);
    return { ok: true, dias: r.dias, fechas: r.fechas };
  }

  if (accion === 'coach_img') {
    const orden = Number(d.orden);
    const f = leerRutinas_(asegurarHojaRutinas_()).find((x) => x.id === id && x.dia === dia && x.orden === orden);
    if (!f) return { ok: false, error: 'no_existe' };
    return { ok: true, data: imagenBase64_(f.archivo) };
  }

  if (!(dia >= 1 && dia <= 5 && dia % 1 === 0)) return { ok: false, error: 'dia' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaRutinas_();

    if (accion === 'coach_subir') {
      const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+\/=]+)$/.exec(String(d.data || ''));
      if (!m || String(d.data).length > CFG.RUTINA_MAX_CHARS) return { ok: false, error: 'imagen' };
      const bytes = Utilities.base64Decode(m[2]);
      const jpg = bytes.length > 3 && (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255;
      const png = bytes.length > 4 && (bytes[0] & 255) === 137 && (bytes[1] & 255) === 80 && (bytes[2] & 255) === 78 && (bytes[3] & 255) === 71;
      if (!jpg && !png) return { ok: false, error: 'imagen' };

      const filas = leerRutinas_(hoja).filter((x) => x.id === id && x.dia === dia);
      let orden = Number(d.orden) || 0;
      const previa = orden ? filas.find((x) => x.orden === orden) : null;
      if (!previa) {
        const usados = filas.map((x) => x.orden);
        orden = 0;
        for (let o = 1; o <= CFG.RUTINAS_MAX_DIA; o++) if (usados.indexOf(o) < 0) { orden = o; break; }
        if (!orden) return { ok: false, error: 'maximo' };
      }
      const blob = Utilities.newBlob(bytes, jpg ? 'image/jpeg' : 'image/png', id + '_d' + dia + '_o' + orden + '_' + Date.now() + (jpg ? '.jpg' : '.png'));
      const arch = carpetaRutinas_().createFile(blob);
      if (previa) {
        papelera_(previa.archivo);
        hoja.getRange(previa.fila, 5, 1, 3).setValues([[arch.getId(), ahoraTxt_(), coach.nombre]]);
      } else {
        const fila = hoja.getLastRow() + 1;
        hoja.getRange(fila, 1, 1, 7).setNumberFormat('@')
          .setValues([[id, porId[id].nombre, String(dia), String(orden), arch.getId(), ahoraTxt_(), coach.nombre]]);
      }
      const r = diasDe_(leerRutinas_(hoja), id);
      return { ok: true, dias: r.dias, fechas: r.fechas, orden: orden };
    }

    if (accion === 'coach_quitar') {
      const orden = Number(d.orden);
      const f = leerRutinas_(hoja).find((x) => x.id === id && x.dia === dia && x.orden === orden);
      if (!f) return { ok: false, error: 'no_existe' };
      papelera_(f.archivo);
      hoja.deleteRow(f.fila);
      const r = diasDe_(leerRutinas_(hoja), id);
      return { ok: true, dias: r.dias, fechas: r.fechas };
    }

    if (accion === 'coach_copiar') {
      const origen = id;
      if (!porId[origen]) return { ok: false, error: 'alumno' };
      const destinos = (Array.isArray(d.destinos) ? d.destinos : []).map(normalizarId_)
        .filter((x, i, arr) => x && x !== origen && porId[x] && arr.indexOf(x) === i).slice(0, 40);
      if (!destinos.length) return { ok: false, error: 'destinos' };
      const filas = leerRutinas_(hoja);
      const fuente = filas.filter((x) => x.id === origen && x.dia === dia).sort((a, b) => a.orden - b.orden);
      if (!fuente.length) return { ok: false, error: 'no_existe' };
      const conflictos = destinos.filter((x) => filas.some((f) => f.id === x && f.dia === dia));
      if (conflictos.length && !d.reemplazar) {
        return { ok: true, conflictos: conflictos.map((x) => porId[x].nombre) };
      }
      // quitar lo anterior de los destinos (de abajo hacia arriba para no desfasar filas)
      filas.filter((f) => destinos.indexOf(f.id) >= 0 && f.dia === dia).sort((a, b) => b.fila - a.fila)
        .forEach((f) => { papelera_(f.archivo); hoja.deleteRow(f.fila); });
      const carpeta = carpetaRutinas_();
      const hoy = ahoraTxt_();
      const nuevas = [];
      destinos.forEach((dest) => {
        fuente.forEach((f) => {
          const copia = DriveApp.getFileById(f.archivo).makeCopy(dest + '_d' + dia + '_o' + f.orden + '_' + Date.now(), carpeta);
          nuevas.push([dest, porId[dest].nombre, String(dia), String(f.orden), copia.getId(), hoy, coach.nombre]);
        });
      });
      const primera = hoja.getLastRow() + 1;
      hoja.getRange(primera, 1, nuevas.length, 7).setNumberFormat('@').setValues(nuevas);
      return { ok: true, copiados: destinos.length };
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: false, error: 'accion' };
}

// Alumno: ve las rutinas de su instructor (solo si está asignado a un instructor con panel)
function manejarRutinaAlumno_(id, d) {
  const accion = String(d.accion || '');
  if (accion !== 'rutina_ver' && accion !== 'rutina_img') return { ok: false, error: 'accion' };
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id)) return { ok: false, error: 'invalido' };
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'rt|' + id));
  if (!limiteMin_('rtm:' + huella, CFG.RUTINAS_POR_MINUTO_TARJETA)) return { ok: false, error: 'ocupado' };
  const al = idExiste_(id) ? buscarAlumno_(id) : null;
  if (!al) return { ok: false, error: 'invalido' };
  if (!COACHES[instructorDe_(al.instructor)]) return { ok: false, error: 'sin_rutina' };

  const filas = leerRutinas_(asegurarHojaRutinas_());
  if (accion === 'rutina_ver') {
    const r = diasDe_(filas, id);
    return { ok: true, dias: r.dias, fechas: r.fechas, estado: al.estado };
  }
  const dia = Number(d.dia), orden = Number(d.orden);
  const f = filas.find((x) => x.id === id && x.dia === dia && x.orden === orden);
  if (!f) return { ok: false, error: 'no_existe' };
  return { ok: true, data: imagenBase64_(f.archivo) };
}

;
/* ---- apps-script/09-coach-payments.gs ---- */
/* ------------------------------------------------------------
 *  PAGOS DE COACH
 *  De cada pago: el socio del espacio recibe X %, el resto es del gimnasio; de ese resto el coach recibe Y %
 *  y el gimnasio el resto. Porcentajes editables en la hoja Config: PCT_PARTNER, PCT_COACH (valores de ejemplo: 40 y 80).
 *  Se le paga cada lunes lo cobrado de lunes a domingo de la semana anterior (según la fecha de registro del pago).
 * ------------------------------------------------------------ */
const HOJA_PAGOS_COACH = 'Pagos Coach';

function r2_(x) { return Math.round(x * 100) / 100; }

function pctPagos_() {
  const c = leerConfig_();
  const leer = (k, def) => { const v = Number(String(c[k] || '').replace(',', '.')); return (c[k] !== undefined && c[k] !== '' && isFinite(v) && v >= 0 && v <= 100) ? v : def; };
  const b = leer('PCT_PARTNER', 40), i = leer('PCT_COACH', 80);
  return { partner: b, coach: i, coachPago: r2_((100 - b) * i / 100), kalosPago: r2_((100 - b) * (100 - i) / 100) };
}

function repartoPago_(monto, p) {
  const kal = r2_(monto * (100 - p.partner) / 100);
  const coach = r2_(kal * p.coach / 100);
  return { partner: r2_(monto - kal), coach: coach, kalos: r2_(kal - coach) };
}

function sumarDias_(iso, n) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
  return Utilities.formatDate(new Date(t), 'UTC', 'yyyy-MM-dd');
}
function lunesDe_(iso) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return sumarDias_(iso, -((new Date(t).getUTCDay() + 6) % 7));
}
function ddmm_(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function ddmmyyyy_(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
function esLunesIso_(x) { return /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) && lunesDe_(String(x)) === String(x); }

// Pagos de los alumnos de un instructor (sin PRUEBA/STAFF ni pagos de 0 Bs)
function pagosDeCoach_(coachNombre) {
  const ss = SpreadsheetApp.getActive();
  const hA = ss.getSheetByName(CFG.HOJA_ALUMNOS);
  const col = mapaColumnas_(hA);
  const alum = {};
  const ultA = hA.getLastRow();
  (ultA >= 2 ? hA.getRange(2, 1, ultA - 1, hA.getLastColumn()).getValues() : []).forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    if (id) alum[id] = { instr: instructorDe_(r[col['Instructor']]), excl: esPrueba_(r[col['Notas internas']]) };
  });
  const hR = asegurarHojaRenovaciones_();
  const ultR = hR.getLastRow();
  const quien = instructorDe_(coachNombre), pct = pctPagos_(), out = [];
  (ultR >= 2 ? hR.getRange(2, 1, ultR - 1, 10).getValues() : []).forEach((r) => {
    const id = normalizarId_(r[0]);
    if (!id || !alum[id] || alum[id].excl || !(r[3] instanceof Date)) return;
    const monto = Number(r[7]) || 0;
    if (monto <= 0) return;
    const instr = String(r[9] || '').trim() ? instructorDe_(r[9]) : alum[id].instr;
    if (instr !== quien) return;
    const fecha = Utilities.formatDate(r[3], CFG.TZ, 'yyyy-MM-dd');
    out.push({ id: id, nombre: String(r[1] || '').trim(), plan: String(r[6] || '').trim(), monto: monto, fecha: fecha, semana: lunesDe_(fecha), rep: repartoPago_(monto, pct) });
  });
  out.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return out;
}

function asegurarHojaPagosIan_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_PAGOS_COACH);
  if (h) return h;
  h = ss.insertSheet(HOJA_PAGOS_COACH);
  h.getRange(1, 1, 1, 4).setValues([['Semana (lunes)', 'Monto liquidado (Bs)', 'Pagado el', 'Nota']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:A').setNumberFormat('@');
  h.getRange('B2:B').setNumberFormat('#,##0.00');
  h.getRange('C2:D').setNumberFormat('@');
  [130, 160, 110, 260].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Pagos a Coach: los escribe el panel').setWarningOnly(true);
  return h;
}

function leerLiquidaciones_() {
  const h = asegurarHojaPagosIan_();
  const ult = h.getLastRow(), out = {};
  (ult >= 2 ? h.getRange(2, 1, ult - 1, 3).getValues() : []).forEach((r, i) => {
    const sem = fechaTxt_(r[0]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sem)) out[sem] = { monto: Number(r[1]) || 0, fecha: r[2] instanceof Date ? Utilities.formatDate(r[2], CFG.TZ, 'dd/MM/yyyy') : String(r[2] || '').trim(), fila: i + 2 };
  });
  return out;
}

function resumenSemanaIan_(pagos, liq, semana) {
  const items = pagos.filter((p) => p.semana === semana);
  let total = 0, cobrado = 0;
  items.forEach((p) => { total += p.rep.coach; cobrado += p.monto; });
  total = r2_(total); cobrado = r2_(cobrado);
  const l = liq[semana] || null;
  let estado = 'vacio', dif = 0;
  if (l) { if (l.monto + 0.005 >= total) estado = 'pagado'; else { estado = 'parcial'; dif = r2_(total - l.monto); } }
  else if (items.length) estado = 'pendiente';
  return {
    semana: semana, desde: ddmm_(semana), hasta: ddmm_(sumarDias_(semana, 6)), total: total, cobrado: cobrado, n: items.length,
    estado: estado, diferencia: dif, liquidado: l ? { monto: l.monto, fecha: l.fecha } : null,
    items: items.map((p) => ({ id: p.id, nombre: p.nombre, fecha: ddmm_(p.fecha), plan: p.plan, monto: p.monto, coach: p.rep.coach }))
  };
}

// Panel de Coach: una semana (lunes a domingo). Por defecto, la semana pasada (la que se le paga hoy).
function coachPagos_(coach, semanaIn) {
  const hoy = isoHoy_(), semActual = lunesDe_(hoy), semPasada = sumarDias_(semActual, -7);
  let sem = esLunesIso_(semanaIn) ? String(semanaIn) : semPasada;
  if (sem > semActual) sem = semActual;
  const pagos = pagosDeCoach_(coach.nombre), liq = leerLiquidaciones_();
  let primera = semActual;
  pagos.forEach((p) => { if (p.semana < primera) primera = p.semana; });
  const r = resumenSemanaIan_(pagos, liq, sem);
  r.items = r.items.map((x) => ({ nombre: x.nombre, fecha: x.fecha, plan: x.plan, monto: x.monto, coach: x.coach }));
  const act = resumenSemanaIan_(pagos, liq, semActual);
  let pendiente = 0;
  const semanas = {}; pagos.forEach((p) => { semanas[p.semana] = true; });
  Object.keys(semanas).forEach((w) => {
    if (w >= semActual) return;
    const x = resumenSemanaIan_(pagos, liq, w);
    if (x.estado === 'pendiente') pendiente += x.total; else if (x.estado === 'parcial') pendiente += x.diferencia;
  });
  return {
    ok: true, coach: coach.nombre, semana: r, esActual: sem === semActual, esPasada: sem === semPasada,
    actual: { desde: act.desde, hasta: act.hasta, total: act.total, n: act.n },
    previa: sumarDias_(sem, -7), siguiente: sumarDias_(sem, 7), hayAnterior: sem > primera, haySiguiente: sem < semActual,
    pendiente: r2_(pendiente)
  };
}

// Panel del dueño: todas las semanas con pagos de Coach
function panelPagosCoach() {
  verificarDueno_();
  const hoy = isoHoy_(), semActual = lunesDe_(hoy);
  const pagos = pagosDeCoach_('Coach'), liq = leerLiquidaciones_();
  const set = {}; pagos.forEach((p) => { set[p.semana] = true; }); Object.keys(liq).forEach((w) => { set[w] = true; });
  const lista = Object.keys(set).sort().reverse().slice(0, 30).map((w) => {
    const r = resumenSemanaIan_(pagos, liq, w);
    r.abierta = w >= semActual;
    return r;
  });
  let pendiente = 0;
  lista.forEach((r) => { if (r.abierta) return; if (r.estado === 'pendiente') pendiente += r.total; else if (r.estado === 'parcial') pendiente += r.diferencia; });
  const pct = pctPagos_();
  return { ok: true, semanas: lista, pendiente: r2_(pendiente), pct: { partner: pct.partner, coach: pct.coachPago, kalos: pct.kalosPago } };
}

function panelPagarCoach(semana) {
  verificarDueno_();
  if (!esLunesIso_(semana)) return { ok: false, error: 'semana' };
  const hoy = isoHoy_();
  if (String(semana) >= lunesDe_(hoy)) return { ok: false, error: 'abierta' };       // la semana aún no terminó
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const pagos = pagosDeCoach_('Coach'), liq = leerLiquidaciones_();
    const r = resumenSemanaIan_(pagos, liq, String(semana));
    if (r.total <= 0) return { ok: false, error: 'vacio' };
    const h = asegurarHojaPagosIan_();
    const fila = liq[semana] ? liq[semana].fila : h.getLastRow() + 1;
    h.getRange(fila, 1, 1, 4).setNumberFormats([['@', '#,##0.00', '@', '@']])
      .setValues([[String(semana), r.total, ddmmyyyy_(hoy), 'Marcado en el panel']]);
    return { ok: true, semana: resumenSemanaIan_(pagos, leerLiquidaciones_(), String(semana)) };
  } finally { lock.releaseLock(); }
}

function panelDeshacerPagoCoach(semana) {
  verificarDueno_();
  if (!esLunesIso_(semana)) return { ok: false, error: 'semana' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const liq = leerLiquidaciones_();
    if (!liq[semana]) return { ok: false, error: 'nopagado' };
    asegurarHojaPagosIan_().deleteRow(liq[semana].fila);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

// Resumen del mes para "Números": reparto de lo cobrado a alumnos de Coach
function repartoMesIan_(mes) {
  const pagos = pagosDeCoach_('Coach'), liq = leerLiquidaciones_(), pct = pctPagos_();
  const estSem = {};
  const o = { n: 0, cobrado: 0, partner: 0, coach: 0, kalos: 0, liquidado: 0, pendiente: 0, pct: { partner: pct.partner, coach: pct.coachPago, kalos: pct.kalosPago } };
  pagos.forEach((p) => {
    if (p.fecha.slice(0, 7) !== mes) return;
    if (!estSem[p.semana]) estSem[p.semana] = resumenSemanaIan_(pagos, liq, p.semana).estado;
    o.n++; o.cobrado += p.monto; o.partner += p.rep.partner; o.coach += p.rep.coach; o.kalos += p.rep.kalos;
    if (estSem[p.semana] === 'pagado') o.liquidado += p.rep.coach; else o.pendiente += p.rep.coach;
  });
  ['cobrado', 'partner', 'coach', 'kalos', 'liquidado', 'pendiente'].forEach((k) => { o[k] = r2_(o[k]); });
  return o;
}

;
/* ---- apps-script/10-streak.gs ---- */
/* ------------------------------------------------------------
 *  RACHA (estilo Duolingo)
 *  - Solo cuentan los días hábiles (lunes a viernes, sin feriados); sábado y domingo no suman ni rompen.
 *  - Plan "3 veces por semana": se mantiene si va 3 días hábiles por semana (los que quiera).
 *  - Mensual / Trimestral / otros: tiene que ir todos los días hábiles.
 *  - Se cuenta desde la primera visita registrada con el QR de la puerta.
 *  - Penitencia: la restaura el administrador desde su panel hasta 3 días hábiles después de perderla; máximo 1 por semana.
 * ------------------------------------------------------------ */
const HOJA_RACHAS = 'Rachas';
const FERIADOS_DEFECTO = ['2026-11-02', '2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'];
const RACHA_PLAZO_HABILES = 3;

function rcAdd_(iso, n) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10); }
function rcDow_(iso) { return (new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay() + 6) % 7; }   // 0 = lunes
function rcLunes_(iso) { return rcAdd_(iso, -rcDow_(iso)); }
function rcHabil_(iso, fer) { return rcDow_(iso) < 5 && !fer[iso]; }
function rcSumarHabiles_(iso, n, fer) { let d = iso, c = 0; while (c < n) { d = rcAdd_(d, 1); if (rcHabil_(d, fer)) c++; } return d; }

function feriados_() {
  const set = {};
  String(leerConfig_().FERIADOS || '').split(/[,\s;]+/).forEach((x) => { if (/^\d{4}-\d{2}-\d{2}$/.test(x)) set[x] = true; });
  if (!Object.keys(set).length) FERIADOS_DEFECTO.forEach((x) => { set[x] = true; });
  return set;
}

// Núcleo puro (sin hojas): o = { modo: 'diario'|'3x', visitas: {iso:true}, restauraciones: [{desde, hasta, creada}], hoy, fer }
function calcularRacha_(o) {
  const fer = o.fer, hoy = o.hoy;
  const vis = {};
  Object.keys(o.visitas).forEach((f) => { if (f <= hoy && rcHabil_(f, fer)) vis[f] = true; });
  const dias = Object.keys(vis).sort();
  const lunHoy = rcLunes_(hoy);
  const L = ['L', 'M', 'Mi', 'J', 'V'];
  const semDias = L.map((l, k) => {
    const d = rcAdd_(lunHoy, k);
    return { l: l, e: fer[d] ? 'feriado' : vis[d] ? 'ok' : d === hoy ? 'hoy' : d > hoy ? 'futuro' : 'falta' };
  });
  const res = { modo: o.modo, racha: 0, record: 0, estado: 'nueva', inicio: dias[0] || '', perdida: null, restaurable: null, bloqueada: false,
    semana: { visitas: 0, necesita: o.modo === '3x' ? 3 : 0, faltan: 0, hoyToca: false, dias: semDias } };
  if (!dias.length) return res;

  const cubierto = (d) => o.restauraciones.some((r) => r.desde <= d && d <= r.hasta);
  const cubiertaSem = (lun) => o.restauraciones.some((r) => r.desde <= rcAdd_(lun, 6) && r.hasta >= lun);
  const inicio = dias[0];
  let run = 0, record = 0;
  const quiebres = [];
  const anotar = () => { if (run > record) record = run; };

  if (o.modo === 'diario') {
    for (let d = inicio; d < hoy; d = rcAdd_(d, 1)) {
      if (!rcHabil_(d, fer)) continue;
      if (vis[d]) { run++; anotar(); }
      else if (!cubierto(d) && run > 0) { quiebres.push({ fecha: d, prev: run }); run = 0; }
    }
    if (vis[hoy]) { run++; anotar(); }
    let v = 0; semDias.forEach((x) => { if (x.e === 'ok') v++; });
    res.semana.visitas = v;
    res.semana.hoyToca = rcHabil_(hoy, fer) && !vis[hoy];
  } else {
    for (let lun = rcLunes_(inicio); lun <= hoy; lun = rcAdd_(lun, 7)) {
      const ds = [];
      for (let k = 0; k < 5; k++) { const d = rcAdd_(lun, k); if (d >= inicio && rcHabil_(d, fer)) ds.push(d); }
      if (!ds.length) continue;
      const need = Math.min(3, ds.length);
      const actual = lun === lunHoy;
      let v = 0, quiebre = null;
      ds.forEach((d, i) => {
        if (d > hoy) return;
        if (vis[d]) v++;
        if (quiebre) return;
        const abierto = (d === hoy && !vis[d]) ? 1 : 0;
        if (v + abierto + (ds.length - 1 - i) < need) quiebre = d;
      });
      if (actual) {
        res.semana.visitas = v; res.semana.necesita = need; res.semana.faltan = Math.max(0, need - v);
        const restantes = ds.filter((d) => d >= hoy && !(d === hoy && vis[d])).length;
        res.semana.hoyToca = rcHabil_(hoy, fer) && !vis[hoy] && v < need && (need - v) >= restantes;
        if (quiebre && !cubiertaSem(lun)) { if (run > 0) quiebres.push({ fecha: quiebre, prev: run }); run = 0; }
        else { run += v; anotar(); }
      } else if (v >= need || cubiertaSem(lun)) { run += v; anotar(); }
      else { if (run > 0) quiebres.push({ fecha: quiebre || ds[ds.length - 1], prev: run }); run = 0; }
    }
  }

  res.racha = run; res.record = record;
  const q = quiebres.length ? quiebres[quiebres.length - 1] : null;
  if (q) {
    res.perdida = { dias: q.prev, fecha: q.fecha };
    const limite = rcSumarHabiles_(q.fecha, RACHA_PLAZO_HABILES, fer);
    res.limite = limite;
    if (hoy <= limite) {
      const usada = o.restauraciones.some((r) => r.creada >= lunHoy && r.creada <= rcAdd_(lunHoy, 6));
      if (usada) res.bloqueada = true; else res.restaurable = { desde: q.fecha, limite: limite, prev: q.prev };
    }
  }
  if (run === 0) res.estado = q ? 'perdida' : 'nueva';
  else if (res.semana.hoyToca && (o.modo === 'diario' ? true : res.semana.faltan > 0)) res.estado = 'riesgo';
  else res.estado = 'activa';
  return res;
}

function modoRacha_(plan) { return /3\s*(veces|x)/i.test(String(plan || '')) ? '3x' : 'diario'; }

function asegurarHojaRachas_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_RACHAS);
  if (h) return h;
  h = ss.insertSheet(HOJA_RACHAS);
  h.getRange(1, 1, 1, 7).setValues([['ID', 'Nombre', 'Desde', 'Hasta', 'Restaurada el', 'Racha restaurada (días)', 'Nota']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:G').setNumberFormat('@');
  [110, 200, 100, 100, 110, 160, 260].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Rachas restauradas: las escribe el panel').setWarningOnly(true);
  return h;
}

function leerRestauraciones_(id) {
  const h = asegurarHojaRachas_();
  const ult = h.getLastRow(), out = [];
  (ult >= 2 ? h.getRange(2, 1, ult - 1, 5).getValues() : []).forEach((r) => {
    if (normalizarId_(r[0]) !== id) return;
    const f = (v) => fechaTxt_(v);
    out.push({ desde: f(r[2]), hasta: f(r[3]), creada: f(r[4]) });
  });
  return out;
}

function visitasDe_(id) {
  const hoja = asegurarHojaAsistencia_();
  const ult = hoja.getLastRow(), set = {};
  if (ult >= 2) hoja.getRange(2, 1, ult - 1, 3).getValues().forEach((r) => {
    if (normalizarId_(r[2]) === id) { const f = fechaTxt_(r[0]); if (/^\d{4}-\d{2}-\d{2}$/.test(f)) set[f] = true; }
  });
  return set;
}

function rachaDeAlumno_(id, plan) {
  try {
    return calcularRacha_({ modo: modoRacha_(plan), visitas: visitasDe_(id), restauraciones: leerRestauraciones_(id), hoy: isoHoy_(), fer: feriados_() });
  } catch (e) { return null; }
}

// El administrador restaura la racha después de que el alumno cumple su penitencia
function panelRestaurarRacha(idEntrada, nota) {
  verificarDueno_();
  const id = normalizarId_(idEntrada);
  if (!/^KAL-[A-Z0-9]{6}$/.test(id)) return { ok: false, error: 'alumno' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = hoja.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const col = mapaColumnas_(hoja);
    const fila = hoja.getRange(celda.getRow(), 1, 1, hoja.getLastColumn()).getValues()[0];
    const nombre = String(fila[col['Nombre']] || '').trim(), plan = String(fila[col['Plan']] || '');
    const hoy = isoHoy_();
    const r = calcularRacha_({ modo: modoRacha_(plan), visitas: visitasDe_(id), restauraciones: leerRestauraciones_(id), hoy: hoy, fer: feriados_() });
    if (!r.restaurable) return { ok: false, error: r.bloqueada ? 'semana' : (r.perdida ? 'plazo' : 'sinperdida') };
    const h = asegurarHojaRachas_();
    const seguro = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t);
    h.getRange(h.getLastRow() + 1, 1, 1, 7).setNumberFormat('@')
      .setValues([[id, seguro(nombre), r.restaurable.desde, hoy, hoy, r.restaurable.prev, seguro(limpiarTexto_(nota || 'Penitencia cumplida', 200))]]);
    try { CacheService.getScriptCache().remove('al:' + id); } catch (e) {}
    return { ok: true, racha: rachaDeAlumno_(id, plan) };
  } finally { lock.releaseLock(); }
}

;
/* ---- apps-script/11-physio.gs ---- */
/* ============================================================
   FISIOTERAPIA ALIADA
   Cuenta cuántos alumnos tocan "Escribir al fisioterapeuta" (hoja "Fisio"; solo la ve el dueño)
   ============================================================ */
const HOJA_FISIO = 'Fisio';

function asegurarHojaFisio_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_FISIO);
  if (h) return h;
  h = ss.insertSheet(HOJA_FISIO);
  h.getRange(1, 1, 1, 4).setValues([['Fecha', 'Hora', 'ID', 'Nombre']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:D').setNumberFormat('@');
  [100, 80, 110, 220].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Consultas al fisioterapeuta aliado: las escribe el sistema').setWarningOnly(true);
  return h;
}

function manejarFisio_(id) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id) || !idExiste_(id)) return { ok: false, error: 'invalido' };
  const cache = CacheService.getScriptCache();
  const clave = 'fi:' + id + ':' + isoHoy_();      // máximo 1 registro por alumno por día
  if (cache.get(clave)) return { ok: true, repetido: true };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: true };     // si hay cola, no molestamos al alumno
  try {
    const h = asegurarHojaFisio_();
    const seguro = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t);
    const ahora = new Date();
    h.getRange(h.getLastRow() + 1, 1, 1, 4).setNumberFormat('@')
      .setValues([[Utilities.formatDate(ahora, CFG.TZ, 'yyyy-MM-dd'), Utilities.formatDate(ahora, CFG.TZ, 'HH:mm'), id, seguro(String(nombreDe_(id) || ''))]]);
    cache.put(clave, '1', 21600);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function fisioMes_(mes) {
  try {
    const h = SpreadsheetApp.getActive().getSheetByName(HOJA_FISIO);
    if (!h || h.getLastRow() < 2) return { total: 0, alumnos: 0 };
    const v = h.getRange(2, 1, h.getLastRow() - 1, 3).getValues();
    const ids = {}; let n = 0;
    v.forEach((f) => {
      const fe = f[0] instanceof Date ? Utilities.formatDate(f[0], CFG.TZ, 'yyyy-MM-dd') : String(f[0]);
      if (fe.slice(0, 7) === mes) { n++; ids[String(f[2])] = 1; }
    });
    return { total: n, alumnos: Object.keys(ids).length };
  } catch (e) { return { total: 0, alumnos: 0 }; }
}

;
/* ---- apps-script/12-notes.gs ---- */
/* ============================================================
   MIS APUNTES
   Cuaderno del alumno: ejercicio, intensidad (liga/peso), reps y notas, con fecha. Cada registro se guarda (historial).
   Hoja "Apuntes": Ref | ID | Alumno | Fecha | Ejercicio | Intensidad | Reps | Notas | Creado
   ============================================================ */
const HOJA_APUNTES = 'Apuntes';
const APUNTES_MAX = 500;            // por alumno
const APUNTES_POR_MINUTO = 40;      // por tarjeta

function asegurarHojaApuntes_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_APUNTES);
  if (h) return h;
  h = ss.insertSheet(HOJA_APUNTES);
  h.getRange(1, 1, 1, 9).setValues([['Ref', 'ID', 'Alumno', 'Fecha', 'Ejercicio', 'Intensidad', 'Reps', 'Notas', 'Creado']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:I').setNumberFormat('@');
  [90, 110, 200, 100, 220, 160, 100, 320, 150].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Apuntes de los alumnos: los escribe el sistema').setWarningOnly(true);
  return h;
}

function fechaApunte_(v) {
  return v instanceof Date ? Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd') : String(v || '');
}

function leerApuntes_(hoja, id) {
  const n = hoja.getLastRow() - 1;
  if (n < 1) return [];
  const v = hoja.getRange(2, 1, n, 9).getValues();
  const out = [];
  v.forEach((f) => {
    if (String(f[1]) !== id) return;
    out.push({ ref: String(f[0]), fecha: fechaApunte_(f[3]), ejercicio: String(f[4]), intensidad: String(f[5]), reps: String(f[6]), notas: String(f[7]), creado: String(f[8]) });
  });
  out.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (a.creado < b.creado ? 1 : a.creado > b.creado ? -1 : 0)));
  return out.map((x) => ({ ref: x.ref, fecha: x.fecha, ejercicio: x.ejercicio, intensidad: x.intensidad, reps: x.reps, notas: x.notas }));
}

function validarApunte_(d) {
  const ejercicio = limpiarTexto_(d.ejercicio, 60), intensidad = limpiarTexto_(d.intensidad, 60), reps = limpiarTexto_(d.reps, 40);
  const notas = limpiarTexto_(d.notas, 300);
  if (ejercicio.length < 2) return { error: 'ejercicio' };
  if (!intensidad) return { error: 'intensidad' };
  if (!reps) return { error: 'reps' };
  const hoy = isoHoy_();
  let fecha = String(d.fecha || '').trim() || hoy;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return { error: 'fecha' };
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return { error: 'fecha' };
  const lim = new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7) - 1, +hoy.slice(8, 10) + 1));    // mañana como máximo (por la hora del celular)
  const viejo = new Date(Date.UTC(+hoy.slice(0, 4) - 3, +hoy.slice(5, 7) - 1, +hoy.slice(8, 10)));
  if (dt > lim || dt < viejo) return { error: 'fecha' };
  return { fecha: fecha, ejercicio: ejercicio, intensidad: intensidad, reps: reps, notas: notas };
}

function manejarApuntes_(id, d) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id) || !idExiste_(id)) return { ok: false, error: 'invalido' };
  const cache = CacheService.getScriptCache();
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ap|' + id));
  const clave = 'apm:' + huella + ':' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(clave) || 0) + 1;
  cache.put(clave, String(n), 120);
  if (n > APUNTES_POR_MINUTO) return { ok: false, error: 'ocupado' };

  const accion = String(d.accion || '');
  if (accion === 'apuntes_leer') return { ok: true, items: leerApuntes_(asegurarHojaApuntes_(), id) };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaApuntes_();
    const ahora = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss');

    if (accion === 'apuntes_crear') {
      const a = validarApunte_(d);
      if (a.error) return { ok: false, error: a.error };
      if (leerApuntes_(hoja, id).length >= APUNTES_MAX) return { ok: false, error: 'limite' };
      const ref = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      const fila = hoja.getLastRow() + 1;
      hoja.getRange(fila, 1, 1, 9).setNumberFormat('@').setValues([[ref, id, String(nombreDe_(id) || ''), a.fecha, a.ejercicio, a.intensidad, a.reps, a.notas, ahora]]);
      return { ok: true, items: leerApuntes_(hoja, id) };
    }

    if (accion === 'apuntes_editar' || accion === 'apuntes_borrar') {
      const ref = String(d.ref || '');
      if (!/^[0-9a-f]{10}$/.test(ref)) return { ok: false, error: 'no_existe' };
      const n2 = hoja.getLastRow() - 1;
      if (n2 < 1) return { ok: false, error: 'no_existe' };
      const col = hoja.getRange(2, 1, n2, 2).getValues();
      let fila = 0;
      for (let i = 0; i < col.length; i++) { if (String(col[i][0]) === ref && String(col[i][1]) === id) { fila = i + 2; break; } }
      if (!fila) return { ok: false, error: 'no_existe' };
      if (accion === 'apuntes_borrar') { hoja.deleteRow(fila); return { ok: true, items: leerApuntes_(hoja, id) }; }
      const a = validarApunte_(d);
      if (a.error) return { ok: false, error: a.error };
      hoja.getRange(fila, 4, 1, 5).setNumberFormat('@').setValues([[a.fecha, a.ejercicio, a.intensidad, a.reps, a.notas]]);
      return { ok: true, items: leerApuntes_(hoja, id) };
    }
    return { ok: false, error: 'accion' };
  } finally { lock.releaseLock(); }
}

;
/* ---- apps-script/13-push-notifications.gs ---- */
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

;
/* ---- apps-script/Qr.gs ---- */
/*! qrcode-generator 1.4.4 — Kazuhiko Arase — MIT License. Bundled so QR codes are generated locally: no card ID is ever sent to a third-party QR service. */
var qrcode=function(){var t=function(t,r){var e=t,n=g[r],o=null,i=0,a=null,u=[],f={},c=function(t,r){o=function(t){for(var r=new Array(t),e=0;e<t;e+=1){r[e]=new Array(t);for(var n=0;n<t;n+=1)r[e][n]=null}return r}(i=4*e+17),l(0,0),l(i-7,0),l(0,i-7),s(),h(),d(t,r),e>=7&&v(t),null==a&&(a=p(e,n,u)),w(a,r)},l=function(t,r){for(var e=-1;e<=7;e+=1)if(!(t+e<=-1||i<=t+e))for(var n=-1;n<=7;n+=1)r+n<=-1||i<=r+n||(o[t+e][r+n]=0<=e&&e<=6&&(0==n||6==n)||0<=n&&n<=6&&(0==e||6==e)||2<=e&&e<=4&&2<=n&&n<=4)},h=function(){for(var t=8;t<i-8;t+=1)null==o[t][6]&&(o[t][6]=t%2==0);for(var r=8;r<i-8;r+=1)null==o[6][r]&&(o[6][r]=r%2==0)},s=function(){for(var t=B.getPatternPosition(e),r=0;r<t.length;r+=1)for(var n=0;n<t.length;n+=1){var i=t[r],a=t[n];if(null==o[i][a])for(var u=-2;u<=2;u+=1)for(var f=-2;f<=2;f+=1)o[i+u][a+f]=-2==u||2==u||-2==f||2==f||0==u&&0==f}},v=function(t){for(var r=B.getBCHTypeNumber(e),n=0;n<18;n+=1){var a=!t&&1==(r>>n&1);o[Math.floor(n/3)][n%3+i-8-3]=a}for(n=0;n<18;n+=1){a=!t&&1==(r>>n&1);o[n%3+i-8-3][Math.floor(n/3)]=a}},d=function(t,r){for(var e=n<<3|r,a=B.getBCHTypeInfo(e),u=0;u<15;u+=1){var f=!t&&1==(a>>u&1);u<6?o[u][8]=f:u<8?o[u+1][8]=f:o[i-15+u][8]=f}for(u=0;u<15;u+=1){f=!t&&1==(a>>u&1);u<8?o[8][i-u-1]=f:u<9?o[8][15-u-1+1]=f:o[8][15-u-1]=f}o[i-8][8]=!t},w=function(t,r){for(var e=-1,n=i-1,a=7,u=0,f=B.getMaskFunction(r),c=i-1;c>0;c-=2)for(6==c&&(c-=1);;){for(var g=0;g<2;g+=1)if(null==o[n][c-g]){var l=!1;u<t.length&&(l=1==(t[u]>>>a&1)),f(n,c-g)&&(l=!l),o[n][c-g]=l,-1==(a-=1)&&(u+=1,a=7)}if((n+=e)<0||i<=n){n-=e,e=-e;break}}},p=function(t,r,e){for(var n=A.getRSBlocks(t,r),o=b(),i=0;i<e.length;i+=1){var a=e[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var u=0;for(i=0;i<n.length;i+=1)u+=n[i].dataCount;if(o.getLengthInBits()>8*u)throw"code length overflow. ("+o.getLengthInBits()+">"+8*u+")";for(o.getLengthInBits()+4<=8*u&&o.put(0,4);o.getLengthInBits()%8!=0;)o.putBit(!1);for(;!(o.getLengthInBits()>=8*u||(o.put(236,8),o.getLengthInBits()>=8*u));)o.put(17,8);return function(t,r){for(var e=0,n=0,o=0,i=new Array(r.length),a=new Array(r.length),u=0;u<r.length;u+=1){var f=r[u].dataCount,c=r[u].totalCount-f;n=Math.max(n,f),o=Math.max(o,c),i[u]=new Array(f);for(var g=0;g<i[u].length;g+=1)i[u][g]=255&t.getBuffer()[g+e];e+=f;var l=B.getErrorCorrectPolynomial(c),h=k(i[u],l.getLength()-1).mod(l);for(a[u]=new Array(l.getLength()-1),g=0;g<a[u].length;g+=1){var s=g+h.getLength()-a[u].length;a[u][g]=s>=0?h.getAt(s):0}}var v=0;for(g=0;g<r.length;g+=1)v+=r[g].totalCount;var d=new Array(v),w=0;for(g=0;g<n;g+=1)for(u=0;u<r.length;u+=1)g<i[u].length&&(d[w]=i[u][g],w+=1);for(g=0;g<o;g+=1)for(u=0;u<r.length;u+=1)g<a[u].length&&(d[w]=a[u][g],w+=1);return d}(o,n)};f.addData=function(t,r){var e=null;switch(r=r||"Byte"){case"Numeric":e=M(t);break;case"Alphanumeric":e=x(t);break;case"Byte":e=m(t);break;case"Kanji":e=L(t);break;default:throw"mode:"+r}u.push(e),a=null},f.isDark=function(t,r){if(t<0||i<=t||r<0||i<=r)throw t+","+r;return o[t][r]},f.getModuleCount=function(){return i},f.make=function(){if(e<1){for(var t=1;t<40;t++){for(var r=A.getRSBlocks(t,n),o=b(),i=0;i<u.length;i++){var a=u[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var g=0;for(i=0;i<r.length;i++)g+=r[i].dataCount;if(o.getLengthInBits()<=8*g)break}e=t}c(!1,function(){for(var t=0,r=0,e=0;e<8;e+=1){c(!0,e);var n=B.getLostPoint(f);(0==e||t>n)&&(t=n,r=e)}return r}())},f.createTableTag=function(t,r){t=t||2;var e="";e+='<table style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: "+(r=void 0===r?4*t:r)+"px;",e+='">',e+="<tbody>";for(var n=0;n<f.getModuleCount();n+=1){e+="<tr>";for(var o=0;o<f.getModuleCount();o+=1)e+='<td style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: 0px;",e+=" width: "+t+"px;",e+=" height: "+t+"px;",e+=" background-color: ",e+=f.isDark(n,o)?"#000000":"#ffffff",e+=";",e+='"/>';e+="</tr>"}return e+="</tbody>",e+="</table>"},f.createSvgTag=function(t,r,e,n){var o={};"object"==typeof arguments[0]&&(t=(o=arguments[0]).cellSize,r=o.margin,e=o.alt,n=o.title),t=t||2,r=void 0===r?4*t:r,(e="string"==typeof e?{text:e}:e||{}).text=e.text||null,e.id=e.text?e.id||"qrcode-description":null,(n="string"==typeof n?{text:n}:n||{}).text=n.text||null,n.id=n.text?n.id||"qrcode-title":null;var i,a,u,c,g=f.getModuleCount()*t+2*r,l="";for(c="l"+t+",0 0,"+t+" -"+t+",0 0,-"+t+"z ",l+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',l+=o.scalable?"":' width="'+g+'px" height="'+g+'px"',l+=' viewBox="0 0 '+g+" "+g+'" ',l+=' preserveAspectRatio="xMinYMin meet"',l+=n.text||e.text?' role="img" aria-labelledby="'+y([n.id,e.id].join(" ").trim())+'"':"",l+=">",l+=n.text?'<title id="'+y(n.id)+'">'+y(n.text)+"</title>":"",l+=e.text?'<description id="'+y(e.id)+'">'+y(e.text)+"</description>":"",l+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',l+='<path d="',a=0;a<f.getModuleCount();a+=1)for(u=a*t+r,i=0;i<f.getModuleCount();i+=1)f.isDark(a,i)&&(l+="M"+(i*t+r)+","+u+c);return l+='" stroke="transparent" fill="black"/>',l+="</svg>"},f.createDataURL=function(t,r){t=t||2,r=void 0===r?4*t:r;var e=f.getModuleCount()*t+2*r,n=r,o=e-r;return I(e,e,function(r,e){if(n<=r&&r<o&&n<=e&&e<o){var i=Math.floor((r-n)/t),a=Math.floor((e-n)/t);return f.isDark(a,i)?0:1}return 1})},f.createImgTag=function(t,r,e){t=t||2,r=void 0===r?4*t:r;var n=f.getModuleCount()*t+2*r,o="";return o+="<img",o+=' src="',o+=f.createDataURL(t,r),o+='"',o+=' width="',o+=n,o+='"',o+=' height="',o+=n,o+='"',e&&(o+=' alt="',o+=y(e),o+='"'),o+="/>"};var y=function(t){for(var r="",e=0;e<t.length;e+=1){var n=t.charAt(e);switch(n){case"<":r+="&lt;";break;case">":r+="&gt;";break;case"&":r+="&amp;";break;case'"':r+="&quot;";break;default:r+=n}}return r};return f.createASCII=function(t,r){if((t=t||1)<2)return function(t){t=void 0===t?2:t;var r,e,n,o,i,a=1*f.getModuleCount()+2*t,u=t,c=a-t,g={"██":"█","█ ":"▀"," █":"▄","  ":" "},l={"██":"▀","█ ":"▀"," █":" ","  ":" "},h="";for(r=0;r<a;r+=2){for(n=Math.floor((r-u)/1),o=Math.floor((r+1-u)/1),e=0;e<a;e+=1)i="█",u<=e&&e<c&&u<=r&&r<c&&f.isDark(n,Math.floor((e-u)/1))&&(i=" "),u<=e&&e<c&&u<=r+1&&r+1<c&&f.isDark(o,Math.floor((e-u)/1))?i+=" ":i+="█",h+=t<1&&r+1>=c?l[i]:g[i];h+="\n"}return a%2&&t>0?h.substring(0,h.length-a-1)+Array(a+1).join("▀"):h.substring(0,h.length-1)}(r);t-=1,r=void 0===r?2*t:r;var e,n,o,i,a=f.getModuleCount()*t+2*r,u=r,c=a-r,g=Array(t+1).join("██"),l=Array(t+1).join("  "),h="",s="";for(e=0;e<a;e+=1){for(o=Math.floor((e-u)/t),s="",n=0;n<a;n+=1)i=1,u<=n&&n<c&&u<=e&&e<c&&f.isDark(o,Math.floor((n-u)/t))&&(i=0),s+=i?g:l;for(o=0;o<t;o+=1)h+=s+"\n"}return h.substring(0,h.length-1)},f.renderTo2dContext=function(t,r){r=r||2;for(var e=f.getModuleCount(),n=0;n<e;n++)for(var o=0;o<e;o++)t.fillStyle=f.isDark(n,o)?"black":"white",t.fillRect(n*r,o*r,r,r)},f};t.stringToBytes=(t.stringToBytesFuncs={default:function(t){for(var r=[],e=0;e<t.length;e+=1){var n=t.charCodeAt(e);r.push(255&n)}return r}}).default,t.createStringToBytes=function(t,r){var e=function(){for(var e=S(t),n=function(){var t=e.read();if(-1==t)throw"eof";return t},o=0,i={};;){var a=e.read();if(-1==a)break;var u=n(),f=n()<<8|n();i[String.fromCharCode(a<<8|u)]=f,o+=1}if(o!=r)throw o+" != "+r;return i}(),n="?".charCodeAt(0);return function(t){for(var r=[],o=0;o<t.length;o+=1){var i=t.charCodeAt(o);if(i<128)r.push(i);else{var a=e[t.charAt(o)];"number"==typeof a?(255&a)==a?r.push(a):(r.push(a>>>8),r.push(255&a)):r.push(n)}}return r}};var r,e,n,o,i,a=1,u=2,f=4,c=8,g={L:1,M:0,Q:3,H:2},l=0,h=1,s=2,v=3,d=4,w=5,p=6,y=7,B=(r=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],e=1335,n=7973,i=function(t){for(var r=0;0!=t;)r+=1,t>>>=1;return r},(o={}).getBCHTypeInfo=function(t){for(var r=t<<10;i(r)-i(e)>=0;)r^=e<<i(r)-i(e);return 21522^(t<<10|r)},o.getBCHTypeNumber=function(t){for(var r=t<<12;i(r)-i(n)>=0;)r^=n<<i(r)-i(n);return t<<12|r},o.getPatternPosition=function(t){return r[t-1]},o.getMaskFunction=function(t){switch(t){case l:return function(t,r){return(t+r)%2==0};case h:return function(t,r){return t%2==0};case s:return function(t,r){return r%3==0};case v:return function(t,r){return(t+r)%3==0};case d:return function(t,r){return(Math.floor(t/2)+Math.floor(r/3))%2==0};case w:return function(t,r){return t*r%2+t*r%3==0};case p:return function(t,r){return(t*r%2+t*r%3)%2==0};case y:return function(t,r){return(t*r%3+(t+r)%2)%2==0};default:throw"bad maskPattern:"+t}},o.getErrorCorrectPolynomial=function(t){for(var r=k([1],0),e=0;e<t;e+=1)r=r.multiply(k([1,C.gexp(e)],0));return r},o.getLengthInBits=function(t,r){if(1<=r&&r<10)switch(t){case a:return 10;case u:return 9;case f:case c:return 8;default:throw"mode:"+t}else if(r<27)switch(t){case a:return 12;case u:return 11;case f:return 16;case c:return 10;default:throw"mode:"+t}else{if(!(r<41))throw"type:"+r;switch(t){case a:return 14;case u:return 13;case f:return 16;case c:return 12;default:throw"mode:"+t}}},o.getLostPoint=function(t){for(var r=t.getModuleCount(),e=0,n=0;n<r;n+=1)for(var o=0;o<r;o+=1){for(var i=0,a=t.isDark(n,o),u=-1;u<=1;u+=1)if(!(n+u<0||r<=n+u))for(var f=-1;f<=1;f+=1)o+f<0||r<=o+f||0==u&&0==f||a==t.isDark(n+u,o+f)&&(i+=1);i>5&&(e+=3+i-5)}for(n=0;n<r-1;n+=1)for(o=0;o<r-1;o+=1){var c=0;t.isDark(n,o)&&(c+=1),t.isDark(n+1,o)&&(c+=1),t.isDark(n,o+1)&&(c+=1),t.isDark(n+1,o+1)&&(c+=1),0!=c&&4!=c||(e+=3)}for(n=0;n<r;n+=1)for(o=0;o<r-6;o+=1)t.isDark(n,o)&&!t.isDark(n,o+1)&&t.isDark(n,o+2)&&t.isDark(n,o+3)&&t.isDark(n,o+4)&&!t.isDark(n,o+5)&&t.isDark(n,o+6)&&(e+=40);for(o=0;o<r;o+=1)for(n=0;n<r-6;n+=1)t.isDark(n,o)&&!t.isDark(n+1,o)&&t.isDark(n+2,o)&&t.isDark(n+3,o)&&t.isDark(n+4,o)&&!t.isDark(n+5,o)&&t.isDark(n+6,o)&&(e+=40);var g=0;for(o=0;o<r;o+=1)for(n=0;n<r;n+=1)t.isDark(n,o)&&(g+=1);return e+=Math.abs(100*g/r/r-50)/5*10},o),C=function(){for(var t=new Array(256),r=new Array(256),e=0;e<8;e+=1)t[e]=1<<e;for(e=8;e<256;e+=1)t[e]=t[e-4]^t[e-5]^t[e-6]^t[e-8];for(e=0;e<255;e+=1)r[t[e]]=e;var n={glog:function(t){if(t<1)throw"glog("+t+")";return r[t]},gexp:function(r){for(;r<0;)r+=255;for(;r>=256;)r-=255;return t[r]}};return n}();function k(t,r){if(void 0===t.length)throw t.length+"/"+r;var e=function(){for(var e=0;e<t.length&&0==t[e];)e+=1;for(var n=new Array(t.length-e+r),o=0;o<t.length-e;o+=1)n[o]=t[o+e];return n}(),n={getAt:function(t){return e[t]},getLength:function(){return e.length},multiply:function(t){for(var r=new Array(n.getLength()+t.getLength()-1),e=0;e<n.getLength();e+=1)for(var o=0;o<t.getLength();o+=1)r[e+o]^=C.gexp(C.glog(n.getAt(e))+C.glog(t.getAt(o)));return k(r,0)},mod:function(t){if(n.getLength()-t.getLength()<0)return n;for(var r=C.glog(n.getAt(0))-C.glog(t.getAt(0)),e=new Array(n.getLength()),o=0;o<n.getLength();o+=1)e[o]=n.getAt(o);for(o=0;o<t.getLength();o+=1)e[o]^=C.gexp(C.glog(t.getAt(o))+r);return k(e,0).mod(t)}};return n}var A=function(){var t=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],r=function(t,r){var e={};return e.totalCount=t,e.dataCount=r,e},e={};return e.getRSBlocks=function(e,n){var o=function(r,e){switch(e){case g.L:return t[4*(r-1)+0];case g.M:return t[4*(r-1)+1];case g.Q:return t[4*(r-1)+2];case g.H:return t[4*(r-1)+3];default:return}}(e,n);if(void 0===o)throw"bad rs block @ typeNumber:"+e+"/errorCorrectionLevel:"+n;for(var i=o.length/3,a=[],u=0;u<i;u+=1)for(var f=o[3*u+0],c=o[3*u+1],l=o[3*u+2],h=0;h<f;h+=1)a.push(r(c,l));return a},e}(),b=function(){var t=[],r=0,e={getBuffer:function(){return t},getAt:function(r){var e=Math.floor(r/8);return 1==(t[e]>>>7-r%8&1)},put:function(t,r){for(var n=0;n<r;n+=1)e.putBit(1==(t>>>r-n-1&1))},getLengthInBits:function(){return r},putBit:function(e){var n=Math.floor(r/8);t.length<=n&&t.push(0),e&&(t[n]|=128>>>r%8),r+=1}};return e},M=function(t){var r=a,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+2<r.length;)t.put(o(r.substring(n,n+3)),10),n+=3;n<r.length&&(r.length-n==1?t.put(o(r.substring(n,n+1)),4):r.length-n==2&&t.put(o(r.substring(n,n+2)),7))}},o=function(t){for(var r=0,e=0;e<t.length;e+=1)r=10*r+i(t.charAt(e));return r},i=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);throw"illegal char :"+t};return n},x=function(t){var r=u,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+1<r.length;)t.put(45*o(r.charAt(n))+o(r.charAt(n+1)),11),n+=2;n<r.length&&t.put(o(r.charAt(n)),6)}},o=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);if("A"<=t&&t<="Z")return t.charCodeAt(0)-"A".charCodeAt(0)+10;switch(t){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+t}};return n},m=function(r){var e=f,n=t.stringToBytes(r),o={getMode:function(){return e},getLength:function(t){return n.length},write:function(t){for(var r=0;r<n.length;r+=1)t.put(n[r],8)}};return o},L=function(r){var e=c,n=t.stringToBytesFuncs.SJIS;if(!n)throw"sjis not supported.";!function(){var t=n("友");if(2!=t.length||38726!=(t[0]<<8|t[1]))throw"sjis not supported."}();var o=n(r),i={getMode:function(){return e},getLength:function(t){return~~(o.length/2)},write:function(t){for(var r=o,e=0;e+1<r.length;){var n=(255&r[e])<<8|255&r[e+1];if(33088<=n&&n<=40956)n-=33088;else{if(!(57408<=n&&n<=60351))throw"illegal char at "+(e+1)+"/"+n;n-=49472}n=192*(n>>>8&255)+(255&n),t.put(n,13),e+=2}if(e<r.length)throw"illegal char at "+(e+1)}};return i},D=function(){var t=[],r={writeByte:function(r){t.push(255&r)},writeShort:function(t){r.writeByte(t),r.writeByte(t>>>8)},writeBytes:function(t,e,n){e=e||0,n=n||t.length;for(var o=0;o<n;o+=1)r.writeByte(t[o+e])},writeString:function(t){for(var e=0;e<t.length;e+=1)r.writeByte(t.charCodeAt(e))},toByteArray:function(){return t},toString:function(){var r="";r+="[";for(var e=0;e<t.length;e+=1)e>0&&(r+=","),r+=t[e];return r+="]"}};return r},S=function(t){var r=t,e=0,n=0,o=0,i={read:function(){for(;o<8;){if(e>=r.length){if(0==o)return-1;throw"unexpected end of file./"+o}var t=r.charAt(e);if(e+=1,"="==t)return o=0,-1;t.match(/^\s$/)||(n=n<<6|a(t.charCodeAt(0)),o+=6)}var i=n>>>o-8&255;return o-=8,i}},a=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(43==t)return 62;if(47==t)return 63;throw"c:"+t};return i},I=function(t,r,e){for(var n=function(t,r){var e=t,n=r,o=new Array(t*r),i={setPixel:function(t,r,n){o[r*e+t]=n},write:function(t){t.writeString("GIF87a"),t.writeShort(e),t.writeShort(n),t.writeByte(128),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(255),t.writeByte(255),t.writeByte(255),t.writeString(","),t.writeShort(0),t.writeShort(0),t.writeShort(e),t.writeShort(n),t.writeByte(0);var r=a(2);t.writeByte(2);for(var o=0;r.length-o>255;)t.writeByte(255),t.writeBytes(r,o,255),o+=255;t.writeByte(r.length-o),t.writeBytes(r,o,r.length-o),t.writeByte(0),t.writeString(";")}},a=function(t){for(var r=1<<t,e=1+(1<<t),n=t+1,i=u(),a=0;a<r;a+=1)i.add(String.fromCharCode(a));i.add(String.fromCharCode(r)),i.add(String.fromCharCode(e));var f,c,g,l=D(),h=(f=l,c=0,g=0,{write:function(t,r){if(t>>>r!=0)throw"length over";for(;c+r>=8;)f.writeByte(255&(t<<c|g)),r-=8-c,t>>>=8-c,g=0,c=0;g|=t<<c,c+=r},flush:function(){c>0&&f.writeByte(g)}});h.write(r,n);var s=0,v=String.fromCharCode(o[s]);for(s+=1;s<o.length;){var d=String.fromCharCode(o[s]);s+=1,i.contains(v+d)?v+=d:(h.write(i.indexOf(v),n),i.size()<4095&&(i.size()==1<<n&&(n+=1),i.add(v+d)),v=d)}return h.write(i.indexOf(v),n),h.write(e,n),h.flush(),l.toByteArray()},u=function(){var t={},r=0,e={add:function(n){if(e.contains(n))throw"dup key:"+n;t[n]=r,r+=1},size:function(){return r},indexOf:function(r){return t[r]},contains:function(r){return void 0!==t[r]}};return e};return i}(t,r),o=0;o<r;o+=1)for(var i=0;i<t;i+=1)n.setPixel(i,o,e(i,o));var a=D();n.write(a);for(var u=function(){var t=0,r=0,e=0,n="",o={},i=function(t){n+=String.fromCharCode(a(63&t))},a=function(t){if(t<0);else{if(t<26)return 65+t;if(t<52)return t-26+97;if(t<62)return t-52+48;if(62==t)return 43;if(63==t)return 47}throw"n:"+t};return o.writeByte=function(n){for(t=t<<8|255&n,r+=8,e+=1;r>=6;)i(t>>>r-6),r-=6},o.flush=function(){if(r>0&&(i(t<<6-r),t=0,r=0),e%3!=0)for(var o=3-e%3,a=0;a<o;a+=1)n+="="},o.toString=function(){return n},o}(),f=a.toByteArray(),c=0;c<f.length;c+=1)u.writeByte(f[c]);return u.flush(),"data:image/gif;base64,"+u};return t}();qrcode.stringToBytesFuncs["UTF-8"]=function(t){return function(t){for(var r=[],e=0;e<t.length;e++){var n=t.charCodeAt(e);n<128?r.push(n):n<2048?r.push(192|n>>6,128|63&n):n<55296||n>=57344?r.push(224|n>>12,128|n>>6&63,128|63&n):(e++,n=65536+((1023&n)<<10|1023&t.charCodeAt(e)),r.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|63&n))}return r}(t)},function(t){"function"==typeof define&&define.amd?define([],t):"object"==typeof exports&&(module.exports=t())}(function(){return qrcode});


;
/*
 * Synthetic demo data. Every name, phone number and amount below is invented.
 * Dates are generated relative to "today", so the demo always looks current.
 * Runs on top of the REAL server code (apps-script/*.gs) and the emulator in gas-emulator.js.
 */
function seedDemo() {
  'use strict';
  var DAY = 86400000;
  var rnd = (function (s) { return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })(20261026);
  var hoyIso = isoHoy_();
  var T = Date.UTC(+hoyIso.slice(0, 4), +hoyIso.slice(5, 7) - 1, +hoyIso.slice(8, 10));
  var isoDe = function (off) { return Utilities.formatDate(new Date(T + off * DAY), 'UTC', 'yyyy-MM-dd'); };
  var dateDe = function (off) { return new Date(T + off * DAY + 12 * 3600000); };
  var dow = function (off) { return (new Date(T + off * DAY).getUTCDay() + 6) % 7; };   // 0 = Monday

  // ---- project setup (creates the sheets exactly like the real setup() does) ----
  // (the real setup() also touches Drive/Slides, which the demo does not have, so its sheet steps are repeated here)
  var ss0 = SpreadsheetApp.getActive();
  var hojaA = ss0.insertSheet(CFG.HOJA_ALUMNOS, 0); prepararHojaAlumnos_(hojaA);
  var hojaC = ss0.insertSheet(CFG.HOJA_CONFIG);
  hojaC.getRange(1, 1, 4, 3).setValues([['Clave', 'Valor', 'Qué es'], ['PLANTILLA_ID', '', ''], ['CARPETA_PDF_ID', '', ''], ['WEBAPP_URL', '', '']]);
  asegurarHojaSugerencias_(); asegurarHojaLogros_(); asegurarHojaAsistencia_(); asegurarColumnasAsistencia_(); asegurarHojaRenovaciones_();
  escribirConfig_('PAGINA_URL', (typeof location !== 'undefined' ? location.origin + location.pathname.replace(/[^/]*$/, '') : 'https://demo.example/') + 'card/');
  escribirConfig_('COACH_CLAVE', 'DEMOCOACHKEY0123456789ABC');
  escribirConfig_('PCT_PARTNER', '40');
  escribirConfig_('PCT_COACH', '80');
  PropertiesService.getScriptProperties().setProperty('PUERTA_SECRETO', 'demo-only-door-secret-not-a-real-one');

  var alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  var col = mapaColumnas_(alumnos);
  var ALF = CFG.ALFABETO_ID, usados = {};
  function nuevoId() { var id; do { id = CFG.PREFIJO_ID; for (var i = 0; i < CFG.LARGO_ID; i++) id += ALF.charAt(Math.floor(rnd() * ALF.length)); } while (usados[id]); usados[id] = 1; return id; }

  // name, plan, days since the current period started, attendance probability, instructor, schedule, previous periods
  var specs = [
    ['Alex Rivera',        'Mensual',            12, 0.95, 'Coach', 'Lun–Vie 19:00', 2],
    ['Camila Torres',      '3 veces por semana', 20, 0.80, '',      'Lun–Vie 07:00', 2],
    ['Mateo Salinas',      'Mensual',            27, 0.85, '',      'Lun–Vie 18:00', 1],
    ['Valeria Quiroga',    'Trimestral',         40, 0.90, 'Coach', 'Lun–Vie 06:30', 0],
    ['Diego Paredes',      'Mensual',            29, 0.75, '',      'Lun–Vie 20:00', 3],
    ['Lucía Mendoza',      'Mensual',            30, 0.70, 'Coach', 'Lun–Vie 19:00', 1],
    ['Sofía Aguilar',      '3 veces por semana', 32, 0.75, '',      'Lun–Vie 07:00', 2],
    ['Andrés Rojas',       'Mensual',            42, 0.55, '',      'Lun–Vie 21:00', 1],
    ['Valentina Cruz',     'Trimestral',         70, 0.60, '',      'Lun–Vie 08:00', 0],
    ['Joaquín Vega',       'Mensual',             5, 1.00, '',      'Lun–Vie 18:00', 0],
    ['Renata Flores',      '3 veces por semana', 15, 0.85, 'Coach', 'Lun–Vie 19:00', 1],
    ['Bruno Castro',       'Mensual',            25, 0.90, 'Coach', 'Lun–Vie 06:30', 4],
    ['Isabela Montes',     'Mensual',             3, 1.00, '',      'Lun–Vie 07:00', 0],
    ['Tomás Gutiérrez',    '3 veces por semana', 23, 0.80, '',      'Lun–Vie 20:00', 2],
    ['Demo Staff',         'Mensual',             0, 0.50, 'Coach', 'Libre',         0],
    ['Demo Trial User',    'Mensual',             2, 0.50, '',      'Libre',         0]
  ];
  var precio = { 'Mensual': 100, '3 veces por semana': 80, 'Trimestral': 270 };
  var diasPlan = { 'Mensual': 30, '3 veces por semana': 30, 'Trimestral': 90 };

  var rowsA = [], rowsR = [], asis = [], feriados = feriados_();
  specs.forEach(function (sp, i) {
    var id = nuevoId(), nombre = sp[0], plan = sp[1], ini = -sp[2], fin = ini + diasPlan[plan] - 1;
    var tel = '7000' + ('0000' + (i + 1)).slice(-4);
    var staff = nombre === 'Demo Staff', prueba = nombre === 'Demo Trial User';
    var fila = []; for (var c = 0; c < alumnos.getLastColumn(); c++) fila.push('');
    fila[col['ID']] = id; fila[col['Nombre']] = nombre; fila[col['Teléfono']] = tel; fila[col['Plan']] = plan;
    fila[col['Fecha inicio']] = dateDe(ini); fila[col['Fecha fin']] = staff ? new Date(Date.UTC(2099, 11, 31, 12)) : dateDe(fin);
    fila[col['Horario']] = sp[5]; fila[col['Instructor']] = sp[4];
    fila[col['Notas internas']] = staff ? 'STAFF' : (prueba ? 'PRUEBA · demo trial — 3-day pass' : '');
    rowsA.push({ fila: fila, id: id });
    sp.id = id; sp.tel = tel;

    // payments: previous periods + current one (none for staff / trial users)
    if (!staff && !prueba) {
      for (var k = sp[6]; k >= 0; k--) {
        var pIni = ini - k * diasPlan[plan], pFin = pIni + diasPlan[plan] - 1;
        var esPrimero = (k === sp[6]);
        var tipo = esPrimero ? 'Inscripción' : 'Renovación';
        rowsR.push([id, nombre, tel, dateDe(pIni), dateDe(pIni), dateDe(pFin), plan, precio[plan], tipo, sp[4]]);
      }
    }
    // attendance
    var desde = Math.max(ini - (sp[6] * diasPlan[plan]), -75);
    for (var off = desde; off <= 0; off++) {
      var iso = isoDe(off), d = dow(off);
      if (d > 4 || feriados[iso]) continue;
      var vigente = false;
      for (var kk = sp[6]; kk >= 0; kk--) { var a0 = ini - kk * diasPlan[plan], a1 = a0 + diasPlan[plan] - 1; if (off >= a0 && off <= a1) vigente = true; }
      if (!vigente && !staff) continue;
      var p = sp[3];
      if (plan === '3 veces por semana') p = 0.6;
      if (rnd() < p) {
        var h = 6 + Math.floor(rnd() * 15);
        asis.push([iso, ('0' + h).slice(-2) + ':' + ('0' + Math.floor(rnd() * 60)).slice(-2), id, nombre, iso.slice(0, 7)]);
      }
    }
  });

  rowsA.forEach(function (r, i) { alumnos.getRange(i + 2, 1, 1, r.fila.length).setValues([r.fila]); });
  var hR = asegurarHojaRenovaciones_();
  rowsR.forEach(function (r, i) { hR.getRange(i + 2, 1, 1, 10).setValues([r]); });
  var hAs = asegurarHojaAsistencia_();
  asis.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  asis.forEach(function (r, i) { hAs.getRange(i + 2, 1, 1, 5).setNumberFormat('@').setValues([r]); });

  // last visit per student (like the live system keeps it)
  var ult = {}; asis.forEach(function (r) { ult[r[2]] = r[0]; });
  var cU = col[CFG.COL_ULTIMA_VISITA];
  if (cU !== undefined) rowsA.forEach(function (r, i) { if (ult[r.id]) alumnos.getRange(i + 2, cU + 1).setValue(ult[r.id].slice(8, 10) + '/' + ult[r.id].slice(5, 7) + '/' + ult[r.id].slice(0, 4)); });

  // goals + training log for the first student, through the real handlers
  var alex = specs[0].id;
  try {
    manejarLogros_(alex, { accion: 'logros_crear', metas: ['10 strict pull-ups', 'Hold a 30 s handstand', 'First muscle-up'] });
    manejarApuntes_(alex, { accion: 'apuntes_crear', fecha: hoyIso, ejercicio: 'Pull-ups', intensidad: 'Weighted +5 kg', reps: '5x6', notas: 'Felt strong, add 2.5 kg next week' });
  } catch (e) { /* optional */ }

  return { students: specs.map(function (s) { return { id: s.id, nombre: s[0], tel: s.tel, plan: s[1] }; }) };
}

;
/*
 * Demo glue: seeds the in-memory sheet and routes the front-ends' calls to the REAL server code.
 *  - fetch(API_URL…)           -> doGet-style lookups and doPost (card + instructor app)
 *  - google.script.run.<fn>()  -> the owner panel and the door screen
 * Loaded after gas-emulator.js, the apps-script/*.gs files and seed.js.
 */
(function () {
  'use strict';
  var SEEDED = seedDemo();
  window.DEMO_STUDENTS = SEEDED.students;

  /* --- fetch shim --- */
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    var API = (window.KALOS_CONFIG || {}).API_URL || '';
    if (typeof url === 'string' && API && url.indexOf(API) === 0) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var out;
          try {
            if (!opts || !opts.method || opts.method === 'GET') {
              var q = new URL(url).searchParams;
              out = q.get('format') === 'json' ? consultar_(normalizarId_(q.get('id') || '')) : { ok: false };
            } else {
              out = JSON.parse(doPost({ postData: { contents: opts.body } }).getContent());
            }
          } catch (e) { out = { ok: false, error: 'demo' }; }
          resolve(new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }, 140);
      });
    }
    return realFetch ? realFetch(url, opts) : Promise.reject(new Error('offline'));
  };

  /* --- google.script.run shim --- */
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (t, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          setTimeout(function () {
            try {
              var fn = window[name];
              if (typeof fn !== 'function') throw new Error('Unknown server function: ' + name);
              var r = fn.apply(null, args);
              if (ok) ok(r === undefined ? undefined : JSON.parse(JSON.stringify(r)));
            } catch (e) { if (fail) fail({ message: String(e && e.message || e) }); else if (window.console) console.error(e); }
          }, 160);
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };

  /* --- "DEMO" strip on every page --- */
  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.setAttribute('role', 'note');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#111;color:#cfe8d5;font:12px/1.3 system-ui,sans-serif;padding:7px 12px;text-align:center;border-top:1px solid #3CE86B;';
    var a = document.createElement('a');
    a.href = (window.DEMO_HOME || '../'); a.textContent = '← demo home'; a.style.cssText = 'color:#3CE86B;margin-right:10px;text-decoration:none';
    bar.appendChild(a);
    bar.appendChild(document.createTextNode('DEMO · synthetic data only · nothing is saved · the real server code runs in your browser'));
    document.body.appendChild(bar);
    document.body.style.paddingBottom = '36px';
  });
})();
