import * as THREE from "three";

const OCEANS = [
  "Arctic",
  "N. Atlantic",
  "Mediterranean",
  "N. Pacific",
  "S. Atlantic",
  "Indian",
  "S. Pacific",
  "Southern",
];

const STYLES = {
  "active, confirmed": { fill: "#2ea043", stroke: "#145c28" },
  "active, inferred": { fill: "#f5d400", stroke: "#6d5e00" },
  inactive: { fill: "#9aa3ad", stroke: "#4c545e" },
};

const COURSE = {
  shortest: "#2ea043",
  mid: "#f5d400",
  farthest: "#e03131",
};

const vents = window.VENTS;
const MISSIONS = window.MISSIONS || [];
const sanFrancisco = {
  name: "San Francisco",
  lat: "37.775",
  lon: "-122.4194",
  activity: "California",
  ocean: "N. Pacific",
  region: "United States",
  jurisdiction: "United States",
  depth: "",
  tectonic: "",
  temp: "",
  maxTemp: "",
  sites: [],
};
const byName = new Map(vents.map((vent) => [vent.name, vent]));
byName.set(sanFrancisco.name, sanFrancisco);
const mediaCatalog = await fetch("media/catalog.json", { cache: "no-store" })
  .then((res) => (res.ok ? res.json() : { fields: {} }))
  .catch(() => ({ fields: {} }));
const mediaByName = new Map(Object.entries(mediaCatalog.fields || {}));

const query = document.getElementById("q");
const oceanSelect = document.getElementById("ocean");
const countEl = document.getElementById("count");
const listEl = document.getElementById("list");
const detailEl = document.getElementById("detail");
const passingEl = document.getElementById("passing");
const ledeEl = document.getElementById("lede");
const form = document.getElementById("filters");
const globeEl = document.getElementById("globe");
const legendEl = document.getElementById("legend");
const tipEl = document.getElementById("tip");
const infoboxEl = document.getElementById("infobox");
const originLabel = document.getElementById("origin-label");

let selectedName = null;
let pinnedMissions = null;
let hovered = null;
let distance = 3.5;
let anim = null;
let follow = null;
let followOwnsZoom = false;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function hemisphere(value, positive, negative) {
  const southOrWest = String(value).startsWith("-");
  const magnitude = southOrWest ? String(value).slice(1) : String(value);
  return `${magnitude}° ${southOrWest ? negative : positive}`;
}

function jurisdictionLabel(value) {
  return value.replace(/\s+:\s+/g, ": ");
}

function activityChecks() {
  return new Set(
    [...form.querySelectorAll('input[name="activity"]:checked')].map((input) => input.value),
  );
}

function matches() {
  return true;
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const earthKm = 6371;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1);
  const dλ = toRad(lon2 - lon1);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

function geodesic(lat1, lon1, lat2, lon2, steps) {
  const φ1 = toRad(lat1);
  const λ1 = toRad(lon1);
  const φ2 = toRad(lat2);
  const λ2 = toRad(lon2);
  const dφ = φ2 - φ1;
  const dλ = λ2 - λ1;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const delta = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  if (delta === 0) return [[lat1, lon1], [lat2, lon2]];
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const A = Math.sin((1 - f) * delta) / Math.sin(delta);
    const B = Math.sin(f * delta) / Math.sin(delta);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI;
    const lon = Math.atan2(y, x) * 180 / Math.PI;
    points.push([lat, lon]);
  }
  return points;
}

