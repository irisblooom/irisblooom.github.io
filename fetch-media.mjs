import fs from "node:fs";
import path from "node:path";

const UA = "CaptainNemo/1.0 (local educational vent globe; InterRidge v3.4 media catalog)";
const ROOT = "/home/hmt/captain_nemo";
const MEDIA = path.join(ROOT, "media");
const FILES = path.join(MEDIA, "files");
const CSV_URL = "https://raw.githubusercontent.com/sbeaulieu/vents-Drupal/master/vent_fields_all_20200325cleansorted.csv";
const DOI_RE = /10\.\d{4,9}\/[A-Za-z0-9._;()\/:-]+/g;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    if (quoted) {
      if (ch === "\"") {
        if (csv[i + 1] === "\"") {
          cell += "\"";
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === "\"") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function cleanDoi(doi) {
  return doi.replace(/[.,;:)]+$/g, "");
}

function doisIn(text) {
  return [...new Set((text.match(DOI_RE) || []).map(cleanDoi))];
}

function slug(name) {
  return (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field").slice(0, 80);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function freeLicense(name) {
  const text = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || text.includes("nc")) return false;
  if (text.startsWith("cc by") || text.startsWith("cc-by") || text.startsWith("cc0")) return true;
  return text.includes("public domain") || text === "pd" || text.includes("no restrictions");
}

function nameInTitle(name, title) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu").test(title);
}

function titleMatches(name, title) {
  const file = title.replace(/^File:/i, "");
  if (!nameInTitle(name, file)) return false;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tight = new RegExp(
    `site hydrothermal\\s+${escaped}|hydrothermal\\s+(?:site|field|vent)s?\\s+${escaped}|${escaped}\\s*\\(?\\s*hydrothermal|${escaped}\\s+(?:vent field|black\\s?smoker|white\\s?smoker)|fumeur[^\\n]{0,48}${escaped}`,
    "i",
  );
  if (tight.test(file)) return true;
  const words = name.trim().split(/\s+/);
  if (words.length < 2 && name.trim().length < 12) return false;
  const at = file.toLowerCase().indexOf(name.trim().toLowerCase());
  const window = file.slice(Math.max(0, at - 48), at + name.length + 48);
  return /hydrothermal|fumeur|smoker/i.test(window);
}

async function api(params) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxlag", "5");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429 || res.status === 503) {
        const wait = Number(res.headers.get("retry-after")) || 15 + attempt * 5;
        console.error(`backoff ${res.status} for ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Commons ${res.status}`);
      const body = await res.json();
      if (body.error && body.error.code === "maxlag") {
        await sleep(5000);
        continue;
      }
      if (body.error) throw new Error(body.error.info || body.error.code);
      return body;
    } catch (err) {
      console.error(`api ${err.message}`);
      await sleep(5000);
    }
  }
  throw new Error("Commons gave up");
}

async function searchAll(query) {
  const titles = [];
  let offset = "0";
  for (let page = 0; page < 220; page += 1) {
    const body = await api({
      action: "query",
      list: "search",
      srsearch: query,
      srnamespace: "6",
      srlimit: "50",
      sroffset: offset,
    });
    for (const hit of body.query.search || []) titles.push(hit.title);
    const total = body.query.searchinfo && body.query.searchinfo.totalhits;
    console.log(`search "${query}" ${titles.length}/${total}`);
    if (!body.continue) break;
    offset = String(body.continue.sroffset);
    await sleep(1100);
  }
  return titles;
}

function pageUrl(title) {
  return `https://commons.wikimedia.org/wiki/${encodeURI(title.replace(/ /g, "_"))}`;
}

function kindFor(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  return "";
}

function extFor(mime, fileUrl) {
  const fromUrl = (fileUrl.match(/\.([a-z0-9]{2,4})(?:\?|$)/i) || [])[1];
  if (fromUrl) return fromUrl.toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "video/webm") return "webm";
  if (mime === "video/mp4") return "mp4";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new Error("got html");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length < 800) throw new Error("too small");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
  return data.length;
}

