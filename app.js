// Tribin (simple version)
// Shows how full each compartment of every campus tri-bin is, so workers
// know which bins to empty. Admins can also add and remove workers.

const UPDATE_EVERY_SECONDS = 3;
const SAVE_KEY = "tribin-simple-v1";

const COMPARTMENTS = [
  { key: "recycling", label: "Recycle" },
  { key: "landfill", label: "Landfill" },
  { key: "compost", label: "Compost" },
];

const STATUS_TEXT = { full: "Needs emptying", almost: "Almost full", ok: "OK", offline: "Sensor offline" };

// The real sensor (XIAO ESP32-C3 + A02YYUW) publishes its distance reading to
// this MQTT topic on a free public broker. It drives one compartment of Bin 3
// ("Test Bin"); every other bin is simulated.
const LIVE = {
  binId: 3,
  key: "landfill",
  label: "Landfill",
  topic: "tribin/amandevio/bin/3",
  broker: "wss://broker.hivemq.com:8884/mqtt",
};
const LIVE_TIMEOUT_MS = 30000; // no reading for this long = sensor offline
const MAP_STATUSES = ["full", "almost", "ok", "offline"];
const SHORT_STATUS = { full: "To empty", almost: "Almost full", ok: "OK", offline: "Offline" };

// How many percent each part fills per busy hour at an average bin.
const PART_RATE = { recycling: 2.3, landfill: 3.2, compost: 1.3 };
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Small line icons used across the pages.
const ICONS = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>',
  bins: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.3v.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  wifiOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.8a10 10 0 0 1 5-2.7"/><path d="M14.2 10.2A10 10 0 0 1 19 12.8"/><path d="M12 20h.01"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  nav: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  signOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5"/><path d="M15 12H4"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.2"/></svg>',
  battery: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="7.5" width="16.5" height="9" rx="2"/><path d="M21.5 10.5v3"/><path d="M6 10.5v3"/></svg>',
};

// Bin locations come from bins.js (the project spreadsheet).
const allBins = Array.isArray(window.bins) ? window.bins : [];

let data = loadData();
let currentPage = "home";
let binFilter = "full";
let zoneFilter = "all"; // a zone id, "all", or "none"
let searchText = "";
let binSort = "fullest"; // "fullest" or "nearest"
let shownBinIds = "";
let map = null;
const mapMarkers = new Map();
let liveReading = null; // { distanceCm, at } from the real sensor
let liveRelayConnected = false;

// ---------------------------------------------------------------------------
// Saved data (kept in the browser so it survives a refresh)
// ---------------------------------------------------------------------------

function defaultData() {
  const random = seededRandom(131);
  const levels = {};
  allBins.forEach((bin) => {
    // Each bin is somewhere in its fill-up since it was last emptied.
    const speed = fillSpeed(bin.id);
    const hours = (random() * 1.08 * (78 + random() * 20)) / (PART_RATE.landfill * speed);
    const emptiedAt = busyHoursBefore(Date.now(), hours);
    levels[bin.id] = {
      landfill: Math.min(100, PART_RATE.landfill * speed * hours * (0.9 + random() * 0.2)),
      recycling: Math.min(100, PART_RATE.recycling * speed * hours * (0.8 + random() * 0.4)),
      compost: Math.min(100, PART_RATE.compost * speed * hours * (0.7 + random() * 0.6)),
      emptiedAt,
      emptiedBy: null,
      historyAnchor: emptiedAt, // reports simulate the past before this moment
    };
  });
  seedSensorStatus(levels);
  seedBattery(levels);

  const d = {
    settings: { fullAt: 80, almostAt: 50, liveDepthCm: 60, lowBatteryAt: 20, autoEmpty: true },
    workers: [
      { id: 1, name: "Jordan Reyes", email: "jordan.reyes@csus.edu", role: "admin" },
      { id: 2, name: "Maria Lopez", email: "maria.lopez@csus.edu", role: "worker" },
      { id: 3, name: "Diego Alvarez", email: "diego.alvarez@csus.edu", role: "worker" },
      { id: 4, name: "Aisha Mohammed", email: "aisha.mohammed@csus.edu", role: "worker" },
      { id: 5, name: "Kevin Tran", email: "kevin.tran@csus.edu", role: "worker" },
    ],
    levels,
    emptiedLog: [],
    batteryLog: [],
    currentUserId: null,
    nextWorkerId: 6,
  };
  seedZones(d);
  return d;
}

// Starting zones: sports venues together, the rest of campus split into
// north, central and south bands by latitude. Demo workers get one each.
function seedZones(d) {
  d.zones = [
    { id: "z1", name: "North Campus", color: "#2f6fdb" },
    { id: "z2", name: "Central Campus", color: "#1f8a5b" },
    { id: "z3", name: "South Campus", color: "#c98309" },
    { id: "z4", name: "Athletics & Fields", color: "#8c6bd1" },
  ];
  d.nextZoneId = 5;
  d.binZones = {};
  const athletic = /stadium|field|athletic|tennis|\bim\b|soccer|softball|practice|track/i;
  const campus = allBins.filter((bin) => !athletic.test(bin.location)).sort((a, b) => b.latitude - a.latitude);
  campus.forEach((bin, i) => {
    const band = i / campus.length;
    d.binZones[bin.id] = band < 1 / 3 ? "z1" : band < 2 / 3 ? "z2" : "z3";
  });
  allBins.forEach((bin) => {
    if (athletic.test(bin.location)) d.binZones[bin.id] = "z4";
  });
  const starting = { 2: "z1", 3: "z2", 4: "z3", 5: "z4" };
  d.workers.forEach((worker) => {
    if (worker.zoneId === undefined) worker.zoneId = starting[worker.id] || null;
  });
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved && saved.levels && saved.workers) {
      // Data saved before sensors were tracked gets a sensor status now.
      if (!("online" in Object.values(saved.levels)[0])) seedSensorStatus(saved.levels);
      // Data saved with the old compartment names gets the new names.
      Object.values(saved.levels).forEach((level) => {
        if ("trash" in level) {
          level.landfill = level.trash;
          level.recycling = level.recycle;
          level.compost = level.aluminum;
          delete level.trash;
          delete level.recycle;
          delete level.aluminum;
        }
      });
      saved.settings.liveDepthCm ??= 60;
      saved.settings.lowBatteryAt ??= 20;
      saved.settings.autoEmpty ??= true;
      // Data saved before batteries were tracked gets battery levels now.
      if (!Object.values(saved.levels).some((level) => "battery" in level)) seedBattery(saved.levels);
      saved.batteryLog ??= [];
      // Data saved before zones existed gets the starting zones.
      if (!saved.zones) seedZones(saved);
      // Data saved before reports existed: work out when each bin was last
      // emptied from how full it is, and simulate the past before that.
      Object.entries(saved.levels).forEach(([binId, level]) => {
        if (level.historyAnchor) return;
        const hours = Math.min(120, Math.max(0.3, level.landfill / (PART_RATE.landfill * fillSpeed(Number(binId)))));
        level.emptiedAt = level.historyAnchor = busyHoursBefore(Date.now(), hours);
        level.emptiedBy = null;
      });
      return saved;
    }
  } catch {
    // Storage blocked or unreadable: start fresh.
  }
  return defaultData();
}

function saveData() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // The app still works, it just won't remember changes.
  }
}

// A few sensors start offline so the demo shows what that looks like.
function seedSensorStatus(levels) {
  const random = seededRandom(7);
  Object.values(levels).forEach((level) => {
    level.online = random() > 0.035;
    level.lastReading = Date.now() - (level.online ? 0 : (10 + random() * 80) * 60 * 1000);
  });
}

// Sensor batteries: most have plenty left, a few are getting low, and some
// of the offline sensors have gone flat. The live test sensor runs on USB.
function seedBattery(levels) {
  const random = seededRandom(911);
  Object.entries(levels).forEach(([binId, level]) => {
    if (Number(binId) === LIVE.binId) {
      level.battery = null;
      return;
    }
    level.battery = random() < 0.07 ? 3 + random() * 15 : 24 + random() * 76;
    if (!level.online && random() < 0.5) level.battery = 0;
  });
}

function batteryOf(binId) {
  const battery = data.levels[binId].battery;
  return battery == null ? null : Math.round(battery);
}

function isLowBattery(binId) {
  const battery = batteryOf(binId);
  return battery != null && battery <= data.settings.lowBatteryAt;
}

const isDeadBattery = (binId) => batteryOf(binId) === 0;

// Same starting numbers on every fresh load.
function seededRandom(seed) {
  let state = seed * 2654435761;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Sensor readings
// ---------------------------------------------------------------------------

function startOfDay(t) {
  return new Date(t).setHours(0, 0, 0, 0);
}

// Bins fill mostly during the day: 7 am to 7 pm counts fully, nights at 20%.
function busyHoursUntil(t) {
  const local = t - new Date(t).getTimezoneOffset() * 60000;
  const day = Math.floor(local / DAY_MS);
  const x = (local - day * DAY_MS) / HOUR_MS;
  const inDay = x < 7 ? 0.2 * x : x < 19 ? 1.4 + (x - 7) : 13.4 + 0.2 * (x - 19);
  return day * 14.4 + inDay;
}

function busyHours(from, to) {
  return busyHoursUntil(to) - busyHoursUntil(from);
}

// The moment that is `hours` busy hours before `t`.
function busyHoursBefore(t, hours) {
  const target = busyHoursUntil(t) - hours;
  let low = t - 40 * DAY_MS;
  let high = t;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (busyHoursUntil(mid) < target) low = mid;
    else high = mid;
  }
  return high;
}

// Busy spots fill faster than quiet ones.
function fillSpeed(binId) {
  return 0.4 + seededRandom(binId)() * 1.6;
}

