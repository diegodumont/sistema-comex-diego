// Lee el calendario de difusión del INDEC (PDF público, uno por semestre) y devuelve
// los indicadores que se publican entre hoy y los próximos 7 días.

const pdf = require("pdf-parse");

const MESES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};
const NOMBRES_MES = Object.keys(MESES);

function hoyART() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
}

function urlCalendarioVigente(fecha) {
  const anio = fecha.getFullYear();
  const semestre = fecha.getMonth() < 6 ? 1 : 2; // meses 0-5 = primer semestre, 6-11 = segundo
  return `https://www.indec.gob.ar/ftp/cuadros/publicaciones/calendario_${semestre}sem${anio}.pdf`;
}

exports.handler = async function () {
  const hoy = hoyART();
  hoy.setHours(0, 0, 0, 0);
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + 7);
  const anio = hoy.getFullYear();
  const url = urlCalendarioVigente(hoy);

  try {
    const res = await fetch(url);
    if (res.status === 404) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: true,
          necesitaLinkNuevo: true,
          mensaje: "El INDEC todavía no publicó el calendario de este semestre en la dirección esperada (" + url + "). Decile a Claude el link actualizado del PDF y lo actualiza.",
          fuente: url,
        }),
      };
    }
    if (!res.ok) throw new Error("No se pudo descargar el PDF (status " + res.status + ")");
    const buffer = Buffer.from(await res.arrayBuffer());
    const tamanioBuffer = buffer.length;
    const data = await pdf(buffer);
    const lineas = data.text.split("\n").map((l) => l.trim()).filter(Boolean);

    const regexFecha = /^(\d{1,2})(LU|MA|MI|JU|VI|SA|DO)(.*)/;
    const eventos = [];
    let mesActual = null;
    let diaActual = null;

    lineas.forEach((linea) => {
      const lower = linea.toLowerCase();
      if (NOMBRES_MES.includes(lower)) {
        mesActual = lower;
        diaActual = null;
        return;
      }
      if (/^actualizado/i.test(linea) || /^calendario de difusi/i.test(linea) || linea.length <= 3) return;

      const m = linea.match(regexFecha);
      if (m && mesActual) {
        diaActual = parseInt(m[1], 10);
        eventos.push({ fecha: new Date(anio, MESES[mesActual], diaActual), descripcion: m[3].trim() });
      } else if (diaActual !== null && mesActual) {
        // Línea sin fecha propia: es OTRO indicador del mismo día (el PDF solo marca
        // la fecha en el primer indicador de cada día), no una continuación de texto.
        eventos.push({ fecha: new Date(anio, MESES[mesActual], diaActual), descripcion: linea.trim() });
      }
    });

    const enVentana = eventos
      .filter((e) => e.fecha >= hoy && e.fecha <= limite)
      .sort((a, b) => a.fecha - b.fecha);

    // Agrupamos por fecha: si un día tiene varios indicadores, quedan juntos en una lista
    const porFecha = new Map();
    enVentana.forEach((e) => {
      const key = e.fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
      if (!porFecha.has(key)) porFecha.set(key, []);
      porFecha.get(key).push(e.descripcion.replace(/\s+/g, " ").trim());
    });
    const proximos = Array.from(porFecha.entries()).map(([fecha, indicadores]) => ({ fecha, indicadores }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store, no-cache, must-revalidate" },
      body: JSON.stringify({
        fuente: url,
        eventos: proximos,
        diagnostico: { statusHttp: res.status, tamanioBufferBytes: tamanioBuffer, totalLineasTexto: lineas.length, totalEventosEnTodoElPdf: eventos.length },
      }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: true, mensaje: String(e), fuente: url }),
    };
  }
};