function formatKm(km) {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

function courseBand(km, shortMax, midMax) {
  if (km <= shortMax) return "shortest";
  if (km <= midMax) return "mid";
  return "farthest";
}

function detailHtml(vent) {
  const facts = [
    ["Position", `${hemisphere(vent.lat, "N", "S")}, ${hemisphere(vent.lon, "E", "W")}`],
    ["Activity", vent.activity],
    ["Ocean", vent.ocean],
    ["Region", vent.region],
    ["Tectonic setting", vent.tectonic],
    ["Jurisdiction", jurisdictionLabel(vent.jurisdiction)],
  ];
  if (vent.depth) facts.push(["Reported depth", `${vent.depth} m`]);
  if (vent.maxTemp) facts.push(["Maximum temperature", `${vent.maxTemp} °C`]);
  if (vent.temp) facts.push(["Temperature category", vent.temp]);
  const body = facts
    .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`)
    .join("");
  const sites = vent.sites.length
    ? `<h3>Named vents on this field</h3><ul>${vent.sites.map((site) => `<li>${esc(site)}</li>`).join("")}</ul>`
    : "";
  const photo = imageFiles(vent.name).length ? photoDot() : "";
  return `<h2>${photo}${esc(vent.name)}</h2><dl>${body}</dl>${sites}${mediaHtml(vent)}`;
}

function linkify(text) {
  return esc(text).replace(/10\.\d{4,9}\/[A-Za-z0-9._;()\/:-]+/g, (doi) => {
    const clean = doi.replace(/[.,;:)]+$/g, "");
    const rest = doi.slice(clean.length);
    return `<a href="https://doi.org/${encodeURI(clean)}">${clean}</a>${rest}`;
  });
}

function popupHtml(vent) {
  const images = imageFiles(vent.name);
  const shots = images.map((file) => {
    const creditText = file.credit && file.credit !== "null" ? file.credit : "";
    const credit = creditText ? `. ${esc(creditText)}` : "";
    return `<figure class="shot"><img src="${esc(file.path)}" alt="${esc(file.title)}"><figcaption>${esc(file.license)}${credit}</figcaption></figure>`;
  }).join("");
  const photo = images.length ? photoDot() : "";
  const bits = [vent.activity, vent.region];
  if (vent.depth) bits.push(`${vent.depth} m`);
  if (vent.maxTemp) bits.push(`${vent.maxTemp} °C`);
  return `<button type="button" class="infobox-close" aria-label="Close">×</button><h2>${photo}${esc(vent.name)}</h2><p class="infobox-meta">${bits.map((bit) => esc(bit)).join(" · ")}</p>${shots}`;
}

const boxScratch = new THREE.Vector3();

function placeInfobox(vent) {
  boxScratch.copy(latLonToVec3(Number(vent.lat), Number(vent.lon), 1.03));
  boxScratch.applyQuaternion(globe.quaternion);
  if (boxScratch.dot(camera.position) <= 0.12) {
    infoboxEl.hidden = true;
    return;
  }
  boxScratch.project(camera);
  const width = globeEl.clientWidth;
  const height = globeEl.clientHeight;
  const boxW = infoboxEl.offsetWidth || 260;
  const boxH = infoboxEl.offsetHeight || 180;
  let x = (boxScratch.x * 0.5 + 0.5) * width + 16;
  let y = (-boxScratch.y * 0.5 + 0.5) * height - 12;
  if (x + boxW > width - 8) x = Math.max(8, x - boxW - 32);
  if (y + boxH > height - 8) y = Math.max(8, height - 8 - boxH);
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  infoboxEl.hidden = false;
  infoboxEl.style.transform = `translate(${x}px, ${y}px)`;
}

function closePopup() {
  selectedName = null;
  pinnedMissions = null;
  infoboxEl.hidden = true;
  infoboxEl.innerHTML = "";
  updateMarkers();
  history.replaceState(null, "", location.pathname);
}

function missionHtml(mission) {
  const host = mission.url.replace(/^https?:\/\//, "");
  return `<h2><span class="dot dot-mission"></span>${esc(mission.name)}</h2><p class="infobox-meta">${esc(mission.when)} · ${esc(mission.start)}</p><p class="infobox-meta">${esc(mission.note)}</p><p class="source-file"><a href="${esc(mission.url)}">${esc(host)}</a></p>`;
}

function showMissions(list) {
  selectedName = null;
  pinnedMissions = list;
  infoboxEl.innerHTML = `<button type="button" class="infobox-close" aria-label="Close">×</button>${list.map(missionHtml).join("")}`;
  placeInfobox(list[0]);
  updateMarkers();
}

function photoDot() {
  return `<span class="dot dot-photo" title="Has photos"></span>`;
}

function imageFiles(name) {
  const entry = mediaByName.get(name);
  if (!entry) return [];
  return (entry.files || []).filter((file) => file.kind === "image");
}

function picturedStops(summary) {
  let km = 0;
  const stops = [];
  const push = (name, at) => {
    if (imageFiles(name).length) stops.push({ name, km: at });
  };
  push(summary.path[0].name, 0);
  for (const leg of summary.legs) {
    km += leg.km;
    push(leg.to.name, km);
  }
  return stops;
}

function nearestPictured(stops, km) {
  let best = null;
  for (const stop of stops) {
    const dist = Math.abs(stop.km - km);
    if (!best || dist < best.dist) best = { stop, dist };
  }
  return best ? best.stop : null;
}

let playlistStops = [];
let playlistIndex = -1;
let playlistKey = "";
let playlistBound = false;

function trackStops(summary) {
  let km = 0;
  const stops = [{ vent: summary.path[0], km: 0, hop: 0 }];
  for (const leg of summary.legs) {
    km += leg.km;
    stops.push({ vent: leg.to, km, hop: leg.km });
  }
  return stops;
}

function nearestStopIndex(km) {
  let best = 0;
  let bestDist = Infinity;
  playlistStops.forEach((stop, index) => {
    const dist = Math.abs(stop.km - km);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  });
  return best;
}

function legForKm(km) {
  let leg = 0;
  for (let index = 0; index < playlistStops.length - 1; index += 1) {
    if (km >= playlistStops[index].km) leg = index;
  }
  return leg;
}

function nowHtml(index, shot) {
  const stop = playlistStops[index];
  const vent = stop.vent;
  const images = imageFiles(vent.name);
  const file = images.length ? images[shot % images.length] : null;
  const prev = index > 0 ? playlistStops[index - 1] : null;
  const next = index < playlistStops.length - 1 ? playlistStops[index + 1] : null;
  const between = [
    prev ? `${formatKm(stop.hop)} from ${esc(prev.vent.name)}` : "Start of the track",
    next ? `${formatKm(next.hop)} to ${esc(next.vent.name)}` : "End of the track",
  ].join(" · ");
  const bits = [vent.activity, vent.region];
  if (vent.depth) bits.push(`${vent.depth} m`);
  if (vent.maxTemp) bits.push(`${vent.maxTemp} °C`);
  const named = vent.sites.length ? `<p class="playlist-sites">${vent.sites.map((site) => esc(site)).join(", ")}</p>` : "";
  const photo = file
    ? `<img src="${esc(file.path)}" alt="${esc(file.title)}"><p class="passing-credit">${esc(file.license)}.${file.credit && file.credit !== "null" ? ` ${esc(file.credit)}.` : ""} <a href="${esc(file.page)}">Wikimedia Commons</a></p>`
    : "";
  const marker = images.length ? photoDot() : `<span class="dot" data-activity="${esc(vent.activity)}"></span>`;
  return `<h2>${marker}${esc(vent.name)}</h2><p class="playlist-meta">${bits.map((bit) => esc(bit)).join(" · ")}</p><p class="playlist-between">${between}</p>${named}${photo}`;
}

function renderNow(index, shot) {
  const file = imageFiles(playlistStops[index].vent.name)[shot] || null;
  const key = `${index}|${file ? file.path : ""}`;
  if (key === playlistKey) return;
  playlistKey = key;
  passingEl.querySelector(".playlist-now").innerHTML = nowHtml(index, shot);
}

function scrollStopIntoView(button) {
  const list = button.closest(".playlist-stops");
  const listRect = list.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  if (buttonRect.top < listRect.top) list.scrollTop -= listRect.top - buttonRect.top + 8;
  else if (buttonRect.bottom > listRect.bottom) list.scrollTop += buttonRect.bottom - listRect.bottom + 8;
}

function markPlaylist(index, leg) {
  const changed = index !== playlistIndex;
  const current = passingEl.querySelector('.playlist-stops button[aria-current="true"]');
  const next = passingEl.querySelector(`.playlist-stops button[data-index="${index}"]`);
  if (current && current !== next) current.removeAttribute("aria-current");
  if (next && next !== current) next.setAttribute("aria-current", "true");
  const currentLeg = passingEl.querySelector(".leg.current");
  const nextLeg = passingEl.querySelector(`.leg[data-leg="${leg}"]`);
  if (currentLeg && currentLeg !== nextLeg) currentLeg.classList.remove("current");
  if (nextLeg) nextLeg.classList.add("current");
  playlistIndex = index;
  if (changed && next) scrollStopIntoView(next);
}

function showPassing(summary, km, now, picture) {
  if (!playlistStops.length) return picture;
  const index = nearestStopIndex(km);
  if (!picture || picture.index !== index) picture = { index, since: now };
  const images = imageFiles(playlistStops[index].vent.name);
  const shot = images.length > 1 ? Math.floor((now - picture.since) / 12000) % images.length : 0;
  renderNow(index, shot);
  markPlaylist(index, legForKm(km));
  return picture;
}

function focusPlaylist(name) {
  const index = playlistStops.findIndex((stop) => stop.vent.name === name);
  if (index < 0) return;
  renderNow(index, 0);
  markPlaylist(index, Math.max(0, index - 1));
}

function bindPlaylist() {
  if (playlistBound || !passingEl) return;
  playlistBound = true;
  passingEl.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".playlist-handle");
    if (!handle) return;
    event.preventDefault();
    const parent = globeEl.getBoundingClientRect();
    const rect = passingEl.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originLeft = rect.left - parent.left;
    const originTop = rect.top - parent.top;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const maxLeft = Math.max(8, globeEl.clientWidth - passingEl.offsetWidth - 8);
      const maxTop = Math.max(8, globeEl.clientHeight - passingEl.offsetHeight - 8);
      const left = Math.min(maxLeft, Math.max(8, originLeft + moveEvent.clientX - startX));
      const top = Math.min(maxTop, Math.max(8, originTop + moveEvent.clientY - startY));
      passingEl.style.left = `${left}px`;
      passingEl.style.top = `${top}px`;
      passingEl.style.right = "auto";
    };
    const up = (upEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  passingEl.addEventListener("click", (event) => {
    const button = event.target.closest(".playlist-stops button");
    if (!button) return;
    const index = Number(button.dataset.index);
    const vent = playlistStops[index].vent;
    seekFollow(playlistStops[index].km);
    renderNow(index, 0);
    markPlaylist(index, Math.max(0, index - 1));
    select(vent.name, { fly: true });
  });
}

function buildPlaylist() {
  if (!passingEl || !courseSummary) return;
  playlistStops = trackStops(courseSummary);
  const total = playlistStops[playlistStops.length - 1].km;
  const rows = [];
  playlistStops.forEach((stop, index) => {
    if (index > 0) rows.push(`<li class="leg" data-leg="${index - 1}">${formatKm(stop.hop)}</li>`);
    const vent = stop.vent;
    const photo = imageFiles(vent.name).length ? photoDot() : "";
    rows.push(`<li class="stop"><button type="button" data-name="${esc(vent.name)}" data-index="${index}"><span class="dot" data-activity="${esc(vent.activity)}"></span><span class="stop-name">${esc(vent.name)}</span>${photo}</button></li>`);
  });
  passingEl.hidden = false;
  passingEl.innerHTML = `<header class="playlist-handle">San Francisco and the long way around · ${formatKm(total)}</header><div class="playlist-now"></div><ol class="playlist-stops">${rows.join("")}</ol>`;
  bindPlaylist();
}

function clearPassing() {
  if (!passingEl) return;
  playlistKey = "";
  playlistIndex = -1;
  passingEl.hidden = true;
  passingEl.innerHTML = "";
}

function mediaHtml(vent) {
  const entry = mediaByName.get(vent.name);
  if (!entry) return "";
  const shots = (entry.files || []).map((file) => {
    const creditText = file.credit && file.credit !== "null" ? file.credit : "";
    const credit = creditText ? ` ${esc(creditText)}.` : "";
    const caption = `<figcaption>${esc(file.license)}.${credit} <a href="${esc(file.page)}">Wikimedia Commons</a></figcaption>`;
    if (file.kind === "video") {
      return `<figure class="shot"><video controls preload="metadata" src="${esc(file.path)}"></video>${caption}</figure>`;
    }
    if (file.kind === "document") {
      return `<p class="source-file"><a href="${esc(file.path)}">${esc(file.title)}</a> (${esc(file.license)})</p>`;
    }
    return `<figure class="shot"><img src="${esc(file.path)}" alt="${esc(file.title)}">${caption}</figure>`;
  }).join("");
  const sources = (entry.references || []).map((ref) => {
    const label = ref.role === "discovery" ? "Discovery" : "Other reports";
    return `<h3>${label}</h3><p class="source">${linkify(ref.text)}</p>`;
  }).join("");
  return `${shots}${sources}`;
}

function appendNamed(path, legs, used, names) {
  for (const name of names) {
    if (used.has(name)) continue;
    const vent = byName.get(name);
    if (!vent) continue;
    const here = path[path.length - 1];
    const km = haversineKm(Number(here.lat), Number(here.lon), Number(vent.lat), Number(vent.lon));
    legs.push({ from: here, to: vent, km });
    path.push(vent);
    used.add(name);
  }
}

function appendVisit(path, legs, names) {
  for (const name of names) {
    const vent = byName.get(name);
    if (!vent) continue;
    const here = path[path.length - 1];
    if (here === vent) continue;
    const km = haversineKm(Number(here.lat), Number(here.lon), Number(vent.lat), Number(vent.lon));
    legs.push({ from: here, to: vent, km });
    path.push(vent);
  }
}

function trackOffset(fromLat, fromLon, toLat, toLon, lat, lon) {
  const earthKm = 6371;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const φ3 = toRad(lat);
  const dλ12 = toRad(toLon - fromLon);
  const dλ13 = toRad(lon - fromLon);
  const θ12 = Math.atan2(Math.sin(dλ12) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ12));
  const θ13 = Math.atan2(Math.sin(dλ13) * Math.cos(φ3), Math.cos(φ1) * Math.sin(φ3) - Math.sin(φ1) * Math.cos(φ3) * Math.cos(dλ13));
  const dφ = φ3 - φ1;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ3) * Math.sin(dλ13 / 2) ** 2;
  const d13 = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  const dθ = θ13 - θ12;
  const cross = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(dθ))));
  const along = Math.atan2(Math.sin(d13) * Math.cos(dθ), Math.cos(d13));
  return { crossKm: Math.abs(cross) * earthKm, alongKm: along * earthKm };
}

function appendCorridor(path, legs, used, fromName, toName, maxCrossKm) {
  const from = byName.get(fromName);
  const to = byName.get(toName);
  const span = haversineKm(Number(from.lat), Number(from.lon), Number(to.lat), Number(to.lon));
  const hits = [];
  for (const vent of vents) {
    if (used.has(vent.name) || vent.name === toName) continue;
    const offset = trackOffset(Number(from.lat), Number(from.lon), Number(to.lat), Number(to.lon), Number(vent.lat), Number(vent.lon));
    if (offset.alongKm < 0 || offset.alongKm > span) continue;
    if (offset.crossKm > maxCrossKm) continue;
    hits.push({ vent, alongKm: offset.alongKm });
  }
  hits.sort((a, b) => a.alongKm - b.alongKm);
  appendNamed(path, legs, used, hits.map((hit) => hit.vent.name).concat(toName));
}

function appendNearest(path, legs, used, candidates) {
  const pool = candidates.filter((vent) => !used.has(vent.name));
  while (pool.length) {
    const here = path[path.length - 1];
    let bestIndex = 0;
    let bestKm = Infinity;
    for (let index = 0; index < pool.length; index += 1) {
      const km = haversineKm(Number(here.lat), Number(here.lon), Number(pool[index].lat), Number(pool[index].lon));
      if (km < bestKm) {
        bestKm = km;
        bestIndex = index;
      }
    }
    const vent = pool.splice(bestIndex, 1)[0];
    legs.push({ from: path[path.length - 1], to: vent, km: bestKm });
    path.push(vent);
    used.add(vent.name);
  }
}

function computeCourses() {
  const origin = byName.get("San Felipe");
  if (!origin) return null;
  const remaining = vents.filter((vent) => vent !== origin);
  const spine = [origin];
  while (remaining.length) {
    const here = spine[spine.length - 1];
    const lat = Number(here.lat);
    const lon = Number(here.lon);
    let best = null;
    for (const vent of remaining) {
      if (Number(vent.lat) >= lat) continue;
      const km = haversineKm(lat, lon, Number(vent.lat), Number(vent.lon));
      if (!best || km < best.km) best = { vent, km };
    }
    if (!best) break;
    remaining.splice(remaining.indexOf(best.vent), 1);
    spine.push(best.vent);
    if (best.vent.name === "Deception Island") break;
  }
  const gulf = vents.filter((vent) => {
    const lat = Number(vent.lat);
    return lat > 20.9 && vent.name !== "Punta Banda" && (vent.region === "Gulf of California" || vent.region === "Coastal Baja California" || vent.name === "EPR/Tamayo intersection");
  }).sort((a, b) => Number(a.lat) - Number(b.lat));
  const upGulf = [];
  const downGulf = [];
  gulf.forEach((vent, index) => (index % 2 === 0 ? upGulf : downGulf).push(vent.name));
  downGulf.reverse();
  const path = [sanFrancisco];
  const legs = [];
  appendVisit(path, legs, [
    "White Point, Palos Verde, California",
    "Punta Banda",
    "EPR, 21 N",
    ...upGulf,
    ...downGulf,
    "Green Seamount",
    "Red Seamount",
  ]);
  const used = new Set(path.map((vent) => vent.name));
  appendVisit(path, legs, spine.filter((vent) => !used.has(vent.name)).map((vent) => vent.name));
  for (const vent of spine) used.add(vent.name);
  appendNamed(path, legs, used, [
    "Little Volcano",
    "Three Sisters, Middle Sister",
    "Hook Ridge",
    "ESR, E2",
    "ESR, E5",
    "ESR, E9",
    "Kemp Caldera",
    "Adventure Caldera",
    "Douglas Strait caldera, Thule Island, South Sandwich Islands",
  ]);
  appendNamed(path, legs, used, vents.filter((vent) => vent.region === "SWIR").sort((a, b) => Number(a.lon) - Number(b.lon)).map((vent) => vent.name));
  appendNamed(path, legs, used, ["Kairei Field"]);
  appendNamed(path, legs, used, vents.filter((vent) => vent.region === "SEIR" && Number(vent.lat) > -55).sort((a, b) => Number(a.lon) - Number(b.lon) || Number(b.lat) - Number(a.lat)).map((vent) => vent.name));
  appendNamed(path, legs, used, ["Whale Island"]);
  appendNearest(path, legs, used, vents.filter((vent) => vent.region === "Taupo Volcanic Zone"));
  appendCorridor(path, legs, used, "White Island", "Mata Fitu", 340);
  appendCorridor(path, legs, used, "Mata Fitu", "Franklin Seamount", 450);
  appendCorridor(path, legs, used, "Franklin Seamount", "Solwara 11", 530);
  appendNearest(path, legs, used, vents.filter((vent) => vent.region === "Manus Basin" || vent.region === "Bismarck Arc" || vent.region === "Tabar-Feni Arc"));
  appendNamed(path, legs, used, vents.filter((vent) => /Mariana|Izu-Bonin|Kuril/.test(vent.region)).sort((a, b) => Number(a.lat) - Number(b.lat) || Number(a.lon) - Number(b.lon)).map((vent) => vent.name));
  appendNamed(path, legs, used, ["Piip Submarine Volcano", "Kagamil Island"]);
  appendNamed(path, legs, used, vents.filter((vent) => vent.region === "Explorer Ridge" || vent.region === "JdF Ridge" || vent.region === "Gorda Ridge" || vent.region === "Coastal California").sort((a, b) => Number(b.lat) - Number(a.lat)).map((vent) => vent.name));
  appendVisit(path, legs, ["San Francisco"]);
  const distances = legs.map((leg) => leg.km).sort((a, b) => a - b);
  const shortMax = distances[Math.floor((distances.length - 1) / 3)];
  const midMax = distances[Math.floor((2 * (distances.length - 1)) / 3)];
  const bands = { shortest: [], mid: [], farthest: [] };
  for (const leg of legs) {
    leg.band = courseBand(leg.km, shortMax, midMax);
    bands[leg.band].push(leg);
  }
  return { path, legs, shortMax, midMax, bands };
}

const courseSummary = computeCourses();

function latLonToVec3(lat, lon, radius) {
  const φ = toRad(lat);
  const λ = toRad(lon);
  const cosφ = Math.cos(φ);
  return new THREE.Vector3(
    radius * Math.cos(λ) * cosφ,
    radius * Math.sin(φ),
    -radius * Math.sin(λ) * cosφ,
  );
}

const scene = new THREE.Scene();
scene.background = new THREE.Color("#03070c");

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
camera.position.set(0, 0, distance);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
globeEl.insertBefore(renderer.domElement, globeEl.firstChild);

const globe = new THREE.Group();
scene.add(globe);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.35);
sun.position.set(-2.5, 1.4, 3);
scene.add(sun);

function oceanCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, "#e7eef4");
  gradient.addColorStop(0.07, "#1c5c98");
  gradient.addColorStop(0.5, "#0a3d72");
  gradient.addColorStop(0.93, "#1c5c98");
  gradient.addColorStop(1, "#f4f7fa");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = "rgba(190, 220, 235, 0.28)";
  for (let i = 1; i < 12; i += 1) {
    const x = (i / 12) * 1024;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let i = 1; i < 6; i += 1) {
    const y = (i / 6) * 512;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 80, 48),
  new THREE.MeshPhongMaterial({
    map: oceanCanvas(),
    specular: new THREE.Color("#16324a"),
    shininess: 12,
  }),
);
globe.add(earth);

new THREE.TextureLoader().load("vendor/earth.jpg", (texture) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  earth.material.map = texture;
  earth.material.needsUpdate = true;
  setTimeout(sendScreen, 1600);
});

async function sendScreen() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const shot = document.createElement("canvas");
  shot.width = width;
  shot.height = height;
  const ctx = shot.getContext("2d");
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#071018";
  ctx.fillRect(0, 0, width, height);
  try {
    const css = await (await fetch("styles.css", { cache: "no-store" })).text();
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll("script, canvas, noscript").forEach((node) => node.remove());
    const style = doc.ownerDocument.createElement("style");
    style.textContent = css;
    doc.querySelector("head").append(style);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(doc)}</foreignObject></svg>`;
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  } catch (err) {}
  const view = renderer.domElement.getBoundingClientRect();
  ctx.drawImage(renderer.domElement, view.left, view.top, view.width, view.height);
  const blob = await new Promise((resolve) => shot.toBlob(resolve, "image/png"));
  if (!blob) return;
  await fetch("/api/screen/shot", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });
}

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.08, 64, 40),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float rim = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
        gl_FragColor = vec4(0.45, 0.72, 1.0, 1.0) * rim;
      }
    `,
  }),
);
scene.add(atmosphere);

const starPositions = new Float32Array(900 * 3);
for (let i = 0; i < 900; i += 1) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const radius = 18 + Math.random() * 10;
  starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
  starPositions[i * 3 + 1] = radius * Math.cos(phi);
  starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
}
const stars = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: "#c5d4e4", size: 0.035, sizeAttenuation: true }),
);
stars.geometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
scene.add(stars);

function graticule() {
  const positions = [];
  const push = (lat, lon) => {
    const point = latLonToVec3(lat, lon, 1.002);
    positions.push(point.x, point.y, point.z);
  };
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 3) {
      push(lat, lon);
      push(lat, lon + 3);
    }
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 3) {
      push(lat, lon);
      push(Math.min(90, lat + 3), lon);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: "#d5e6f2", transparent: true, opacity: 0.18 }),
  );
}
globe.add(graticule());

function courseRibbon(legs) {
  const positions = [];
  const colors = [];
  const half = 0.0032 / 6;
  for (const leg of legs) {
    const samples = geodesic(
      Number(leg.from.lat),
      Number(leg.from.lon),
      Number(leg.to.lat),
      Number(leg.to.lon),
      24,
    ).map(([lat, lon]) => latLonToVec3(lat, lon, 1.008));
    const color = new THREE.Color(COURSE[leg.band]);
    const sides = samples.map((curr, index) => {
      const prev = samples[Math.max(0, index - 1)];
      const next = samples[Math.min(samples.length - 1, index + 1)];
      const forward = next.clone().sub(prev);
      if (forward.lengthSq() < 1e-12) forward.set(0, 1, 0);
      forward.normalize();
      const side = new THREE.Vector3().crossVectors(curr.clone().normalize(), forward);
      if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
      side.normalize().multiplyScalar(half);
      return [curr.clone().add(side), curr.clone().sub(side)];
    });
    for (let index = 0; index < sides.length - 1; index += 1) {
      const [a, b] = sides[index];
      const [c, d] = sides[index + 1];
      for (const point of [a, c, b, b, c, d]) {
        positions.push(point.x, point.y, point.z);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
}

if (courseSummary) globe.add(courseRibbon(courseSummary.legs));

const markerGeometry = new THREE.SphereGeometry(0.014 / 6, 12, 8);
const markerMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, vents.length);
markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const markerDummy = new THREE.Object3D();
vents.forEach((vent, index) => {
  markers.setColorAt(index, new THREE.Color(STYLES[vent.activity].fill));
  markerDummy.position.copy(latLonToVec3(Number(vent.lat), Number(vent.lon), 1.02));
  markerDummy.scale.setScalar(1);
  markerDummy.updateMatrix();
  markers.setMatrixAt(index, markerDummy.matrix);
});
markers.instanceColor.needsUpdate = true;
globe.add(markers);

const sanFranciscoMarker = new THREE.Mesh(
  markerGeometry,
  new THREE.MeshBasicMaterial({ color: "#49589C" }),
);
sanFranciscoMarker.position.copy(latLonToVec3(Number(sanFrancisco.lat), Number(sanFrancisco.lon), 1.02));
globe.add(sanFranciscoMarker);

const picturedVents = vents.filter((vent) => imageFiles(vent.name).length);
const photoMarkers = new THREE.InstancedMesh(
  markerGeometry,
  new THREE.MeshBasicMaterial({ color: "#4c9dff" }),
  Math.max(picturedVents.length, 1),
);
photoMarkers.count = picturedVents.length;
photoMarkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const PHOTO_SCALE = 2.15;

function photoPosition(vent) {
  return latLonToVec3(Number(vent.lat), Number(vent.lon), 1.016);
}

picturedVents.forEach((vent, index) => {
  photoMarkers.setColorAt(index, new THREE.Color("#4c9dff"));
  markerDummy.position.copy(photoPosition(vent));
  markerDummy.scale.setScalar(PHOTO_SCALE);
  markerDummy.rotation.set(0, 0, 0);
  markerDummy.updateMatrix();
  photoMarkers.setMatrixAt(index, markerDummy.matrix);
});
if (picturedVents.length) {
  photoMarkers.instanceColor.needsUpdate = true;
  globe.add(photoMarkers);
}

const missionMarkers = new THREE.InstancedMesh(
  markerGeometry,
  new THREE.MeshBasicMaterial({ color: "#ff6eb4" }),
  Math.max(MISSIONS.length, 1),
);
missionMarkers.count = MISSIONS.length;
MISSIONS.forEach((mission, index) => {
  markerDummy.position.copy(latLonToVec3(Number(mission.lat), Number(mission.lon), 1.024));
  markerDummy.scale.setScalar(1);
  markerDummy.rotation.set(0, 0, 0);
  markerDummy.updateMatrix();
  missionMarkers.setMatrixAt(index, markerDummy.matrix);
});
if (MISSIONS.length) globe.add(missionMarkers);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.022 / 6, 0.03 / 6, 28),
  new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide }),
);
ring.visible = false;
globe.add(ring);

function placeRing(vent) {
  const pos = latLonToVec3(Number(vent.lat), Number(vent.lon), 1.025);
  ring.position.copy(pos);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
  ring.visible = true;
}

function updateMarkers() {
  vents.forEach((vent, index) => {
    const visible = matches(vent);
    const selected = vent.name === selectedName;
    if (visible) {
      markerDummy.position.copy(latLonToVec3(Number(vent.lat), Number(vent.lon), 1.02));
      markerDummy.scale.setScalar(selected ? 1.85 : 1);
    } else {
      markerDummy.position.set(0, 0, 0);
      markerDummy.scale.setScalar(0.001);
    }
    markerDummy.rotation.set(0, 0, 0);
    markerDummy.updateMatrix();
    markers.setMatrixAt(index, markerDummy.matrix);
  });
  markers.instanceMatrix.needsUpdate = true;
  sanFranciscoMarker.scale.setScalar(selectedName === sanFrancisco.name ? 1.85 : 1);
  picturedVents.forEach((vent, index) => {
    if (matches(vent)) {
      markerDummy.position.copy(photoPosition(vent));
      markerDummy.scale.setScalar(vent.name === selectedName ? PHOTO_SCALE * 1.85 : PHOTO_SCALE);
    } else {
      markerDummy.position.set(0, 0, 0);
      markerDummy.scale.setScalar(0.001);
    }
    markerDummy.rotation.set(0, 0, 0);
    markerDummy.updateMatrix();
    photoMarkers.setMatrixAt(index, markerDummy.matrix);
  });
  photoMarkers.instanceMatrix.needsUpdate = true;
  const selected = selectedName ? byName.get(selectedName) : null;
  if (selected && matches(selected)) placeRing(selected);
  else ring.visible = false;
}

function renderList(shown) {
  if (!shown.length) {
    listEl.innerHTML = '<p class="empty">No fields match these filters.</p>';
    return;
  }
  const html = shown
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((vent) => {
      const ventsLabel = vent.sites.length ? ` · ${vent.sites.length} named vents` : "";
      const current = vent.name === selectedName ? ' aria-current="true"' : "";
      const photo = imageFiles(vent.name).length ? photoDot() : "";
      return `<button type="button" class="field" data-name="${esc(vent.name)}"${current}><span class="dots"><span class="dot" data-activity="${esc(vent.activity)}"></span>${photo}</span><span><span class="field-name">${esc(vent.name)}</span><span class="field-meta">${esc(vent.region)}${ventsLabel}</span></span></button>`;
    })
    .join("");
  listEl.innerHTML = html;
}

function render() {
  updateMarkers();
}

function select(name, options) {
  const vent = byName.get(name);
  if (!vent || !matches(vent)) return;
  pinnedMissions = null;
  selectedName = name;
  focusPlaylist(name);
  infoboxEl.innerHTML = popupHtml(vent);
  placeInfobox(vent);
  updateMarkers();
  if (options && options.fly) face(Number(vent.lat), Number(vent.lon), { approach: true });
  history.replaceState(null, "", `#field=${encodeURIComponent(name)}`);
}