// Simulated readings for the demo. When the real sensors are ready, replace
// this with a fetch() from your backend that updates data.levels.
function readSensors() {
  allBins.forEach((bin) => {
    const level = data.levels[bin.id];
    if (bin.id === LIVE.binId) {
      applyLiveReading();
      return;
    }

    // In the demo, sensors occasionally drop out and come back later.
    // An offline sensor sends nothing, so its bin keeps its last reading.
    // With real sensors, mark a bin offline when it hasn't reported in
    // about 30 minutes.
    // Batteries drain slowly, and a flat one means the sensor goes quiet
    // until someone puts in a new battery.
    if (level.battery != null) {
      if (level.online) level.battery = Math.max(0, level.battery - Math.random() * 0.0003);
      if (level.battery < 0.5) level.online = false;
    }
    const hasPower = level.battery == null || level.battery >= 0.5;
    if (level.online && Math.random() < 0.0003) level.online = false;
    else if (!level.online && hasPower && Math.random() < 0.01) level.online = true;
    if (!level.online) return;
    level.lastReading = Date.now();

    const before = { recycling: level.recycling, landfill: level.landfill, compost: level.compost };
    const speed = fillSpeed(bin.id);
    level.landfill = Math.min(100, level.landfill + Math.random() * 0.06 * speed);
    level.recycling = Math.min(100, level.recycling + Math.random() * 0.045 * speed);
    level.compost = Math.min(100, level.compost + Math.random() * 0.025 * speed);

    // In the demo, crews empty some of the full bins without touching the
    // app. The sensor sees the drop and the bin is marked emptied by itself.
    // (With automatic detection off, they tap "Mark emptied" instead.)
    if (fullest(bin.id) >= 85 && Math.random() < 0.02) {
      if (data.settings.autoEmpty) COMPARTMENTS.forEach(({ key }) => (level[key] = Math.random() * 3));
      else emptyBin(bin.id, randomOtherWorker());
    }
    detectEmptying(bin.id, before);
  });
}

