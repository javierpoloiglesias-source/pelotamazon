// Renueva productos.json con ofertas de Amazon.es del 50 % o más (o posibles errores de precio).
// Fuente: RSS públicos de Chollometro. No se accede a Amazon: solo se lee el ASIN del enlace de la oferta.
import { readFileSync, writeFileSync } from "node:fs";

const TAG = "pelotaofertas-21", MIN_DTO = 50, DIAS = 3, MAX = 60;
const FEEDS = ["https://www.chollometro.com/rss/hot", "https://www.chollometro.com/rss/nuevos"];
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ERROR = /error de precio|errores de precio|bug de precio|precio err[oó]neo|\bmistake\b/i;
const CATS = {
  "Tecnología": /electr[oó]nica|inform[aá]tica|tel[eé]fon|gaming|videojuego|auricular|m[oó]vil|tablet|port[aá]til|monitor|teclado|rat[oó]n|c[aá]mara|smartwatch|altavoz|cargador|usb|ssd|router|consola|bombilla|led\b/i,
  "Cocina": /cocina|freidora|sart[eé]n|olla|cafetera|caf[eé]|batidora|horno|microondas|vajilla|aceite|alimenta|supermercado|bebida/i,
  "Belleza": /belleza|salud|cuidado personal|crema|perfume|maquillaje|colorete|champ[uú]|secador|afeitad|depilad|cosm[eé]tic/i,
  "Deporte": /deporte|deportiv|moda|zapatilla|camiseta|sudadera|polo\b|ropa|bolso|fitness|running|bicicleta/i,
  "Juguetes": /juguete|juego|lego|funko|mu[ñn]ec|puzzle|peluche|beb[eé]|infantil|ni[ñn]o|play-doh|maqueta/i,
};
const EMOJI = { "Tecnología": "💻", "Hogar": "🏠", "Cocina": "🍳", "Belleza": "💄", "Deporte": "🏃", "Juguetes": "🧸" };

const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "es-ES" } }); if (!r.ok) throw new Error(u + " " + r.status); return r.text(); };
const last = (s, re) => { let m, v = null; const r = new RegExp(re, "g"); while ((m = r.exec(s))) v = m[1]; return v; };
const isAmazon = (h) => /(^|\.)amazon\.es$/i.test(h);
const cleanTitle = (t) => t.replace(/^\s*-?\d+°\s*-\s*/, "").split(/\s*(\|\||\|)\s*/)[0].replace(/\(?\s*\d+(?:[.,]\d+)?\s*€\)?/g, "").replace(/\s+/g, " ").trim().slice(0, 110);

async function asinDe(id) {
  let u = `https://www.chollometro.com/visit/threadmain/${id}`;
  for (let i = 0; i < 8; i++) {
    const h = new URL(u);
    const m = h.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    if (m && isAmazon(h.hostname)) return m[1].toUpperCase();
    if (isAmazon(h.hostname)) return null; // nunca se descarga Amazon
    const r = await fetch(u, { redirect: "manual", headers: { "user-agent": UA } });
    const loc = r.headers.get("location");
    if (!loc) return null;
    u = new URL(loc, u).toString();
  }
  return null;
}

async function datosOferta(url, id) {
  const h = await get(url);
  const i = h.indexOf(`"threadId":"${id}"`);
  if (i < 0) return null;
  const antes = h.slice(Math.max(0, i - 2500), i), w = h.slice(Math.max(0, i - 2500), i + 1500);
  const price = parseFloat(last(antes, '"price":([\\d.]+)')), prev = parseFloat(last(antes, '"nextBestPrice":([\\d.]+)'));
  const pd = parseInt(last(antes, '"priceDiscount":(\\d+)'));
  const dto = pd || (price && prev > price ? Math.round((1 - price / prev) * 100) : 0);
  return { dto, expirada: /"isExpired":true/.test(w), host: last(w, '"linkHost":"([^"]+)"') || "" };
}

const ahora = Date.now(), limite = ahora - DIAS * 864e5;
let items = JSON.parse(readFileSync("productos.json", "utf8"));
items = items.map((x) => (x.fecha ? x : { ...x, fecha: new Date(ahora).toISOString() }));

// Quitar las que han caducado o son antiguas
const vivos = [];
for (const x of items) {
  if (Date.parse(x.fecha) < limite) continue;
  if (x.auto) { try { const d = await datosOferta(x.fuente, x.auto); if (d && d.expirada) continue; } catch {} }
  vivos.push(x);
}
items = vivos;

const vistos = new Set(items.map((x) => (x.enlace.match(/[A-Z0-9]{10}/) || [])[0]).filter(Boolean));
let nuevos = 0, revisadas = 0;
for (const feed of FEEDS) {
  let xml; try { xml = await get(feed); } catch (e) { console.log("Feed falló:", e.message); continue; }
  for (const it of xml.split("<item>").slice(1)) {
    if (!/<pepper:merchant name="Amazon"/.test(it)) continue;
    const link = (it.match(/<link>([^<]+)/) || [])[1] || "", id = (link.match(/-(\d+)$/) || [])[1];
    const titulo0 = (it.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || "";
    const cat0 = (it.match(/<category><!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || "";
    if (!id || items.some((x) => x.auto === id)) continue;
    revisadas++;
    try {
      const d = await datosOferta(link, id);
      if (!d || d.expirada || (d.host && !/amazon\.es|amzn\./.test(d.host))) continue;
      const esError = ERROR.test(titulo0);
      if (d.dto < MIN_DTO && !esError) continue;
      const asin = await asinDe(id);
      if (!asin || vistos.has(asin)) continue;
      vistos.add(asin);
      const titulo = cleanTitle(titulo0) || "Oferta en Amazon";
      const categoria = Object.keys(CATS).find((c) => CATS[c].test(cat0 + " " + titulo)) || "Hogar";
      items.unshift({ titulo, categoria, enlace: `https://www.amazon.es/dp/${asin}?tag=${TAG}`,
        imagen: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`, // enlazada, no copiada (opción A de JAVI)
        emoji: EMOJI[categoria], fecha: new Date(ahora).toISOString(), auto: id, fuente: link, ...(esError ? { error: true } : {}) });
      nuevos++;
      console.log(`+ ${d.dto}%${esError ? " (error de precio)" : ""} ${asin} ${titulo}`);
    } catch (e) { console.log("Saltada", id, e.message); }
    await new Promise((r) => setTimeout(r, 400));
  }
}
items.sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
items = items.slice(0, MAX);
writeFileSync("productos.json", JSON.stringify(items, null, 1) + "\n");
console.log(`Revisadas ${revisadas}, nuevas ${nuevos}, total en la web ${items.length}`);
