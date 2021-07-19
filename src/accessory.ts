import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge";

import {
	IClientOptions,
    Client, 
    connect, 
    IConnackPacket
} from "mqtt";

let hap: HAP;

//  Initializer function called when the plugin is loaded.

export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("mqtt-tasmota-led-strip-ts", MqttTasmotaLedStrip);
};


interface LEDStripe {
  active:     boolean;
  brightness: number;
  hue:        number;
  saturation: number;
  HSBColor:   string;
};

function printStatus(led : LEDStripe, log: Logging) {
  log.info(`LEDStripe: ${led.active}, ${led.brightness}, ${led.hue}, ${led.saturation},`, led.HSBColor);
};

// Tasmota WS2812 Accessory plugin for HomeBridge
class MqttTasmotaLedStrip implements AccessoryPlugin {
  private readonly lbService: Service;
  private readonly informationService: Service;

  private readonly log: Logging;
  private readonly name: string;
  private readonly topicStatusGet: string;
  private readonly topicStatusSet: string;
  private readonly topicsStateGet: string;

  private readonly topicSetBrightness: string;
  private readonly topicSetHSB: string;

  private readonly powerValue: string;
  private readonly onValue: string;
  private readonly offValue: string;

  private ledStripe : LEDStripe;

  // MQTT variables
  private readonly mqttURL: string;
  private readonly mqttClientID: string; 
  private readonly mqttOptions: IClientOptions; 
  private mqttHandle: Client;


  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;
 
	// set topics
    this.topicStatusGet = config["topics"].statusGet;
    this.topicStatusSet = config["topics"].statusSet;
    this.topicsStateGet = (config["topics"].stateGet !== undefined) ? config["topics"].stateGet : "";
    this.topicSetBrightness = config["topics"].setBrightness; 
    this.topicSetHSB = config["topics"].setHSB;

    this.powerValue = (config["powerValue"] !== undefined) ? config["powerValue"] : "POWER";
    this.onValue = (config["onValue"] !== undefined) ? config["onValue"] : "ON";
    this.offValue = (config["offValue"] !== undefined) ? config["offValue"] : "OFF";

    this.ledStripe = {
		active     : false,
		brightness : 0,
		hue        : 0,
		saturation : 0,
		HSBColor   : "0,0,0"
    };
   
	// MQTT stuff
	this.mqttURL = config.url;
	this.mqttClientID = 'mqttjs_' + Math.random().toString(16).substr(2, 8);
	this.mqttOptions = {
		keepalive: 10,
		clientId: this.mqttClientID,
		protocolId: 'MQTT',
		protocolVersion: 4,
		clean: true,
		reconnectPeriod: 1000,
		connectTimeout: 30 * 1000,
		will: {
			topic: config["name"],
			payload: ' >> Connection closed abnormally..!',
			qos: 0,
			retain: false
		},
		username: config.username,
		password: config.password,
		rejectUnauthorized: false
	};

    this.lbService = new hap.Service.Lightbulb(this.name);

    this.lbService.getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          	// printStatus(this.ledStripe, log); 
			callback(undefined, this.ledStripe.active);
		})
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
			this.ledStripe.active = value as boolean;
			this.mqttHandle.publish(this.topicStatusSet, (this.ledStripe.active? this.onValue: this.offValue));
          	// printStatus(this.ledStripe, log); 
			callback();
        });

    this.lbService.getCharacteristic(hap.Characteristic.Brightness)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          	// printStatus(this.ledStripe, log); 
			callback(undefined, this.ledStripe.brightness);
		})
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
			this.ledStripe.brightness = value as number;
			this.mqttHandle.publish(this.topicSetBrightness, String(value));
          	// printStatus(this.ledStripe, log); 
			callback();
        });
 
    this.lbService.getCharacteristic(hap.Characteristic.Hue)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          	// printStatus(this.ledStripe, log); 
			callback(undefined, this.ledStripe.hue);
		})
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
			this.ledStripe.hue = value as number;
            var HSBColor = `${this.ledStripe.hue},${this.ledStripe.saturation},${this.ledStripe.brightness}`;
			this.mqttHandle.publish(this.topicSetHSB, String(value));
          	// printStatus(this.ledStripe, log); 
			callback();
        });


    this.lbService.getCharacteristic(hap.Characteristic.Saturation)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          	// printStatus(this.ledStripe, log); 
			callback(undefined, this.ledStripe.saturation);
		})
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
			this.ledStripe.saturation = value as number;
          	// printStatus(this.ledStripe, log); 
			callback();
        });

 
    this.informationService = new hap.Service.AccessoryInformation();
    this.informationService
        .setCharacteristic(hap.Characteristic.Name, this.name);
        //.setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
        //.setCharacteristic(hap.Characteristic.Model, this.model)
        //.setCharacteristic(hap.Characteristic.SerialNumber, this.serialNumberMAC);


    this.mqttHandle = connect(this.mqttURL, this.mqttOptions);
	this.mqttHandle
		.subscribe({
			[this.topicStatusGet]: {qos: 0}, 
			[this.topicsStateGet]: {qos: 0}
		}, (err, granted) => {
			granted.forEach(({topic, qos}) => {
				log.info(`subscribed to ${topic} with qos=${qos}`)
			})
		})

        .on("error", () => {
            log.info("Error event on MQTT");
        })

		.on("connect", (packet: IConnackPacket) => {
			log.info("Succesfully connect to MQTT Broker [", this.mqttURL, "]");
            if (config["startCmd"] !== undefined && config["startParameter"] !== undefined) {
               this.mqttHandle.publish(config["startCmd"], config["startParameter"]);
            }
		})

		.on("message", (topic: string, payload: Buffer) => {
			let message = payload.toString();
			if (topic == this.topicStatusGet) {
				try {
					var data = JSON.parse(message);
					if (data.hasOwnProperty(this.powerValue)) {
						this.ledStripe.active = (data[this.powerValue] == this.onValue);
						this.lbService.updateCharacteristic(hap.Characteristic.On, this.ledStripe.active);
					}
				} 
				catch (e) {               
					this.ledStripe.active = (message.toString() == this.onValue);
					log.info("Exception topicStatusGet", e);
				}
			}

			// cyclic self message from esp8266 
			else if (topic == this.topicsStateGet) {
				try {
					var data = JSON.parse(message);
					if (data.hasOwnProperty(this.powerValue)) {
						this.ledStripe.active = (data[this.powerValue] == this.onValue);
						this.lbService.updateCharacteristic(hap.Characteristic.On, this.ledStripe.active);
					}
					if(data.hasOwnProperty("HSBColor")){
						this.ledStripe.HSBColor = data.HSBColor;
						[this.ledStripe.hue, this.ledStripe.saturation, this.ledStripe.brightness] = data.HSBColor.split(',');
						this.lbService.updateCharacteristic(hap.Characteristic.Hue, this.ledStripe.hue);
						this.lbService.updateCharacteristic(hap.Characteristic.Saturation, this.ledStripe.saturation);
						this.lbService.updateCharacteristic(hap.Characteristic.Brightness, this.ledStripe.brightness);
					}
				} 
				catch (e) {
					log.info("Exception topicsStateGet", e);
				}
			} 
		});
    
    log.info("LED Strip Service configured!");
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!");
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.lbService,
    ];
  }

}
