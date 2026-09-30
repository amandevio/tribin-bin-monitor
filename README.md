# Tribin: Simple Version

Shows how full each part (trash, recycling, aluminum) of every Sac State
tri-bin is, so workers know which bins to empty.

Open `index.html` in a browser (or use VS Code Live Server). An internet
connection is needed for the map.

## Pages

- **Bins**: every bin as a card with three fill bars. Click **Need emptying**,
  **Almost full**, or **All bins** at the top to filter. Workers press
  **Mark emptied** after emptying a bin.
- **Map**: every bin as a mini tri-bin marker with one bar per compartment
  (red = needs emptying, yellow = almost full, green = OK). Nearby bins are
  grouped into circles whose ring shows how many are full. Filter by
  compartment or status, search, and switch between Map, Streets, and
  Satellite. Click a bin for details.
- **Settings** (admins only): add, edit, and remove workers, and change when a
  bin counts as full.

## Demo accounts

- Jordan Reyes: Admin
- Maria Lopez, Diego Alvarez: Workers

No password is needed in the demo.

## Files

- `index.html`: page layout
- `style.css`: colors and styling
- `app.js`: all the logic (sign in, bins, map, workers)
- `bins.js`: bin locations from the project spreadsheet

## Connecting real sensors

The fill levels are simulated for now in `readSensors()` in `app.js`. When
the sensors and backend are ready, replace that function with one that
fetches the real readings. `distanceToPercent()` shows how to turn an
ultrasonic sensor's distance into a fill percentage.