function setDistance(next) {
  distance = Math.min(6.2, Math.max(1.35, next));
  camera.position.z = distance;
}

function trackSamples(summary) {
  const samples = [];
  let km = 0;
  for (const leg of summary.legs) {
    const points = geodesic(
      Number(leg.from.lat),
      Number(leg.from.lon),
      Number(leg.to.lat),
      Number(leg.to.lon),
      24,
    );
    for (let index = 0; index < points.length; index += 1) {
      if (index === 0 && samples.length) continue;
      const [lat, lon] = points[index];
      if (samples.length) {
        const prev = samples[samples.length - 1];
        let dLon = lon - prev.lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        km += haversineKm(prev.lat, prev.lon, lat, prev.lon + dLon);
      }
      samples.push({ lat, lon, km });
    }
  }
  return samples;
}

function sampleAtKm(samples, km) {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].km < km) lo = mid + 1;
    else hi = mid;
  }
  const next = samples[lo];
  const prev = samples[Math.max(0, lo - 1)];
  if (prev === next || next.km === prev.km) return next;
  const t = (km - prev.km) / (next.km - prev.km);
  let dLon = next.lon - prev.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return {
    lat: prev.lat + (next.lat - prev.lat) * t,
    lon: prev.lon + dLon * t,
  };
}

