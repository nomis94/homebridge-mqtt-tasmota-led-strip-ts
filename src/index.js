// Tasmota WS2812 Accessory plugin for HomeBridge
// Simon Schmidt 

'use strict';

var Service, Characteristic;
var mqtt = require("mqtt");

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-mqtt-tasmota-led-strip", "mqtt-tasmota-led-strip",
            MqttTasmotaLEDStripAccessory);
}

function MqttTasmotaLEDStripAccessory(log, config) {
    this.log = log;

    this.name = config["name"] || "WS2812_Strip";
    this.manufacturer = config['manufacturer'] || "China";
    this.model = config['model'] || "WS2812";
    this.serialNumberMAC = config['serialNumberMAC'] || "";
    
    this.url = config["url"];
    this.publish_options = {
        qos: ((config["qos"] !== undefined) ? config["qos"] : 0)
    };

    this.client_Id = 'mqttjs_' + Math.random().toString(16).substr(2, 8);
    this.options = {
        keepalive: 10,
        clientId: this.client_Id,
        protocolId: 'MQTT',
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 30 * 1000,
        will: {
            topic: 'WillMsg',
            payload: 'Connection Closed abnormally..!',
            qos: 0,
            retain: false
        },
        username: config["username"],
        password: config["password"],
        rejectUnauthorized: false
    };

    this.topicStatusGet = config["topics"].statusGet;
    this.topicStatusSet = config["topics"].statusSet;
    this.topicsStateGet = (config["topics"].stateGet !== undefined) ? config["topics"].stateGet : "";
    
    this.topicSetBrightness = config["topics"].setBrightness; 
    this.topicSetHSB = config["topics"].setHSB;

    this.powerValue = (config["powerValue"] !== undefined) ? config["powerValue"] : "POWER";
    this.onValue = (config["onValue"] !== undefined) ? config["onValue"] : "ON";
    this.offValue = (config["offValue"] !== undefined) ? config["offValue"] : "OFF";



    // Check for Online Device
    if (config["activityTopic"] !== undefined && config["activityParameter"] !== undefined) {
        this.activityTopic = config["activityTopic"];
        this.activityParameter = config["activityParameter"];
    } else {
        this.activityTopic = "";
        this.activityParameter = "";
    }
    

    this.switchStatus = false;

    this.lb_brightness = 0;
    this.lb_hue = 0;
    this.lb_saturation = 0;
    this.lb_hsb_color = "0,0,0";
    
    
    this.service = new Service.Lightbulb(this.name);
    
    this.service
        .getCharacteristic(Characteristic.On)
        .on('get', this.getStatus.bind(this))
        .on('set', this.setStatus.bind(this));
        
    this.service
        .addCharacteristic(new Characteristic.Hue())
        .on('get', this.getHue.bind(this))
        .on('set', this.setHue.bind(this));

    this.service
        .addCharacteristic(new Characteristic.Saturation())
        .on('get', this.getSaturation.bind(this))
        .on('set', this.setSaturation.bind(this));

    this.service  
        .addCharacteristic(new Characteristic.Brightness())
        .on('get', this.getBrightness.bind(this))
        .on('set', this.setBrightness.bind(this));

    if (this.activityTopic !== "") {
        this.service.addOptionalCharacteristic(Characteristic.StatusActive);
        this.service
            .getCharacteristic(Characteristic.StatusActive)
            .on('get', this.getStatusActive.bind(this));
    }

    this.client = mqtt.connect(this.url, this.options);
    var that = this;
    
    this.client.on('error', function() {
        that.log('Error event on MQTT');
    });

    this.client.on('connect', function() {
        if (config["startCmd"] !== undefined && config["startParameter"] !== undefined) {
            that.client.publish(config["startCmd"], config["startParameter"]);
        }
    });

    this.client.on('message', function(topic, message) {
        if (topic == that.topicStatusGet) {
            try {
                var data = JSON.parse(message);
                if (data.hasOwnProperty(that.powerValue)) {
                    var status = data[that.powerValue];
                    that.switchStatus = (status == that.onValue);
                    that.service.getCharacteristic(Characteristic.On).updateValue(that.switchStatus);
                }
            } 
            catch (e) {               
                var status = message.toString();
                that.switchStatus = (status == that.onValue);
                that.log("Exception topicStatusGet", e);
            }
        }
        // cyclic self message from esp8266 
        else if (topic == that.topicsStateGet) {
            try {
                var data = JSON.parse(message);
                if (data.hasOwnProperty(that.powerValue)) {
                    var status = data[that.powerValue];
                    that.switchStatus = (status == that.onValue);
                    that.service.getCharacteristic(Characteristic.On).updateValue(that.switchStatus);
                }
                if(data.hasOwnProperty("HSBColor")){
                    that.lb_hsb_color = data.HSBColor;
				    [that.lb_hue, that.lb_saturation, that.lb_brightness] = data.HSBColor.split(',');
                    that.service.getCharacteristic(Characteristic.Hue).updateValue(that.lb_hue);
                    that.service.getCharacteristic(Characteristic.Saturation).updateValue(that.lb_saturation);
                    that.service.getCharacteristic(Characteristic.Brightness).updateValue(that.lb_brightness);
                }
            } catch (e) {
                that.log("Exception topicsStateGet", e);
            }
        } 
        else if (topic == that.activityTopic) {
            var status = message.toString();
            that.activeStat = (status == that.activityParameter);
            that.service.setCharacteristic(Characteristic.StatusActive, that.activeStat);
        }
    });
    
    
    // Subscribe to MQTT Channels
    this.client.subscribe(this.topicStatusGet);
    this.client.subscribe(this.topicsStateGet);
    if (this.activityTopic !== "") {
        this.client.subscribe(this.activityTopic);
    }
}


