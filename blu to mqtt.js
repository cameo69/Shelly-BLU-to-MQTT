/**
 * This script uses the BLE scan functionality in scripting
 * Selects Shelly BLU Motion from the aired advertisements, decodes
 * the service data payload and transfert it to an MQTT broker
 */

// Shelly BLU devices:
// SBBT - Shelly BLU Button
// SBDW - Shelly BLU DoorWindow

// sample Shelly DW service_data payload
// 0x40 0x00 0x4E 0x01 0x64 0x05 0x00 0x00 0x00 0x2D 0x01 0x3F 0x00 0x00

// First byte: BTHome device info, 0x40 - no encryption, BTHome v.2
// bit 0: “Encryption flag”
// bit 1-4: “Reserved for future use”
// bit 5-7: “BTHome Version”

// AD 0: PID, 0x00
// Value: 0x4E

// AD 1: Battery, 0x01
// Value, 100%

// AD 2: Illuminance, 0x05
// Value: 0

// AD 3: Window, 0x2D
// Value: true, open

// AD 4: Rotation, 0x3F
// Value: 0



// CHANGE THE CONFIG OBJECT TO MATCH YOUR NEEDS

let CONFIG = {
    shelly_blu_address: {
        "38:39:8f:99:75:fb": "shellies/comble_velux1",
        "another_address": "another_topic",
        "yet_another_address": "yet_another_topic"
    },
    verbose_logs: false,
};
// Convertit les adresses en majuscules
for (let key in CONFIG.shelly_blu_address) {
    CONFIG.shelly_blu_address[key.toUpperCase()] = CONFIG.shelly_blu_address[key];
}

// END OF CHANGE

// MQTT publish function
function mqtt_publish(topic, payload) {
    if (CONFIG.verbose_logs) console.log("MQTT DBG: publish topic=", topic);
    try {
        let message = JSON.stringify(payload);
        if (CONFIG.verbose_logs) console.log("MQTT DBG: stringify ok, len=", message.length);
        MQTT.publish(topic, message, 0, false);
        if (CONFIG.verbose_logs) console.log("MQTT DBG: publish ok");
    } catch (e) {
        console.log("MQTT DBG ERR:", e);
    }
}

let ALLTERCO_MFD_ID_STR = "0ba9";
let BTHOME_SVC_ID_STR = "fcd2";

let ALLTERCO_MFD_ID = JSON.parse("0x" + ALLTERCO_MFD_ID_STR);
let BTHOME_SVC_ID = JSON.parse("0x" + BTHOME_SVC_ID_STR);

let SCAN_DURATION = BLE.Scanner.INFINITE_SCAN;

let uint8 = 0;
let int8 = 1;
let uint16 = 2;
let int16 = 3;
let uint24 = 4;
let int24 = 5;

function getByteSize(type) {
    if (type === uint8 || type === int8) return 1;
    if (type === uint16 || type === int16) return 2;
    if (type === uint24 || type === int24) return 3;
    //impossible as advertisements are much smaller;
    return 255;
}

function toHex(buffer) {
    if (typeof buffer !== "string" || buffer.length === 0) return "";
    let out = "";
    for (let i = 0; i < buffer.length; i++) {
        let h = buffer.at(i).toString(16);
        if (h.length < 2) h = "0" + h;
        out += h;
    }
    return out;
}

function toHexByte(num) {
    let h = num.toString(16);
    if (h.length < 2) h = "0" + h;
    return h;
}

function logManufacturerData(manufacturerData) {
    if (typeof manufacturerData === "undefined" || manufacturerData === null) return;
    for (let mfdId in manufacturerData) {
        let raw = manufacturerData[mfdId];
        let hex = toHex(raw);
        if (CONFIG.verbose_logs) {
            console.log("manufacturer_data id=0x" + mfdId + " len=" + raw.length + " hex=" + hex);
        }

    }
}

function shouldIgnoreManufacturerData(manufacturerData) {
    if (typeof manufacturerData === "undefined" || manufacturerData === null) return false;
    return manufacturerData.hasOwnProperty("004c");
}