const csvRes = await fetch(CSV_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
if (!csvRes.ok) throw new Error(`csv ${csvRes.status}`);
const rows = parseCsv(await csvRes.text()).slice(1);
const names = rows.map((row) => row[1]).sort((a, b) => b.length - a.length);
const fields = {};
for (const row of rows) {
  const name = row[1];
  const discovery = (row[19] || "").trim();
  const other = (row[20] || "").trim();
  const references = [];
  if (discovery && discovery !== "NA") references.push({ role: "discovery", text: discovery });
  if (other && other !== "NA") references.push({ role: "other", text: other });
  fields[name] = { references, dois: doisIn(`${discovery}\n${other}`), files: [] };
}

const seen = new Set();
const titles = [];
for (const title of await searchAll("hydrothermal")) {
  if (seen.has(title)) continue;
  seen.add(title);
  titles.push(title);
}

const wanted = [];
for (const title of titles) {
  if (/\.(svg|ogv|tiff?)(\b|$)/i.test(title)) continue;
  for (const name of names) {
    if (!titleMatches(name, title)) continue;
    wanted.push({ name, title });
    break;
  }
}
console.log(`matched ${wanted.length} files to field names`);

fs.mkdirSync(FILES, { recursive: true });
const chosen = [];
for (let start = 0; start < wanted.length; start += 20) {
  const batch = wanted.slice(start, start + 20);
  let info;
  try {
    info = await api({
      action: "query",
      prop: "imageinfo",
      titles: batch.map((item) => item.title).join("|"),
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "960",
    });
  } catch (err) {
    console.error("info", err.message);
    continue;
  }
  const byTitle = new Map();
  for (const page of Object.values(info.query.pages || {})) byTitle.set(page.title, page);
  for (const item of batch) {
    const page = byTitle.get(item.title);
    const shot = page && page.imageinfo && page.imageinfo[0];
    if (!shot) continue;
    const meta = shot.extmetadata || {};
    const license = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
    if (!freeLicense(license)) continue;
    const kind = kindFor(shot.mime || "");
    if (!kind) continue;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(shot.mime) && kind === "image") continue;
    if (kind === "video" && shot.size > 25_000_000) continue;
    if (kind === "document" && shot.size > 12_000_000) continue;
    const have = fields[item.name].files.length;
    const counts = { image: 0, video: 0, document: 0 };
    for (const file of fields[item.name].files) counts[file.kind] += 1;
    for (const pending of chosen) if (pending.name === item.name) counts[pending.kind] += 1;
    if (kind === "image" && counts.image >= 3) continue;
    if (kind === "video" && counts.video >= 1) continue;
    if (kind === "document" && counts.document >= 1) continue;
    const credit = (stripHtml(meta.Artist && meta.Artist.value) || stripHtml(meta.Credit && meta.Credit.value))
      .replace(/^Unknown author(?:\s+Unknown author)?$/i, "");
    chosen.push({
      name: item.name,
      kind,
      title: item.title.replace(/^File:/, ""),
      credit,
      license,
      licenseUrl: stripHtml(meta.LicenseUrl && meta.LicenseUrl.value),
      page: pageUrl(item.title),
      url: kind === "image" ? (shot.thumburl || shot.url) : shot.url,
      mime: shot.mime,
      order: have + counts[kind] + 1,
    });
  }
  await sleep(100);
}
console.log(`licensed ${chosen.length}`);

let bytes = 0;
let done = 0;
async function save(item) {
  const filename = `${String(item.order).padStart(2, "0")}.${extFor(item.mime, item.url)}`;
  const dest = path.join(FILES, slug(item.name), filename);
  const size = fs.existsSync(dest) && fs.statSync(dest).size > 800
    ? fs.statSync(dest).size
    : await download(item.url, dest);
  bytes += size;
  fields[item.name].files.push({
    kind: item.kind,
    path: `media/files/${slug(item.name)}/${filename}`,
    title: item.title,
    credit: item.credit,
    license: item.license,
    licenseUrl: item.licenseUrl,
    page: item.page,
  });
  done += 1;
  console.log(`${done}/${chosen.length} ${item.name} ${item.kind}`);
}

for (let start = 0; start < chosen.length; start += 4) {
  const batch = chosen.slice(start, start + 4);
  await Promise.all(batch.map(async (item) => {
    try {
      await save(item);
    } catch (err) {
      console.error("skip", item.name, err.message);
    }
  }));
}

const catalog = {
  source: "Citations are the discovery and other references from InterRidge Vents Database version 3.4. Pictures, video, and documents are freely licensed Wikimedia Commons files whose titles name that field.",
  fields,
};
fs.writeFileSync(path.join(MEDIA, "catalog.json"), JSON.stringify(catalog));
const withFiles = Object.values(fields).filter((field) => field.files.length).length;
const images = Object.values(fields).reduce((sum, field) => sum + field.files.filter((file) => file.kind === "image").length, 0);
const videos = Object.values(fields).reduce((sum, field) => sum + field.files.filter((file) => file.kind === "video").length, 0);
const documents = Object.values(fields).reduce((sum, field) => sum + field.files.filter((file) => file.kind === "document").length, 0);
console.log(JSON.stringify({ fields: rows.length, withFiles, images, videos, documents, megabytes: Math.round(bytes / 1e6) }));
