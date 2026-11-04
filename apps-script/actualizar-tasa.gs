/**
 * Tasa BCV automática — actualiza tasa_bs en la pestaña "config" con la
 * tasa oficial del BCV, sin cambiar cómo el menú (menu.html / menú1.html)
 * lee los datos: el menú sigue leyendo solo la clave tasa_bs.
 *
 * Instalación: Extensiones → Apps Script en la hoja de Google, pega este
 * archivo, guarda, recarga la hoja. Aparecerá el menú "Tasa BCV".
 *
 * Ver la sección "Tasa BCV automática" del README del repositorio para
 * instrucciones de uso dirigidas al dueño del negocio.
 */

// ===== CONFIGURACIÓN (ajustar aquí si algo cambia) =====

// Fuente del dato: servicio público de terceros que toma la tasa del BCV.
// No requiere clave. Si esta URL deja de funcionar, hay que reemplazarla.
const TASA_BCV_API_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';
// Campo principal a usar, y campo de respaldo si el principal viene vacío/nulo.
const TASA_BCV_CAMPO_PRINCIPAL = 'promedio';
const TASA_BCV_CAMPO_RESPALDO = 'venta';

// Rechaza un salto mayor a este porcentaje respecto a la tasa actual.
const TASA_BCV_SALTO_MAXIMO_PORCENTAJE = 20;

// Horas (hora de Caracas) del disparador diario y su reintento.
const TASA_BCV_HORA_PRINCIPAL = 6;
const TASA_BCV_HORA_REINTENTO = 9;

const TASA_BCV_ZONA_HORARIA = 'America/Caracas';
const TASA_BCV_NOMBRE_HOJA_CONFIG = 'config';
const TASA_BCV_NOMBRE_HOJA_LOG = 'log_tasa';
const TASA_BCV_NOMBRE_FUNCION_DISPARADOR = 'actualizarTasa';

// Texto que ve el dueño si intenta editar tasa_bs a mano estando en
// automático. Sirve también para identificar (por su descripción) cuál
// protección de la celda puso este script, y no tocar otras que hubiera.
const TASA_BCV_DESCRIPCION_PROTECCION =
  'Esta celda se actualiza sola. Para editarla a mano, cambia "tasa_automatica" a NO en esta misma pestaña y, cuando termines, vuelve a ponerlo en SI.';

// ===== MENÚ DENTRO DE LA HOJA =====

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tasa BCV')
    .addItem('Activar tasa automática', 'activarTasaAutomaticaDesdeMenu')
    .addItem('Actualizar tasa ahora', 'actualizarTasaDesdeMenu')
    .addToUi();
}

function activarTasaAutomaticaDesdeMenu() {
  const ui = SpreadsheetApp.getUi();
  try {
    crearDisparadores_();
    const sheet = obtenerHojaConfig_();
    const mapa = leerMapaConfig_(sheet);
    escribirValorConfig_(sheet, mapa, 'tasa_automatica', 'SI',
      'Si está en SI, la tasa_bs se actualiza sola cada mañana con la tasa oficial del BCV. Si está en NO, tasa_bs se edita a mano.');
    aplicarProteccionTasaBs_(sheet, mapa, true);
    ui.alert('Listo', 'La tasa automática quedó activada. Se actualizará todos los días a las ' +
      TASA_BCV_HORA_PRINCIPAL + ':00 a. m. (con un reintento a las ' + TASA_BCV_HORA_REINTENTO + ':00 a. m.), hora de Caracas. ' +
      'La celda tasa_bs queda protegida mientras esté en automático: para editarla a mano, primero cambia tasa_automatica a NO.',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('No se pudo activar', 'Ocurrió un error: ' + err.message, ui.ButtonSet.OK);
  }
}

function actualizarTasaDesdeMenu() {
  const ui = SpreadsheetApp.getUi();
  try {
    const resultado = actualizarTasa();
    ui.alert('Tasa BCV', resultado, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('No se pudo actualizar', 'Ocurrió un error: ' + err.message, ui.ButtonSet.OK);
  }
}

// Borra disparadores previos de actualizarTasa (para no duplicarlos si se
// activa más de una vez) y crea los dos nuevos: hora principal y reintento.
function crearDisparadores_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === TASA_BCV_NOMBRE_FUNCION_DISPARADOR) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(TASA_BCV_NOMBRE_FUNCION_DISPARADOR)
    .timeBased()
    .atHour(TASA_BCV_HORA_PRINCIPAL)
    .everyDays(1)
    .inTimezone(TASA_BCV_ZONA_HORARIA)
    .create();

  ScriptApp.newTrigger(TASA_BCV_NOMBRE_FUNCION_DISPARADOR)
    .timeBased()
    .atHour(TASA_BCV_HORA_REINTENTO)
    .everyDays(1)
    .inTimezone(TASA_BCV_ZONA_HORARIA)
    .create();
}