// Ultrasonic sensors measure the distance down to the top of the trash.
// Example: in a 90 cm deep bin, a reading of 30 cm means 67% full.
function distanceToPercent(distanceCm, emptyDepthCm = 90) {
  const percent = ((emptyDepthCm - distanceCm) / emptyDepthCm) * 100;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

// ---------------------------------------------------------------------------
// Live sensor
// ---------------------------------------------------------------------------

function liveIsFresh() {
  return Boolean(liveReading && liveReading.at && Date.now() - liveReading.at < LIVE_TIMEOUT_MS);
}

// Copy the latest real reading into the live bin.
function applyLiveReading() {
  const level = data.levels[LIVE.binId];
  if (!level) return;
  const fresh = liveIsFresh();
  level.online = fresh;
  if (!liveReading) return;
  if (fresh) {
    level.lastReading = liveReading.at;
    // The other two compartments have no sensor yet, so start them empty.
    if (!level.liveStarted) {
      COMPARTMENTS.forEach(({ key }) => {
        if (key !== LIVE.key) level[key] = 0;
      });
      level.liveStarted = true;
    }
  }
  const before = { recycling: level.recycling, landfill: level.landfill, compost: level.compost };
  const wasStarted = level.liveStarted;
  level[LIVE.key] = distanceToPercent(liveReading.distanceCm, data.settings.liveDepthCm);
  if (fresh && wasStarted) detectEmptying(LIVE.binId, { ...level, [LIVE.key]: before[LIVE.key] });
}

// ---------------------------------------------------------------------------
// Automatic "emptied": a big drop in fill level means someone emptied the bin
// ---------------------------------------------------------------------------

const EMPTY_FROM = 40; // a part has to have been at least this full...
const EMPTY_TO = 15; // ...and drop to this or less
const EMPTY_DROP = 30; // by at least this many points

const roundLevels = (levels) => Object.fromEntries(COMPARTMENTS.map(({ key }) => [key, Math.round(levels[key])]));

// Compare the new reading with the one before it. A drop has to show up on
// two readings in a row, so one glitchy reading doesn't count.
function detectEmptying(binId, before) {
  const level = data.levels[binId];
  if (!data.settings.autoEmpty || (level.ignoreDropUntil && Date.now() < level.ignoreDropUntil)) {
    delete level.pendingEmpty;
    return;
  }
  if (level.pendingEmpty) {
    const peak = level.pendingEmpty.before;
    const stillLow = COMPARTMENTS.some(({ key }) => peak[key] >= EMPTY_FROM && level[key] <= EMPTY_TO + 5);
    delete level.pendingEmpty;
    if (stillLow) recordAutoEmptied(binId, peak);
    return;
  }
  const dropped = COMPARTMENTS.some(
    ({ key }) => before[key] >= EMPTY_FROM && level[key] <= EMPTY_TO && before[key] - level[key] >= EMPTY_DROP
  );
  if (dropped) level.pendingEmpty = { at: Date.now(), before: roundLevels(before) };
}

function recordAutoEmptied(binId, before) {
  const level = data.levels[binId];
  const wasTrip = trip?.binId === binId;
  const previous = { emptiedAt: level.emptiedAt, emptiedBy: level.emptiedBy, emptiedAuto: level.emptiedAuto };
  // The sensor can't tell who emptied it, so nobody is named.
  const entry = { binId, workerId: null, at: Date.now(), before, auto: true };
  level.emptiedAt = entry.at;
  level.emptiedBy = entry.workerId;
  level.emptiedAuto = true;
  data.emptiedLog.unshift(entry);
  data.emptiedLog.length = Math.min(data.emptiedLog.length, 2000);
  saveData();

  // Only interrupt people when it matters: the bin they were heading to, or
  // the real sensor in the demo.
  if (!currentUser() || !(wasTrip || binId === LIVE.binId)) return;
  if (wasTrip) showNextBinPrompt(binId);
  showToast(`Bin ${binId} emptied. The sensor noticed, so there's nothing to tap.`, {
    label: "Undo",
    onClick: () => {
      const i = data.emptiedLog.indexOf(entry);
      if (i !== -1) data.emptiedLog.splice(i, 1);
      Object.assign(data.levels[binId], previous);
      saveData();
      shownBinIds = "";
      render();
      showToast(`Undone. Bin ${binId} isn't counted as emptied.`);
    },
  });
}

function startLiveSensor() {
  if (typeof mqtt === "undefined") return;
  const client = mqtt.connect(LIVE.broker, {
    clientId: `tribin-dashboard-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });
  client.on("connect", () => {
    liveRelayConnected = true;
    client.subscribe(LIVE.topic);
    renderLiveStatus();
  });
  client.on("close", () => {
    liveRelayConnected = false;
    renderLiveStatus();
  });
  client.on("message", (topic, payload, packet) => {
    try {
      const message = JSON.parse(payload.toString());
      if (typeof message.distance_cm !== "number") return;
      // A retained message is the last reading the broker kept, which may be
      // old, so it only counts as live once a new one arrives.
      liveReading = { distanceCm: message.distance_cm, at: packet.retain ? 0 : Date.now() };
      applyLiveReading();
      if (currentUser()) render();
    } catch {
      // Ignore anything that isn't a sensor reading.
    }
  });
}

function renderLiveStatus() {
  const el = document.querySelector("#liveStatus");
  if (!el) return;
  if (liveIsFresh()) {
    const percent = distanceToPercent(liveReading.distanceCm, data.settings.liveDepthCm);
    el.className = "live-status is-on";
    el.innerHTML = `<b>Connected</b> · ${liveReading.distanceCm.toFixed(1)} cm to the trash · <b>${percent}% full</b>`;
  } else if (!liveRelayConnected) {
    el.className = "live-status";
    el.textContent = "Connecting to the sensor relay…";
  } else if (liveReading) {
    el.className = "live-status is-off";
    el.textContent = `Sensor offline · last reading ${liveReading.distanceCm.toFixed(1)} cm. Check that it's powered and on Wi-Fi.`;
  } else {
    el.className = "live-status";
    el.textContent = "Waiting for the sensor. Make sure it's powered and connected to Wi-Fi.";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusOf(percent) {
  if (percent >= data.settings.fullAt) return "full";
  if (percent >= data.settings.almostAt) return "almost";
  return "ok";
}

function fullest(binId) {
  const level = data.levels[binId];
  return Math.max(level.landfill, level.recycling, level.compost);
}

function isOnline(binId) {
  return data.levels[binId].online !== false;
}

function binStatus(binId) {
  if (!isOnline(binId)) return "offline";
  return statusOf(fullest(binId));
}

function offlineText(binId) {
  if (binId === LIVE.binId && !liveIsFresh()) return "Live sensor not connected";
  if (isDeadBattery(binId)) return `Battery is flat · last reading ${timeAgo(data.levels[binId].lastReading)}`;
  return `No signal · last reading ${timeAgo(data.levels[binId].lastReading)}`;
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

const ZONE_COLORS = ["#2f6fdb", "#1f8a5b", "#c98309", "#8c6bd1", "#d0402f", "#0f9fb0", "#b5487a", "#5d6b62"];

function zoneById(id) {
  return data.zones.find((zone) => zone.id === id) || null;
}

function binZone(binId) {
  return zoneById(data.binZones[binId]);
}

function myZoneId() {
  const zoneId = currentUser()?.zoneId;
  return zoneId && zoneById(zoneId) ? zoneId : null;
}

// filter is a zone id, "all", or "none" (bins without a zone)
function inZone(binId, filter) {
  if (filter === "all") return true;
  if (filter === "none") return !binZone(binId);
  return data.binZones[binId] === filter;
}

function zoneTag(zone) {
  return zone
    ? `<span class="zone-tag" style="--zone: ${zone.color}">${escapeHtml(zone.name)}</span>`
    : '<span class="zone-tag zone-none">No zone</span>';
}

function zoneOptions() {
  return (
    '<option value="all">All zones</option>' +
    data.zones
      .map((zone) => `<option value="${zone.id}">${escapeHtml(zone.name)}${zone.id === myZoneId() ? " (my zone)" : ""}</option>`)
      .join("") +
    '<option value="none">No zone</option>'
  );
}

// Fill the zone dropdowns on the Bins and Map pages.
function renderZoneSelects() {
  const valid = (value) => value === "all" || value === "none" || zoneById(value);
  if (!valid(zoneFilter)) zoneFilter = "all";
  if (!valid(mapFilters.zone)) mapFilters.zone = "all";
  const binsSelect = document.querySelector("#zoneFilter");
  binsSelect.innerHTML = zoneOptions();
  binsSelect.value = zoneFilter;
  const mapSelect = document.querySelector("#mapZone");
  mapSelect.innerHTML = zoneOptions();
  mapSelect.value = mapFilters.zone;
}

function currentUser() {
  return data.workers.find((worker) => worker.id === data.currentUserId) || null;
}

function isAdmin() {
  return currentUser()?.role === "admin";
}

function randomOtherWorker() {
  const others = data.workers.filter((w) => w.role === "worker" && w.id !== data.currentUserId);
  return others.length ? others[Math.floor(Math.random() * others.length)].id : null;
}

function timeAgo(timestamp) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function isToday(timestamp) {
  return new Date(timestamp).toDateString() === new Date().toDateString();
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

// A short message at the bottom of the screen, with an optional button.
function showToast(message, action = null) {
  const toast = document.querySelector("#toast");
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button" class="toast-action">${escapeHtml(action.label)}</button>` : ""}`;
  if (action) {
    toast.querySelector("button").addEventListener("click", () => {
      toast.hidden = true;
      action.onClick();
    });
  }
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => (toast.hidden = true), action ? 6000 : 3000);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function emptyBin(binId, workerId) {
  const level = data.levels[binId];
  const before = {};
  COMPARTMENTS.forEach(({ key }) => (before[key] = Math.round(level[key])));
  COMPARTMENTS.forEach(({ key }) => (level[key] = 0));
  level.emptiedAt = Date.now();
  level.emptiedBy = workerId;
  level.emptiedAuto = false;
  data.emptiedLog.unshift({ binId, workerId, at: Date.now(), before });
  data.emptiedLog.length = Math.min(data.emptiedLog.length, 2000);
}

function markEmptied(binId) {
  const before = { ...data.levels[binId] };
  emptyBin(binId, data.currentUserId);
  saveData();
  render();
  showToast(`Bin ${binId} marked as emptied.`, { label: "Undo", onClick: () => undoEmptied(binId, before) });
}

// Someone put a new battery in this bin's sensor.
function replaceBattery(binId) {
  const level = data.levels[binId];
  const before = { battery: level.battery, online: level.online, lastReading: level.lastReading };
  level.battery = 100;
  if (!level.online && before.battery < 0.5) {
    level.online = true;
    level.lastReading = Date.now();
  }
  data.batteryLog ??= [];
  data.batteryLog.unshift({ binId, workerId: data.currentUserId, at: Date.now(), before: Math.round(before.battery) });
  data.batteryLog.length = Math.min(data.batteryLog.length, 500);
  saveData();
  shownBinIds = "";
  render();
  showToast(`Bin ${binId} has a new battery.`, {
    label: "Undo",
    onClick: () => {
      Object.assign(data.levels[binId], before);
      data.batteryLog.shift();
      saveData();
      shownBinIds = "";
      render();
      showToast(`Undone. Bin ${binId} is back to ${Math.round(before.battery)}% battery.`);
    },
  });
}

// Put a bin back the way it was, in case "Mark emptied" was tapped by mistake.
function undoEmptied(binId, before) {
  data.levels[binId] = before;
  const entry = data.emptiedLog.findIndex((e) => e.binId === binId && e.workerId === data.currentUserId);
  if (entry !== -1) data.emptiedLog.splice(entry, 1);
  if (nextPromptFor === binId) stopDirections();
  saveData();
  shownBinIds = "";
  render();
  showToast(`Undone. Bin ${binId} is back to how it was.`);
}

// ---------------------------------------------------------------------------
// Your location (for "nearest" sorting and the next-bin button)
// ---------------------------------------------------------------------------

let myLocation = null; // [latitude, longitude]
let myLocationAt = 0;
let locationWatch = null;

function setMyLocation(here) {
  myLocation = here;
  myLocationAt = Date.now();
}

function getMyLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLocation([position.coords.latitude, position.coords.longitude]);
        resolve(myLocation);
      },
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}

// Keep the location fresh while bins are sorted by distance.
function startLocationWatch() {
  if (locationWatch !== null || !navigator.geolocation) return;
  locationWatch = navigator.geolocation.watchPosition(
    (position) => {
      const here = [position.coords.latitude, position.coords.longitude];
      const moved = !myLocation || distanceMeters(myLocation, here) > 15;
      setMyLocation(here);
      if (moved && currentPage === "bins") renderBins();
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

function stopLocationWatch() {
  if (locationWatch !== null) navigator.geolocation.clearWatch(locationWatch);
  locationWatch = null;
}

function metersToBin(bin) {
  return myLocation ? distanceMeters(myLocation, [bin.latitude, bin.longitude]) : Infinity;
}

// Workers with a zone get the closest full bin in their own zone first.
function nearestFullBin(skipBinId = null) {
  const full = allBins.filter((bin) => bin.id !== skipBinId && binStatus(bin.id) === "full");
  const zoneId = myZoneId();
  const mine = zoneId ? full.filter((bin) => data.binZones[bin.id] === zoneId) : [];
  return (mine.length ? mine : full).sort((a, b) => metersToBin(a) - metersToBin(b))[0] || null;
}

async function sortByNearest() {
  try {
    await getMyLocation();
  } catch (error) {
    showToast(locationErrorText(error));
    return;
  }
  binSort = "nearest";
  startLocationWatch();
  shownBinIds = "";
  renderBins();
}

function sortByFullest() {
  binSort = "fullest";
  stopLocationWatch();
  shownBinIds = "";
  renderBins();
}

// Find the closest bin that needs emptying and start walking directions.
async function goToNearestFullBin() {
  const buttons = document.querySelectorAll('[data-action="next-bin"]');
  buttons.forEach((button) => (button.disabled = true));
  showToast("Finding your location…");
  try {
    await getMyLocation();
  } catch (error) {
    showToast(locationErrorText(error));
    return;
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }

  const bin = nearestFullBin();
  if (!bin) {
    showToast("No bins need emptying right now.");
    return;
  }
  document.querySelector("#toast").hidden = true;
  showPage("map");
  startDirections(bin.id, myLocation);
}

// ---------------------------------------------------------------------------
// Sign in / sign out
// ---------------------------------------------------------------------------

function showLogin() {
  document.querySelector("#loginScreen").hidden = false;
  document.querySelector("#appScreen").hidden = true;
  renderLoginPreview();

  document.querySelector("#demoAccounts").innerHTML = data.workers
    .slice(0, 3)
    .map(
      (worker) => `
        <button type="button" class="demo-account" data-worker="${worker.id}">
          <span class="avatar small">${escapeHtml(initials(worker.name))}</span>
          <span class="demo-text">
            <strong>${escapeHtml(worker.name)}</strong>
            <span>${escapeHtml(roleText(worker))}</span>
          </span>
          <span class="demo-go">${ICONS.arrow}</span>
        </button>
      `
    )
    .join("");
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function roleText(worker) {
  const zone = zoneById(worker.zoneId);
  return `${worker.role === "admin" ? "Admin" : "Worker"} · ${zone ? zone.name : "All campus"}`;
}

// Name, role and the "need emptying" count in the sidebar and phone header.
function renderShell() {
  const worker = currentUser();
  if (!worker) return;
  const set = (selector, text) =>
    document.querySelectorAll(selector).forEach((el) => {
      if (el.textContent !== text) el.textContent = text;
    });
  set("#userName", worker.name);
  set("#userRole", roleText(worker));
  set("[data-avatar]", initials(worker.name));
  const toEmpty = allBins.filter((bin) => binStatus(bin.id) === "full" && inZone(bin.id, myZoneId() || "all")).length;
  set("#navBadge", String(toEmpty));
  document.querySelector("#navBadge").hidden = toEmpty === 0;
}

// Live campus numbers and the next bin to empty, on the sign-in screen.
function renderLoginPreview() {
  const setHtmlOnce = (selector, html) => {
    const el = document.querySelector(selector);
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
  };
  const counts = { full: 0, almost: 0, ok: 0, offline: 0 };
  allBins.forEach((bin) => counts[binStatus(bin.id)]++);
  const online = Math.round(((allBins.length - counts.offline) / allBins.length) * 100);
  document.querySelector("#loginLive").textContent = `Live on campus · ${allBins.length} bins`;

  const stat = (value, label, dot) => `<div class="preview-stat"><b>${value}</b><span><i class="${dot}"></i>${label}</span></div>`;
  setHtmlOnce("#loginStats", stat(counts.full, "Need emptying", "dot-full") + stat(counts.almost, "Almost full", "dot-almost") + stat(`${online}%`, "Sensors online", "dot-ok"));

  const next = allBins.filter((bin) => binStatus(bin.id) === "full").sort((a, b) => fullest(b.id) - fullest(a.id))[0];
  if (!next) {
    setHtmlOnce("#loginNext", '<p class="preview-clear">No bins need emptying right now.</p>');
    return;
  }
  const bars = COMPARTMENTS.map(({ key, label }) => {
    const value = Math.round(data.levels[next.id][key]);
    return `
      <div class="bar">
        <span class="bar-label">${label}</span>
        <div class="bar-track"><div class="bar-fill fill-${statusOf(value)}" style="width: ${value}%"></div></div>
        <span class="bar-percent">${value}%</span>
      </div>
    `;
  }).join("");
  setHtmlOnce(
    "#loginNext",
    `
      <div class="preview-next-head">
        <strong>Fullest bin: Bin ${next.id}</strong>
        <span class="badge badge-full">Needs emptying</span>
      </div>
      <p>${escapeHtml(next.location)}</p>
      <div class="bars">${bars}</div>
    `
  );
}

function signIn(workerId) {
  const worker = data.workers.find((w) => w.id === workerId);
  data.currentUserId = worker.id;
  binFilter = worker.role === "admin" ? "all" : "full";
  zoneFilter = myZoneId() || "all";
  mapFilters.zone = zoneFilter;
  if (typeof resetReports === "function") resetReports();
  saveData();
  renderZoneSelects();

  document.querySelector("#loginScreen").hidden = true;
  document.querySelector("#appScreen").hidden = false;
  document.querySelectorAll("[data-admin-only]").forEach((el) => (el.hidden = worker.role !== "admin"));
  renderShell();
  shownBinIds = "";
  showPage("home");

  // If this browser already allows location, sort by nearest right away.
  navigator.permissions?.query({ name: "geolocation" }).then((status) => {
    if (status.state === "granted") sortByNearest();
  });
}

document.querySelector("#loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("#loginEmail").value.trim().toLowerCase();
  const worker = data.workers.find((w) => w.email.toLowerCase() === email);
  const error = document.querySelector("#loginError");
  if (!worker) {
    error.textContent = email ? "No worker has that email. Try a demo account below." : "Enter your campus email.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  signIn(worker.id);
});

document.querySelector("#demoAccounts").addEventListener("click", (event) => {
  const button = event.target.closest("[data-worker]");
  if (button) signIn(Number(button.dataset.worker));
});

document.querySelectorAll("[data-sign-out]").forEach((button) =>
  button.addEventListener("click", () => {
    stopLocationWatch();
    binSort = "fullest";
    data.currentUserId = null;
    saveData();
    showLogin();
  })
);

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function showPage(page) {
  if (page === "settings" && !isAdmin()) page = "home";
  currentPage = page;

  document.querySelectorAll(".page").forEach((section) => {
    section.hidden = section.id !== `page-${page}`;
  });
  document.querySelectorAll(".nav [data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  // The map fills the whole screen under the top bar.
  document.body.classList.toggle("map-open", page === "map");
  setBarHeights();

  if (page !== "map" && typeof stopDirections === "function") stopDirections();
  if (page !== "map") stopZoneEdit();
  if (page === "map") setupMap();
  if (page === "settings") renderSettings();
  if (page === "history" && typeof openReports === "function") openReports();
  render();
}

// The map fills the space between the top bar and (on phones) the bottom tabs.
function setBarHeights() {
  const root = document.documentElement.style;
  root.setProperty("--topbar-height", `${document.querySelector(".topbar").offsetHeight}px`);
  const tabs = document.querySelector(".sidebar");
  root.setProperty("--nav-height", `${getComputedStyle(tabs).position === "fixed" ? tabs.offsetHeight : 0}px`);
}

window.addEventListener("resize", setBarHeights);

document.querySelector(".nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (button) showPage(button.dataset.page);
});

function render() {
    renderShell();
    if (typeof refreshBinSheet === "function") refreshBinSheet();
    if (currentPage === "home" && typeof renderHome === "function") renderHome();
    if (currentPage === "bins") renderBins();
    if (currentPage === "map") renderMap();
    if (currentPage === "history" && typeof refreshReports === "function") refreshReports();
    if (currentPage === "settings") renderLiveStatus();
}

// ---------------------------------------------------------------------------
// Bins page
// ---------------------------------------------------------------------------

function renderBins() {
  const zoneBins = allBins.filter((bin) => inZone(bin.id, zoneFilter));
  const counts = { full: 0, almost: 0, offline: 0 };
  zoneBins.forEach((bin) => {
    const status = binStatus(bin.id);
    if (status in counts) counts[status]++;
  });
  document.querySelector("#countFull").textContent = counts.full;
  document.querySelector("#countAlmost").textContent = counts.almost;
  document.querySelector("#countOffline").textContent = counts.offline;
  document.querySelector("#countAll").textContent = zoneBins.length;
  document.querySelectorAll("[data-filter]").forEach((box) => {
    box.classList.toggle("selected", box.dataset.filter === binFilter);
  });

  const zoneLabel = zoneFilter === "all" ? "All zones" : zoneFilter === "none" ? "No zone" : zoneById(zoneFilter)?.name || "All zones";
  const lowBattery = zoneBins.filter((bin) => isLowBattery(bin.id)).length;
  document.querySelector("#countBattery").textContent = lowBattery;
  const subtitle = `${zoneLabel} · ${zoneBins.length} bins · ${counts.full} need${counts.full === 1 ? "s" : ""} emptying${lowBattery ? ` · ${lowBattery} low battery` : ""}`;
  document.querySelector("#autoNote").hidden = !data.settings.autoEmpty;
  const subtitleEl = document.querySelector("#binsSubtitle");
  if (subtitleEl.textContent !== subtitle) subtitleEl.textContent = subtitle;

  const visible = zoneBins
    .filter((bin) => binFilter === "all" || (binFilter === "battery" ? isLowBattery(bin.id) : binStatus(bin.id) === binFilter))
    .filter((bin) => `bin ${bin.id} ${bin.location}`.toLowerCase().includes(searchText))
    .sort(
      (a, b) =>
        (b.id === LIVE.binId) - (a.id === LIVE.binId) ||
        (binFilter === "battery"
          ? batteryOf(a.id) - batteryOf(b.id)
          : binSort === "nearest"
            ? metersToBin(a) - metersToBin(b)
            : fullest(b.id) - fullest(a.id))
    );

  // Only rebuild the cards when a bin joins or leaves the list (or, when
  // sorted by distance, changes place), so cards don't jump around or
  // swallow clicks while numbers update.
  const grid = document.querySelector("#binGrid");
  const order = visible.map((bin) => bin.id);
  const sorted = binSort === "nearest" || binFilter === "battery" ? order : [...order].sort((a, b) => a - b);
  // Rebuild when a sensor goes on/offline too, since that changes the buttons.
  const ids = binFilter + binSort + data.settings.autoEmpty + sorted.map((id) => (isOnline(id) ? id : `${id}x`)).join(",");
  if (ids !== shownBinIds) {
    shownBinIds = ids;
    grid.innerHTML = visible.length
      ? visible.map(cardHtml).join("")
      : `<p class="empty">${EMPTY_TEXT[binFilter] || "No bins match."}</p>`;
  }

  visible.forEach((bin) => {
    const card = grid.querySelector(`[data-id="${bin.id}"]`);
    if (card) updateCard(card, bin);
  });
}

const EMPTY_TEXT = {
  full: "All clear! No bins need emptying right now.",
  offline: "All sensors are working.",
  battery: "No sensors need a new battery.",
};

function cardHtml(bin) {
  const bars = COMPARTMENTS.map(
    ({ key, label }) => `
      <div class="bar" data-key="${key}">
        <span class="bar-label">${label}</span>
        <div class="bar-track"><div class="bar-fill"></div></div>
        <span class="bar-percent"></span>
      </div>
    `
  ).join("");

  return `
    <article class="bin-card" data-id="${bin.id}">
      <div class="card-info" data-action="details" data-id="${bin.id}">
        <div class="card-top">
          <strong>Bin ${bin.id}${bin.id === LIVE.binId ? ' <span class="live-tag">LIVE</span>' : ""}</strong>
          <span class="badge"></span>
          <span class="battery-badge" hidden></span>
        </div>
        <p class="card-location">${escapeHtml(bin.location)}</p>
        <p class="card-meta"></p>
      </div>
      <div class="bars" data-action="details" data-id="${bin.id}">${bars}</div>
      <div class="card-buttons">
        ${
          binFilter === "battery" && isLowBattery(bin.id)
            ? `<button type="button" class="button primary" data-action="battery" data-id="${bin.id}">${ICONS.battery}Battery replaced</button>`
            : data.settings.autoEmpty && isOnline(bin.id)
              ? `<button type="button" class="button primary" data-action="directions" data-id="${bin.id}">${ICONS.nav}Directions</button>`
              : `<button type="button" class="button primary" data-action="empty" data-id="${bin.id}">${ICONS.check}Mark emptied</button>`
        }
        <button type="button" class="button" data-action="details" data-id="${bin.id}">${ICONS.info}Details</button>
        <button type="button" class="button" data-action="map" data-id="${bin.id}">${ICONS.map}Map</button>
      </div>
    </article>
  `;
}

function updateCard(card, bin) {
  const status = binStatus(bin.id);
  card.className = `bin-card is-${status}`;

  const badge = card.querySelector(".badge");
  badge.textContent = STATUS_TEXT[status];
  badge.className = `badge badge-${status}`;

  COMPARTMENTS.forEach(({ key }) => {
    const value = Math.round(data.levels[bin.id][key]);
    const bar = card.querySelector(`[data-key="${key}"]`);
    bar.querySelector(".bar-percent").textContent = `${value}%`;
    const fill = bar.querySelector(".bar-fill");
    fill.style.width = `${value}%`;
    fill.className = `bar-fill fill-${status === "offline" ? "offline" : statusOf(value)}`;
  });

  // One short info line: zone (only when showing every zone), distance, last emptied.
  const parts = [];
  if (zoneFilter === "all") parts.push(zoneTag(binZone(bin.id)));
  if (myLocation) parts.push(`<b>${formatDistance(metersToBin(bin))} away</b>`);
  parts.push(escapeHtml(status === "offline" ? offlineText(bin.id) : emptiedText(bin.id)));
  const battery = batteryOf(bin.id);
  const low = isLowBattery(bin.id);
  if (battery != null) parts.push(`<span class="battery-level${low ? " low" : ""}" title="Sensor battery">${ICONS.battery}${battery}%</span>`);
  const batteryBadge = card.querySelector(".battery-badge");
  const badgeHtml = low ? `${ICONS.battery}${battery === 0 ? "Battery flat" : "Low battery"}` : "";
  if (batteryBadge.innerHTML !== badgeHtml) batteryBadge.innerHTML = badgeHtml;
  batteryBadge.hidden = !low;
  const meta = parts.map((part) => `<span>${part}</span>`).join("");
  const metaEl = card.querySelector(".card-meta");
  if (metaEl.innerHTML !== meta) metaEl.innerHTML = meta;
}

function emptiedText(binId) {
  const level = data.levels[binId];
  const worker = data.workers.find((w) => w.id === level.emptiedBy);
  if (level.emptiedAuto) return `Emptied ${timeAgo(level.emptiedAt)} · by sensor`;
  return `Emptied ${timeAgo(level.emptiedAt)}${worker ? ` by ${worker.name.split(" ")[0]}` : ""}`;
}

document.querySelector(".summary").addEventListener("click", (event) => {
  const box = event.target.closest("[data-filter]");
  if (!box) return;
  binFilter = box.dataset.filter;
  renderBins();
});

document.querySelector("#zoneFilter").addEventListener("change", (event) => {
  zoneFilter = event.target.value;
  shownBinIds = "";
  renderBins();
});

document.querySelector("#search").addEventListener("input", (event) => {
  searchText = event.target.value.trim().toLowerCase();
  renderBins();
});

// Buttons on cards, in map popups, and in the directions panel.
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const binId = Number(button.dataset.id);

  if (button.dataset.action === "empty") {
    map?.closePopup();
    const wasTripDestination = trip?.binId === binId;
    markEmptied(binId);
    if (wasTripDestination) showNextBinPrompt(binId);
  }
  if (button.dataset.action === "next-bin") goToNearestFullBin();
  if (button.dataset.action === "details") {
    map?.closePopup();
    openBinSheet(binId);
  }
  if (button.dataset.action === "battery") {
    map?.closePopup();
    replaceBattery(binId);
  }
  if (button.dataset.action === "history") {
    map?.closePopup();
    openBinHistory(binId);
  }
  if (button.dataset.action === "directions") {
    if (currentPage !== "map") showPage("map");
    startDirections(binId);
  }
  if (button.dataset.action === "stop-directions") stopDirections();
  if (button.dataset.action === "map") {
    showPage("map");
    focusBin(binId);
  }
});

// ---------------------------------------------------------------------------
// Map page
// ---------------------------------------------------------------------------

const STREET_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const MAP_STYLES = {
  map: { url: STREET_TILES, className: "map-tiles" }, // toned-down streets
  streets: { url: STREET_TILES, className: "" },
  satellite: { url: SATELLITE_TILES, className: "" },
};

const mapFilters = { search: "", compartment: "any", statuses: new Set(MAP_STATUSES), zone: "all" };
const markerHtml = new Map();
let markerGroup = null;
const GROUP_KEY = "tribin-grouped";
let groupNearby = (() => {
  try {
    return localStorage.getItem(GROUP_KEY) !== "0";
  } catch {
    return true;
  }
})();
let shownMarkers = new Set();
let baseLayer = null;

function setupMap() {
  if (map) {
    setTimeout(() => {
      map.invalidateSize();
      // Someone new signed in, or the zone changed: show their bins.
      if (mapFittedFor !== `${data.currentUserId}|${mapFilters.zone}`) fitMapToZone();
    }, 0);
    return;
  }
  if (typeof L === "undefined") {
    document.querySelector("#map").innerHTML = '<p class="empty">The map could not load. Check your internet connection.</p>';
    return;
  }

  map = L.map("map", { zoomControl: false }).setView([38.5605, -121.4235], 16);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  setMapStyle("map");

  // Without the grouping library, fall back to plain markers.
  if (typeof L.markerClusterGroup !== "function") {
    groupNearby = false;
    document.querySelector(".map-group").hidden = true;
  }
  markerGroup = makeMarkerGroup();
  map.addLayer(markerGroup);

  allBins.forEach((bin) => {
    const marker = L.marker([bin.latitude, bin.longitude], { title: `Bin ${bin.id}`, riseOnHover: true });
    marker.bindPopup(() => popupHtml(bin));
    marker.on("click", () => {
      if (zoneEdit.active) toggleBinZone(bin.id);
    });
    mapMarkers.set(bin.id, marker);
  });

  // Zoomed out, bins are small dots; zoomed in, they become mini tri-bins.
  map.on("zoomend", () => renderMap());
  renderMap();
  fitMapToZone();
  setTimeout(() => {
    map.invalidateSize();
    fitMapToZone();
  }, 0);
}

// Show the bins of the chosen zone (your zone, to start), clear of the panel.
let mapFittedFor = "";

function fitMapToZone() {
  if (!map) return;
  mapFittedFor = `${data.currentUserId}|${mapFilters.zone}`;
  const bins = allBins.filter((bin) => inZone(bin.id, mapFilters.zone));
  const list = bins.length ? bins : allBins;
  const phone = window.innerWidth <= 700;
  const panelOpen = !document.querySelector("#mapDrawer").classList.contains("closed");
  map.fitBounds(L.latLngBounds(list.map((bin) => [bin.latitude, bin.longitude])), {
    paddingTopLeft: [phone || !panelOpen ? 30 : 350, 40],
    paddingBottomRight: [40, phone ? 170 : 40],
    maxZoom: 18,
  });
}

function setMapStyle(name) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(MAP_STYLES[name].url, {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri",
    className: MAP_STYLES[name].className,
  }).addTo(map);
  document.querySelectorAll("[data-map-style]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mapStyle === name);
  });
}

// Nearby bins are grouped into one circle until you zoom in.
function makeMarkerGroup() {
  if (!groupNearby) return L.layerGroup();
  return L.markerClusterGroup({
    iconCreateFunction: clusterIcon,
    showCoverageOnHover: false,
    // Group more when zoomed out, so circles never pile on top of each other.
    // Fully zoomed in, only bins that would overlap stay grouped, and tapping
    // the group fans them out.
    maxClusterRadius: (zoom) => (zoom >= 18 ? 30 : zoom >= 17 ? 50 : 80),
    spiderfyOnMaxZoom: true,
  });
}

// Status shown on the map: the chosen compartment, or the fullest one.
function mapStatus(bin) {
  if (!isOnline(bin.id)) return "offline";
  const level = data.levels[bin.id];
  return statusOf(mapFilters.compartment === "any" ? fullest(bin.id) : level[mapFilters.compartment]);
}

// Each marker is a tiny tri-bin: one bar per compartment at its fill level.
function markerIconHtml(bin) {
  const level = data.levels[bin.id];
  const offline = !isOnline(bin.id);
  const bars = COMPARTMENTS.map(({ key }) => {
    const value = Math.round(level[key]);
    const dim = mapFilters.compartment !== "any" && mapFilters.compartment !== key ? " dim" : "";
    return `<span class="fill-${offline ? "offline" : statusOf(value)}${dim}" style="height: ${Math.max(value, 8)}%"></span>`;
  }).join("");
  if (zoneEdit.active) {
    const zone = binZone(bin.id);
    const extra = zone ? (zone.id === zoneEdit.zoneId ? " pin-zone pin-selected-zone" : " pin-zone") : " pin-zone pin-nozone";
    return `<div class="bin-pin pin-${mapStatus(bin)}${extra}"${zone ? ` style="--zone: ${zone.color}"` : ""}>${bars}</div>`;
  }
  if (map && map.getZoom() < 17) return `<div class="dot-wrap"><div class="bin-dot dot-${mapStatus(bin)}"></div></div>`;
  return `<div class="bin-pin pin-${mapStatus(bin)}">${bars}</div>`;
}

// Group circles show how many bins they hold, ringed by status
// (red, yellow, green, and gray for offline sensors).
function clusterIcon(cluster) {
  const counts = { full: 0, almost: 0, ok: 0, offline: 0 };
  const children = cluster.getAllChildMarkers();
  children.forEach((marker) => counts[marker.options.status || "ok"]++);

  const full = (counts.full / children.length) * 100;
  const almost = full + (counts.almost / children.length) * 100;
  const ok = almost + (counts.ok / children.length) * 100;
  const ring = `conic-gradient(var(--full) 0 ${full}%, var(--almost) ${full}% ${almost}%, var(--ok) ${almost}% ${ok}%, var(--offline) ${ok}% 100%)`;
  const size = children.length >= 20 ? 46 : children.length >= 8 ? 40 : 34;

  return L.divIcon({
    className: "",
    html: `<div class="cluster-pin${counts.full ? " has-full" : ""}" style="--ring: ${ring}; width: ${size}px; height: ${size}px"><span>${children.length}</span></div>`,
    iconSize: [size, size],
  });
}

function popupHtml(bin) {
  const offline = !isOnline(bin.id);
  const rows = COMPARTMENTS.map(({ key, label }) => {
    const value = Math.round(data.levels[bin.id][key]);
    return `
      <div class="popup-row">
        <span>${label}</span>
        <div class="popup-track"><div class="fill-${offline ? "offline" : statusOf(value)}" style="width: ${value}%"></div></div>
        <b>${value}%</b>
      </div>
    `;
  }).join("");

  return `
    <div class="popup">
      <strong>Bin ${bin.id}${bin.id === LIVE.binId ? ' <span class="live-tag">LIVE</span>' : ""}</strong>
      <p>${escapeHtml(bin.location)}</p>
      <p class="popup-zone">${zoneTag(binZone(bin.id))}</p>
      ${bin.id === LIVE.binId ? `<p class="popup-live">${LIVE.label} reading comes from the real sensor.</p>` : ""}
      ${rows}
      ${offline ? `<p class="popup-offline">Sensor offline. ${offlineText(bin.id)}, so these levels may be out of date.</p>` : ""}
      <p class="popup-emptied">${emptiedText(bin.id)}</p>
      ${
        batteryOf(bin.id) == null
          ? ""
          : `<p class="popup-battery${isLowBattery(bin.id) ? " low" : ""}">${ICONS.battery}Sensor battery ${batteryOf(bin.id)}%${isLowBattery(bin.id) ? " · needs a new one" : ""}</p>`
      }
      <div class="popup-buttons">
        <button type="button" class="button${data.settings.autoEmpty && !offline ? " primary" : ""}" data-action="directions" data-id="${bin.id}">Directions</button>
        <button type="button" class="button${data.settings.autoEmpty && !offline ? "" : " primary"}" data-action="empty" data-id="${bin.id}" title="Only needed if the sensor missed it">Mark emptied</button>
      </div>
      ${isLowBattery(bin.id) ? `<button type="button" class="button full-width popup-battery-button" data-action="battery" data-id="${bin.id}">${ICONS.battery}Battery replaced</button>` : ""}
      <button type="button" class="link-button" data-action="details" data-id="${bin.id}">More about this bin</button>
    </div>
  `;
}

function renderMap() {
  if (!map) return;
  const counts = { full: 0, almost: 0, ok: 0, offline: 0 };
  const visible = [];
  let iconsChanged = false;

  allBins.forEach((bin) => {
    const marker = mapMarkers.get(bin.id);
    const status = mapStatus(bin);
    marker.options.status = status;

    const html = markerIconHtml(bin);
    if (markerHtml.get(bin.id) !== html) {
      markerHtml.set(bin.id, html);
      const dot = html.startsWith('<div class="dot-wrap"');
      marker.setIcon(
        L.divIcon({
          className: "",
          html,
          iconSize: dot ? [22, 22] : [28, 26],
          iconAnchor: dot ? [11, 11] : [14, 13],
          popupAnchor: dot ? [0, -10] : [0, -12],
        })
      );
      iconsChanged = true;
    }

    if (mapFilters.search && !`bin ${bin.id} ${bin.location}`.toLowerCase().includes(mapFilters.search)) return;
    if (zoneEdit.active) {
      visible.push(bin);
      return;
    }
    if (!inZone(bin.id, mapFilters.zone)) return;
    counts[status]++;
    if (mapFilters.statuses.has(status)) visible.push(bin);
  });

  // Add and remove only the markers that changed.
  const wanted = new Set(visible.map((bin) => bin.id));
  const toAdd = [...wanted].filter((id) => !shownMarkers.has(id)).map((id) => mapMarkers.get(id));
  const toRemove = [...shownMarkers].filter((id) => !wanted.has(id)).map((id) => mapMarkers.get(id));
  if (groupNearby) {
    markerGroup.removeLayers(toRemove);
    markerGroup.addLayers(toAdd);
    if (iconsChanged) markerGroup.refreshClusters();
  } else {
    toRemove.forEach((marker) => markerGroup.removeLayer(marker));
    toAdd.forEach((marker) => markerGroup.addLayer(marker));
  }
  shownMarkers = wanted;

  document.querySelector("#mapStatuses").innerHTML = MAP_STATUSES
    .map(
      (status) => `
        <button type="button" class="status-toggle st-${status}${mapFilters.statuses.has(status) ? " on" : ""}" data-status="${status}">
          <i></i>${SHORT_STATUS[status]}<b>${counts[status]}</b>
        </button>
      `
    )
    .join("");

  document.querySelector("#mapResults").innerHTML = mapFilters.search
    ? visible
        .slice(0, 6)
        .map(
          (bin) => `
            <button type="button" class="map-result" data-result="${bin.id}">
              <b>Bin ${bin.id}</b><span>${escapeHtml(bin.location)}</span>
            </button>
          `
        )
        .join("") || '<p class="muted">No bins match.</p>'
    : "";
}

// Zoom to a bin and open its popup, even if it's inside a group.
function focusBin(binId) {
  const marker = mapMarkers.get(binId);
  if (!map || !marker) return;
  if (!shownMarkers.has(binId)) {
    mapFilters.statuses = new Set(MAP_STATUSES);
    renderMap();
  }
  if (groupNearby) {
    markerGroup.zoomToShowLayer(marker, () => marker.openPopup());
  } else {
    map.setView(marker.getLatLng(), 18);
    marker.openPopup();
  }
}

document.querySelector("#mapSearch").addEventListener("input", (event) => {
  mapFilters.search = event.target.value.trim().toLowerCase();
  renderMap();
});

document.querySelector("#mapResults").addEventListener("click", (event) => {
  const result = event.target.closest("[data-result]");
  if (result) focusBin(Number(result.dataset.result));
});

document.querySelectorAll('input[name="mapCompartment"]').forEach((input) => {
  input.addEventListener("change", () => {
    mapFilters.compartment = input.value;
    renderMap();
  });
});

// Click a status to show only that one; click it again to show all.
document.querySelector("#mapStatuses").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button) return;
  const status = button.dataset.status;
  const statuses = mapFilters.statuses;
  if (statuses.size === 1 && statuses.has(status)) {
    mapFilters.statuses = new Set(MAP_STATUSES);
  } else if (statuses.size === MAP_STATUSES.length) {
    mapFilters.statuses = new Set([status]);
  } else if (statuses.has(status)) {
    statuses.delete(status);
  } else {
    statuses.add(status);
  }
  renderMap();
});

function syncGroupButtons() {
  document.querySelectorAll("[data-group]").forEach((button) => button.classList.toggle("active", (button.dataset.group === "on") === groupNearby));
}

function setGrouping(value) {
  groupNearby = value;
  syncGroupButtons();
  if (!map) return;
  map.removeLayer(markerGroup);
  markerGroup = makeMarkerGroup();
  shownMarkers = new Set();
  map.addLayer(markerGroup);
  renderMap();
}

syncGroupButtons();

document.querySelector(".map-group").addEventListener("click", (event) => {
  const button = event.target.closest("[data-group]");
  if (!button) return;
  const value = button.dataset.group === "on";
  try {
    localStorage.setItem(GROUP_KEY, value ? "1" : "0");
  } catch {
    // Only a convenience; grouping still works.
  }
  if (zoneEdit.active) zoneEdit.groupedBefore = value;
  else if (value !== groupNearby) setGrouping(value);
  showToast(value ? "Nearby bins are grouped into circles." : "Every bin is shown on its own.");
});

document.querySelector("#mapZone").addEventListener("change", (event) => {
  mapFilters.zone = event.target.value;
  renderMap();
  fitMapToZone();
});

// ---------------------------------------------------------------------------
// Editing zones on the map (admins): pick a zone, click bins to add them
// ---------------------------------------------------------------------------

const zoneEdit = { active: false, zoneId: null, groupedBefore: true };

function startZoneEdit(zoneId = null) {
  if (!isAdmin()) return;
  if (currentPage !== "map") showPage("map");
  if (!map) return;
  stopDirections();
  map.closePopup();
  zoneEdit.active = true;
  zoneEdit.zoneId = zoneById(zoneId) ? zoneId : data.zones[0]?.id || null;
  zoneEdit.groupedBefore = groupNearby;
  mapMarkers.forEach((marker) => marker.unbindPopup());
  document.querySelector(".page-map").classList.add("zone-editing");
  renderZoneEditPanel();
  // Grouping off, so every bin can be clicked.
  if (groupNearby) setGrouping(false);
  else renderMap();
}

function stopZoneEdit() {
  if (!zoneEdit.active) return;
  zoneEdit.active = false;
  mapMarkers.forEach((marker, id) => {
    const bin = allBins.find((b) => b.id === id);
    marker.bindPopup(() => popupHtml(bin));
  });
  document.querySelector(".page-map").classList.remove("zone-editing");
  document.querySelector("#zoneEditPanel").hidden = true;
  if (zoneEdit.groupedBefore && !groupNearby) setGrouping(true);
  else renderMap();
}

function toggleBinZone(binId) {
  const zone = zoneById(zoneEdit.zoneId);
  if (!zone) {
    showToast("Create a zone first.");
    return;
  }
  if (data.binZones[binId] === zone.id) {
    delete data.binZones[binId];
    showToast(`Bin ${binId} taken out of ${zone.name}.`);
  } else {
    data.binZones[binId] = zone.id;
    showToast(`Bin ${binId} added to ${zone.name}.`);
  }
  saveData();
  shownBinIds = "";
  renderMap();
  renderZoneEditPanel();
}

function renderZoneEditPanel() {
  const panel = document.querySelector("#zoneEditPanel");
  if (!zoneEdit.active) {
    panel.hidden = true;
    return;
  }
  const count = (zoneId) => allBins.filter((bin) => data.binZones[bin.id] === zoneId).length;
  const unassigned = allBins.filter((bin) => !binZone(bin.id)).length;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="directions-head">
      <div>
        <p class="map-label">Editing zones</p>
        <strong>Click bins to assign them</strong>
      </div>
      <button type="button" class="button primary" data-zone-done>Done</button>
    </div>
    <p class="zone-hint">Pick a zone, then click a bin on the map to add it. Click it again to take it out.</p>
    <div class="zone-chips">
      ${data.zones
        .map(
          (zone) => `
            <button type="button" class="zone-chip${zone.id === zoneEdit.zoneId ? " active" : ""}" data-zone-pick="${zone.id}" style="--zone: ${zone.color}">
              <i></i>${escapeHtml(zone.name)}<b>${count(zone.id)}</b>
            </button>
          `
        )
        .join("")}
    </div>
    <button type="button" class="button full-width" data-zone-new>+ New zone</button>
    <p class="zone-hint">${unassigned ? `${unassigned} bin${unassigned === 1 ? " has" : "s have"} no zone yet (gray dashed outline).` : "Every bin is in a zone."}</p>
  `;
}

document.querySelector("#zoneEditPanel").addEventListener("click", (event) => {
  if (event.target.closest("[data-zone-done]")) stopZoneEdit();
  if (event.target.closest("[data-zone-new]")) openZoneDialog();
  const pick = event.target.closest("[data-zone-pick]");
  if (pick) {
    zoneEdit.zoneId = pick.dataset.zonePick;
    renderZoneEditPanel();
    renderMap();
  }
});

document.querySelector(".map-styles").addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-style]");
  if (button && map) setMapStyle(button.dataset.mapStyle);
});

// On phones the filters fold away so the map stays visible.
document.querySelector("#filterToggle").addEventListener("click", () => {
  document.querySelector(".map-panel").classList.toggle("open");
});

// ---------------------------------------------------------------------------
// Filter panel: swipe it off the side of the screen, or tap its tab
// ---------------------------------------------------------------------------

const DRAWER_KEY = "tribin-filters-hidden";
const drawer = document.querySelector("#mapDrawer");
const drawerTab = document.querySelector("#drawerTab");
let swipe = null;
let ignoreTabClick = false;

function setDrawerOpen(open) {
  drawer.classList.toggle("closed", !open);
  drawerTab.setAttribute("aria-expanded", String(open));
  drawerTab.setAttribute("aria-label", open ? "Hide filters" : "Show filters");
  try {
    localStorage.setItem(DRAWER_KEY, open ? "0" : "1");
  } catch {
    // It just won't be remembered next time.
  }
}

drawerTab.addEventListener("click", () => {
  if (ignoreTabClick) return;
  setDrawerOpen(drawer.classList.contains("closed"));
});

// The panel follows your finger while you swipe sideways. Up-and-down
// swipes are left alone so the panel can still scroll.
drawer.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    swipe = { x: touch.clientX, y: touch.clientY, dx: 0, sideways: null };
  },
  { passive: true }
);

drawer.addEventListener(
  "touchmove",
  (event) => {
    if (!swipe) return;
    const touch = event.touches[0];
    swipe.dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (swipe.sideways === null && Math.max(Math.abs(swipe.dx), Math.abs(dy)) > 10) {
      swipe.sideways = Math.abs(swipe.dx) > Math.abs(dy);
    }
    if (!swipe.sideways) return;

    const closed = drawer.classList.contains("closed");
    drawer.classList.add("dragging");
    drawer.style.transform = closed
      ? `translateX(calc(-100% - ${drawer.offsetLeft}px + ${Math.max(0, swipe.dx)}px))`
      : `translateX(${Math.min(0, swipe.dx)}px)`;
  },
  { passive: true }
);

function endSwipe() {
  if (!swipe) return;
  drawer.classList.remove("dragging");
  drawer.style.transform = "";
  if (swipe.sideways && Math.abs(swipe.dx) > 60) {
    setDrawerOpen(swipe.dx > 0);
    // A swipe that ends on the tab shouldn't also count as a tap.
    ignoreTabClick = true;
    setTimeout(() => (ignoreTabClick = false), 400);
  }
  swipe = null;
}

drawer.addEventListener("touchend", endSwipe);
drawer.addEventListener("touchcancel", endSwipe);

try {
  if (localStorage.getItem(DRAWER_KEY) === "1") setDrawerOpen(false);
} catch {
  // Storage blocked: start with the panel open.
}

// ---------------------------------------------------------------------------
// Walking directions, shown right on the map
// ---------------------------------------------------------------------------

// Free walking-route service built on OpenStreetMap.
const ROUTE_SERVICE = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
const ARRIVED_METERS = 25;

// The trip in progress: { binId, layer, userMarker, watchId, steps, distance, duration, ... }
let trip = null;

// Starts from `here` if given, or a location found in the last minute.
function startDirections(binId, here = null) {
  const bin = allBins.find((b) => b.id === binId);
  if (!bin || !map) return;
  const known = here || (myLocation && Date.now() - myLocationAt < 60000 ? myLocation : null);
  stopDirections();
  map.closePopup();

  trip = { binId, layer: L.layerGroup().addTo(map), userMarker: null, watchId: null, steps: [] };
  document.querySelector(".page-map").classList.add("routing");
  document.querySelector("#directionsPanel").hidden = false;

  if (!navigator.geolocation) {
    renderDirections(bin, { error: "This browser can't share your location, so directions aren't available." });
    return;
  }

  renderDirections(bin, { loading: true });
  if (known) {
    loadRoute(bin, { latitude: known[0], longitude: known[1] });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => loadRoute(bin, position.coords),
    (error) => {
      if (trip?.binId === bin.id) renderDirections(bin, { error: locationErrorText(error) });
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function loadRoute(bin, coords) {
  if (trip?.binId !== bin.id) return;
  const from = [coords.latitude, coords.longitude];
  const to = [bin.latitude, bin.longitude];

  try {
    const url = `${ROUTE_SERVICE}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
    const result = await (await fetch(url)).json();
    if (result.code !== "Ok") throw new Error(result.message || "No route found");
    if (trip?.binId !== bin.id) return;

    const best = result.routes[0];
    const path = best.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    L.polyline(path, { className: "route-line", weight: 6 }).addTo(trip.layer);
    // Paths end at the nearest walkway, so dash the last few steps to the bin.
    L.polyline([path[path.length - 1], to], { className: "route-line", weight: 4, dashArray: "2 8" }).addTo(trip.layer);

    trip.steps = best.legs[0].steps;
    trip.distance = best.distance;
    trip.duration = best.duration;
    trip.points = [...path, to, from];
  } catch {
    // If the route service is down, fall back to a straight line.
    if (trip?.binId !== bin.id) return;
    L.polyline([from, to], { className: "route-line", weight: 5, dashArray: "6 10" }).addTo(trip.layer);
    trip.steps = [];
    trip.distance = distanceMeters(from, to);
    trip.duration = trip.distance / 1.3;
    trip.straightLine = true;
    trip.points = [from, to];
  }

  // Zoom once the steps are showing, so the panel's final size is known.
  moveUser(bin, from);
  fitRoute(trip.points);
  trip.watchId = navigator.geolocation.watchPosition(
    (position) => moveUser(bin, [position.coords.latitude, position.coords.longitude]),
    () => {},
    { enableHighAccuracy: true }
  );
}

