// ===========================================================================
// Home page: the next bin to empty and today's numbers, at a glance.
// Workers see their own zone; admins see the whole campus and every zone.
// Uses the data and helpers from app.js and reports.js.
// ===========================================================================

const homeCache = new Map();
let activityMemo = { key: "", events: [] };

// Only touch the page when something actually changed, so buttons never
// disappear under a finger during the 3-second updates.
function setHtml(id, html) {
  if (homeCache.get(id) === html) return;
  homeCache.set(id, html);
  document.getElementById(id).innerHTML = html;
}

function homeScope() {
  return myZoneId() || "all";
}

function fullestPart(binId) {
  const level = data.levels[binId];
  return COMPARTMENTS.reduce((best, part) => (level[part.key] > level[best.key] ? part : best));
}

// Bins that need emptying, closest (or fullest) first.
function binsToEmpty(scope) {
  const order = (a, b) => (myLocation ? metersToBin(a) - metersToBin(b) : fullest(b.id) - fullest(a.id));
  const full = allBins.filter((bin) => binStatus(bin.id) === "full");
  return {
    mine: full.filter((bin) => inZone(bin.id, scope)).sort(order),
    elsewhere: full.filter((bin) => !inZone(bin.id, scope)).sort(order),
  };
}

// Collections from today and yesterday (worked out at most once a minute).
function recentCollections(scope) {
  const key = `${scope}|${data.emptiedLog.length}|${data.emptiedLog[0]?.at}|${Math.floor(Date.now() / 60000)}`;
  if (activityMemo.key !== key) {
    const since = startOfDay(Date.now() - DAY_MS);
    const events = allBins
      .filter((bin) => inZone(bin.id, scope))
      .flatMap((bin) => binEvents(bin.id).filter((e) => e.peak && e.at >= since))
      .sort((a, b) => b.at - a.at);
    activityMemo = { key, events };
  }
  return activityMemo.events;
}

function heroHtml(scope) {
  const { mine, elsewhere } = binsToEmpty(scope);
  const bin = mine[0] || elsewhere[0];

  if (!bin) {
    const almost = allBins.filter((b) => inZone(b.id, scope) && binStatus(b.id) === "almost").length;
    return `
      <div class="home-hero all-clear">
        <div>
          <span class="hero-label">${ICONS.check}All clear</span>
          <h2 class="hero-title">Nothing needs emptying</h2>
          <p class="hero-place">${almost ? `${almost} bin${almost === 1 ? " is" : "s are"} almost full. Check back later.` : "Every bin has plenty of room."}</p>
        </div>
        ${almost ? `<div class="hero-actions"><button type="button" class="button" data-home-go="almost">See almost-full bins</button></div>` : ""}
      </div>
    `;
  }

  const level = data.levels[bin.id];
  const bars = COMPARTMENTS.map(({ key, label }) => {
    const value = Math.round(level[key]);
    return `
      <div class="hero-bar">
        <span>${label}</span>
        <span class="hero-track"><i class="fill-${statusOf(value)}" style="width: ${value}%"></i></span>
        <b>${value}%</b>
      </div>
    `;
  }).join("");
  const label = mine.length ? "Next bin to empty" : "Your zone is done · closest elsewhere";
  const meta = [
    zoneTag(binZone(bin.id)),
    myLocation ? `<span>${formatDistance(metersToBin(bin))} away</span>` : "",
    `<span>${escapeHtml(emptiedText(bin.id))}</span>`,
    mine.length > 1 ? `<span>${mine.length - 1} more after this</span>` : "",
  ].filter(Boolean);

  return `
    <div class="home-hero">
      <div>
        <span class="hero-label">${ICONS.alert}${label}</span>
        <h2 class="hero-title">Bin ${bin.id}</h2>
        <p class="hero-place">${escapeHtml(bin.location)}</p>
        <div class="hero-meta">${meta.join("")}</div>
        <div class="hero-bars">${bars}</div>
      </div>
      <div class="hero-actions">
        <button type="button" class="button gold" data-action="directions" data-id="${bin.id}">${ICONS.nav}Get directions</button>
        <button type="button" class="button on-dark" data-action="empty" data-id="${bin.id}">${ICONS.check}Mark emptied</button>
        <button type="button" class="text-link" data-action="history" data-id="${bin.id}">See its history</button>
      </div>
    </div>
  `;
}

function tileHtml(kind, icon, value, label, go) {
  return `
    <button type="button" class="tile tile-${kind}" data-home-go="${go}">
      <span class="tile-icon">${icon}</span>
      <span class="tile-value">${value}</span>
      <span class="tile-label">${label}</span>
    </button>
  `;
}

