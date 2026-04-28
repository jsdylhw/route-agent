const state = {
  mode: "start",
  start: null,
  end: null,
  startMarker: null,
  endMarker: null,
  routeLayer: null
};

const map = L.map("map", {
  zoomControl: true
}).setView([30.246, 120.129], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const elements = {
  profile: document.querySelector("#profile"),
  modeStart: document.querySelector("#modeStart"),
  modeEnd: document.querySelector("#modeEnd"),
  hangzhouPreset: document.querySelector("#hangzhouPreset"),
  routeButton: document.querySelector("#routeButton"),
  startText: document.querySelector("#startText"),
  endText: document.querySelector("#endText"),
  status: document.querySelector("#status"),
  distance: document.querySelector("#distance"),
  gain: document.querySelector("#gain"),
  loss: document.querySelector("#loss"),
  maxGrade: document.querySelector("#maxGrade"),
  straightTurns: document.querySelector("#straightTurns"),
  leftTurns: document.querySelector("#leftTurns"),
  rightTurns: document.querySelector("#rightTurns"),
  sharpTurns: document.querySelector("#sharpTurns"),
  gradeSections: document.querySelector("#gradeSections"),
  surfaceList: document.querySelector("#surfaceList")
};

function setMode(mode) {
  state.mode = mode;
  elements.modeStart.classList.toggle("active", mode === "start");
  elements.modeEnd.classList.toggle("active", mode === "end");
}

function formatCoordinate(point) {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

function updatePointText() {
  elements.startText.textContent = state.start ? formatCoordinate(state.start) : "点击地图选择";
  elements.endText.textContent = state.end ? formatCoordinate(state.end) : "点击地图选择";
}

function setPoint(mode, point) {
  const marker = L.marker([point.lat, point.lon], {
    title: mode === "start" ? "起点" : "终点"
  }).bindPopup(mode === "start" ? "起点" : "终点");

  if (mode === "start") {
    if (state.startMarker) state.startMarker.remove();
    state.start = point;
    state.startMarker = marker.addTo(map);
    setMode("end");
  } else {
    if (state.endMarker) state.endMarker.remove();
    state.end = point;
    state.endMarker = marker.addTo(map);
  }

  updatePointText();
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`;
}

function renderAnalysis(analysis) {
  elements.distance.textContent = formatDistance(analysis.distanceMeters);
  elements.gain.textContent = `${analysis.elevationGainMeters} m`;
  elements.loss.textContent = `${analysis.elevationLossMeters} m`;
  elements.maxGrade.textContent = `${analysis.maxGradePercent}%`;
  elements.straightTurns.textContent = analysis.turns.straight;
  elements.leftTurns.textContent = analysis.turns.left;
  elements.rightTurns.textContent = analysis.turns.right;
  elements.sharpTurns.textContent = analysis.turns.sharp;

  if (analysis.gradeSections.length > 0) {
    elements.gradeSections.innerHTML = analysis.gradeSections
      .slice(0, 12)
      .map((section) => {
        const label = section.type === "climb" ? "爬坡" : section.type === "descent" ? "下坡" : "平路";
        return `<li><span>${label} ${section.startKm}-${section.endKm} km</span><strong>${section.distanceKm} km / ${section.elevationMeters} m</strong></li>`;
      })
      .join("");
  } else {
    elements.gradeSections.innerHTML = "<li>没有识别到明显坡度区间。</li>";
  }

  if (analysis.surfaces.length > 0) {
    elements.surfaceList.innerHTML = analysis.surfaces
      .map((item) => `<li><span>${item.name}</span><strong>${item.count}</strong></li>`)
      .join("");
  } else {
    elements.surfaceList.innerHTML = "<li>BRouter 这次没有返回路面/道路标签。</li>";
  }
}

function drawRoute(geojson) {
  if (state.routeLayer) {
    state.routeLayer.remove();
  }

  state.routeLayer = L.geoJSON(geojson, {
    style: {
      color: "#d06d2d",
      weight: 5,
      opacity: 0.92
    }
  }).addTo(map);

  map.fitBounds(state.routeLayer.getBounds(), {
    padding: [24, 24]
  });
}

async function calculateRoute() {
  if (!state.start || !state.end) {
    setStatus("请先选择起点和终点。", true);
    return;
  }

  setStatus("正在请求 BRouter 并分析路线...");
  elements.routeButton.disabled = true;

  try {
    const params = new URLSearchParams({
      from: `${state.start.lon},${state.start.lat}`,
      to: `${state.end.lon},${state.end.lat}`,
      profile: elements.profile.value
    });
    const response = await fetch(`/api/route?${params}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "路线请求失败");
    }

    drawRoute(payload.geojson);
    renderAnalysis(payload.analysis);
    setStatus(`路线已生成：${payload.profile} profile，${payload.analysis.pointCount} 个轨迹点。`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "路线请求失败", true);
  } finally {
    elements.routeButton.disabled = false;
  }
}

map.on("click", (event) => {
  setPoint(state.mode, {
    lat: event.latlng.lat,
    lon: event.latlng.lng
  });
});

elements.modeStart.addEventListener("click", () => setMode("start"));
elements.modeEnd.addEventListener("click", () => setMode("end"));
elements.routeButton.addEventListener("click", calculateRoute);
elements.hangzhouPreset.addEventListener("click", () => {
  setPoint("start", { lat: 30.25866, lon: 120.13033 });
  setPoint("end", { lat: 30.21498, lon: 120.10043 });
  map.setView([30.237, 120.116], 13);
  setStatus("已填入杭州示例点，可以直接计算。");
});

updatePointText();
