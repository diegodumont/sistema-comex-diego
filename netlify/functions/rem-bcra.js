// Lee el informe mensual del REM (Relevamiento de Expectativas de Mercado) del BCRA,
// publicado como PDF con URL predecible, y extrae los indicadores principales.
// Nota: la redacción del informe varía levemente mes a mes, así que estos patrones
// pueden necesitar ajustes con el tiempo.

const pdf = require("pdf-parse");

const MESES_ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_NOMBRE = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function hoyART() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
}

function urlRem(anio, mesIndex0) {
  return `https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-${MESES_ABREV[mesIndex0]}-${anio}.pdf`;
}

// Busca un patrón y devuelve el primer grupo capturado, o null si no aparece
function buscar(texto, regex) {
  const m = texto.match(regex);
  return m ? m[1].trim() : null;
}

exports.handler = async function () {
  const hoy = hoyART();
  let anio = hoy.getFullYear();
  let mesIndex0 = hoy.getMonth() - 1; // el REM del mes anterior es el último publicado (aprox.)
  if (mesIndex0 < 0) { mesIndex0 = 11; anio -= 1; }

  let url = urlRem(anio, mesIndex0);
  let res = await fetch(url).catch(() => null);

  // Si todavía no se publicó el del mes anterior, probamos dos meses atrás
  if (!res || !res.ok) {
    let anio2 = anio, mesIndex0b = mesIndex0 - 1;
    if (mesIndex0b < 0) { mesIndex0b = 11; anio2 -= 1; }
    url = urlRem(anio2, mesIndex0b);
    res = await fetch(url).catch(() => null);
    anio = anio2; mesIndex0 = mesIndex0b;
  }

  if (!res || !res.ok) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: true, mensaje: "No se encontró el PDF del REM en las direcciones esperadas. Puede que el BCRA aún no lo haya publicado, o haya cambiado el formato del link.", fuente: url }),
    };
  }

  try {
    const buffer = Buffer.from(await res.arrayBuffer());
    const data = await pdf(buffer);
    const t = data.text.replace(/\s+/g, " ");

    const mesRem = MESES_NOMBRE[mesIndex0];

    const fechaPublicacion = buscar(t, /publicado el día (\d{1,2} de \w+ de \d{4})/i);

    const inflacionMensual = buscar(t, /inflaci[oó]n mensual de ([\d,]+%) para \w+/i);
    const inflacionNucleo = buscar(t, /inflaci[oó]n n[uú]cleo[^.]*?(?:ubic[oó]|estim[oó])[^.]*?en ([\d,]+%)/i);

    // Desempleo: dato del trimestre relevado + proyección a fin de año
    const desempleoMatch = t.match(/desocupaci[oó]n abierta para el (\w+ trimestre) de \d{4}[^.]*?estimada[^.]*?en ([\d,]+%)/i);
    const desempleoProyMatch = t.match(/tasa de ([\d,]+%) para el (\w+ trimestre) del año/i);

    // PIB: crecimiento anual proyectado para el año en curso respecto del año anterior
    const pibAnualMatch = t.match(/nivel de PIB real ([\d,]+%) superior al promedio de (\d{4})/i);

    const tipoCambioMatch = t.match(/tipo de cambio nominal de \$?([\d.,]+) por d[oó]lar para (\w+)/i);

    const exportaciones = buscar(t, /exportaciones \(FOB\) totalicen USD ?([\d.,]+) millones/i);
    const importaciones = buscar(t, /importaciones \(CIF\) USD ?([\d.,]+) millones/i);
    const saldoComercial = buscar(t, /superávit comercial anual esperado sería de USD ?([\d.,]+) millones/i);

    const resultadoFiscal = buscar(t, /resultado fiscal primario[^.]*?super[aá]vit de \$?([\d.,]+) billones para (\d{4})/i);


    const filas = [
      { indicador: "Inflación (IPC nivel general)", dato: inflacionMensual ? `${mesRem}: ${inflacionMensual} mensual` : null, proyeccion: null },
      { indicador: "Inflación núcleo (IPC Núcleo)", dato: inflacionNucleo ? `${mesRem}: ${inflacionNucleo} mensual` : null, proyeccion: null },
      { indicador: "Actividad económica (PIB)", dato: null, proyeccion: pibAnualMatch ? `+${pibAnualMatch[1]} respecto al promedio de ${pibAnualMatch[2]}` : null },
      { indicador: "Desempleo", dato: desempleoMatch ? `${desempleoMatch[1]}: ${desempleoMatch[2]} de la PEA` : null, proyeccion: desempleoProyMatch ? `${desempleoProyMatch[2]}: ${desempleoProyMatch[1]}` : null },
      { indicador: "Tipo de cambio", dato: tipoCambioMatch ? `$${tipoCambioMatch[1]} por dólar (${tipoCambioMatch[2]})` : null, proyeccion: null },
      { indicador: "Exportaciones (FOB)", dato: null, proyeccion: exportaciones ? `USD ${exportaciones} millones` : null },
      { indicador: "Importaciones (CIF)", dato: null, proyeccion: importaciones ? `USD ${importaciones} millones` : null },
      { indicador: "Saldo comercial", dato: null, proyeccion: saldoComercial ? `Superávit de USD ${saldoComercial} millones` : null },
      { indicador: "Resultado fiscal primario", dato: null, proyeccion: resultadoFiscal ? `Superávit de $${resultadoFiscal} billones (${anio})` : null },
    ];

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        fuente: url,
        mesRem: `${mesRem} de ${anio}`,
        fechaPublicacion: fechaPublicacion || "no encontrada en el texto",
        filas,
      }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: true, mensaje: String(e), fuente: url }),
    };
  }
};
