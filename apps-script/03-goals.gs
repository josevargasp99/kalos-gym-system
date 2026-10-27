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
