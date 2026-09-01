/**
 * Send Shelly input status to Domoticz via MQTT input.
 * - Periodic update every 30 seconds
 * - Immediate update on input state change
 */

let MQTTPublishTopic = "domoticz/in";
let inputId = 0;
let domoticzIdx = 23;
let invertState = true;

function publishInputStateToDomoticz(state) {
  let normalizedState = state ? 1 : 0;
  let nvalue = invertState ? (normalizedState ? 0 : 1) : normalizedState;
  let message = JSON.stringify({
    idx: domoticzIdx,
    nvalue: nvalue,
    svalue: nvalue.toString()
  });

  print("Domoticz payload:", message);
  MQTT.publish(MQTTPublishTopic, message, 0, false);
}

function sendCurrentInputState() {
  let inputStatus = Shelly.getComponentStatus("input", inputId);
  if (!inputStatus || inputStatus.state === undefined || inputStatus.state === null) {
    print("Input state unavailable for input:", inputId);
    return;
  }

  publishInputStateToDomoticz(inputStatus.state);
}

Shelly.addStatusHandler(function (event) {
  if (!event || !event.component || !event.delta) return;
  if (event.component !== "input:" + inputId) return;
  if (event.delta.state === undefined || event.delta.state === null) return;

  publishInputStateToDomoticz(event.delta.state);
});

// Initial send at startup
sendCurrentInputState();

// Periodic refresh every 30 seconds
Timer.set(30000, true, function () {
  sendCurrentInputState();
}, null);