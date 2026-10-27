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