// ===== ACTUALIZACIÓN DE LA TASA =====

// Punto de entrada tanto del disparador diario como del menú "Actualizar
// tasa ahora". Devuelve un texto corto con el resultado (para mostrarlo
// en el menú); el registro completo queda en tasa_actualizada.
function actualizarTasa() {
  const sheet = obtenerHojaConfig_();
  const mapa = leerMapaConfig_(sheet);
  asegurarFilasBase_(sheet, mapa);

  const automatica = normalizarSiNo_(obtenerValorConfig_(sheet, mapa, 'tasa_automatica'));
  aplicarProteccionTasaBs_(sheet, mapa, automatica);
  if (!automatica) {
    return 'La tasa automática está en NO: no se tocó tasa_bs.';
  }

  let nuevaTasa;
  try {
    nuevaTasa = obtenerTasaDesdeAPI_();
  } catch (err) {
    registrarResultado_(sheet, mapa, 'error de conexión, se mantiene la anterior');
    return 'No se pudo consultar la tasa (error de conexión). Se mantiene la tasa anterior.';
  }

  if (nuevaTasa == null || isNaN(nuevaTasa) || nuevaTasa <= 0) {
    registrarResultado_(sheet, mapa, 'error de conexión, se mantiene la anterior');
    return 'La tasa recibida no es válida. Se mantiene la tasa anterior.';
  }

  const tasaActualRaw = obtenerValorConfig_(sheet, mapa, 'tasa_bs');
  const tasaActual = parsearNumeroVenezolano_(tasaActualRaw);

  if (!isNaN(tasaActual) && tasaActual > 0) {
    const saltoPorcentaje = Math.abs(nuevaTasa - tasaActual) / tasaActual * 100;
    if (saltoPorcentaje > TASA_BCV_SALTO_MAXIMO_PORCENTAJE) {
      registrarResultado_(sheet, mapa, `valor rechazado por salto mayor al ${TASA_BCV_SALTO_MAXIMO_PORCENTAJE} %`);
      return `La nueva tasa (${nuevaTasa}) difiere demasiado de la actual (${tasaActual}). No se escribió; revísala a mano si es correcta.`;
    }
  }

  const nuevaTasaRedondeada = Math.round(nuevaTasa * 100) / 100;

  if (!isNaN(tasaActual) && Math.round(tasaActual * 100) / 100 === nuevaTasaRedondeada) {
    registrarResultado_(sheet, mapa, 'sin cambios');
    return `La tasa sigue igual (${nuevaTasaRedondeada}). No hubo cambios.`;
  }

  escribirTasaBs_(sheet, mapa, nuevaTasaRedondeada);
  registrarResultado_(sheet, mapa, `actualizada a ${formatearNumeroVenezolano_(nuevaTasaRedondeada)}`);
  return `Tasa actualizada a ${formatearNumeroVenezolano_(nuevaTasaRedondeada)}.`;
}

// Consulta la API y devuelve el número de tasa (sin redondear todavía).
// Lanza una excepción si la respuesta no es válida (red caída, HTTP de
// error, JSON mal formado): quien llama decide qué hacer con eso.
function obtenerTasaDesdeAPI_() {
  const response = UrlFetchApp.fetch(TASA_BCV_API_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('La API respondió con código ' + response.getResponseCode());
  }
  const data = JSON.parse(response.getContentText());
  let valor = data[TASA_BCV_CAMPO_PRINCIPAL];
  if (valor == null) valor = data[TASA_BCV_CAMPO_RESPALDO];
  return parseFloat(valor);
}

