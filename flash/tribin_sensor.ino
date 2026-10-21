// Tribin live sensor: XIAO ESP32-C3 + DFRobot A02YYUW ultrasonic sensor.
//
// Reads the distance to the trash and publishes it over Wi-Fi (MQTT) so the
// Tribin dashboard can show it live. Wi-Fi is set up from the browser flash
// page (Improv Wi-Fi), and saved on the board.
//
// Wiring:
//   Sensor red    (VCC) -> XIAO 3V3
//   Sensor black  (GND) -> XIAO GND
//   Sensor white  (TX)  -> XIAO D7
//   Sensor yellow (RX)  -> not connected

#include <WiFi.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ImprovWiFiLibrary.h>

const int SENSOR_RX_PIN = D7;
const int SENSOR_TX_PIN = D6;  // not wired

// Free public MQTT broker. The dashboard listens on the same topic.
const char *MQTT_HOST = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *MQTT_TOPIC = "tribin/amandevio/bin/3";

const unsigned long PUBLISH_EVERY_MS = 2000;
const char *DASHBOARD_URL = "https://amandevio.github.io/tribin-bin-monitor/";

ImprovWiFi improv(&Serial);
Preferences prefs;
WiFiClient netClient;
PubSubClient mqtt(netClient);

float latestCm = -1;
unsigned long latestAt = 0;
unsigned long lastPublish = 0;
unsigned long lastMqttAttempt = 0;
unsigned long lastLog = 0;

// The sensor sends 4 bytes about 10 times a second:
//   0xFF, distance high byte, distance low byte, checksum (distance in mm)
void readSensor() {
  while (Serial1.available() >= 4) {
    if (Serial1.read() != 0xFF) continue;
    uint8_t high = Serial1.read();
    uint8_t low = Serial1.read();
    uint8_t sum = Serial1.read();
    if (((0xFF + high + low) & 0xFF) != sum) continue;
    int mm = high * 256 + low;
    if (mm > 0) {
      latestCm = mm / 10.0;
      latestAt = millis();
    }
  }
}

// Called by Improv after the browser sends Wi-Fi details and we connect.
void onWifiConnected(const char *ssid, const char *password) {
  prefs.begin("wifi", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", password);
  prefs.end();
}

void connectSavedWifi() {
  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();
  if (ssid.length() > 0) {
    WiFi.begin(ssid.c_str(), pass.c_str());
  }
}

void keepMqttConnected() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  if (millis() - lastMqttAttempt < 5000) return;  // retry every 5 seconds
  lastMqttAttempt = millis();
  String clientId = "tribin-" + WiFi.macAddress();
  clientId.replace(":", "");
  mqtt.connect(clientId.c_str());
}

void publishReading() {
  if (!mqtt.connected() || latestCm < 0) return;
  if (millis() - lastPublish < PUBLISH_EVERY_MS) return;
  if (millis() - latestAt > 5000) return;  // sensor stopped sending
  lastPublish = millis();

  char payload[96];
  snprintf(payload, sizeof(payload), "{\"distance_cm\":%.1f,\"rssi\":%d,\"uptime_s\":%lu}",
           latestCm, WiFi.RSSI(), millis() / 1000);
  mqtt.publish(MQTT_TOPIC, payload, true);  // retained, so the dashboard gets the last value right away
}

void logStatus() {
  if (millis() - lastLog < 1000) return;
  lastLog = millis();
  Serial.print("Distance: ");
  if (latestCm >= 0) {
    Serial.print(latestCm, 1);
    Serial.print(" cm");
  } else {
    Serial.print("no reading");
  }
  Serial.print("   Wi-Fi: ");
  Serial.print(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("not connected"));
  Serial.print("   Dashboard link: ");
  Serial.println(mqtt.connected() ? "sending" : "waiting");
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600, SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  improv.setDeviceInfo(ImprovTypes::ChipFamily::CF_ESP32_C3, "Tribin Sensor", "1.1", "Tribin Sensor", DASHBOARD_URL);
  improv.onImprovConnected(onWifiConnected);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  connectSavedWifi();
}

void loop() {
  improv.handleSerial();  // must run often so the browser can set up Wi-Fi
  readSensor();
  keepMqttConnected();
  mqtt.loop();
  publishReading();
  logStatus();
}
