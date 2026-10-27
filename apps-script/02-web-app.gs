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
