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
