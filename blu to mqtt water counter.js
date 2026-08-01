
// Détection des impulsions sur l'input du module
// MQTT params :
let MQTTPublishTopic = "domoticz/in";
let waterCounterIdx = 850;
let waterIsRunningIdx = 855;

// Shelly params :
let inputId = 100;

// Paramètres de comptage d'eau
let timeWindowMs = 5000; // Fenêtre de temps pour détecter les impulsions (5 secondes)

let lastPulseTime = 0;

let waterCounterM3 = 0.0;
let flowLPerMinute = 3;
let litersPerPulse = flowLPerMinute / 60; // 0.05 L par seconde, soit 3 L/minute

function sendWaterToMqtt(topic, idx, valueM3) {
  let message = JSON.stringify({
    idx: idx,
    nvalue: 0,
    svalue: valueM3.toFixed(3)
  });

  print(message);
  MQTT.publish(topic, message, 0, false);
}

function sendRunningState(isRunning) {
  let message = JSON.stringify({
    idx: waterIsRunningIdx,
    nvalue: isRunning ? 1 : 0
  });

  print("Water running: " + isRunning);
  MQTT.publish(MQTTPublishTopic, message, 0, false);
}

function updateWaterCounter() {
  let now = Date.now();
  if (lastPulseTime === 0) {
    sendRunningState(false);
    return;
  }

  let elapsedSeconds = (now - lastPulseTime) / 1000;
  if (elapsedSeconds <= timeWindowMs / 1000) {
    waterCounterM3 += litersPerPulse / 1000;
    sendWaterToMqtt(MQTTPublishTopic, waterCounterIdx, waterCounterM3);
    sendRunningState(true);
    print("Active flow detected, new value: " + waterCounterM3.toFixed(3) + " m3");
  } else if (elapsedSeconds <= (timeWindowMs / 1000) + 5) {
    sendRunningState(false);
  } else {
    // Nothing
  }
}

Shelly.addStatusHandler(function(e) {
  if (e.component === "input:" + inputId) {
    if (e.delta.state === true) {
      lastPulseTime = Date.now();
      updateWaterCounter();
    }
  }
});

Timer.set(1000, true, function() {
  updateWaterCounter();
}, null);