function inspectBTHPayload(buffer) {
    if (typeof buffer !== "string" || buffer.length === 0) {
        return { status: "missing" };
    }

    let _dib = buffer.at(0);
    let version = _dib >> 5;
    let encrypted = (_dib & 0x1) ? true : false;
    let objects = [];
    let unknownId = null;
    buffer = buffer.slice(1);

    while (buffer.length > 0) {
        let objectId = buffer.at(0);
        let _bth = BTH[objectId];
        if (typeof _bth === "undefined") {
            unknownId = objectId;
            objects.push({ id: objectId, name: "UNKNOWN_BTH_OBJECT_ID" });
            break;
        }
        objects.push({ id: objectId, name: _bth.n });
        buffer = buffer.slice(1);
        let size = getByteSize(_bth.t);
        if (buffer.length < size) {
            return {
                status: "truncated",
                version: version,
                encrypted: encrypted,
                objects: objects,
            };
        }
        buffer = buffer.slice(size);
    }

    if (encrypted) {
        return {
            status: "encrypted",
            version: version,
            encrypted: encrypted,
            objects: objects,
        };
    }

    if (unknownId !== null) {
        return {
            status: "unknown_type",
            version: version,
            encrypted: encrypted,
            objects: objects,
            unknown_id: unknownId,
        };
    }

    return {
        status: "known",
        version: version,
        encrypted: encrypted,
        objects: objects,
    };
}

function formatManufacturerSummary(manufacturerData) {
    if (typeof manufacturerData === "undefined" || manufacturerData === null) return "none";
    let parts = [];
    for (let mfdId in manufacturerData) {
        let raw = manufacturerData[mfdId];
        parts.push("0x" + mfdId + ":" + toHex(raw));
    }
    if (parts.length === 0) return "none";
    return parts.join(" | ");
}

function formatBTHSummary(serviceData) {
    if (
        typeof serviceData === "undefined" ||
        serviceData === null ||
        typeof serviceData[BTHOME_SVC_ID_STR] === "undefined"
    ) {
        return "none";
    }

    let raw = serviceData[BTHOME_SVC_ID_STR];
    let info = inspectBTHPayload(raw);
    let knownObjects = "none";
    if (typeof info.objects !== "undefined" && info.objects.length > 0) {
        let objectParts = [];
        for (let i = 0; i < info.objects.length; i++) {
            let obj = info.objects[i];
            objectParts.push(obj.name + "(0x" + toHexByte(obj.id) + ")");
        }
        knownObjects = objectParts.join(",");
    }

    let summary = "payload=" + toHex(raw) + " status=" + info.status + " objects=" + knownObjects;
    if (typeof info.version !== "undefined") summary += " ver=" + info.version;
    if (typeof info.encrypted !== "undefined") summary += " encrypted=" + (info.encrypted ? "1" : "0");
    if (typeof info.unknown_id !== "undefined") summary += " unknown_id=0x" + toHexByte(info.unknown_id);
    return summary;
}

let BTH = {};
BTH[0x00] = { n: "pid", t: uint8 };
BTH[0x01] = { n: "Battery", t: uint8, u: "%" };
BTH[0x15] = { n: "Battery-OK", t: uint8 };
BTH[0x16] = { n: "Battery-Charging", t: uint8 };
BTH[0x05] = { n: "Illuminance", t: uint24, f: 0.01 };
BTH[0x3f] = { n: "Rotation", t: int16, f: 0.1 };
BTH[0x02] = { n: "Temperature", t: int16, f: 0.01, u: "tC" };
BTH[0x45] = { n: "Temperature", t: int16, f: 0.1, u: "tF" };
BTH[0x04] = { n: "Pressure", t: uint24, f: 0.01};
BTH[0x03] = { n: "Humidity", t: uint16, f: 0.01, u: "%" };
BTH[0x2e] = { n: "Humidity", t: uint8, f: 1, u: "%" };
BTH[0x08] = { n: "Dewpoint", t: uint16, f: 0.01};
BTH[0x14] = { n: "Moisture", t: uint16, f: 0.01};
BTH[0x2f] = { n: "Moisture", t: uint8, f: 1};
BTH[0x20] = { n: "Moisture", t: uint8 };
BTH[0x20] = { n: "Moisture-Warn", t: uint8 };
BTH[0x12] = { n: "co2", t: uint16};
BTH[0x17] = { n: "co", t: uint8 };
BTH[0x0c] = { n: "Voltage", t: uint16, f: 0.001};
BTH[0x4a] = { n: "Voltage", t: uint16, f: 0.1};
BTH[0x18] = { n: "Cold", t: uint8 };
BTH[0x1c] = { n: "Gas", t: uint8 };
BTH[0x1d] = { n: "Heat", t: uint8 };
BTH[0x1e] = { n: "Light", t: uint8 };
BTH[0x1f] = { n: "Lock", t: uint8 };
BTH[0x1a] = { n: "Door", t: uint8 };
BTH[0x1b] = { n: "Garage-Door", t: uint8 };
BTH[0x21] = { n: "Motion", t: uint8 };
BTH[0x2d] = { n: "Window", t: uint8 };
BTH[0x3a] = { n: "Button", t: uint8 };

