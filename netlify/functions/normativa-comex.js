// Función serverless (corre en el servidor de Netlify, no en el navegador del usuario)
// Motivo: el Boletín Oficial no permite que el navegador lo consulte directo (CORS),
// así que este intermediario lo lee por nosotros y devuelve solo lo filtrado.
//
// Estrategia en dos pasadas:
// 1) Leer el sumario del día y quedarnos con los avisos de organismos relacionados
//    a comercio exterior (para no tener que abrir los 100+ avisos del día).
// 2) De esa lista corta, entrar al texto completo de cada uno y ahí sí buscar
//    las palabras clave exactas (porque a veces están en el cuerpo, no en el título).

const KEYWORDS = [
  "aduana", "importación", "importacion", "exportación", "exportacion",
  "despachante", "courier", "envíos postales", "envios postales",
  "mercosur", "omc", "depósitos fiscales", "depositos fiscales",
  "zona primaria", "servicios extraordinarios", "dumping", "antidumping",
];

// Filtro amplio para decidir qué avisos vale la pena abrir y revisar a fondo
const ORGANISMOS_CANDIDATOS = [
  "aduana", "arca", "comercio exterior", "economía", "economia",
  "mercosur", "producción", "produccion", "agricultura", "aranceles",
  "recaudación y control aduanero", "recaudacion y control aduanero",
];

function hoyYYYYMMDD() {
  const now = new Date();
  const art = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const y = art.getFullYear();
  const m = String(art.getMonth() + 1).padStart(2, "0");
  const d = String(art.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function limpiarHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ");
}

async function fetchConTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SistemaComexDiegoDumont/1.0)" },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async function () {
  const fecha = hoyYYYYMMDD();
  const fechaFmt = `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}`;
  const urlSumario = `https://www.boletinoficial.gob.ar/seccion/primera/${fecha}`;

  try {
    const res = await fetchConTimeout(urlSumario, 8000);
    if (!res.ok) throw new Error("No se pudo acceder al sumario (status " + res.status + ")");
    const html = await res.text();

    // Extraemos cada aviso: su link de detalle + el texto visible cercano (título)
    const regexAviso = /<a[^>]+href="(\/detalleAviso\/primera\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const avisos = [];
    const vistosHref = new Set();
    let m;
    while ((m = regexAviso.exec(html)) !== null) {
      const href = m[1];
      const tituloCrudo = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (vistosHref.has(href) || tituloCrudo.length < 5) continue;
      vistosHref.add(href);
      avisos.push({ href: "https://www.boletinoficial.gob.ar" + href, titulo: tituloCrudo });
    }

    // Pasada 1: preseleccionamos por organismo (candidatos amplios)
    const candidatos = avisos.filter((a) => {
      const lower = a.titulo.toLowerCase();
      return ORGANISMOS_CANDIDATOS.some((org) => lower.includes(org));
    }).slice(0, 20); // límite para no exceder el tiempo de la función

    // Pasada 2: abrimos cada candidato y buscamos las palabras clave exactas en el texto completo
    const resultados = [];
    await Promise.all(candidatos.map(async (c) => {
      try {
        const r = await fetchConTimeout(c.href, 5000);
        if (!r.ok) return;
        const detalleHtml = await r.text();
        const textoDetalle = limpiarHTML(detalleHtml).replace(/\n+/g, " ").trim();
        const lower = textoDetalle.toLowerCase();
        const kw = KEYWORDS.find((k) => lower.includes(k));
        if (kw) {
          resultados.push({
            texto: (c.titulo + " — " + textoDetalle).slice(0, 320),
            palabraClave: kw,
            fuente: c.href,
          });
        }
      } catch (e) { /* si un aviso puntual falla, seguimos con los demás */ }
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: fechaFmt,
        fuente: urlSumario,
        resultados: resultados.slice(0, 25),
        totalAvisosDelDia: avisos.length,
        totalCandidatosRevisados: candidatos.length,
      }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: true, mensaje: String(e), fuente: urlSumario }),
    };
  }
};