const viewForward = new THREE.Vector3(0, 0, 1);
const north = new THREE.Vector3(0, 1, 0);
const rollAxis = new THREE.Vector3(0, 0, 1);
const orientQ = new THREE.Quaternion();
const rollQ = new THREE.Quaternion();
const northScratch = new THREE.Vector3();

function orientationAt(lat, lon, previousRoll) {
  const point = latLonToVec3(lat, lon, 1).normalize();
  orientQ.setFromUnitVectors(point, viewForward);
  northScratch.copy(north).applyQuaternion(orientQ);
  let roll = Math.atan2(northScratch.x, northScratch.y);
  if (previousRoll != null) {
    while (roll - previousRoll > Math.PI) roll -= Math.PI * 2;
    while (previousRoll - roll > Math.PI) roll += Math.PI * 2;
  }
  rollQ.setFromAxisAngle(rollAxis, -roll);
  rollQ.multiply(orientQ);
  return { quaternion: rollQ, roll };
}

const traveler = new THREE.Mesh(
  new THREE.SphereGeometry(0.02 / 6, 16, 12),
  new THREE.MeshBasicMaterial({ color: "#ffffff" }),
);
traveler.visible = false;
globe.add(traveler);

function placeTraveler(lat, lon) {
  traveler.position.copy(latLonToVec3(lat, lon, 1.035));
  traveler.visible = true;
}