// Escribe tasa_bs forzando el formato de celda a números simples sin
// separador de miles (0.00), para que el CSV publicado siempre tenga un
// solo separador decimal — así el menú (que solo reemplaza una coma por
// un punto al leer tasa_bs) nunca se rompe, sin importar que la tasa siga
// subiendo y pase de 4 cifras.
function escribirTasaBs_(sheet, mapa, valorNumerico) {
  const fila = mapa.filas['tasa_bs'];
  if (!fila) {
    agregarFilaConfig_(sheet, mapa, 'tasa_bs', valorNumerico,
      'Tasa de cambio para mostrar precios en bolívares. Se actualiza sola si tasa_automatica está en SI.');
    return;
  }
  const celda = sheet.getRange(fila, mapa.colValor + 1);
  celda.setNumberFormat('0.00');
  celda.setValue(valorNumerico);
}

function registrarResultado_(sheet, mapa, estadoTexto) {
  const fechaHora = Utilities.formatDate(new Date(), TASA_BCV_ZONA_HORARIA, 'dd/MM/yyyy HH:mm');
  escribirValorConfig_(sheet, mapa, 'tasa_actualizada', `${fechaHora} · ${estadoTexto}`,
    'Registro de la última actualización automática de tasa_bs (fecha, hora y resultado). Lo escribe el script, no lo edites a mano.');
}

// ===== PROTECCIÓN DE LA CELDA tasa_bs MIENTRAS ESTÉ EN AUTOMÁTICO =====
// Bloquea la edición manual de tasa_bs cuando tasa_automatica está en SI
// (para evitar que alguien la pise sin darse cuenta de que el script la va
// a volver a sobrescribir), y la libera apenas se pasa a NO. El propio
// script (que corre con la cuenta que lo activó) siempre puede seguir
// escribiéndola: la protección solo afecta la edición manual desde la hoja.

function aplicarProteccionTasaBs_(sheet, mapa, activar) {
  const fila = mapa.filas['tasa_bs'];
  if (!fila) return;
  const celda = sheet.getRange(fila, mapa.colValor + 1);

  // Quita cualquier protección que este mismo script haya puesto antes
  // (identificada por su descripción), para no ir acumulando duplicados
  // cada vez que se activa o corre de nuevo. Se revisan las protecciones
  // de toda la hoja (no solo las de esta celda) porque es el método que
  // realmente existe en la API de Apps Script.
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(proteccion => {
    if (proteccion.getDescription() === TASA_BCV_DESCRIPCION_PROTECCION) {
      proteccion.remove();
    }
  });

  // La nota (el triangulito en la esquina de la celda) es independiente de
  // la protección: se ve igual en la app móvil de Sheets y en el navegador,
  // a diferencia del aviso (toast), que en el celular puede no mostrarse.
  // Por eso queda como la explicación principal; el toast es un refuerzo
  // extra para quien lo vea desde la computadora.
  celda.setNote(activar ? TASA_BCV_DESCRIPCION_PROTECCION : '');

  if (!activar) return;

  const proteccion = celda.protect().setDescription(TASA_BCV_DESCRIPCION_PROTECCION);
  // Deja la celda editable solo por quien creó la protección (la cuenta
  // que activó la tasa automática); nadie más puede escribirla a mano.
  if (proteccion.canDomainEdit()) proteccion.setDomainEdit(false);
  const editoresActuales = proteccion.getEditors();
  if (editoresActuales.length > 0) proteccion.removeEditors(editoresActuales);
}

