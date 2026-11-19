// ===========================================================================
// Reports page: graphs, the history of every bin, and Excel / PDF downloads.
// Uses the data and helpers from app.js.
// ===========================================================================

const REPORT_DAYS = 14; // charts and tables cover the last two weeks
const BIN_CHART_DAYS = 7; // the fill-level graph for one bin

// One color per compartment in the graphs (checked for color-blind safety).
const PART_COLORS = { recycling: "#2a78d6", landfill: "#eb6834", compost: "#1baf7a" };

const LIBRARIES = {
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  autotable: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
};

const reportState = { zone: null, binId: null, showAllBins: false, renderedAt: 0, hovering: false };
const historyCache = new Map();

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

// (startOfDay, busyHours and busyHoursBefore are in app.js.)

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const fmtWhen = (t) => `${fmtDay(t)}, ${fmtTime(t)}`;
const average = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;
const round1 = (v) => Math.round(v * 10) / 10;

function fmtGap(hours) {
  if (hours == null) return "-";
  return hours < 36 ? `${Math.round(hours)} h` : `${round1(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// History of each bin
// ---------------------------------------------------------------------------

function zoneCrew(binId) {
  const zoneId = data.binZones[binId];
  const crew = data.workers.filter((w) => w.role === "worker");
  const inZone = crew.filter((w) => w.zoneId === zoneId);
  return inZone.length ? inZone : crew.length ? crew : data.workers;
}

function workerName(workerId) {
  return data.workers.find((w) => w.id === workerId)?.name || "Other staff";
}

// Every time this bin was emptied, oldest first. Real "Mark emptied" presses
// come from the log; the weeks before the dashboard was first opened (the
// "anchor") are simulated so the demo has a past. With real sensors this
// would come from the backend instead.
function binEvents(binId) {
  const level = data.levels[binId];
  const anchor = level.historyAnchor ?? level.emptiedAt;
  const real = data.emptiedLog.filter((e) => e.binId === binId && e.at > anchor).sort((a, b) => a.at - b.at);
  const key = [anchor, real.length, real.at(-1)?.at, data.binZones[binId], data.workers.length].join("|");
  const cached = historyCache.get(binId);
  if (cached && cached.key === key) return cached.events;

  const random = seededRandom(binId * 7919 + 17);
  const crew = zoneCrew(binId);
  const pick = () => crew[Math.floor(random() * crew.length)]?.id ?? null;
  const speed = fillSpeed(binId);

  // Walk back in time from the oldest known emptying, one fill-up at a time.
  const past = [{ binId, at: anchor, workerId: anchor === level.emptiedAt && level.emptiedBy ? level.emptiedBy : pick(), sim: true, auto: true }];
  let end = anchor;
  const stop = Date.now() - (REPORT_DAYS + 3) * DAY_MS;
  while (end > stop) {
    const fillTo = 78 + random() * 20;
    let start = busyHoursBefore(end, fillTo / (PART_RATE.landfill * speed));
    // Workers empty bins between 6 am and 8 pm.
    const hour = new Date(start).getHours();
    if (hour < 6) start = startOfDay(start) - DAY_MS + (18 + random() * 1.5) * HOUR_MS;
    else if (hour >= 20) start = startOfDay(start) + (18 + random() * 1.5) * HOUR_MS;
    past.push({ binId, at: start, workerId: pick(), sim: true, auto: true });
    end = start;
  }

  const events = [...past.reverse(), ...real.map((e) => ({ ...e }))];

  // How full each part was when it was emptied.
  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    if (event.before) {
      event.peak = event.before;
      continue;
    }
    const hours = busyHours(events[i - 1].at, event.at);
    event.peak = {};
    COMPARTMENTS.forEach(({ key }) => {
      const modeled = PART_RATE[key] * speed * hours * (0.85 + random() * 0.3);
      const estimate = event.sim ? modeled : Math.max(modeled, (88 * PART_RATE[key]) / PART_RATE.landfill);
      event.peak[key] = Math.round(Math.min(100, estimate));
    });
  }

  historyCache.set(binId, { key, events });
  return events;
}

// Fill level of each part at time t.
function levelsAt(binId, events, t) {
  let i = events.length - 1;
  while (i >= 0 && events[i].at > t) i--;
  if (i < 0) return null;
  const next = events[i + 1];
  const end = next ? next.at : Date.now();
  const top = next ? next.peak : data.levels[binId];
  const total = busyHours(events[i].at, end);
  const share = total > 0 ? Math.min(1, Math.max(0, busyHours(events[i].at, t) / total)) : 1;
  const levels = {};
  COMPARTMENTS.forEach(({ key }) => (levels[key] = round1((top?.[key] ?? 0) * share)));
  return levels;
}

// Hourly fill levels, plus the drop to zero each time the bin was emptied.
function binSeries(binId, from, to) {
  const events = binEvents(binId);
  const times = new Set([from, to]);
  for (let t = Math.ceil(from / HOUR_MS) * HOUR_MS; t < to; t += HOUR_MS) times.add(t);
  const emptied = events.filter((e) => e.peak && e.at > from && e.at <= to);
  emptied.forEach((e) => {
    times.add(e.at - 1);
    times.add(e.at);
  });
  const points = [...times]
    .sort((a, b) => a - b)
    .map((t) => ({ t, levels: levelsAt(binId, events, t) }))
    .filter((p) => p.levels);
  return { points, emptied, events };
}

const fullestPeak = (event) => Math.max(...COMPARTMENTS.map(({ key }) => event.peak[key]));

function binMetrics(binId, from) {
  const events = binEvents(binId);
  const inRange = events.filter((e) => e.peak && e.at >= from);
  const gaps = [];
  events.forEach((e, i) => {
    if (i > 0 && e.at >= from) gaps.push((e.at - events[i - 1].at) / HOUR_MS);
  });
  return {
    count: inRange.length,
    avgFull: inRange.length ? Math.round(average(inRange.map(fullestPeak))) : null,
    avgGap: gaps.length ? average(gaps) : null,
    events: inRange,
  };
}

// ---------------------------------------------------------------------------
// Report data (shared by the page and the downloads)
// ---------------------------------------------------------------------------

function reportStart() {
  return startOfDay(Date.now() - (REPORT_DAYS - 1) * DAY_MS);
}

function reportZoneLabel() {
  if (reportState.zone === "all") return "All zones";
  if (reportState.zone === "none") return "No zone";
  return zoneById(reportState.zone)?.name || "All zones";
}

const zoneName = (binId) => binZone(binId)?.name || "No zone";

const STATUS_ORDER = { full: 0, almost: 1, offline: 2, ok: 3 };

function buildReport() {
  const valid = (v) => v === "all" || v === "none" || zoneById(v);
  if (!valid(reportState.zone)) reportState.zone = myZoneId() || "all";

  const now = Date.now();
  const from = reportStart();
  const bins = allBins
    .filter((bin) => inZone(bin.id, reportState.zone))
    .sort((a, b) => STATUS_ORDER[binStatus(a.id)] - STATUS_ORDER[binStatus(b.id)] || fullest(b.id) - fullest(a.id));
  const metrics = new Map(bins.map((bin) => [bin.id, binMetrics(bin.id, from)]));
  const collections = [...metrics.values()].flatMap((m) => m.events).sort((a, b) => b.at - a.at);

  const days = [];
  for (let i = REPORT_DAYS - 1; i >= 0; i--) days.push({ start: startOfDay(now - i * DAY_MS), count: 0 });
  const byDay = new Map(days.map((d) => [d.start, d]));
  collections.forEach((e) => {
    const day = byDay.get(startOfDay(e.at));
    if (day) day.count++;
  });

  const perWorker = new Map();
  collections.forEach((e) => perWorker.set(e.workerId ?? null, (perWorker.get(e.workerId ?? null) || 0) + 1));
  const workers = [...perWorker.entries()]
    .map(([workerId, count]) => {
      const worker = data.workers.find((w) => w.id === workerId);
      return {
        name: worker?.name || "Other staff",
        zone: worker?.zoneId && zoneById(worker.zoneId) ? zoneById(worker.zoneId).name : "All campus",
        count,
        today: collections.filter((e) => (e.workerId ?? null) === workerId && e.at >= startOfDay(now)).length,
      };
    })
    .sort((a, b) => b.count - a.count);

  const fullAtEmpty = collections.map(fullestPeak);
  return {
    now,
    from,
    zone: reportZoneLabel(),
    bins,
    metrics,
    collections,
    days,
    workers,
    stats: {
      today: collections.filter((e) => e.at >= startOfDay(now)).length,
      week: collections.filter((e) => e.at >= now - 7 * DAY_MS).length,
      total: collections.length,
      avgFull: fullAtEmpty.length ? Math.round(average(fullAtEmpty)) : null,
      needEmptying: bins.filter((bin) => binStatus(bin.id) === "full").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Charts (plain SVG, so they can also be put into the PDF)
// ---------------------------------------------------------------------------

const INK = "#16241c";
const MUTED_INK = "#6b766f";
const r1 = (v) => Math.round(v * 10) / 10;

function svgOpen(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Plus Jakarta Sans, Helvetica, Arial, sans-serif">`;
}