function setPlayButton(paused) {
  const button = document.getElementById("play");
  if (!button) return;
  button.textContent = paused ? "\u25B6" : "\u275A\u275A";
  button.setAttribute("aria-label", paused ? "Play" : "Pause");
}

function pauseFollow() {
  if (!follow || follow.paused) return;
  follow.elapsed = (performance.now() - follow.start) % follow.dur;
  follow.paused = true;
  setPlayButton(true);
}

function playFollow() {
  if (!follow) {
    beginFollow();
    return;
  }
  if (follow.elapsed >= follow.dur) follow.elapsed = 0;
  follow.paused = false;
  follow.start = performance.now() - follow.elapsed;
  setPlayButton(false);
}

function seekFollow(km) {
  if (!follow) beginFollow();
  const clamped = Math.max(0, Math.min(follow.totalKm, km));
  follow.elapsed = follow.totalKm ? (clamped / follow.totalKm) * follow.dur : 0;
  follow.paused = true;
  follow.start = performance.now() - follow.elapsed;
  followOwnsZoom = false;
  setPlayButton(true);
  const at = sampleAtKm(follow.samples, clamped);
  follow.roll = orientationAt(at.lat, at.lon, follow.roll).roll;
  follow.picture = showPassing(follow, clamped, performance.now(), null);
  placeTraveler(at.lat, at.lon);
}