// Disparador simple (se instala solo, sin pedir permisos extra) con dos
// trabajos:
//
// 1. Si alguien edita tasa_bs directo mientras está en automático, revierte
//    el valor al instante. Esto es necesario además de la protección de
//    aplicarProteccionTasaBs_() porque Google Sheets nunca permite que una
//    protección bloquee al Propietario del archivo (así está diseñado:
//    nadie puede quedar bloqueado de su propio archivo) — el Propietario
//    siempre podría editarla igual sin este refuerzo.
// 2. Si alguien edita tasa_automatica a mano, ajusta la protección de
//    tasa_bs de inmediato, y si pasó a NO, recuerda volver a ponerlo en SI
//    (pensado para una corrección puntual de emergencia que después se
//    olvide revertir).
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== TASA_BCV_NOMBRE_HOJA_CONFIG) return;

    const mapa = leerMapaConfig_(sheet);

    const filaTasaBs = mapa.filas['tasa_bs'];
    if (filaTasaBs && e.range.getRow() === filaTasaBs && e.range.getColumn() === mapa.colValor + 1) {
      if (normalizarSiNo_(obtenerValorConfig_(sheet, mapa, 'tasa_automatica'))) {
        if (e.oldValue !== undefined) {
          e.range.setValue(e.oldValue);
        }
        sheet.getParent().toast(
          'tasa_bs no se puede editar a mano mientras "tasa_automatica" esté en SI (ni como Propietario: Sheets no permite bloquear al dueño del archivo). Cambia "tasa_automatica" a NO primero.',
          'Celda protegida', 10
        );
      }
      return;
    }

    const filaAutomatica = mapa.filas['tasa_automatica'];
    if (!filaAutomatica) return;
    if (e.range.getRow() !== filaAutomatica || e.range.getColumn() !== mapa.colValor + 1) return;

    const automatica = normalizarSiNo_(e.value);
    aplicarProteccionTasaBs_(sheet, mapa, automatica);

    if (!automatica) {
      sheet.getParent().toast(
        'Cuando termines de corregir la tasa a mano, vuelve a poner "tasa_automatica" en SI para que la actualización automática siga funcionando.',
        'Modo manual activado', 10
      );
    }
  } catch (err) {
    // Un disparador simple no debe interrumpir la edición del usuario con
    // un error visible; si algo falla aquí, la próxima corrida de
    // actualizarTasa() vuelve a dejar la protección en el estado correcto.
  }
}

// ===== LECTURA/ESCRITURA GENÉRICA DE LA PESTAÑA "config" =====
// (clave/valor por nombre de columna, igual que lo lee el menú: el orden
// de las columnas no importa, solo que existan los encabezados clave y
// valor; "ayuda" es opcional y el menú nunca la lee.)

function obtenerHojaConfig_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TASA_BCV_NOMBRE_HOJA_CONFIG);
  if (!sheet) throw new Error(`No se encontró la pestaña "${TASA_BCV_NOMBRE_HOJA_CONFIG}".`);
  return sheet;
}

// Devuelve { colClave, colValor, colAyuda, filas: { clave_minuscula: numeroDeFila } }
// con columnas e índices base 0 (relativos al encabezado) y filas en base 1
// (tal como las espera sheet.getRange).
function leerMapaConfig_(sheet) {
  const datos = sheet.getDataRange().getValues();
  if (datos.length === 0) throw new Error('La pestaña "config" está vacía.');

  const encabezado = datos[0].map(h => String(h).trim().toLowerCase());
  const colClave = encabezado.indexOf('clave');
  const colValor = encabezado.indexOf('valor');
  const colAyuda = encabezado.indexOf('ayuda');
  if (colClave === -1 || colValor === -1) {
    throw new Error('La pestaña "config" no tiene las columnas "clave" y "valor".');
  }

  const filas = {};
  for (let i = 1; i < datos.length; i++) {
    const clave = String(datos[i][colClave] || '').trim().toLowerCase();
    if (clave) filas[clave] = i + 1; // +1: getRange es base 1
  }

  return { colClave, colValor, colAyuda, totalFilas: datos.length, filas };
}

function obtenerValorConfig_(sheet, mapa, clave) {
  const fila = mapa.filas[clave];
  if (!fila) return '';
  return String(sheet.getRange(fila, mapa.colValor + 1).getValue() || '').trim();
}

// Escribe el valor de una clave existente, o agrega la fila si no existe.
function escribirValorConfig_(sheet, mapa, clave, valor, ayudaSiEsNueva) {
  const fila = mapa.filas[clave];
  if (fila) {
    sheet.getRange(fila, mapa.colValor + 1).setValue(valor);
  } else {
    agregarFilaConfig_(sheet, mapa, clave, valor, ayudaSiEsNueva);
  }
}

// Agrega una fila nueva al final de "config" respetando el orden real de
// columnas de la hoja (clave/valor/ayuda, detectadas por encabezado).
function agregarFilaConfig_(sheet, mapa, clave, valor, ayuda) {
  const nuevaFila = mapa.totalFilas + 1;
  const numColumnas = Math.max(mapa.colClave, mapa.colValor, mapa.colAyuda) + 1;
  const fila = new Array(numColumnas).fill('');
  fila[mapa.colClave] = clave;
  fila[mapa.colValor] = valor;
  if (mapa.colAyuda !== -1 && ayuda) fila[mapa.colAyuda] = ayuda;
  sheet.getRange(nuevaFila, 1, 1, numColumnas).setValues([fila]);

  // Mantiene el mapa en memoria al día por si se agregan varias filas en
  // la misma ejecución (tasa_automatica y tasa_actualizada, por ejemplo).
  mapa.filas[clave] = nuevaFila;
  mapa.totalFilas = nuevaFila;
}

