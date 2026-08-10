// Lee el calendario económico de EEUU de la semana en curso desde el feed público
// de ForexFactory (FairEconomy) y devuelve, para los 5 indicadores clave, el dato
// anterior, la previsión (consenso) y la fecha/hora exacta de publicación cuando
// caen en la semana en curso.
//
// Los indicadores que esta semana NO tienen evento programado se completan del lado
// del panel con el último dato conocido + la próxima fecha oficial (datos "seed"),
// para que las 5 tarjetas siempre muestren algo. Cuando el indicador entra en la
// semana en curso, este feed lo actualiza automáticamente en vivo.
//
// Fuente del feed: https://nfs.faireconomy.media/ff_calendar_thisweek.json
// (es la versión pública del calendario de https://www.forexfactory.com/calendar)
 
const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
 
// Cada indicador del panel se identifica por el título que usa ForexFactory (inglés).
// match  = alguna de estas palabras debe estar en el título.
// exclude = si el título contiene alguna de estas, se descarta (para separar el dato
//           general del "Core"/subyacente y quedarnos con el titular que sigue el mercado).
const INDICADORES = [
  { id: "fed",    match: ["federal funds rate"], exclude: [] },
  { id: "nfp",    match: ["non-farm employment change"], exclude: [] },
  { id: "cpi",    match: ["cpi m/m"], exclude: ["core"] },
  { id: "gdp",    match: ["gdp q/q"], exclude: [] },
  { id: "retail", match: ["retail sales m/m"], exclude: ["core"] },
];
 
function nivelImpacto(x) {
  return { High: 3, Medium: 2, Low: 1 }[x] || 0;
}
 
exports.handler = async function () {
  try {
    const res = await fetch(FEED + "?t=" + Date.now());
    if (!res.ok) throw new Error("No se pudo leer el feed (status " + res.status + ")");
    const eventos = await res.json();
    const usd = Array.isArray(eventos) ? eventos.filter((e) => e && e.country === "USD") : [];
 
    const semana = {};
    INDICADORES.forEach((ind) => {
      const matches = usd.filter((e) => {
        const t = (e.title || "").toLowerCase();
        const incluye = ind.match.some((k) => t.includes(k));
        const excluido = ind.exclude.some((k) => t.includes(k));
        return incluye && !excluido;
      });
      if (!matches.length) return;
 
      // Preferimos el de mayor impacto y, dentro de eso, el más próximo en el tiempo.
      matches.sort((a, b) => {
        const imp = nivelImpacto(b.impact) - nivelImpacto(a.impact);
        if (imp !== 0) return imp;
        return new Date(a.date) - new Date(b.date);
      });
 
      const e = matches[0];
      semana[ind.id] = {
        titulo: e.title,
        fecha: e.date, // ISO con offset, ej: "2026-08-12T08:30:00-04:00"
        forecast: e.forecast || "",
        anterior: e.previous || "",
        impacto: e.impact || "",
      };
    });
 
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store, no-cache, must-revalidate" },
      body: JSON.stringify({ fuente: "https://www.forexfactory.com/calendar", feed: FEED, semana }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: true, mensaje: String(e), fuente: "https://www.forexfactory.com/calendar" }),
    };
  }
};
