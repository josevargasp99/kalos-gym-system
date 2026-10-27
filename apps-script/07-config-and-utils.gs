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