function beginFollow() {
  const samples = trackSamples(courseSummary);
  const totalKm = samples[samples.length - 1].km;
  if (!totalKm) return;
  followOwnsZoom = true;
  follow = {
    samples,
    totalKm,
    stops: picturedStops(courseSummary),
    start: performance.now(),
    elapsed: 0,
    paused: false,
    dur: (totalKm / 48) * 1000,
    fromDistance: distance,
    toDistance: 1.78,
    roll: null,
    picture: null,
  };
  setPlayButton(false);
  follow.picture = showPassing(follow, 0, follow.start, null);
  const posed = orientationAt(samples[0].lat, samples[0].lon, null);
  globe.quaternion.copy(posed.quaternion);
  follow.roll = posed.roll;
  placeTraveler(samples[0].lat, samples[0].lon);
}

function stepFollow(now) {
  if (follow.paused) return;
  const elapsed = now - follow.start;
  const wrapped = elapsed % follow.dur;
  const at = sampleAtKm(follow.samples, follow.totalKm * (wrapped / follow.dur));
  const posed = orientationAt(at.lat, at.lon, follow.roll);
  globe.quaternion.copy(posed.quaternion);
  follow.roll = posed.roll;
  placeTraveler(at.lat, at.lon);
  follow.picture = showPassing(follow, follow.totalKm * (wrapped / follow.dur), now, follow.picture);
  const zoomT = Math.min(1, elapsed / 2800);
  if (followOwnsZoom && zoomT < 1) {
    const eased = zoomT < 0.5 ? 2 * zoomT * zoomT : 1 - ((-2 * zoomT + 2) ** 2) / 2;
    setDistance(follow.fromDistance + (follow.toDistance - follow.fromDistance) * eased);
  }
}