// Zoom to the route, keeping it clear of the directions panel
// (beside it on computers, above it on phones).
function fitRoute(points) {
  const panel = document.querySelector("#directionsPanel");
  const onPhone = window.innerWidth <= 700;
  map.fitBounds(L.latLngBounds(points), {
    paddingTopLeft: onPhone ? [30, 70] : [panel.offsetWidth + 50, 50],
    paddingBottomRight: onPhone ? [30, panel.offsetHeight + 30] : [50, 50],
    maxZoom: 18,
  });
}

// Move the blue "you are here" dot and check whether you've arrived.
function moveUser(bin, here) {
  if (trip?.binId !== bin.id) return;
  if (!trip.userMarker) {
    trip.userMarker = L.marker(here, {
      icon: L.divIcon({ className: "", html: '<div class="you-dot"></div>', iconSize: [22, 22] }),
      zIndexOffset: 2000,
      interactive: false,
    }).addTo(trip.layer);
  } else {
    trip.userMarker.setLatLng(here);
  }

  setMyLocation(here);
  trip.remaining = distanceMeters(here, [bin.latitude, bin.longitude]);
  trip.arrived = trip.remaining <= ARRIVED_METERS;
  renderDirections(bin);
}

function stopDirections() {
  if (trip) {
    if (trip.watchId !== null) navigator.geolocation.clearWatch(trip.watchId);
    trip.layer.remove();
    trip = null;
  }
  nextPromptFor = null;
  document.querySelector(".page-map").classList.remove("routing");
  document.querySelector("#directionsPanel").hidden = true;
}

