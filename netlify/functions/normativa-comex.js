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

    // Partimos en líneas/fragmentos
    const fragmentosCrudos = texto.split("\n").map((l) => l.trim()).filter((l) => l.length > 15);

    // Un fragmento cuenta como "norma real" solo si además de la palabra clave
    // tiene marca de instrumento legal (Resolución, Decreto, Disposición o su código)
    const MARCA_NORMA = /(resoluci[oó]n|decreto|disposici[oó]n|resoluci[oó]n general|resog|decto|dispo|decnu|ley\s)/i;

    const vistos = new Set();
    const coincidencias = [];

    for (let i = 0; i < fragmentosCrudos.length; i++) {
      // Juntamos el fragmento actual con el siguiente para no perder título+descripción partidos en dos líneas
      const combinado = (fragmentosCrudos[i] + " " + (fragmentosCrudos[i + 1] || "")).trim();
      const lower = combinado.toLowerCase();
      const kw = KEYWORDS.find((k) => lower.includes(k));
      if (!kw || !MARCA_NORMA.test(combinado)) continue;

      const clave = combinado.slice(0, 60); // para deduplicar por inicio de texto
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      coincidencias.push({ texto: combinado.slice(0, 320), palabraClave: kw });
    }

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