function face(lat, lon, options) {
  pauseFollow();
  const approach = options && options.approach;
  const to = new THREE.Quaternion().setFromUnitVectors(
    latLonToVec3(lat, lon, 1).normalize(),
    new THREE.Vector3(0, 0, 1),
  );
  const toDistance = approach ? Math.min(distance, 1.9) : distance;
  if (options && options.immediate) {
    globe.quaternion.copy(to);
    setDistance(toDistance);
    anim = null;
    return;
  }
  anim = {
    from: globe.quaternion.clone(),
    to,
    fromDistance: distance,
    toDistance,
    start: performance.now(),
    dur: 850,
  };
}

const yAxis = new THREE.Vector3(0, 1, 0);
const xAxis = new THREE.Vector3(1, 0, 0);
const yaw = new THREE.Quaternion();
const pitch = new THREE.Quaternion();

function rotateBy(dx, dy) {
  yaw.setFromAxisAngle(yAxis, dx);
  pitch.setFromAxisAngle(xAxis, dy);
  globe.quaternion.premultiply(yaw.multiply(pitch));
}

function resize() {
  const width = globeEl.clientWidth;
  const height = globeEl.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function overlayPoint(element, lat, lon) {
  const world = latLonToVec3(lat, lon, 1.03).applyQuaternion(globe.quaternion);
  if (world.dot(camera.position) <= 0.12) {
    element.hidden = true;
    return;
  }
  const projected = world.project(camera);
  const width = globeEl.clientWidth;
  const height = globeEl.clientHeight;
  element.hidden = false;
  element.style.transform = `translate(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height}px) translate(-50%, -140%)`;
}

const pickScratch = new THREE.Vector3();

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best = null;
  let bestDist = 22;
  for (const vent of vents.concat(sanFrancisco)) {
    if (!matches(vent)) continue;
    const spots = [latLonToVec3(Number(vent.lat), Number(vent.lon), 1.02)];
    if (imageFiles(vent.name).length) spots.push(photoPosition(vent));
    for (const spot of spots) {
      pickScratch.copy(spot);
      pickScratch.applyQuaternion(globe.quaternion);
      if (pickScratch.dot(camera.position) <= 0.12) continue;
      pickScratch.project(camera);
      const px = (pickScratch.x * 0.5 + 0.5) * rect.width;
      const py = (-pickScratch.y * 0.5 + 0.5) * rect.height;
      const dist = Math.hypot(px - x, py - y);
      if (dist <= bestDist) {
        best = vent;
        bestDist = dist;
      }
    }
  }
  return best ? { vent: best, dist: bestDist } : null;
}

