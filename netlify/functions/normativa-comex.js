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

// Requiere que el título tenga una referencia real de norma (no un simple "Aviso Oficial" administrativo
// de una aduana puntual, que es ruido: edictos, decomisos, notificaciones judiciales, etc.)
const TIENE_REFERENCIA_NORMA = /(resoluci[oó]n(\s+general)?|decreto|disposici[oó]n)\s*n?[º°]?\.?\s*\d+/i;

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
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    // Entidades numéricas genéricas (&#243; por ej.), cubre lo que las nombradas no capturen
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    // Boilerplate que se repite en todas las páginas del sitio, no aporta nada
    .replace(/Al hacer clic en este enlace[^.]*\./gi, " ")
    .replace(/usted (está siendo dirigido|acepta ser dirigido)[^.]*\./gi, " ")
    .replace(/BORA - Boletín Oficial de la República Argentina/gi, " ");
}

// De un texto largo, devuelve la oración (o par de oraciones) donde aparece la palabra clave,
// buscando en todo el cuerpo (no solo salteando el encabezado). Si no la encuentra,
// devuelve null en vez de repetir texto de encabezado sin sentido.
function extraerContexto(textoPlano, keyword) {
  const oraciones = textoPlano.split(/(?<=[.;])\s+/).map((o) => o.trim()).filter((o) => o.length > 15);
  const idx = oraciones.findIndex((o) => o.toLowerCase().includes(keyword));
  if (idx === -1) return null;
  return oraciones.slice(idx, idx + 2).join(" ").slice(0, 320);
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

    // Pasada 1: preseleccionamos por organismo (candidatos amplios) Y que tengan
    // una referencia real de norma (no un "Aviso Oficial" administrativo de rutina)
    const candidatos = avisos.filter((a) => {
      const lower = a.titulo.toLowerCase();
      const esOrganismoRelevante = ORGANISMOS_CANDIDATOS.some((org) => lower.includes(org));
      return esOrganismoRelevante && TIENE_REFERENCIA_NORMA.test(a.titulo);
    }).slice(0, 20); // límite para no exceder el tiempo de la función

    // Pasada 2: abrimos cada candidato y buscamos las palabras clave exactas en el texto completo
    const resultados = [];
    await Promise.all(candidatos.map(async (c) => {
      try {
        const r = await fetchConTimeout(c.href, 5000);
        if (!r.ok) return;
        const detalleHtml = await r.text();
        const textoDetalle = limpiarHTML(detalleHtml).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
        const lower = textoDetalle.toLowerCase();
        const kw = KEYWORDS.find((k) => lower.includes(k));
        if (kw) {
          const contexto = extraerContexto(textoDetalle, kw);
          resultados.push({
            titulo: c.titulo.slice(0, 140),
            texto: contexto, // puede ser null — el front-end decide si lo muestra
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