// After emptying the bin you walked to, offer the next closest full bin.
let nextPromptFor = null;

function showNextBinPrompt(emptiedBinId) {
  stopDirections();
  nextPromptFor = emptiedBinId;
  const next = nearestFullBin(emptiedBinId);
  const panel = document.querySelector("#directionsPanel");
  document.querySelector(".page-map").classList.add("routing");
  panel.hidden = false;
  panel.innerHTML = `
    <div class="directions-head">
      <div>
        <p class="map-label">Done</p>
        <strong>Bin ${emptiedBinId} emptied</strong>
      </div>
      <button type="button" class="button" data-action="stop-directions">Close</button>
    </div>
    ${
      next
        ? `
          <div class="next-up">
            <p class="map-label">Next closest full bin</p>
            <strong>Bin ${next.id}</strong>
            <span>${escapeHtml(next.location)}</span>
            ${myLocation ? `<b>${formatDistance(metersToBin(next))} away</b>` : ""}
          </div>
          <button type="button" class="button primary full-width" data-action="directions" data-id="${next.id}">Go to Bin ${next.id}</button>
        `
        : '<p class="directions-arrived">That was the last bin that needed emptying. Nice work!</p>'
    }
  `;
}

function renderDirections(bin, { loading = false, error = "" } = {}) {
  let body;
  if (loading) {
    body = '<p class="directions-status">Finding your location…</p>';
  } else if (error) {
    body = `
      <p class="directions-status">${escapeHtml(error)}</p>
      <button type="button" class="button primary full-width" data-action="directions" data-id="${bin.id}">Try again</button>
    `;
  } else if (trip.arrived) {
    body = `
      <p class="directions-arrived">You've arrived at Bin ${bin.id}.</p>
      ${
        data.settings.autoEmpty && isOnline(bin.id)
          ? `<p class="directions-auto">Empty it and Tribin will notice on its own, then show you the next bin.</p>
             <button type="button" class="button full-width" data-action="empty" data-id="${bin.id}">Mark emptied by hand</button>`
          : `<button type="button" class="button primary full-width" data-action="empty" data-id="${bin.id}">Mark emptied</button>`
      }
    `;
  } else {
    const steps = trip.steps
      .map((step) => `<li><span>${escapeHtml(stepText(step))}</span>${step.distance ? `<b>${formatDistance(step.distance)}</b>` : ""}</li>`)
      .join("");
    body = `
      <p class="directions-summary">
        <strong>${Math.max(1, Math.round(trip.duration / 60))} min</strong>
        <span>${formatDistance(trip.distance)} walk · ${formatDistance(trip.remaining ?? trip.distance)} away</span>
      </p>
      ${trip.straightLine ? '<p class="directions-status">Street directions are unavailable right now, so this is a straight-line guide.</p>' : ""}
      ${steps ? `<ol class="directions-steps">${steps}</ol>` : ""}
    `;
  }

  document.querySelector("#directionsPanel").innerHTML = `
    <div class="directions-head">
      <div>
        <p class="map-label">Walking to</p>
        <strong>Bin ${bin.id}</strong>
        <span>${escapeHtml(bin.location)}</span>
      </div>
      <button type="button" class="button" data-action="stop-directions">End</button>
    </div>
    ${body}
  `;
}