function missionsAt(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hits = [];
  for (const mission of MISSIONS) {
    pickScratch.copy(latLonToVec3(Number(mission.lat), Number(mission.lon), 1.024));
    pickScratch.applyQuaternion(globe.quaternion);
    if (pickScratch.dot(camera.position) <= 0.12) continue;
    pickScratch.project(camera);
    const px = (pickScratch.x * 0.5 + 0.5) * rect.width;
    const py = (-pickScratch.y * 0.5 + 0.5) * rect.height;
    const dist = Math.hypot(px - x, py - y);
    if (dist <= 22) hits.push({ mission, dist });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.dist - b.dist);
  const nearest = hits[0].dist;
  return { list: hits.filter((hit) => hit.dist <= nearest + 0.5).map((hit) => hit.mission), dist: nearest };
}

let drag = null;
const canvas = renderer.domElement;
canvas.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
  anim = null;
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grabbing";
});
canvas.addEventListener("pointermove", (event) => {
  if (drag && event.pointerId === drag.id) {
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      if (!drag.moved) pauseFollow();
      drag.moved = true;
    }
    if (drag.moved) rotateBy(dx * 0.005, dy * 0.005);
    drag.x = event.clientX;
    drag.y = event.clientY;
    return;
  }
  const ventHit = pick(event);
  const missionHit = missionsAt(event);
  if (missionHit && (!ventHit || missionHit.dist <= ventHit.dist)) {
    hovered = {
      lat: missionHit.list[0].lat,
      lon: missionHit.list[0].lon,
      name: missionHit.list.map((mission) => mission.name).join(" · "),
    };
  } else hovered = ventHit ? ventHit.vent : null;
  tipEl.hidden = !hovered;
  if (hovered) tipEl.textContent = hovered.name;
  canvas.style.cursor = hovered ? "pointer" : "grab";
});
canvas.addEventListener("pointerup", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const moved = drag.moved;
  drag = null;
  canvas.style.cursor = "grab";
  if (!moved) {
    const ventHit = pick(event);
    const missionHit = missionsAt(event);
    if (missionHit && (!ventHit || missionHit.dist <= ventHit.dist)) showMissions(missionHit.list);
    else if (ventHit) {
      select(ventHit.vent.name, { fly: false });
      const stop = playlistStops.find((entry) => entry.vent.name === ventHit.vent.name);
      if (stop) seekFollow(stop.km);
    } else closePopup();
  }
});
canvas.addEventListener("pointerleave", () => {
  if (!drag) hovered = null;
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  anim = null;
  setDistance(distance * (event.deltaY > 0 ? 1.09 : 0.92));
}, { passive: false });

document.getElementById("play").addEventListener("click", () => {
  if (!follow || follow.paused) playFollow();
  else pauseFollow();
});

let idleTimer = 0;
function noteActivity() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!follow || follow.paused) playFollow();
  }, 30000);
}
document.addEventListener("pointerdown", noteActivity);
document.addEventListener("pointerup", noteActivity);
document.addEventListener("pointermove", (event) => {
  if (event.buttons) noteActivity();
});
document.addEventListener("wheel", noteActivity, { passive: true });
document.addEventListener("keydown", noteActivity);
document.getElementById("zoom-in").addEventListener("click", () => {
  anim = null;
  setDistance(distance / 1.25);
});
document.getElementById("zoom-out").addEventListener("click", () => {
  anim = null;
  setDistance(distance * 1.25);
});

new ResizeObserver(resize).observe(globeEl);
resize();

function animate(now) {
  if (anim) {
    const t = Math.min(1, (now - anim.start) / anim.dur);
    const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    globe.quaternion.slerpQuaternions(anim.from, anim.to, eased);
    setDistance(anim.fromDistance + (anim.toDistance - anim.fromDistance) * eased);
    if (t >= 1) anim = null;
  } else if (follow) stepFollow(now);
  renderer.render(scene, camera);
  if (hovered) overlayPoint(tipEl, Number(hovered.lat), Number(hovered.lon));
  else tipEl.hidden = true;
  if (matches(sanFrancisco)) overlayPoint(originLabel, Number(sanFrancisco.lat), Number(sanFrancisco.lon));
  else originLabel.hidden = true;
  if (selectedName) {
    const selectedVent = byName.get(selectedName);
    if (selectedVent && matches(selectedVent)) placeInfobox(selectedVent);
    else infoboxEl.hidden = true;
  } else if (pinnedMissions) placeInfobox(pinnedMissions[0]);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

function bandText(band, label, lo, hi) {
  const legs = courseSummary.bands[band];
  if (!legs.length) return "";
  return `<div><span class="swatch" style="background:${COURSE[band]}"></span><span>${label}, ${formatKm(lo)}–${formatKm(hi)}</span></div>`;
}

const activityLegend = [
  ["active, confirmed", "active, confirmed"],
  ["active, inferred", "active, inferred"],
  ["inactive", "inactive"],
]
  .map(([activityName, label]) => `<div><i class="dot" data-activity="${activityName}"></i><span>${label}</span></div>`)
  .join("");
const courseLegend = courseSummary
  ? `<p class="legend-title">San Francisco, around Antarctica, and back</p>${
    bandText("shortest", "shortest hops", Math.min(...courseSummary.bands.shortest.map((leg) => leg.km)), courseSummary.shortMax)
    + bandText("mid", "mid hops", Math.min(...courseSummary.bands.mid.map((leg) => leg.km)), courseSummary.midMax)
    + bandText("farthest", "farthest hops", Math.min(...courseSummary.bands.farthest.map((leg) => leg.km)), Math.max(...courseSummary.bands.farthest.map((leg) => leg.km)))
  }`
  : "";
legendEl.innerHTML = `<p class="legend-title">Activity</p>${activityLegend}<div><i class="dot dot-photo"></i><span>has photos</span></div><div><i class="dot dot-mission"></i><span>expedition</span></div>${courseLegend}<p class="legend-note">The view follows the track. Drag pauses it until you press play.</p>`;

infoboxEl.addEventListener("click", (event) => {
  if (event.target.closest(".infobox-close")) closePopup();
});

render();
buildPlaylist();
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
if (courseSummary) beginFollow();
