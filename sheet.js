// ===========================================================================
// Bin details sheet: tap any bin (a row, a map pin, the Home card) to see
// everything about it in one place, with big buttons for what to do next.
// Slides up from the bottom on phones and iPads in portrait.
// Uses the data and helpers from app.js and reports.js.
// ===========================================================================

const binSheet = document.querySelector("#binSheet");
const sheetCache = new Map();
let sheetBinId = null;
let sheetChartAt = 0;

function sheetSet(id, html) {
  if (sheetCache.get(id) === html) return;
  sheetCache.set(id, html);
  document.getElementById(id).innerHTML = html;
}

function openBinSheet(binId) {
  sheetBinId = binId;
  sheetCache.clear();
  if (!binSheet.open) binSheet.showModal();
  binSheet.scrollTop = 0;
  renderBinSheet(true);
}

function closeBinSheet() {
  if (binSheet.open) binSheet.close();
}

function renderBinSheet(withChart = false) {
  if (!sheetBinId || !binSheet.open) return;
  const bin = allBins.find((b) => b.id === sheetBinId);
  if (!bin) return;
  const level = data.levels[bin.id];
  const status = binStatus(bin.id);
  const online = isOnline(bin.id);
  const battery = batteryOf(bin.id);
  const low = isLowBattery(bin.id);

  sheetSet(
    "sheetHead",
    `
      <div class="sheet-title">
        <div class="sheet-badges">
          <span class="badge badge-${status}">${STATUS_TEXT[status]}</span>
          ${low ? `<span class="battery-badge">${ICONS.battery}${battery === 0 ? "Battery flat" : "Low battery"}</span>` : ""}
          ${bin.id === LIVE.binId ? '<span class="live-tag">LIVE</span>' : ""}
        </div>
        <h2>Bin ${bin.id}</h2>
        <p>${escapeHtml(bin.location)}</p>
      </div>
      <button type="button" class="plain-icon sheet-close" data-sheet-close aria-label="Close">${ICONS.close}</button>
    `
  );

  sheetSet(
    "sheetLevels",
    COMPARTMENTS.map(({ key, label }) => {
      const value = Math.round(level[key]);
      return `
        <div class="sheet-level">
          <div class="sheet-level-top"><span>${label}</span><b>${value}%</b></div>
          <div class="sheet-track"><i class="fill-${online ? statusOf(value) : "offline"}" style="width: ${value}%"></i></div>
        </div>
      `;
    }).join("")
  );

  const facts = [
    ["Last emptied", emptiedText(bin.id).replace(/^Emptied /, "")],
    ["Sensor", online ? `Working · updated ${timeAgo(level.lastReading)}` : offlineText(bin.id)],
    ["Battery", battery == null ? "Plugged in (USB)" : `${battery}%${low ? " · needs a new one" : ""}`],
    myLocation ? ["Distance", `${formatDistance(metersToBin(bin))} away`] : ["Zone", binZone(bin.id)?.name || "No zone"],
  ];
  sheetSet(
    "sheetFacts",
    facts.map(([label, value]) => `<div class="sheet-fact"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join("")
  );

  const autoOn = data.settings.autoEmpty && online;
  sheetSet(
    "sheetActions",
    `
      <button type="button" class="button primary big" data-action="directions" data-id="${bin.id}">${ICONS.nav}Get directions</button>
      ${low ? `<button type="button" class="button big battery-action" data-action="battery" data-id="${bin.id}">${ICONS.battery}Battery replaced</button>` : ""}
      ${
        autoOn
          ? `<p class="sheet-note">${ICONS.check}It's marked emptied on its own when the sensor sees it's empty.</p>
             <button type="button" class="text-link" data-action="empty" data-id="${bin.id}">Mark emptied by hand</button>`
          : `<button type="button" class="button big" data-action="empty" data-id="${bin.id}">${ICONS.check}Mark emptied</button>`
      }
      ${isAdmin() ? `<button type="button" class="text-link" data-action="history" data-id="${bin.id}">Open full report</button>` : ""}
    `
  );

  // The graph only needs redrawing now and then.
  if (withChart || Date.now() - sheetChartAt > 60000) {
    drawLineChart(document.querySelector("#sheetChart"), bin.id);
    sheetChartAt = Date.now();
  }
}

// Called from app.js on every update.
function refreshBinSheet() {
  renderBinSheet(false);
}

binSheet.addEventListener("close", () => {
  sheetBinId = null;
});

binSheet.addEventListener("click", (event) => {
  // Tap outside the sheet, or the X, to close it.
  if (event.target === binSheet || event.target.closest("[data-sheet-close]")) {
    closeBinSheet();
    return;
  }
  // Going somewhere else closes the sheet first.
  const action = event.target.closest("[data-action]");
  if (action && ["directions", "map", "history"].includes(action.dataset.action)) closeBinSheet();
});