// Turn a route step into a short instruction, e.g. "Turn left onto J Street".
function stepText(step) {
  const { type, modifier, bearing_after: bearing } = step.maneuver;
  const road = step.name ? ` onto ${step.name}` : "";

  if (type === "depart") return `Head ${compassDirection(bearing)}${step.name ? ` on ${step.name}` : ""}`;
  if (type === "arrive") return `Arrive at Bin ${trip.binId}`;
  if (type === "roundabout" || type === "rotary") return `Go around the roundabout${road}`;
  if (modifier === "uturn") return "Turn around";
  if (!modifier || modifier === "straight") return `Continue straight${road}`;
  if (type === "turn" || type === "end of road") return `Turn ${modifier}${road}`;
  return `Keep ${modifier.replace("slight ", "")}${road}`;
}

function compassDirection(bearing = 0) {
  return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(bearing / 45) % 8];
}

// Feet for short distances, miles for longer ones.
function formatDistance(meters) {
  const feet = meters * 3.281;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  return `${(meters / 1609).toFixed(1)} mi`;
}

// Straight-line distance between two [lat, lng] points, in meters.
function distanceMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function locationErrorText(error) {
  if (error.code === 1) return "Location access is off. Allow location for this site in your browser settings, then try again.";
  if (error.code === 3) return "Finding your location took too long. Make sure location is on, then try again.";
  return "We couldn't find your location. Try again in a moment.";
}