MqttTasmotaLEDStripAccessory.prototype.getServices = function() {

    var informationService = new Service.AccessoryInformation();
    informationService
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
        .setCharacteristic(Characteristic.Model, this.model)
        .setCharacteristic(Characteristic.SerialNumber, this.serialNumberMAC);

    return [informationService, this.service];
}


MqttTasmotaLEDStripAccessory.prototype.getStatus = function(callback) {
    if (this.activeStat) {
        //this.log("Power state for '%s' is %s", this.name, this.switchStatus);
        callback(null, this.switchStatus);
    } else {
        this.log("'%s' is offline", this.name);
        callback('No Response');
    }
}

MqttTasmotaLEDStripAccessory.prototype.setStatus = function(status, callback) {
    this.switchStatus = status;
    //this.log("Set power state on '%s' to %s", this.name, status);
    this.client.publish(this.topicStatusSet, status ? this.onValue : this.offValue, this.publish_options);

    callback();
}

MqttTasmotaLEDStripAccessory.prototype.getStatusActive = function(callback) {
    //this.log(this.name, " -  Activity Set : ", this.activeStat);
    callback(null, this.activeStat);
}


// HSL Color Changes
MqttTasmotaLEDStripAccessory.prototype.getBrightness = function(callback) {
    callback(null, this.lb_brightness);
};

MqttTasmotaLEDStripAccessory.prototype.setBrightness = function(value, callback) {
    this.lb_brightness = value;
    this.client.publish(this.topicSetBrightness, String(value));
    callback();
};


MqttTasmotaLEDStripAccessory.prototype.getHue = function(callback) {
    callback(null, this.lb_hue);
};

MqttTasmotaLEDStripAccessory.prototype.setHue = function(value, callback) {
    this.lb_hue = value;
    var HSBColor = `${this.lb_hue},${this.lb_saturation},${this.lb_brightness}`;
    this.client.publish(this.topicSetHSB, HSBColor);
    callback();
};

MqttTasmotaLEDStripAccessory.prototype.getSaturation = function(callback) {
    callback(null, this.lb_saturation);
};

MqttTasmotaLEDStripAccessory.prototype.setSaturation = function(value, callback) {
    // always together with setHue()
    this.lb_saturation = value;
    callback();
};
