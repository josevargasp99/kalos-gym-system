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