// Bin Collection History
// ---------------------------------------------------------------------------
// Settings page (admins only)
// ---------------------------------------------------------------------------

function renderSettings() {
  document.querySelector("#workerRows").innerHTML = data.workers
    .map(
      (worker) => `
        <tr>
          <td><strong>${escapeHtml(worker.name)}</strong>${worker.id === data.currentUserId ? ' <span class="you">You</span>' : ""}</td>
          <td class="muted">${escapeHtml(worker.email)}</td>
          <td><span class="role role-${worker.role}">${worker.role === "admin" ? "Admin" : "Worker"}</span></td>
          <td>${worker.zoneId && zoneById(worker.zoneId) ? zoneTag(zoneById(worker.zoneId)) : '<span class="muted">All campus</span>'}</td>
          <td class="row-buttons">
            <button type="button" class="button" data-edit="${worker.id}">Edit</button>
            ${worker.id !== data.currentUserId ? `<button type="button" class="button danger" data-remove="${worker.id}">Remove</button>` : ""}
          </td>
        </tr>
      `
    )
    .join("");

  renderZones();
  document.querySelector("#liveDepth").value = data.settings.liveDepthCm;
  renderLiveStatus();

  const { fullAt, almostAt } = data.settings;
  document.querySelector("#fullAt").value = fullAt;
  document.querySelector("#fullAtValue").textContent = `${fullAt}%`;
  document.querySelector("#almostAt").value = almostAt;
  document.querySelector("#almostAtValue").textContent = `${almostAt}%`;
  document.querySelector("#autoEmpty").checked = data.settings.autoEmpty;
  document.querySelector("#lowBatteryAt").value = data.settings.lowBatteryAt;
  document.querySelector("#lowBatteryAtValue").textContent = `${data.settings.lowBatteryAt}%`;
}

document.querySelector("#workerRows").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit]");
  const remove = event.target.closest("[data-remove]");

  if (edit) openWorkerDialog(Number(edit.dataset.edit));
  if (remove) {
    const worker = data.workers.find((w) => w.id === Number(remove.dataset.remove));
    if (confirm(`Remove ${worker.name}? They won't be able to sign in anymore.`)) {
      data.workers = data.workers.filter((w) => w.id !== worker.id);
      saveData();
      renderSettings();
      showToast(`${worker.name} was removed.`);
    }
  }
});

// Keep "almost full" below "needs emptying".
document.querySelector("#autoEmpty").addEventListener("change", (event) => {
  data.settings.autoEmpty = event.target.checked;
  shownBinIds = "";
  saveData();
  showToast(event.target.checked ? "Bins will be marked emptied automatically." : "Workers will mark bins emptied by hand.");
});

["fullAt", "almostAt", "lowBatteryAt"].forEach((key) => {
  document.querySelector(`#${key}`).addEventListener("input", (event) => {
    let value = Number(event.target.value);
    if (key === "fullAt") value = Math.max(value, data.settings.almostAt + 5);
    if (key === "almostAt") value = Math.min(value, data.settings.fullAt - 5);
    event.target.value = value;
    data.settings[key] = value;
    document.querySelector(`#${key}Value`).textContent = `${value}%`;
    shownBinIds = "";
    saveData();
  });
});