// Shelly ECOWITT WS90 weather station specific
// For id = 0x5f
// 0x01 "Battery"     - defined above
// 0x04 "Pressure"    - defined above
// 0x08 "Dewpoint"    - defined above
// 0x0c "Voltage"     - defined above
// 0x2e "Humidity"    - defined above
// 0x45 "Temperature" - defined above
// For id = 0x44
// 0x05 "Illuminance" - defined above
// 0x20 "Moisture-Warn" - defined above
BTH[0x44] = { n: "Wind-Speed", t: uint16, f: 0.01, u: "m/s" };
BTH[0x46] = { n: "UV-Index", t: uint8, f: 0.1 };
BTH[0x5e] = { n: "Wind-Direction", t: uint16, f: 0.01, u: "deg" };
BTH[0x5f] = { n: "Precipitation", t: uint16, f: 0.1, u: "mm" };




// Shelly BLU Distance specific
BTH[0x40] = { n: "Distance", t: uint16, u: "mm" };
BTH[0x2c] = { n: "Vibration", t: uint8 };

// Specific to Shelly BLU RC Button 4
const ACTION = {
    0x00: "None",
    0x01: "press",
    0x02: "double_press",
    0x03: "triple_press",
    0x04: "long_press",
    0x05: "long_double_press",
    0x06: "long_triple_press",
    0xFE: "hold_press",
};

let BTHomeDecoder = {
    utoi: function (num, bitsz) {
        let mask = 1 << (bitsz - 1);
        return num & mask ? num - (1 << bitsz) : num;
    },
    getUInt8: function (buffer) {
        return buffer.at(0);
    },
    getInt8: function (buffer) {
        return this.utoi(this.getUInt8(buffer), 8);
    },
    getUInt16LE: function (buffer) {
        return 0xffff & ((buffer.at(1) << 8) | buffer.at(0));
    },
    getInt16LE: function (buffer) {
        return this.utoi(this.getUInt16LE(buffer), 16);
    },
    getUInt24LE: function (buffer) {
        return (
            0x00ffffff & ((buffer.at(2) << 16) | (buffer.at(1) << 8) | buffer.at(0))
        );
    },
    getInt24LE: function (buffer) {
        return this.utoi(this.getUInt24LE(buffer), 24);
    },
    getBufValue: function (type, buffer) {
        if (buffer.length < getByteSize(type)) return null;
        let res = null;
        if (type === uint8) res = this.getUInt8(buffer);
        if (type === int8) res = this.getInt8(buffer);
        if (type === uint16) res = this.getUInt16LE(buffer);
        if (type === int16) res = this.getInt16LE(buffer);
        if (type === uint24) res = this.getUInt24LE(buffer);
        if (type === int24) res = this.getInt24LE(buffer);
        return res;
    },
    unpack: function (buffer) {
        if (typeof buffer !== "string" || buffer.length === 0) return null;
        let result = {};
        let tempButtons = [];
        let _dib = buffer.at(0);
        result["encryption"] = _dib & 0x1 ? true : false;
        result["BTHome_version"] = _dib >> 5;
        if (result["BTHome_version"] !== 2) return null;
        if (result["encryption"]) return result;
        buffer = buffer.slice(1);
    
        let _bth;
        let _value;
    
        while (buffer.length > 0) {
            _bth = BTH[buffer.at(0)];
            if (typeof _bth === "undefined") {
                if (CONFIG.verbose_logs) console.log("BTH: unknown type");
                break;
            }
            buffer = buffer.slice(1);
            _value = this.getBufValue(_bth.t, buffer);
            if (_value === null) break;
            if (typeof _bth.f !== "undefined") _value = _value * _bth.f;
            if (CONFIG.verbose_logs) console.log("BTH: ", _bth.n, _value);
            
            // Collecte de tous les boutons
            if (_bth.n === "Button") {
                tempButtons.push(_value);
            } else {
                result[_bth.n] = _value;
            }
            
            buffer = buffer.slice(getByteSize(_bth.t));
        }
    
        // Traitement des boutons selon leur nombre
        if (tempButtons.length > 0) {
            if (tempButtons.length === 1) {
                // Lonely button
                result.Button = tempButtons[0];
            } else {
                result.Buttons = tempButtons;
            }
        }
        if (CONFIG.verbose_logs) console.log("result: ", JSON.stringify(result));
        return result;
    },
};

