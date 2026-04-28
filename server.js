import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 8799);
const brouterBaseUrl = process.env.BROUTER_URL || "https://brouter.de/brouter";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function parseLonLat(value, label) {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }

  const [lonRaw, latRaw] = value.split(",");
  const lon = Number(lonRaw);
  const lat = Number(latRaw);

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`Invalid ${label}; expected "lon,lat"`);
  }

  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(`Invalid ${label}; coordinate is out of range`);
  }

  return { lon, lat };
}

function normalizeProfile(value) {
  const allowed = new Set(["trekking", "fastbike", "safety", "shortest"]);
  return allowed.has(value) ? value : "trekking";
}

function buildBrouterUrl(from, to, profile) {
  const url = new URL(brouterBaseUrl);
  url.searchParams.set("lonlats", `${from.lon},${from.lat}|${to.lon},${to.lat}`);
  url.searchParams.set("profile", profile);
  url.searchParams.set("alternativeidx", "0");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("timode", "2");
  url.searchParams.set("trackname", "Route Agent Demo");
  return url;
}

function getRouteCoordinates(geojson) {
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  const line = features.find((feature) => feature?.geometry?.type === "LineString");
  return Array.isArray(line?.geometry?.coordinates) ? line.geometry.coordinates : [];
}

function haversineMeters(a, b) {
  const radius = 6371008.8;
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDegrees(a, b) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

function normalizeDelta(degrees) {
  return ((degrees + 540) % 360) - 180;
}

function classifyTurn(delta) {
  const abs = Math.abs(delta);
  if (abs < 25) return "straight";
  if (abs > 120) return "sharp";
  return delta > 0 ? "right" : "left";
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function pushGradeSection(sections, type, startDistance, endDistance, gain) {
  if (endDistance - startDistance < 80) {
    return;
  }

  sections.push({
    type,
    startKm: round(startDistance / 1000, 2),
    endKm: round(endDistance / 1000, 2),
    distanceKm: round((endDistance - startDistance) / 1000, 2),
    elevationMeters: Math.round(gain)
  });
}

function extractSurfaceSummary(geojson) {
  const counts = new Map();
  const candidates = ["surface", "highway", "smoothness", "tracktype"];

  for (const feature of geojson.features || []) {
    const properties = feature.properties || {};

    for (const key of candidates) {
      const value = properties[key];
      if (typeof value === "string" && value.trim()) {
        counts.set(`${key}:${value}`, (counts.get(`${key}:${value}`) || 0) + 1);
      }
    }

    const messages = Array.isArray(properties.messages) ? properties.messages : [];
    const header = Array.isArray(messages[0]) ? messages[0] : [];
    const wayTagsIndex = header.indexOf("WayTags");
    if (wayTagsIndex === -1) {
      continue;
    }

    for (const row of messages.slice(1)) {
      const wayTags = row?.[wayTagsIndex];
      if (typeof wayTags !== "string") {
        continue;
      }

      for (const tag of wayTags.split(/\s+/)) {
        if (!tag.includes("=")) {
          continue;
        }

        const [key] = tag.split("=");
        if (candidates.includes(key)) {
          counts.set(tag, (counts.get(tag) || 0) + 1);
        }
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));
}

function analyzeRoute(geojson) {
  const coordinates = getRouteCoordinates(geojson);
  const stats = {
    pointCount: coordinates.length,
    distanceMeters: 0,
    elevationGainMeters: 0,
    elevationLossMeters: 0,
    maxElevationMeters: null,
    avgGradePercent: 0,
    maxGradePercent: 0,
    turns: {
      straight: 0,
      left: 0,
      right: 0,
      sharp: 0
    },
    gradeSections: [],
    surfaces: extractSurfaceSummary(geojson)
  };

  if (coordinates.length < 2) {
    return stats;
  }

  let gradeDistance = 0;
  let weightedGrade = 0;
  let currentSection = null;
  let cumulativeDistance = 0;

  for (const coordinate of coordinates) {
    if (Number.isFinite(coordinate[2])) {
      stats.maxElevationMeters = Math.max(stats.maxElevationMeters ?? coordinate[2], coordinate[2]);
    }
  }

  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    const distance = haversineMeters(previous, current);
    const previousDistance = cumulativeDistance;
    cumulativeDistance += distance;
    stats.distanceMeters += distance;

    const hasElevation = Number.isFinite(previous[2]) && Number.isFinite(current[2]);
    if (!hasElevation || distance <= 0) {
      continue;
    }

    const elevationDelta = current[2] - previous[2];
    if (elevationDelta > 0) stats.elevationGainMeters += elevationDelta;
    if (elevationDelta < 0) stats.elevationLossMeters += Math.abs(elevationDelta);

    const grade = (elevationDelta / distance) * 100;
    if (distance >= 20) {
      stats.maxGradePercent = Math.max(stats.maxGradePercent, Math.abs(grade));
      weightedGrade += grade * distance;
      gradeDistance += distance;
    }

    const type = grade > 3 ? "climb" : grade < -3 ? "descent" : "flat";
    if (!currentSection) {
      currentSection = {
        type,
        startDistance: previousDistance,
        endDistance: cumulativeDistance,
        gain: elevationDelta
      };
    } else if (currentSection.type === type) {
      currentSection.endDistance = cumulativeDistance;
      currentSection.gain += elevationDelta;
    } else {
      pushGradeSection(
        stats.gradeSections,
        currentSection.type,
        currentSection.startDistance,
        currentSection.endDistance,
        currentSection.gain
      );
      currentSection = {
        type,
        startDistance: previousDistance,
        endDistance: cumulativeDistance,
        gain: elevationDelta
      };
    }
  }

  if (currentSection) {
    pushGradeSection(
      stats.gradeSections,
      currentSection.type,
      currentSection.startDistance,
      currentSection.endDistance,
      currentSection.gain
    );
  }

  for (let index = 2; index < coordinates.length; index += 1) {
    const a = coordinates[index - 2];
    const b = coordinates[index - 1];
    const c = coordinates[index];
    const beforeDistance = haversineMeters(a, b);
    const afterDistance = haversineMeters(b, c);

    if (beforeDistance < 25 || afterDistance < 25) {
      continue;
    }

    const delta = normalizeDelta(bearingDegrees(b, c) - bearingDegrees(a, b));
    stats.turns[classifyTurn(delta)] += 1;
  }

  stats.distanceMeters = Math.round(stats.distanceMeters);
  stats.elevationGainMeters = Math.round(stats.elevationGainMeters);
  stats.elevationLossMeters = Math.round(stats.elevationLossMeters);
  stats.maxElevationMeters =
    stats.maxElevationMeters === null ? null : Math.round(stats.maxElevationMeters);
  stats.avgGradePercent = gradeDistance > 0 ? round(weightedGrade / gradeDistance, 1) : 0;
  stats.maxGradePercent = round(stats.maxGradePercent, 1);
  return stats;
}

async function handleRouteRequest(req, res) {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const from = parseLonLat(requestUrl.searchParams.get("from"), "from");
    const to = parseLonLat(requestUrl.searchParams.get("to"), "to");
    const profile = normalizeProfile(requestUrl.searchParams.get("profile"));
    const brouterUrl = buildBrouterUrl(from, to, profile);

    const response = await fetch(brouterUrl, {
      headers: { accept: "application/json" }
    });
    const text = await response.text();

    if (!response.ok) {
      sendJson(res, response.status, {
        error: "BRouter request failed",
        detail: text.slice(0, 600)
      });
      return;
    }

    const geojson = JSON.parse(text);
    sendJson(res, 200, {
      provider: "brouter",
      profile,
      requestUrl: brouterUrl.toString(),
      geojson,
      analysis: analyzeRoute(geojson)
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Unknown route error"
    });
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes.get(ext) || "application/octet-stream"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/route")) {
    void handleRouteRequest(req, res);
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`Route Agent demo: http://localhost:${port}`);
  console.log(`BRouter endpoint: ${brouterBaseUrl}`);
});