function queueHtml(scope) {
  const { mine } = binsToEmpty(scope);
  const almost = allBins
    .filter((bin) => inZone(bin.id, scope) && binStatus(bin.id) === "almost")
    .sort((a, b) => fullest(b.id) - fullest(a.id));
  const list = [...mine, ...almost].slice(0, 5);
  if (!list.length) return `<p class="empty-note">${ICONS.check}Nothing to empty right now.</p>`;
  return list
    .map((bin, i) => {
      const part = fullestPart(bin.id);
      return `
        <div class="queue-item">
          <span class="queue-rank rank-${binStatus(bin.id)}">${i + 1}</span>
          <button type="button" class="queue-main" data-action="map" data-id="${bin.id}" title="Show on map">
            <strong>Bin ${bin.id}</strong>
            <span>${escapeHtml(bin.location)}</span>
          </button>
          <span class="queue-pct">${part.label} <b>${Math.round(data.levels[bin.id][part.key])}%</b></span>
          <button type="button" class="button small" data-action="directions" data-id="${bin.id}">${ICONS.nav}Go</button>
        </div>
      `;
    })
    .join("");
}

function activityHtml(events) {
  if (!events.length) return '<p class="empty-note">No bins emptied yet today.</p>';
  return events
    .slice(0, 6)
    .map((e) => {
      const name = workerName(e.workerId);
      return `
        <div class="activity-item">
          <span class="avatar small">${escapeHtml(initials(name))}</span>
          <div>
            <p><b>${escapeHtml(name)}</b> emptied <b>Bin ${e.binId}</b></p>
            <span>${escapeHtml(zoneName(e.binId))} · ${escapeHtml(timeAgo(e.at))}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function zonesHtml() {
  const groups = data.zones.map((zone) => ({ id: zone.id, name: zone.name, color: zone.color }));
  if (allBins.some((bin) => !binZone(bin.id))) groups.push({ id: "none", name: "No zone", color: "#a3a9a3" });
  return groups
    .map((group) => {
      const bins = allBins.filter((bin) => inZone(bin.id, group.id));
      const counts = { full: 0, almost: 0, ok: 0, offline: 0 };
      bins.forEach((bin) => counts[binStatus(bin.id)]++);
      const crew = data.workers.filter((w) => w.zoneId === group.id).map((w) => w.name.split(" ")[0]);
      const split = ["full", "almost", "ok", "offline"]
        .filter((status) => counts[status])
        .map((status) => `<span class="seg-${status}" style="flex: ${counts[status]}"></span>`)
        .join("");
      return `
        <button type="button" class="zone-card" data-home-zone="${group.id}" style="--zone: ${group.color}">
          <span class="zone-card-top"><strong>${escapeHtml(group.name)}</strong><span>${bins.length} bins</span></span>
          <span class="zone-split">${split}</span>
          <span class="zone-counts">
            <span><i class="dot-full"></i>${counts.full} to empty</span>
            <span><i class="dot-almost"></i>${counts.almost} almost full</span>
            ${counts.offline ? `<span><i class="dot-offline"></i>${counts.offline} offline</span>` : ""}
          </span>
          <span class="zone-crew">${crew.length ? `Worked by ${escapeHtml(crew.join(", "))}` : "No one assigned yet"}</span>
        </button>
      `;
    })
    .join("");
}

function renderHome() {
  const user = currentUser();
  if (!user) return;
  const scope = homeScope();
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  setHtml("homeDate", escapeHtml(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })));
  setHtml("homeGreeting", `${hello}, ${escapeHtml(user.name.split(" ")[0])}`);

  const bins = allBins.filter((bin) => inZone(bin.id, scope));
  const counts = { full: 0, almost: 0, ok: 0, offline: 0 };
  bins.forEach((bin) => counts[binStatus(bin.id)]++);
  setHtml("homeScope", scope === "all" ? `All campus · ${bins.length} bins` : `Your zone: ${zoneTag(zoneById(scope))} · ${bins.length} bins`);

  setHtml("homeHero", heroHtml(scope));

  const events = recentCollections(scope);
  const today = startOfDay(Date.now());
  const emptiedToday = events.filter((e) => e.at >= today).length;
  const mineToday = data.emptiedLog.filter((e) => e.workerId === user.id && e.at >= today).length;
  setHtml(
    "homeTiles",
    [
      tileHtml("full", ICONS.alert, counts.full, "Need emptying", "full"),
      tileHtml("almost", ICONS.clock, counts.almost, "Almost full", "almost"),
      tileHtml("ok", ICONS.check, emptiedToday, "Emptied today", "reports"),
      isAdmin()
        ? tileHtml("offline", ICONS.wifiOff, counts.offline, "Sensors offline", "offline")
        : tileHtml("ok", ICONS.user, mineToday, "Emptied by you today", "reports"),
    ].join("")
  );

  setHtml("homeQueue", queueHtml(scope));
  setHtml("homeActivity", activityHtml(events));
  if (isAdmin()) setHtml("homeZones", zonesHtml());
}

document.querySelector("#page-home").addEventListener("click", (event) => {
  const go = event.target.closest("[data-home-go]");
  if (go) {
    if (go.dataset.homeGo === "reports") {
      showPage("history");
      return;
    }
    binFilter = go.dataset.homeGo;
    zoneFilter = homeScope();
    shownBinIds = "";
    renderZoneSelects();
    showPage("bins");
    return;
  }
  const zone = event.target.closest("[data-home-zone]");
  if (zone) {
    zoneFilter = zone.dataset.homeZone;
    binFilter = allBins.some((bin) => inZone(bin.id, zoneFilter) && binStatus(bin.id) === "full") ? "full" : "all";
    shownBinIds = "";
    renderZoneSelects();
    showPage("bins");
  }
});
