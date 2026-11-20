// Recibe un enlace de Amazon compartido desde el iPhone y lo añade a productos.json.
// Variables en Netlify: GITHUB_TOKEN (Contents read/write en pelotamazon) y CLAVE_ATAJO.
const OWNER = "javierpoloiglesias-source", REPO = "pelotamazon", FILE = "productos.json", BRANCH = "main";
const TAG = "pelotaofertas-21";
const CATS = {
  "Tecnología": /auricular|móvil|movil|smartphone|tablet|portátil|portatil|ordenador|monitor|teclado|ratón|raton|cámara|camara|gafas|reloj|smartwatch|altavoz|tv|televis|cargador|usb|ssd|router|consola|echo|alexa|kindle|fire/i,
  "Cocina": /cocina|freidora|sartén|sarten|olla|cafetera|batidora|horno|microondas|tostador|cuchill|vaso|robot de cocina|thermomix|nevera/i,
  "Belleza": /belleza|crema|perfume|maquillaje|champú|champu|secador|plancha de pelo|afeitad|depilad|cepillo|tensiómetro|tensiometro|salud|masaje/i,
  "Deporte": /deporte|deportiv|fitness|yoga|pesas|mancuerna|bicicleta|running|zapatilla|gimnasio|pelota|balón|balon/i,
  "Juguetes": /juguete|lego|muñec|puzzle|juego de mesa|peluche|niño|niña|infantil|bebé|bebe/i,
};
const EMOJI = { "Tecnología": "💻", "Hogar": "🏠", "Cocina": "🍳", "Belleza": "💄", "Deporte": "🏃", "Juguetes": "🧸" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const reply = (status, text) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const isAmazonHost = h => /(^|\.)amazon\.[a-z.]+$/i.test(h) || /^(amzn\.to|amzn\.eu|link\.amazon|a\.co)$/i.test(h);
const decode = s => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

async function resolve(url) {
  let u = url;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u, { redirect: "manual", headers: { "user-agent": UA } });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).toString(); continue; }
    return { url: u, html: r.ok ? await r.text() : "" };
  }
  return { url: u, html: "" };
}

export default async (req) => {
  if (req.method !== "POST") return reply(405, "Usa POST");
  let body = {};
  try { body = await req.json(); } catch { try { body = Object.fromEntries(new URLSearchParams(await req.text())); } catch {} }
  const clave = String(body.clave || "").trim(), texto = String(body.texto || body.url || "");
  if (!process.env.CLAVE_ATAJO || clave !== process.env.CLAVE_ATAJO) return reply(401, "❌ Clave incorrecta");
  if (!process.env.GITHUB_TOKEN) return reply(500, "❌ Falta GITHUB_TOKEN en Netlify");

  const found = (texto.match(/https?:\/\/[^\s"'<>]+/gi) || []).map(s => s.replace(/https?:\/\/(https?:\/\/)/i, "$1"));
  const shared = found.find(s => { try { return isAmazonHost(new URL(s).hostname); } catch { return false; } });
  if (!shared) return reply(400, "❌ No veo un enlace de Amazon");

  let final = shared, html = "";
  try { ({ url: final, html } = await resolve(shared)); } catch {}
  const asin = (final.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i) || [])[1];
  const finalHasTag = new URL(final).searchParams.get("tag") === TAG;
  const enlace = finalHasTag ? shared : asin ? `https://www.amazon.es/dp/${asin.toUpperCase()}?tag=${TAG}` : null;
  if (!enlace) return reply(400, "❌ No he podido abrir ese enlace de Amazon");

  // Título: del HTML, del texto compartido o del enlace
  let titulo = decode((html.match(/id="productTitle"[^>]*>([\s\S]*?)</) || [])[1] || "");
  if (!titulo) titulo = decode(texto.replace(/https?:\/\/\S+/g, "").replace(/^(mira|echa un vistazo)[^:]*:/i, ""));
  if (!titulo) { const p = new URL(final).pathname.split("/").filter(Boolean); const i = p.indexOf("dp"); if (i > 0) titulo = decodeURIComponent(p[i - 1]).replace(/-/g, " "); }
  if (!titulo) titulo = "Oferta de Amazon";
  titulo = titulo.split(/\s*[|(]\s*|,\s+|\s+-\s+/)[0].slice(0, 110);

  let imagen = (html.match(/data-old-hires="(https:[^"]+)"/) || html.match(/"hiRes":"(https:[^"]+)"/) || [])[1] || "";
  const im = imagen.match(/\/images\/I\/([^.\/]+)\./);
  imagen = im ? `https://m.media-amazon.com/images/I/${im[1]}._AC_SL500_.jpg` : "";

  const categoria = Object.keys(CATS).find(c => CATS[c].test(titulo)) || "Hogar";

  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
  const gh = { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "pelotaofertas" };
  for (let intento = 0; intento < 3; intento++) {
    const g = await fetch(`${api}?ref=${BRANCH}`, { headers: gh });
    if (!g.ok) return reply(502, "❌ GitHub no responde (" + g.status + ")");
    const j = await g.json();
    let items = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
    if (items.some(x => x.enlace === enlace || (asin && x.enlace.includes(asin)))) return reply(200, "ℹ️ Ya estaba en la web: " + titulo);
    items = [{ titulo, categoria, enlace, imagen, emoji: EMOJI[categoria] }, ...items];
    const p = await fetch(api, { method: "PUT", headers: gh, body: JSON.stringify({
      message: "Añadir producto desde el iPhone: " + titulo, branch: BRANCH, sha: j.sha,
      content: Buffer.from(JSON.stringify(items, null, 1) + "\n").toString("base64") }) });
    if (p.ok) return reply(200, "✅ Añadido: " + titulo + (imagen ? "" : " (sin foto)"));
    if (p.status !== 409) return reply(502, "❌ No se pudo guardar (" + p.status + ")");
  }
  return reply(503, "❌ Inténtalo otra vez");
};