let ShellyBLUParser = {
    getData: function (res) {
        let result = BTHomeDecoder.unpack(res.service_data[BTHOME_SVC_ID_STR]);
        result.addr = res.addr;
        result.rssi = res.rssi;
        return result;
    },
};

let last_packet_id = 0x100;
function scanCB(ev, res) {
    if (ev !== BLE.Scanner.SCAN_RESULT) return;
    if (shouldIgnoreManufacturerData(res.manufacturer_data)) {
        if (CONFIG.verbose_logs) console.log("BLE adv ignored: manufacturer_data includes 0x004c");
        return;
    }
    // Keep logs focused on BTHome traffic only.
    if (
        typeof res.service_data === "undefined" ||
        typeof res.service_data[BTHOME_SVC_ID_STR] === "undefined"
    ) {
        return;
    }
    console.log(
        "BLE adv addr=" + res.addr +
        " rssi=" + res.rssi +
        " mfd={" + formatManufacturerSummary(res.manufacturer_data) + "}" +
        " bth={" + formatBTHSummary(res.service_data) + "}"
    );
    if (CONFIG.verbose_logs) {
        logManufacturerData(res.manufacturer_data);
        console.log("service_uuids:", res.service_uuids);
    }
    // skip if we are looking for name match but don't have active scan as we don't have name
    if (
        typeof CONFIG.shelly_blu_name_prefix !== "undefined" &&
        (typeof res.local_name === "undefined" ||
            res.local_name.indexOf(CONFIG.shelly_blu_name_prefix) !== 0)
    )
        return;
    // skip if we don't have address match
    if (
        typeof CONFIG.shelly_blu_address !== "undefined" &&
        !CONFIG.shelly_blu_address.hasOwnProperty(res.addr.toUpperCase())
    )
        return;
    let BTHparsed = ShellyBLUParser.getData(res);
    // // skip if parsing failed
    if (BTHparsed === null) {
        console.log("Failed to parse BTH data");
        return;
    }
    // skip, we are deduping results
    if (last_packet_id === BTHparsed.pid) return;
    last_packet_id = BTHparsed.pid;
    console.log("Shelly BTH packet:", JSON.stringify(BTHparsed));
    // Get the topic for the current address
    let topic = CONFIG.shelly_blu_address[res.addr.toUpperCase()];
    if (CONFIG.verbose_logs) console.log("Topic for the current address:", topic);
    // Publish the data
    if (CONFIG.verbose_logs) console.log("MQTT DBG: before mqtt_publish");
    print("Publishing to MQTT topic:", topic, "with payload:", JSON.stringify(BTHparsed));
    mqtt_publish(topic, BTHparsed);
    if (CONFIG.verbose_logs) console.log("MQTT DBG: after mqtt_publish");

}

print("Starting BLE scan");
BLE.Scanner.Start({ duration_ms: SCAN_DURATION, active: false }, scanCB);