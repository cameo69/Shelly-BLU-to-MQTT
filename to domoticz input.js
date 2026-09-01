/**
 * Allow to send data straight to domoticz via MQTT. 
 */

let MQTTPublishTopic = "domoticz/in";
let tempId = 100;
let domoticzIdx = 40;

function sentTempToMqtt(tempId, topic, idx) {
  let temp = Shelly.getComponentStatus("Temperature", tempId);
  if (!temp || temp.tC === undefined || temp.tC === null) {
    print("Temperature value unavailable");
    return;
  }

  let message = JSON.stringify({
    idx: idx,
    nvalue: 0,
    svalue: temp.tC.toString()
  });

  print(message);
  MQTT.publish(topic, message, 0, false);
}


sentTempToMqtt(tempId, MQTTPublishTopic, domoticzIdx);

Timer.set(30000, true, function() {
  sentTempToMqtt(tempId, MQTTPublishTopic, domoticzIdx);
}, null);