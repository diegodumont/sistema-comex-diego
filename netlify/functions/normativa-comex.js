// Función serverless (corre en el servidor de Netlify, no en el navegador del usuario)
// Motivo: el Boletín Oficial no permite que el navegador lo consulte directo (CORS),
// así que este intermediario lo lee por nosotros y devuelve solo lo filtrado.

const KEYWORDS = [
  "aduana", "importación", "importacion", "exportación", "exportacion",
  "despachante", "courier", "envíos postales", "envios postales",
  "mercosur", "omc", "depósitos fiscales", "depositos fiscales",
  "zona primaria", "servicios extraordinarios", "dumping", "antidumping",
];

function hoyYYYYMMDD() {
  const now = new Date();
  const art = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const y = art.getFullYear();
  const m = String(art.getMonth() + 1).padStart(2, "0");
  const d = String(art.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

exports.handler = async function () {
  const fecha = hoyYYYYMMDD();
  const url = `https://www.boletinoficial.gob.ar/seccion/primera/${fecha}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SistemaComexDiegoDumont/1.0)" },
    });
    if (!res.ok) throw new Error("No se pudo acceder al Boletín Oficial (status " + res.status + ")");
    const html = await res.text();

    // Quitamos etiquetas HTML para trabajar sobre texto plano
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
      .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ");

    // Partimos en líneas/fragmentos y buscamos los que contengan alguna palabra clave
    const fragmentos = texto.split("\n").map((l) => l.trim()).filter((l) => l.length > 25);
    const vistos = new Set();
    const coincidencias = [];

    fragmentos.forEach((frag) => {
      const lower = frag.toLowerCase();
      const match = KEYWORDS.find((kw) => lower.includes(kw));
      if (match && !vistos.has(frag)) {
        vistos.add(frag);
        coincidencias.push({ texto: frag.slice(0, 300), palabraClave: match });
      }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}`,
        fuente: url,
        resultados: coincidencias.slice(0, 25),
        totalEncontrado: coincidencias.length,
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
