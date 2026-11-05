# Tribin: Simple Version

Shows how full each part (recycle, landfill, compost) of every Sac State
tri-bin is, so workers know which bins to empty.

Open `index.html` in a browser (or use VS Code Live Server). An internet
connection is needed for the map.

## Pages

- **Go to nearest full bin**: one big button that finds the closest bin that
  needs emptying and starts walking directions to it. After you mark it
  emptied, it offers the next closest one.
- **Simple layout**: four pages (Bins, Map, History, and Settings for
  admins). On phones they sit as big tabs along the bottom of the screen.
- **Sensor offline**: bins whose sensor has stopped reporting show in gray
  with the time of their last reading. Admins find them with the **Offline**
  tab on the Bins page or the status filter on the map.
- **Bins**: every bin as a card with three fill bars. Tap **To empty**,
  **Almost full**, or **All** at the top to switch lists. Fullest bins come
  first, or nearest first once location is allowed. Workers press **Mark
  emptied** after emptying a bin, and can tap **Undo** for a few seconds if
  they tapped the wrong one. The pin button shows the bin on the map.
- **Map**: every bin as a mini tri-bin marker with one bar per compartment
  (red = needs emptying, yellow = almost full, green = OK). Nearby bins are
  grouped into circles whose ring shows how many are full. Search, filter by
  zone or status, and switch between Map and Satellite. Click a bin for
  details or to mark it emptied. Swipe the filter panel to the left (or tap
  its tab) to hide it and see more of the map.
- **Directions**: tap **Directions** on any bin and the map shows the walking
  route from where you are, with turn-by-turn steps. Your location updates as
  you walk, and it tells you when you've arrived. (Your browser will ask for
  location permission the first time. Routes come from the free OpenStreetMap
  routing service at routing.openstreetmap.de.)
- **History**: a log of recently emptied bins, with who emptied them and when.
- **Live sensor**: Bin 3 (Test Bin) shows a real XIAO ESP32-C3 + A02YYUW
  sensor. The board publishes its distance reading over MQTT
  (broker.hivemq.com, topic `tribin/amandevio/bin/3`) and the dashboard turns
  it into the Landfill fill level. Flash the board and set up its Wi-Fi from
  `flash/` in Chrome or Edge; calibrate the empty depth in Settings.
- **Zones**: campus is split into zones (North, Central, South, Athletics &
  Fields to start). Each worker can be given a zone. When they sign in they
  see their zone first, and **Go to nearest full bin** picks bins in their zone
  first. Every page has a zone filter, each card shows its zone, and History
  has a Zone column.
- **Settings** (admins only), in three tabs (Workers, Zones, Alerts & sensor): add, edit, and remove workers and choose their
  zone; create, rename, recolor, and delete zones and pick who works in each;
  see how many bins in each zone need emptying; and change when a bin counts
  as full. **Assign bins on map** opens an editor where you pick a zone and
  click bins to add them or take them out.

## 3D model

`model.html` is an interactive 3D model of an outdoor tri-bin with the sensor
system installed: the three ultrasonic sensors and their sound beams, and the
controller case with the XIAO ESP32-C3, 18650 battery, power switch, cable
glands and Wi-Fi antenna. Bin dimensions are estimated from photos.

## Case concepts

`cases.html` shows 3D-printable case concepts: five thin, basic boxes (screw
lid, snap lid, slide lid, flat demo plate, sensor box) and six creative designs (Magnetic Brick, Hornet Hive, Cartridge Pod, Smart Rim, Sensor Clip and
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
