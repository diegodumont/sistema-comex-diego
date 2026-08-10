// ─────────────────────────────────────────────────────────────────────────────
// MERCADO — cotizaciones internacionales para el panel.
//
// Trae, con su fuente real y su fecha, y calcula la variación de la última
// semana y del último mes de cada instrumento:
//   · Petróleo Brent y WTI  → Stooq (futuro front-month, la referencia del mercado)
//   · Oro (XAU/USD)         → Stooq
//   · Granos Chicago (CBOT) → Stooq  (referencia INTERNACIONAL, no es el FOB Argentina)
//   · Bitcoin               → CoinGecko
//   · Euro / Dólar          → BCE (referencia diaria) vía Frankfurter
//
// REGLA DE ORO: si una fuente no responde, ese instrumento vuelve con ok:false
// y precio null — el panel muestra "—" y el link a la fuente, nunca un número
// inventado. Cada fuente se pide en paralelo: si una falla, las demás siguen.
// ─────────────────────────────────────────────────────────────────────────────
 
const UA = { headers: { "User-Agent": "Mozilla/5.0 (panel-comex-diego)" } };
 
function ymd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
function ymdGuion(date) {
  const s = ymd(date);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
 
// Redondeo de variación porcentual a 1 decimal
function pct(actual, base) {
  if (base == null || base === 0 || actual == null) return null;
  return Math.round(((actual - base) / base) * 1000) / 10;
}
 
// Dada una serie ascendente [{fecha:'YYYY-MM-DD', close:Number}], calcula
// último valor + variación a ~7 y ~30 días (tomando el dato más cercano por debajo).
function resumirSerie(serie) {
  if (!serie || serie.length === 0) return null;
  serie = serie.filter((p) => isFinite(p.close)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (serie.length === 0) return null;
  const last = serie[serie.length - 1];
  const tMs = Date.parse(last.fecha + "T00:00:00Z");
  const puntoHace = (dias) => {
    const objetivo = tMs - dias * 86400000;
    let elegido = null;
    for (const p of serie) {
      if (Date.parse(p.fecha + "T00:00:00Z") <= objetivo) elegido = p;
    }
    return elegido || serie[0];
  };
  const sem = puntoHace(7);
  const mes = puntoHace(30);
  return {
    precio: last.close,
    fecha: last.fecha,
    varSemana: pct(last.close, sem.close),
    varMes: pct(last.close, mes.close),
    baseSemana: sem.close,
    baseMes: mes.close,
  };
}
 
// fetch con timeout: ninguna fuente lenta puede colgar la función más allá de `ms`.
// (Netlify corta las funciones a los ~10s; con esto la función siempre responde antes.)
async function fetchTO(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: UA.headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
async function fetchText(url) {
  const r = await fetchTO(url, 3500);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}
async function fetchJson(url) {
  const r = await fetchTO(url, 3500);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
 
// ── STOOQ ────────────────────────────────────────────────────────────────────
// Descarga la serie diaria (CSV) de los últimos ~55 días para uno o varios
// símbolos candidatos, y usa el primero que devuelva datos numéricos.
async function stooqSerie(candidatos) {
  const hasta = new Date();
  const desde = new Date(Date.now() - 55 * 86400000);
  for (const sym of candidatos) {
    try {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&d1=${ymd(desde)}&d2=${ymd(hasta)}&i=d`;
      const txt = await fetchText(url);
      const lineas = txt.trim().split("\n");
      if (lineas.length < 2) continue;
      // Cabecera esperada: Date,Open,High,Low,Close,Volume
      const serie = lineas
        .slice(1)
        .map((l) => l.split(","))
        .filter((c) => c.length >= 5 && c[4] && c[4] !== "N/D")
        .map((c) => ({ fecha: c[0], close: parseFloat(c[4]) }))
        .filter((p) => isFinite(p.close));
      if (serie.length) return { symbol: sym, ...resumirSerie(serie) };
    } catch (e) {
      /* probamos el siguiente símbolo */
    }
  }
  return null;
}
 
// ── BITCOIN (CoinGecko) ──────────────────────────────────────────────────────
async function bitcoin() {
  const url = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=31&interval=daily";
  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.prices) || !data.prices.length) throw new Error("sin precios");
  const serie = data.prices.map(([ts, price]) => ({
    fecha: ymdGuion(new Date(ts)),
    close: price,
  }));
  return resumirSerie(serie);
}
 
// ── EURO / DÓLAR (BCE vía Frankfurter) ───────────────────────────────────────
async function eurusd() {
  const hasta = ymdGuion(new Date());
  const desde = ymdGuion(new Date(Date.now() - 40 * 86400000));
  const url = `https://api.frankfurter.dev/v1/${desde}..${hasta}?base=EUR&symbols=USD`;
  const data = await fetchJson(url);
  if (!data || !data.rates) throw new Error("sin rates");
  const serie = Object.keys(data.rates)
    .sort()
    .map((f) => ({ fecha: f, close: data.rates[f].USD }))
    .filter((p) => isFinite(p.close));
  if (!serie.length) throw new Error("serie vacía");
  return resumirSerie(serie);
}
 
// Definición de cada instrumento y cómo se obtiene.
const INSTRUMENTOS = [
  {
    id: "brent", nombre: "Petróleo Brent", grupo: "petroleo",
    unidad: "US$/barril", decimales: 2,
    fuente: "Stooq · futuro front-month",
    fuenteUrl: "https://es.investing.com/commodities/brent-oil",
    obtener: () => stooqSerie(["cb.f", "sc.f"]),
  },
  {
    id: "wti", nombre: "Petróleo WTI", grupo: "petroleo",
    unidad: "US$/barril", decimales: 2,
    fuente: "Stooq · futuro front-month",
    fuenteUrl: "https://es.investing.com/commodities/crude-oil",
    obtener: () => stooqSerie(["cl.f"]),
  },
  {
    id: "oro", nombre: "Oro", grupo: "metal",
    unidad: "US$/onza", decimales: 2,
    fuente: "Stooq · XAU/USD (spot)",
    fuenteUrl: "https://es.investing.com/currencies/xau-usd",
    obtener: () => stooqSerie(["xauusd"]),
  },
  {
    id: "bitcoin", nombre: "Bitcoin", grupo: "cripto",
    unidad: "US$", decimales: 0,
    fuente: "CoinGecko",
    fuenteUrl: "https://www.coingecko.com/es/monedas/bitcoin",
    obtener: () => bitcoin(),
  },
  {
    id: "eurusd", nombre: "Euro / Dólar", grupo: "divisa",
    unidad: "US$ por €", decimales: 4,
    fuente: "BCE · referencia diaria (Frankfurter)",
    fuenteUrl: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html",
    obtener: () => eurusd(),
  },
  {
    id: "soja", nombre: "Soja · Chicago (CBOT)", grupo: "grano",
    unidad: "¢US/bushel", decimales: 2,
    fuente: "Stooq · CBOT (referencia internacional)",
    fuenteUrl: "https://es.investing.com/commodities/us-soybeans",
    obtener: () => stooqSerie(["zs.f"]),
  },
  {
    id: "maiz", nombre: "Maíz · Chicago (CBOT)", grupo: "grano",
    unidad: "¢US/bushel", decimales: 2,
    fuente: "Stooq · CBOT (referencia internacional)",
    fuenteUrl: "https://es.investing.com/commodities/us-corn",
    obtener: () => stooqSerie(["zc.f"]),
  },
  {
    id: "trigo", nombre: "Trigo · Chicago (CBOT)", grupo: "grano",
    unidad: "¢US/bushel", decimales: 2,
    fuente: "Stooq · CBOT (referencia internacional)",
    fuenteUrl: "https://es.investing.com/commodities/us-wheat",
    obtener: () => stooqSerie(["zw.f"]),
  },
];
 
const GRANOS_BCR = {
  local: "https://www.cac.bcr.com.ar/es/precios-de-pizarra",
  fob: "https://www.bcr.com.ar/es/mercados/mercado-de-granos/cotizaciones/cotizaciones-locales-0",
  disponible: "https://www.bcr.com.ar/es/mercados/mercado-de-granos/cotizaciones/cotizaciones-locales/precios-del-mercado-disponible",
};
 
exports.handler = async function () {
  // Blindaje total: pase lo que pase, la función responde 200 con JSON válido
  // (nunca un 500/timeout que el panel leería como "bad response").
  try {
    return await construir();
  } catch (e) {
    const instrumentos = INSTRUMENTOS.map((inst) => ({
      id: inst.id, nombre: inst.nombre, grupo: inst.grupo, unidad: inst.unidad,
      decimales: inst.decimales, fuente: inst.fuente, fuenteUrl: inst.fuenteUrl,
      ok: false, precio: null, fecha: null, varSemana: null, varMes: null,
    }));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ fecha: new Date().toISOString(), instrumentos, granosBCR: GRANOS_BCR, aviso: String(e && e.message || e) }),
    };
  }
};
 
async function construir() {
  const resultados = await Promise.allSettled(INSTRUMENTOS.map((i) => i.obtener()));
 
  const instrumentos = INSTRUMENTOS.map((inst, idx) => {
    const r = resultados[idx];
    const base = {
      id: inst.id, nombre: inst.nombre, grupo: inst.grupo,
      unidad: inst.unidad, decimales: inst.decimales,
      fuente: inst.fuente, fuenteUrl: inst.fuenteUrl,
    };
    if (r.status === "fulfilled" && r.value && r.value.precio != null) {
      const v = r.value;
      return {
        ...base, ok: true,
        precio: v.precio, fecha: v.fecha,
        varSemana: v.varSemana, varMes: v.varMes,
        baseSemana: v.baseSemana, baseMes: v.baseMes,
        symbol: v.symbol || null,
      };
    }
    return { ...base, ok: false, precio: null, fecha: null, varSemana: null, varMes: null };
  });
 
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      fecha: new Date().toISOString(),
      instrumentos,
      granosBCR: GRANOS_BCR,
    }),
  };
}
 