function niceScale(max, ticks = 4) {
  const raw = Math.max(1, max) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw));
  return { step, max: step * ticks };
}

function topRoundedBar(x, y, w, h, radius) {
  if (h <= 0) return "";
  const r = Math.min(radius, w / 2, h);
  return `M${r1(x)},${r1(y + h)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h)}Z`;
}

// Bins emptied per day.
function columnChart(days, width, height) {
  const m = { top: 22, right: 8, bottom: 26, left: 34 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const { step, max } = niceScale(Math.max(...days.map((d) => d.count)));
  const y = (v) => m.top + h - (v / max) * h;
  const slot = w / days.length;
  const barW = Math.min(38, slot * 0.62);
  const labelEvery = slot >= 34 ? 1 : 2;
  const peak = days.reduce((best, d, i) => (d.count > days[best].count ? i : best), 0);

  let svg = svgOpen(width, height);
  for (let v = 0; v <= max; v += step) {
    svg += `<line x1="${m.left}" x2="${width - m.right}" y1="${r1(y(v))}" y2="${r1(y(v))}" stroke="${v === 0 ? "#cdd3cb" : "#e8ebe5"}" stroke-width="1"/>`;
    svg += `<text x="${m.left - 7}" y="${r1(y(v) + 4)}" text-anchor="end" font-size="11" fill="${MUTED_INK}">${v}</text>`;
  }
  const bars = days.map((day, i) => {
    const x = m.left + slot * i + (slot - barW) / 2;
    const top = y(day.count);
    const isToday = i === days.length - 1;
    svg += `<path class="col" data-i="${i}" d="${topRoundedBar(x, top, barW, m.top + h - top, 4)}" fill="#0b5a3c"/>`;
    if ((days.length - 1 - i) % labelEvery === 0) {
      const label = slot >= 56 ? (isToday ? "Today" : new Date(day.start).toLocaleDateString([], { weekday: "short", day: "numeric" })) : new Date(day.start).getDate();
      svg += `<text x="${r1(x + barW / 2)}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${MUTED_INK}">${escapeHtml(String(label))}</text>`;
    }
    if ((i === peak || isToday) && day.count > 0) {
      svg += `<text x="${r1(x + barW / 2)}" y="${r1(top - 6)}" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">${day.count}</text>`;
    }
    return { left: m.left + slot * i, width: slot, center: x + barW / 2, top, day };
  });
  return { svg: svg + "</svg>", bars, width, height };
}

// Fill level of the three parts of one bin over time.
function lineChart({ points, emptied, from, to, width, height, fullAt }) {
  const narrow = width < 520;
  const m = { top: 14, right: narrow ? 50 : 100, bottom: 26, left: 40 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const x = (t) => m.left + ((t - from) / (to - from)) * w;
  const y = (v) => m.top + (1 - v / 100) * h;

  let svg = svgOpen(width, height);
  [0, 25, 50, 75, 100].forEach((v) => {
    svg += `<line x1="${m.left}" x2="${m.left + w}" y1="${r1(y(v))}" y2="${r1(y(v))}" stroke="${v === 0 ? "#cdd3cb" : "#e8ebe5"}" stroke-width="1"/>`;
    svg += `<text x="${m.left - 7}" y="${r1(y(v) + 4)}" text-anchor="end" font-size="11" fill="${MUTED_INK}">${v}%</text>`;
  });
  for (let day = startOfDay(from); day < to; day = startOfDay(day + DAY_MS + 2 * HOUR_MS)) {
    if (day > from) svg += `<line x1="${r1(x(day))}" x2="${r1(x(day))}" y1="${m.top}" y2="${m.top + h}" stroke="#eef0eb" stroke-width="1"/>`;
    const noon = day + 12 * HOUR_MS;
    if (noon > from && noon < to) {
      const label = new Date(noon).toLocaleDateString([], narrow ? { weekday: "short" } : { weekday: "short", day: "numeric" });
      svg += `<text x="${r1(x(noon))}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${MUTED_INK}">${escapeHtml(label)}</text>`;
    }
  }
  svg += `<line x1="${m.left}" x2="${m.left + w}" y1="${r1(y(fullAt))}" y2="${r1(y(fullAt))}" stroke="#d0402f" stroke-opacity="0.6" stroke-width="1" stroke-dasharray="4 4"/>`;
  svg += `<text x="${m.left + 6}" y="${r1(y(fullAt) - 5)}" font-size="10.5" fill="#a3392b">Full at ${fullAt}%</text>`;
  emptied.forEach((e) => {
    svg += `<line x1="${r1(x(e.at))}" x2="${r1(x(e.at))}" y1="${m.top}" y2="${m.top + h}" stroke="#8f978f" stroke-width="1" stroke-dasharray="2 3"/>`;
  });
  COMPARTMENTS.forEach(({ key }) => {
    const d = points.map((p, i) => `${i ? "L" : "M"}${r1(x(p.t))},${r1(y(p.levels[key]))}`).join("");
    svg += `<path d="${d}" fill="none" stroke="${PART_COLORS[key]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });

  // Name and latest value at the end of each line, nudged apart so they never overlap.
  const last = points.at(-1).levels;
  const labels = COMPARTMENTS.map(({ key, label }) => ({ key, label, value: Math.round(last[key]), y: y(last[key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
  const overflow = labels.at(-1).y - (m.top + h);
  if (overflow > 0) labels.forEach((l) => (l.y -= overflow));
  labels.forEach((l) => {
    svg += `<circle cx="${m.left + w + 10}" cy="${r1(l.y)}" r="4" fill="${PART_COLORS[l.key]}"/>`;
    svg += `<text x="${m.left + w + 18}" y="${r1(l.y + 4)}" font-size="11.5" fill="${INK}">${narrow ? "" : `${l.label} `}<tspan font-weight="700">${l.value}%</tspan></text>`;
  });

  return { svg: svg + "</svg>", x, y, m, w, h, from, to };
}

function element(tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

function trackHover(container) {
  container.addEventListener("pointerenter", () => (reportState.hovering = true));
  container.addEventListener("pointerleave", () => (reportState.hovering = false));
}

function placeTip(container, tip, x, y) {
  let left = x + 12;
  if (left + tip.offsetWidth > container.clientWidth) left = x - 12 - tip.offsetWidth;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${y}px`;
}

function drawColumnChart(container, days) {
  const width = container.clientWidth || 700;
  const chart = columnChart(days, width, width < 520 ? 200 : 230);
  container.innerHTML = chart.svg;
  const tip = element("div", "chart-tip");
  tip.hidden = true;
  container.append(tip);
  chart.bars.forEach((bar, i) => {
    const hit = element("div", "chart-hit");
    Object.assign(hit.style, { left: `${bar.left}px`, width: `${bar.width}px`, top: "0", height: `${chart.height - 26}px` });
    const show = () => {
      container.classList.add("dimmed");
      container.querySelectorAll(".col").forEach((col) => col.classList.toggle("on", col.dataset.i === String(i)));
      tip.innerHTML = `<b>${escapeHtml(fmtDay(bar.day.start))}</b><div>${bar.day.count} bin${bar.day.count === 1 ? "" : "s"} emptied</div>`;
      tip.hidden = false;
      placeTip(container, tip, bar.center, Math.max(0, bar.top - 44));
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", () => {
      container.classList.remove("dimmed");
      tip.hidden = true;
    });
    container.append(hit);
  });
  trackHover(container);
}

function drawLineChart(container, binId) {
  const to = Date.now();
  const from = to - BIN_CHART_DAYS * DAY_MS;
  const { points, emptied, events } = binSeries(binId, from, to);
  const width = container.clientWidth || 700;
  if (!points.length) {
    container.innerHTML = '<p class="muted">No readings yet for this bin.</p>';
    return;
  }
  const chart = lineChart({ points, emptied, from, to, width, height: width < 520 ? 220 : 260, fullAt: data.settings.fullAt });
  container.innerHTML = chart.svg;

  const cross = element("div", "chart-cross");
  const tip = element("div", "chart-tip");
  const dots = COMPARTMENTS.map(({ key }) => {
    const dot = element("div", "chart-dot");
    dot.style.background = PART_COLORS[key];
    return dot;
  });
  const hit = element("div", "chart-hit");
  Object.assign(hit.style, { left: `${chart.m.left}px`, top: `${chart.m.top}px`, width: `${chart.w}px`, height: `${chart.h}px` });
  Object.assign(cross.style, { top: `${chart.m.top}px`, height: `${chart.h}px` });
  [cross, tip, ...dots].forEach((el) => (el.hidden = true));
  container.append(cross, ...dots, tip, hit);

  const hide = () => [cross, tip, ...dots].forEach((el) => (el.hidden = true));
  const show = (event) => {
    const rect = hit.getBoundingClientRect();
    const px = Math.min(chart.w, Math.max(0, event.clientX - rect.left));
    const t = from + (px / chart.w) * (to - from);
    const levels = levelsAt(binId, events, t);
    if (!levels) return hide();
    const x = chart.m.left + px;
    const near = emptied.find((e) => Math.abs(chart.x(e.at) - x) < 8);
    cross.style.left = `${x}px`;
    COMPARTMENTS.forEach(({ key }, i) => {
      dots[i].style.left = `${x}px`;
      dots[i].style.top = `${chart.y(levels[key])}px`;
    });
    tip.innerHTML =
      `<b>${escapeHtml(fmtWhen(t))}</b>` +
      COMPARTMENTS.map(({ key, label }) => `<div><i style="background: ${PART_COLORS[key]}"></i>${label} <b>${Math.round(levels[key])}%</b></div>`).join("") +
      (near ? `<div class="tip-note">Emptied at ${escapeHtml(fmtTime(near.at))} by ${escapeHtml(workerName(near.workerId))}</div>` : "");
    [cross, tip, ...dots].forEach((el) => (el.hidden = false));
    placeTip(container, tip, x, chart.m.top + 4);
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
  trackHover(container);
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function barList(items, max) {
  return items.length
    ? items
        .map(
          (item) => `
            <${item.binId ? `button type="button" data-report-bin="${item.binId}"` : "div"} class="bar-item">
              <span class="bar-name" title="${escapeHtml(item.title || item.name)}">${escapeHtml(item.name)}</span>
              <span class="bar-line"><span style="width: ${max ? (item.count / max) * 100 : 0}%"></span></span>
              <b>${item.count}</b>
            </${item.binId ? "button" : "div"}>
          `
        )
        .join("")
    : '<p class="muted">Nothing emptied in this period.</p>';
}

function renderReports() {
  const report = buildReport();
  const zoneSelect = document.querySelector("#reportZone");
  zoneSelect.innerHTML = zoneOptions();
  zoneSelect.value = reportState.zone;
  document.querySelector("#reportSubtitle").textContent = `${report.zone} · last ${REPORT_DAYS} days · ${report.bins.length} bins`;

  const { stats } = report;
  document.querySelector("#reportStats").innerHTML = [
    ["Emptied today", stats.today],
    ["Emptied in 7 days", stats.week],
    ["Full when emptied", stats.avgFull == null ? "-" : `${stats.avgFull}%`, "on average"],
    ["Need emptying now", stats.needEmptying],
  ]
    .map(
      ([label, value, note]) => `
        <div class="stat">
          <span class="stat-label">${label}</span>
          <strong class="stat-value">${value}</strong>
          ${note ? `<span class="stat-note">${note}</span>` : ""}
        </div>
      `
    )
    .join("");

  drawColumnChart(document.querySelector("#dailyChart"), report.days);
  renderBinHistory(report);

  const top = report.bins
    .map((bin) => ({ binId: bin.id, name: `Bin ${bin.id}`, title: `Bin ${bin.id} · ${bin.location}`, count: report.metrics.get(bin.id).count }))
    .filter((item) => item.count)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  document.querySelector("#topBins").innerHTML = barList(top, top[0]?.count);
  document.querySelector("#workerBars").innerHTML = barList(report.workers.slice(0, 8), report.workers[0]?.count);

  const shown = reportState.showAllBins ? report.bins : report.bins.slice(0, 12);
  document.querySelector("#allBinRows").innerHTML = shown.length
    ? shown
        .map((bin) => {
          const status = binStatus(bin.id);
          const metric = report.metrics.get(bin.id);
          const level = data.levels[bin.id];
          return `
            <tr data-report-bin="${bin.id}" class="${bin.id === reportState.binId ? "selected" : ""}">
              <td><b>Bin ${bin.id}</b></td>
              <td class="cell-location" title="${escapeHtml(bin.location)}">${escapeHtml(bin.location)}</td>
              <td>${zoneTag(binZone(bin.id))}</td>
              <td><span class="badge badge-${status}">${STATUS_TEXT[status]}</span></td>
              ${COMPARTMENTS.map(({ key }) => `<td class="num">${Math.round(level[key])}%</td>`).join("")}
              <td class="num${isLowBattery(bin.id) ? " battery-low" : ""}">${batteryOf(bin.id) == null ? "USB" : `${batteryOf(bin.id)}%`}</td>
              <td>${escapeHtml(timeAgo(level.emptiedAt))}</td>
              <td class="num">${metric.count}</td>
              <td class="num">${metric.avgFull == null ? "-" : `${metric.avgFull}%`}</td>
              <td class="num">${fmtGap(metric.avgGap)}</td>
            </tr>
          `;
        })
        .join("")
    : '<tr><td colspan="12" class="muted">No bins in this zone.</td></tr>';
  const more = document.querySelector("#showAllBins");
  more.hidden = report.bins.length <= 12;
  more.textContent = reportState.showAllBins ? "Show fewer" : `Show all ${report.bins.length} bins`;

  const log = report.collections.slice(0, 50);
  document.querySelector("#historyRows").innerHTML = log.length
    ? log
        .map(
          (e) => `
            <tr data-report-bin="${e.binId}">
              <td><b>Bin ${e.binId}</b></td>
              <td>${zoneTag(binZone(e.binId))}</td>
              <td>${escapeHtml(workerName(e.workerId))}</td>
              <td>${e.auto ? "Sensor" : "Button"}</td>
              <td>${escapeHtml(fmtWhen(e.at))}</td>
              <td class="num">${fullestPeak(e)}%</td>
            </tr>
          `
        )
        .join("")
    : '<tr><td colspan="6" class="muted">No collection history yet.</td></tr>';
  document.querySelector("#historyNote").textContent =
    report.collections.length > log.length ? `Showing the latest ${log.length} of ${report.collections.length}. The Excel download has all of them.` : "";

  reportState.renderedAt = Date.now();
}

function renderBinHistory(report) {
  const { bins } = report;
  if (!bins.some((bin) => bin.id === reportState.binId)) reportState.binId = bins[0]?.id ?? null;
  const select = document.querySelector("#reportBin");
  select.innerHTML = [...bins]
    .sort((a, b) => a.id - b.id)
    .map((bin) => {
      const place = bin.location.length > 38 ? `${bin.location.slice(0, 37)}…` : bin.location;
      return `<option value="${bin.id}">Bin ${bin.id} · ${escapeHtml(place)}</option>`;
    })
    .join("");
  const card = document.querySelector("#binHistoryCard");
  const bin = allBins.find((b) => b.id === reportState.binId);
  card.classList.toggle("is-empty", !bin);
  if (!bin) {
    document.querySelector("#binChart").innerHTML = '<p class="muted">No bins in this zone.</p>';
    document.querySelector("#binStats").innerHTML = "";
    document.querySelector("#binEventRows").innerHTML = "";
    return;
  }
  select.value = bin.id;
  document.querySelector("#binPlace").innerHTML = `${escapeHtml(bin.location)} ${zoneTag(binZone(bin.id))}`;
  drawLineChart(document.querySelector("#binChart"), bin.id);

  const metric = report.metrics.get(bin.id) || binMetrics(bin.id, report.from);
  const status = binStatus(bin.id);
  document.querySelector("#binStats").innerHTML = [
    ["Right now", `${Math.round(fullest(bin.id))}%`, STATUS_TEXT[status]],
    ["Emptied", metric.count, `in ${REPORT_DAYS} days`],
    ["Emptied about every", fmtGap(metric.avgGap)],
    ["Full when emptied", metric.avgFull == null ? "-" : `${metric.avgFull}%`, "on average"],
  ]
    .map(
      ([label, value, note]) => `
        <div class="stat">
          <span class="stat-label">${label}</span>
          <strong class="stat-value">${value}</strong>
          ${note ? `<span class="stat-note">${note}</span>` : ""}
        </div>
      `
    )
    .join("");

  const recent = [...metric.events].reverse().slice(0, 8);
  document.querySelector("#binEventRows").innerHTML = recent.length
    ? recent
        .map(
          (e) => `
            <tr>
              <td>${escapeHtml(fmtWhen(e.at))}</td>
              <td>${escapeHtml(workerName(e.workerId))}</td>
              <td>${e.auto ? "Sensor" : "Button"}</td>
              ${COMPARTMENTS.map(({ key }) => `<td class="num">${e.peak[key]}%</td>`).join("")}
            </tr>
          `
        )
        .join("")
    : '<tr><td colspan="6" class="muted">Not emptied in this period.</td></tr>';
}

// Called from app.js when the page opens and on every update tick.
function refreshReports(force = false) {
  if (currentPage !== "history") return;
  if (force || !reportState.renderedAt || (!reportState.hovering && Date.now() - reportState.renderedAt > 60000)) renderReports();
}

function resetReports() {
  Object.assign(reportState, { zone: null, binId: null, showAllBins: false, renderedAt: 0 });
}

function openReports() {
  reportState.renderedAt = 0;
}

function openBinHistory(binId) {
  if (!inZone(binId, reportState.zone ?? "all")) reportState.zone = "all";
  reportState.binId = binId;
  if (reportState.zone === null) reportState.zone = inZone(binId, myZoneId() || "all") ? myZoneId() || "all" : "all";
  showPage("history");
  document.querySelector("#binHistoryCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelector("#reportZone").addEventListener("change", (event) => {
  reportState.zone = event.target.value;
  reportState.showAllBins = false;
  renderReports();
});

document.querySelector("#reportBin").addEventListener("change", (event) => {
  reportState.binId = Number(event.target.value);
  renderReports();
});

document.querySelector("#showAllBins").addEventListener("click", () => {
  reportState.showAllBins = !reportState.showAllBins;
  renderReports();
});

// Click a bin anywhere on the page to see its history graph.
document.querySelector("#page-history").addEventListener("click", (event) => {
  const row = event.target.closest("[data-report-bin]");
  if (!row) return;
  reportState.binId = Number(row.dataset.reportBin);
  renderReports();
  document.querySelector("#binHistoryCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

let reportResize = null;
window.addEventListener("resize", () => {
  clearTimeout(reportResize);
  reportResize = setTimeout(() => refreshReports(true), 250);
});

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

const scriptLoads = new Map();

function loadScript(src) {
  if (!scriptLoads.has(src)) {
    scriptLoads.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => {
          scriptLoads.delete(src);
          script.remove();
          reject(new Error(`Could not load ${src}`));
        };
        document.head.append(script);
      })
    );
  }
  return scriptLoads.get(src);
}

function reportFileName(extension) {
  const zone = reportState.zone === "all" ? "" : `-${reportZoneLabel().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `tribin-report${zone}-${fmtDate(Date.now())}.${extension}`;
}

const BIN_HEADER = ["Bin", "Location", "Zone", "Status", "Recycle %", "Landfill %", "Compost %", "Battery %", "Sensor", "Last emptied", `Emptied (${REPORT_DAYS} days)`, "Full when emptied %", "Hours between emptying"];

function binRows(report) {
  return report.bins.map((bin) => {
    const level = data.levels[bin.id];
    const metric = report.metrics.get(bin.id);
    return [
      bin.id,
      bin.location,
      zoneName(bin.id),
      STATUS_TEXT[binStatus(bin.id)],
      ...COMPARTMENTS.map(({ key }) => Math.round(level[key])),
      batteryOf(bin.id) ?? "USB power",
      isOnline(bin.id) ? (isLowBattery(bin.id) ? "Online, low battery" : "Online") : isDeadBattery(bin.id) ? "Offline, battery flat" : "Offline",
      `${fmtDate(level.emptiedAt)} ${fmtTime(level.emptiedAt)}`,
      metric.count,
      metric.avgFull ?? "",
      metric.avgGap == null ? "" : round1(metric.avgGap),
    ];
  });
}

const COLLECTION_HEADER = ["Date", "Time", "Bin", "Location", "Zone", "Worker", "Recorded by", "Recycle % at emptying", "Landfill % at emptying", "Compost % at emptying"];

function collectionRows(report, limit = Infinity) {
  return report.collections.slice(0, limit).map((e) => {
    const bin = allBins.find((b) => b.id === e.binId);
    return [fmtDate(e.at), fmtTime(e.at), e.binId, bin?.location || "", zoneName(e.binId), workerName(e.workerId), e.auto ? "Sensor" : "Button press", ...COMPARTMENTS.map(({ key }) => e.peak[key])];
  });
}

async function runDownload(button, task) {
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    await task();
  } catch (error) {
    console.error(error);
    showToast("The download couldn't be made. Check your internet connection and try again.");
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

async function downloadExcel() {
  await loadScript(LIBRARIES.xlsx);
  const report = buildReport();
  const book = XLSX.utils.book_new();
  const addSheet = (name, rows, widths) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  };

  const { stats } = report;
  addSheet(
    "Summary",
    [
      ["Tribin bin report"],
      ["Zone", report.zone],
      ["Period", `${fmtDate(report.from)} to ${fmtDate(report.now)} (last ${REPORT_DAYS} days)`],
      ["Made", `${fmtDate(report.now)} ${fmtTime(report.now)}`],
      [],
      ["Bins", report.bins.length],
      ["Emptied today", stats.today],
      ["Emptied in the last 7 days", stats.week],
      [`Emptied in the last ${REPORT_DAYS} days`, stats.total],
      ["Average fullness when emptied (%)", stats.avgFull ?? ""],
      ["Need emptying now", stats.needEmptying],
      [],
      ["Day", "Bins emptied"],
      ...report.days.map((d) => [fmtDate(d.start), d.count]),
      [],
      ["Note", "Demo data: readings from before the dashboard was opened are simulated until real sensors are connected."],
    ],
    [34, 46]
  );
  addSheet("Bins", [BIN_HEADER, ...binRows(report)], [6, 44, 18, 15, 10, 10, 10, 10, 20, 20, 16, 18, 20]);
  const replaced = (data.batteryLog || []).filter((e) => report.bins.some((bin) => bin.id === e.binId));
  if (replaced.length) {
    addSheet(
      "Battery changes",
      [["Date", "Time", "Bin", "Location", "Zone", "Replaced by", "Battery before %"], ...replaced.map((e) => [fmtDate(e.at), fmtTime(e.at), e.binId, allBins.find((b) => b.id === e.binId)?.location || "", zoneName(e.binId), workerName(e.workerId), e.before])],
      [12, 10, 6, 44, 18, 18, 16]
    );
  }
  addSheet("Collections", [COLLECTION_HEADER, ...collectionRows(report)], [12, 10, 6, 44, 18, 18, 14, 20, 20, 20]);
  addSheet("Workers", [["Worker", "Zone", `Bins emptied (${REPORT_DAYS} days)`, "Bins emptied today"], ...report.workers.map((w) => [w.name, w.zone, w.count, w.today])], [22, 20, 24, 20]);

  // Hour-by-hour readings for the bin picked on the page.
  if (reportState.binId) {
    const to = Date.now();
    const from = to - BIN_CHART_DAYS * DAY_MS;
    const { events } = binSeries(reportState.binId, from, to);
    const rows = [];
    for (let t = Math.ceil(from / HOUR_MS) * HOUR_MS; t <= to; t += HOUR_MS) {
      const levels = levelsAt(reportState.binId, events, t);
      if (!levels) continue;
      const emptied = events.filter((e) => e.peak && e.at > t - HOUR_MS && e.at <= t);
      rows.push([
        fmtDate(t),
        fmtTime(t),
        ...COMPARTMENTS.map(({ key }) => Math.round(levels[key])),
        emptied.map((e) => `Emptied at ${fmtTime(e.at)} by ${workerName(e.workerId)}${e.auto ? " (detected by sensor)" : ""}`).join("; "),
      ]);
    }
    addSheet(`Bin ${reportState.binId} readings`, [["Date", "Time", "Recycle %", "Landfill %", "Compost %", "Emptied"], ...rows], [12, 10, 11, 11, 11, 40]);
  }

  XLSX.writeFile(book, reportFileName("xlsx"));
}

function svgToPng(svg, width, height) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(2, 2);
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// The built-in PDF fonts only cover basic Latin letters.
const pdfText = (value) => String(value).replace(/…/g, "...").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

async function downloadPdf() {
  await loadScript(LIBRARIES.jspdf);
  await loadScript(LIBRARIES.autotable);
  const report = buildReport();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const left = 36;
  const contentW = pageW - left * 2;
  const green = [4, 57, 39];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...green);
  doc.text("Tribin bin report", left, 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(107, 118, 111);
  doc.text(pdfText(`${report.zone} · ${fmtDate(report.from)} to ${fmtDate(report.now)} · made ${fmtDate(report.now)} ${fmtTime(report.now)}`), left, 68);

  const tiles = [
    ["Emptied today", String(report.stats.today)],
    ["Emptied in 7 days", String(report.stats.week)],
    ["Full when emptied (avg)", report.stats.avgFull == null ? "-" : `${report.stats.avgFull}%`],
    ["Need emptying now", String(report.stats.needEmptying)],
  ];
  const tileW = (contentW - 12 * 3) / 4;
  tiles.forEach(([label, value], i) => {
    const x = left + i * (tileW + 12);
    doc.setDrawColor(226, 221, 208);
    doc.setFillColor(255, 253, 248);
    doc.roundedRect(x, 82, tileW, 48, 6, 6, "FD");
    doc.setFontSize(9);
    doc.setTextColor(107, 118, 111);
    doc.text(label, x + 10, 98);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(22, 36, 28);
    doc.text(value, x + 10, 121);
    doc.setFont("helvetica", "normal");
  });

  const chartW = 900;
  const chartH = 212;
  const imageH = (contentW * chartH) / chartW;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(22, 36, 28);
  doc.text(`Bins emptied per day (last ${REPORT_DAYS} days)`, left, 154);
  doc.addImage(await svgToPng(columnChart(report.days, chartW, chartH).svg, chartW, chartH), "PNG", left, 160, contentW, imageH, undefined, "FAST");

  if (reportState.binId) {
    const bin = allBins.find((b) => b.id === reportState.binId);
    const to = Date.now();
    const from = to - BIN_CHART_DAYS * DAY_MS;
    const { points, emptied } = binSeries(bin.id, from, to);
    const y = 160 + imageH + 24;
    doc.text(pdfText(`Bin ${bin.id} fill level, last ${BIN_CHART_DAYS} days`), left, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(107, 118, 111);
    doc.text(pdfText(`${bin.location} · ${zoneName(bin.id)} · dashed lines show when it was emptied`), left + 210, y);
    if (points.length) {
      const svg = lineChart({ points, emptied, from, to, width: chartW, height: chartH, fullAt: data.settings.fullAt }).svg;
      doc.addImage(await svgToPng(svg, chartW, chartH), "PNG", left, y + 6, contentW, imageH, undefined, "FAST");
    }
  }

  const table = (title, head, body, columnStyles = {}) => {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(22, 36, 28);
    doc.text(pdfText(title), left, 46);
    doc.autoTable({
      startY: 56,
      head: [head.map(pdfText)],
      body: body.map((row) => row.map((cell) => pdfText(cell))),
      margin: { left, right: left, bottom: 40 },
      styles: { fontSize: 7.5, cellPadding: 3.5, textColor: [22, 36, 28], lineColor: [226, 221, 208] },
      headStyles: { fillColor: green, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 246, 239] },
      columnStyles,
    });
  };

  table(`All bins (${report.bins.length})`, BIN_HEADER, binRows(report), { 1: { cellWidth: 140 } });
  table(`Bins emptied by worker (last ${REPORT_DAYS} days)`, ["Worker", "Zone", `Bins emptied (${REPORT_DAYS} days)`, "Today"], report.workers.map((w) => [w.name, w.zone, w.count, w.today]));
  const limit = 300;
  table(
    report.collections.length > limit ? `Collections (latest ${limit} of ${report.collections.length}; the Excel download has all)` : `Collections (${report.collections.length})`,
    COLLECTION_HEADER,
    collectionRows(report, limit),
    { 3: { cellWidth: 150 } }
  );

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(107, 118, 111);
    doc.text("Tribin · Sac State bin monitor · demo data: past readings are simulated until real sensors are connected", left, doc.internal.pageSize.getHeight() - 20);
    doc.text(`Page ${i} of ${pages}`, pageW - left, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }

  doc.save(reportFileName("pdf"));
}

document.querySelector("#downloadExcel").addEventListener("click", (event) => runDownload(event.currentTarget, downloadExcel));
document.querySelector("#downloadPdf").addEventListener("click", (event) => runDownload(event.currentTarget, downloadPdf));
