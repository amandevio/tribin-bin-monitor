// Tribin sensor test: XIAO ESP32-C3 + DFRobot A02YYUW ultrasonic sensor.
//
// Wiring:
//   Sensor red    (VCC) -> XIAO 3V3
//   Sensor black  (GND) -> XIAO GND
//   Sensor white  (TX)  -> XIAO D7
//   Sensor yellow (RX)  -> not connected
//
// Open Tools > Serial Monitor at 115200 baud to see the readings.

const int SENSOR_RX_PIN = D7;  // XIAO pin that receives data from the sensor
const int SENSOR_TX_PIN = D6;  // not wired; the sensor doesn't need commands

// Distance from the sensor to the bottom of the empty container, in cm.
// Measure your demo box or bin and change this.
const float EMPTY_DEPTH_CM = 60.0;

// The sensor sends 4 bytes about 10 times a second:
//   0xFF, distance high byte, distance low byte, checksum
// Distance is in millimeters.
int readDistanceMm() {
  while (Serial1.available() >= 4) {
    if (Serial1.read() != 0xFF) continue;  // wait for the start byte

    uint8_t high = Serial1.read();
    uint8_t low = Serial1.read();
    uint8_t sum = Serial1.read();
    if (((0xFF + high + low) & 0xFF) != sum) continue;  // corrupted frame

    return high * 256 + low;
  }
  return -1;  // no complete reading yet
}

int fillPercent(float distanceCm) {
  float percent = (EMPTY_DEPTH_CM - distanceCm) / EMPTY_DEPTH_CM * 100.0;
  return constrain((int)percent, 0, 100);
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600, SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN);
  delay(1000);
  Serial.println("Tribin sensor test starting...");
}

void loop() {
  int mm = readDistanceMm();
  if (mm > 0) {
    float cm = mm / 10.0;
    Serial.print("Distance: ");
    Serial.print(cm, 1);
    Serial.print(" cm   Fill: ");
    Serial.print(fillPercent(cm));
    Serial.println("%");
  }
  delay(200);
}