// Crea tasa_automatica (en NO) y tasa_actualizada (vacía) si todavía no
// existen en "config", sin pisar el valor si ya estaban. Se llama al
// inicio de cada ejecución para que ambas filas siempre existan, aunque
// el dueño nunca haya abierto el menú "Tasa BCV".
function asegurarFilasBase_(sheet, mapa) {
  if (!mapa.filas['tasa_automatica']) {
    agregarFilaConfig_(sheet, mapa, 'tasa_automatica', 'NO',
      'Si está en SI, la tasa_bs se actualiza sola cada mañana con la tasa oficial del BCV. Si está en NO, tasa_bs se edita a mano.');
  }
  if (!mapa.filas['tasa_actualizada']) {
    agregarFilaConfig_(sheet, mapa, 'tasa_actualizada', '',
      'Registro de la última actualización automática de tasa_bs (fecha, hora y resultado). Lo escribe el script, no lo edites a mano.');
  }
}

// ===== UTILIDADES DE TEXTO Y NÚMEROS =====

function normalizarSiNo_(raw) {
  const limpio = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita tildes: sí -> si
  return limpio === 'si';
}

// Interpreta un número escrito en cualquiera de las dos convenciones
// (1.234,56 o 1,234.56, o solo 893 / 893,45 / 893.45) usando el separador
// que aparece más a la derecha como decimal y descartando el otro como
// separador de miles. Devuelve NaN si no se puede interpretar.
function parsearNumeroVenezolano_(raw) {
  const texto = String(raw || '').trim();
  if (!texto) return NaN;

  const soloValido = texto.replace(/[^0-9.,-]/g, '');
  const ultimaComa = soloValido.lastIndexOf(',');
  const ultimoPunto = soloValido.lastIndexOf('.');

  let normalizado;
  if (ultimaComa === -1 && ultimoPunto === -1) {
    normalizado = soloValido;
  } else if (ultimaComa > ultimoPunto) {
    // La coma es el separador decimal; el punto (si lo hay) es de miles.
    normalizado = soloValido.replace(/\./g, '').replace(',', '.');
  } else {
    // El punto es el separador decimal; la coma (si la hay) es de miles.
    normalizado = soloValido.replace(/,/g, '');
  }

  return parseFloat(normalizado);
}

function formatearNumeroVenezolano_(numero) {
  return numero.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ===== PRUEBAS (temporal: fácil de borrar, no toca tasa_bs) =====

// Consulta la API y agrega una fila a "log_tasa" (la crea si no existe)
// con la fecha/hora de Caracas y lo que devolvió la API. Útil para ver a
// qué hora cambia el valor (ej. revisar a las 5pm, 7pm, 12:30am y 6am).
function probarAPI() {
  const hojaLog = obtenerOCrearHojaLog_();
  let promedio = '';
  let fechaActualizacionAPI = '';
  try {
    const response = UrlFetchApp.fetch(TASA_BCV_API_URL, { muteHttpExceptions: true });
    const data = JSON.parse(response.getContentText());
    promedio = data[TASA_BCV_CAMPO_PRINCIPAL];
    fechaActualizacionAPI = data['fechaActualizacion'] || '';
  } catch (err) {
    promedio = 'ERROR: ' + err.message;
  }
  const fechaHoraCaracas = Utilities.formatDate(new Date(), TASA_BCV_ZONA_HORARIA, 'dd/MM/yyyy HH:mm');
  hojaLog.appendRow([fechaHoraCaracas, promedio, fechaActualizacionAPI]);
}

function obtenerOCrearHojaLog_() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(TASA_BCV_NOMBRE_HOJA_LOG);
  if (!hoja) {
    hoja = libro.insertSheet(TASA_BCV_NOMBRE_HOJA_LOG);
    hoja.appendRow(['fecha_hora_caracas', 'promedio', 'fechaActualizacion_api']);
  }
  return hoja;
}
