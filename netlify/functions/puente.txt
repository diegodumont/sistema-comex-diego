// PUENTE PROPIO del panel — reemplaza a los proxies CORS públicos (codetabs,
// allorigins, etc.), que fallan seguido y dejaban sin datos al petróleo, el oro,
// la pizarra de Rosario y las noticias.
//
// Qué hace: recibe ?url=<dirección codificada>, verifica que el host esté en la
// LISTA BLANCA de fuentes del panel (nada más se puede pedir), lo baja desde el
// servidor de Netlify (sin problema de CORS ni límites de terceros) y devuelve el
// contenido tal cual, con permiso CORS para el navegador del panel.
//
// Fuentes permitidas (las del panel, ninguna más):
//   - query1/query2.finance.yahoo.com  → petróleo, oro y granos de Chicago
//   - (www.)cac.bcr.com.ar             → pizarra Cámara Arbitral de Rosario
//   - www.magyp.gob.ar                 → FOB oficial SAGyP
//   - news.google.com                  → titulares (Google Noticias RSS)

const HOSTS_PERMITIDOS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "www.cac.bcr.com.ar",
  "cac.bcr.com.ar",
  "www.magyp.gob.ar",
  "news.google.com",
];

exports.handler = async function (event) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
  };

  try {
    const crudo = (event.queryStringParameters && event.queryStringParameters.url) || "";
    if (!crudo) {
      return { statusCode: 400, headers: cors, body: "Falta el parámetro url" };
    }

    let destino;
    try {
      destino = new URL(crudo);
    } catch (e) {
      return { statusCode: 400, headers: cors, body: "URL inválida" };
    }

    if (destino.protocol !== "https:" || !HOSTS_PERMITIDOS.includes(destino.hostname)) {
      return { statusCode: 403, headers: cors, body: "Host no permitido: " + destino.hostname };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(destino.toString(), {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
      },
    });
    clearTimeout(timer);

    const cuerpo = await r.text();
    return {
      statusCode: r.status,
      headers: {
        ...cors,
        "Content-Type": r.headers.get("content-type") || "text/plain; charset=utf-8",
      },
      body: cuerpo,
    };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "La fuente tardó demasiado en responder" : String((e && e.message) || e);
    return { statusCode: 502, headers: cors, body: "Error del puente: " + msg };
  }
};