function renderZones() {
  const rows = data.zones.map((zone) => {
    const bins = allBins.filter((bin) => data.binZones[bin.id] === zone.id);
    const full = bins.filter((bin) => binStatus(bin.id) === "full").length;
    const workers = data.workers.filter((worker) => worker.zoneId === zone.id);
    return `
      <tr>
        <td>${zoneTag(zone)}</td>
        <td>${bins.length}</td>
        <td>${full ? `<b class="text-full">${full}</b>` : "0"}</td>
        <td>${workers.length ? workers.map((w) => escapeHtml(w.name)).join(", ") : '<span class="no-workers">No one assigned</span>'}</td>
        <td class="row-buttons">
          <button type="button" class="button" data-zone-map="${zone.id}">Map</button>
          <button type="button" class="button" data-zone-edit="${zone.id}">Edit</button>
          <button type="button" class="button danger" data-zone-delete="${zone.id}">Delete</button>
        </td>
      </tr>
    `;
  });
  document.querySelector("#zoneRows").innerHTML = rows.length
    ? rows.join("")
    : '<tr><td colspan="5" class="muted">No zones yet. Click + Add zone to make one.</td></tr>';

  const unassigned = allBins.filter((bin) => !binZone(bin.id)).length;
  const warning = document.querySelector("#zoneWarning");
  warning.hidden = unassigned === 0;
  warning.textContent = `${unassigned} bin${unassigned === 1 ? " isn't" : "s aren't"} in any zone yet. Use "Assign bins on map" to add them.`;
}

document.querySelector("#zoneRows").addEventListener("click", (event) => {
  const mapButton = event.target.closest("[data-zone-map]");
  const editButton = event.target.closest("[data-zone-edit]");
  const deleteButton = event.target.closest("[data-zone-delete]");
  if (mapButton) startZoneEdit(mapButton.dataset.zoneMap);
  if (editButton) openZoneDialog(editButton.dataset.zoneEdit);
  if (deleteButton) {
    const zone = zoneById(deleteButton.dataset.zoneDelete);
    if (!confirm(`Delete ${zone.name}? Its bins and workers will have no zone until you assign them again.`)) return;
    data.zones = data.zones.filter((z) => z.id !== zone.id);
    Object.keys(data.binZones).forEach((binId) => {
      if (data.binZones[binId] === zone.id) delete data.binZones[binId];
    });
    data.workers.forEach((worker) => {
      if (worker.zoneId === zone.id) worker.zoneId = null;
    });
    saveData();
    shownBinIds = "";
    renderZoneSelects();
    renderSettings();
    showToast(`${zone.name} was deleted.`);
  }
});

document.querySelector("#addZone").addEventListener("click", () => openZoneDialog());

function showSettingsTab(tab) {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => button.classList.toggle("active", button.dataset.settingsTab === tab));
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => (panel.hidden = panel.dataset.settingsPanel !== tab));
}

document.querySelector(".settings-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-settings-tab]");
  if (button) showSettingsTab(button.dataset.settingsTab);
});
document.querySelector("#editZonesMap").addEventListener("click", () => startZoneEdit());

// ---------------------------------------------------------------------------
// Add / edit zone dialog
// ---------------------------------------------------------------------------

let editingZoneId = null;
let zoneColor = ZONE_COLORS[0];
const zoneDialog = document.querySelector("#zoneDialog");

function renderZoneColors() {
  document.querySelector("#zoneColors").innerHTML = ZONE_COLORS.map(
    (color) =>
      `<button type="button" class="color-swatch${color === zoneColor ? " active" : ""}" data-color="${color}" style="background: ${color}" aria-label="Color ${color}"></button>`
  ).join("");
}

function openZoneDialog(zoneId = null) {
  editingZoneId = zoneId;
  const zone = zoneById(zoneId);
  const unused = ZONE_COLORS.find((color) => !data.zones.some((z) => z.color === color));
  zoneColor = zone?.color || unused || ZONE_COLORS[0];
  document.querySelector("#zoneDialogTitle").textContent = zone ? `Edit ${zone.name}` : "Add zone";
  document.querySelector("#zoneName").value = zone?.name || "";
  document.querySelector("#zoneError").hidden = true;
  renderZoneColors();
  document.querySelector("#zoneWorkers").innerHTML = data.workers
    .map((worker) => {
      const current = zoneById(worker.zoneId);
      const note = current && current.id !== zoneId ? `now in ${escapeHtml(current.name)}` : worker.role === "admin" ? "admin" : "";
      return `
        <label class="zone-worker">
          <input type="checkbox" value="${worker.id}" ${zone && worker.zoneId === zone.id ? "checked" : ""} />
          ${escapeHtml(worker.name)}${note ? ` <small>(${note})</small>` : ""}
        </label>
      `;
    })
    .join("");
  zoneDialog.showModal();
}

document.querySelector("#zoneColors").addEventListener("click", (event) => {
  const swatch = event.target.closest("[data-color]");
  if (!swatch) return;
  zoneColor = swatch.dataset.color;
  renderZoneColors();
});

document.querySelector("#cancelZone").addEventListener("click", () => zoneDialog.close());

document.querySelector("#zoneForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#zoneName").value.trim();
  const error = document.querySelector("#zoneError");
  let problem = "";
  if (name.length < 2) problem = "Give the zone a name.";
  else if (data.zones.some((z) => z.name.toLowerCase() === name.toLowerCase() && z.id !== editingZoneId)) problem = "There's already a zone with that name.";
  if (problem) {
    error.textContent = problem;
    error.hidden = false;
    return;
  }

  let zone = zoneById(editingZoneId);
  const isNew = !zone;
  if (isNew) {
    zone = { id: `z${data.nextZoneId++}`, name, color: zoneColor };
    data.zones.push(zone);
  } else {
    Object.assign(zone, { name, color: zoneColor });
  }

  // Checked workers move into this zone; unchecked ones leave it.
  const checked = new Set([...document.querySelectorAll("#zoneWorkers input:checked")].map((box) => Number(box.value)));
  data.workers.forEach((worker) => {
    if (checked.has(worker.id)) worker.zoneId = zone.id;
    else if (worker.zoneId === zone.id) worker.zoneId = null;
  });

  saveData();
  zoneDialog.close();
  shownBinIds = "";
  renderZoneSelects();
  if (currentPage === "settings") renderSettings();
  if (zoneEdit.active) {
    zoneEdit.zoneId = zone.id;
    renderZoneEditPanel();
    renderMap();
  } else if (isNew) {
    showToast(`${name} created. Now add its bins.`, { label: "Assign bins", onClick: () => startZoneEdit(zone.id) });
    return;
  }
  showToast(isNew ? `${name} created.` : `${name} updated.`);
});

document.querySelector("#liveDepth").addEventListener("change", (event) => {
  const value = Math.round(Number(event.target.value));
  data.settings.liveDepthCm = Math.min(400, Math.max(10, value || 60));
  event.target.value = data.settings.liveDepthCm;
  data.levels[LIVE.binId].ignoreDropUntil = Date.now() + 10000;
  applyLiveReading();
  saveData();
  renderLiveStatus();
});

// Point the sensor at the empty container and click this to set its depth.
document.querySelector("#liveCalibrate").addEventListener("click", () => {
  if (!liveIsFresh()) {
    showToast("No live reading yet. Make sure the sensor is on Wi-Fi.");
    return;
  }
  data.settings.liveDepthCm = Math.max(10, Math.round(liveReading.distanceCm));
  data.levels[LIVE.binId].ignoreDropUntil = Date.now() + 10000;
  document.querySelector("#liveDepth").value = data.settings.liveDepthCm;
  applyLiveReading();
  saveData();
  renderLiveStatus();
  showToast(`Empty depth set to ${data.settings.liveDepthCm} cm.`);
});

document.querySelector("#resetData").addEventListener("click", () => {
  if (!confirm("Reset all bins and workers back to the demo starting point?")) return;
  const userId = data.currentUserId;
  data = defaultData();
  data.currentUserId = userId;
  saveData();
  shownBinIds = "";
  renderSettings();
  showToast("Demo data reset.");
});

// ---------------------------------------------------------------------------
// Add / edit worker dialog
// ---------------------------------------------------------------------------

let editingWorkerId = null;
const workerDialog = document.querySelector("#workerDialog");

function openWorkerDialog(workerId = null) {
  editingWorkerId = workerId;
  const worker = data.workers.find((w) => w.id === workerId);
  document.querySelector("#workerDialogTitle").textContent = worker ? `Edit ${worker.name}` : "Add worker";
  document.querySelector("#workerName").value = worker?.name || "";
  document.querySelector("#workerEmail").value = worker?.email || "";
  document.querySelector("#workerRole").value = worker?.role || "worker";
  document.querySelector("#workerRole").disabled = workerId === data.currentUserId;
  document.querySelector("#workerZone").innerHTML =
    '<option value="">No zone (all campus)</option>' +
    data.zones.map((zone) => `<option value="${zone.id}">${escapeHtml(zone.name)}</option>`).join("");
  document.querySelector("#workerZone").value = worker?.zoneId && zoneById(worker.zoneId) ? worker.zoneId : "";
  document.querySelector("#workerError").hidden = true;
  workerDialog.showModal();
}

document.querySelector("#addWorker").addEventListener("click", () => openWorkerDialog());
document.querySelector("#cancelWorker").addEventListener("click", () => workerDialog.close());

document.querySelector("#workerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#workerName").value.trim();
  const email = document.querySelector("#workerEmail").value.trim().toLowerCase();
  const role = document.querySelector("#workerRole").value;
  const zoneId = document.querySelector("#workerZone").value || null;
  const error = document.querySelector("#workerError");

  let problem = "";
  if (name.length < 2) problem = "Enter the worker's full name.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problem = "Enter a valid email address.";
  else if (data.workers.some((w) => w.email === email && w.id !== editingWorkerId)) problem = "Someone already uses that email.";
  if (problem) {
    error.textContent = problem;
    error.hidden = false;
    return;
  }

  if (editingWorkerId) {
    const worker = data.workers.find((w) => w.id === editingWorkerId);
    Object.assign(worker, { name, email, zoneId });
    if (worker.id !== data.currentUserId) worker.role = role;
    showToast(`${name} was updated.`);
  } else {
    data.workers.push({ id: data.nextWorkerId++, name, email, role, zoneId });
    showToast(`${name} was added.`);
  }

  saveData();
  workerDialog.close();
  renderSettings();
  if (editingWorkerId === data.currentUserId) document.querySelector("#userName").textContent = name;
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Wait until reports.js and home.js have loaded too.
window.addEventListener("DOMContentLoaded", () => {
  if (currentUser()) {
    signIn(data.currentUserId);
  } else {
    showLogin();
  }

  startLiveSensor();

  setInterval(() => {
    readSensors();
    saveData();
    if (currentUser()) render();
    else renderLoginPreview();
  }, UPDATE_EVERY_SECONDS * 1000);
});
