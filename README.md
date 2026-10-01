# Tribin: Simple Version

Shows how full each part (trash, recycling, aluminum) of every Sac State
tri-bin is, so workers know which bins to empty.

Open `index.html` in a browser (or use VS Code Live Server). An internet
connection is needed for the map.

## Pages

- **Go to nearest full bin**: one big button that finds the closest bin that
  needs emptying and starts walking directions to it. After you mark it
  emptied, it offers the next closest one.
- **Sensor offline**: bins whose sensor has stopped reporting show in gray
  with the time of their last reading. Find them with the **Sensor offline**
  box on the Bins page or the status filter on the map.
- **Bins**: every bin as a card with three fill bars. Click **Need emptying**,
  **Almost full**, **Sensor offline**, or **All bins** at the top to filter, and sort by
  **Nearest** (shows how far away each bin is) or **Fullest**. Workers press
  **Mark emptied** after emptying a bin, and can tap **Undo** for a few
  seconds if they tapped the wrong one.
- **Map**: every bin as a mini tri-bin marker with one bar per compartment
  (red = needs emptying, yellow = almost full, green = OK). Nearby bins are
  grouped into circles whose ring shows how many are full. Filter by
  compartment or status, search, and switch between Map, Streets, and
  Satellite. Click a bin for details or to mark it emptied. Swipe the filter
  panel to the left (or tap its tab) to hide it and see more of the map.
- **Directions**: tap **Directions** on any bin and the map shows the walking
  route from where you are, with turn-by-turn steps. Your location updates as
  you walk, and it tells you when you've arrived. (Your browser will ask for
  location permission the first time. Routes come from the free OpenStreetMap
  routing service at routing.openstreetmap.de.)
- **Settings** (admins only): add, edit, and remove workers, and change when a
  bin counts as full.

## 3D model

`model.html` is an interactive 3D model of an outdoor tri-bin with the sensor
system installed: the three ultrasonic sensors and their sound beams, and the
controller case with the XIAO ESP32-C3, 18650 battery, power switch, cable
glands and Wi-Fi antenna. Bin dimensions are estimated from photos.

## Case concepts

`cases.html` shows six 3D-printable case concepts for the controller and
sensor (Magnetic Brick, Hornet Hive, Cartridge Pod, Smart Rim, Sensor Clip and
Demo Tower), each with an exploded view, X-ray, pros and cons, and rough print
estimates.

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
