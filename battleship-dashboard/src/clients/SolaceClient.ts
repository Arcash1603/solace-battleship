import solace from "solclientjs";
import { solaceBrokerConfig } from "./solace-broker-config";
import { noView } from "aurelia-framework";

@noView
export class SolaceClient {
  session = null;
  topicSubscriptions: Record<string, any> = {};
  
  constructor() {
    let factoryProps = new solace.SolclientFactoryProperties();
    factoryProps.profile = solace.SolclientFactoryProfiles.version10;
    solace.SolclientFactory.init(factoryProps);
  }

  log(line: string) {
    let now = new Date();
    let time = [('0' + now.getHours()).slice(-2), ('0' + now.getMinutes()).slice(-2), ('0' + now.getSeconds()).slice(-2)];
    let timestamp = '[' + time.join(':') + '] ';
    console.log(timestamp + line);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      if (this.session !== null) {
        this.log('Already connected and ready to subscribe.');
        reject();
      }
      // if there's no session, create one
      try {
        this.session = solace.SolclientFactory.createSession({
            // solace.SessionProperties
            url:      solaceBrokerConfig.hostUrl,
            vpnName:  solaceBrokerConfig.vpn,
            userName: solaceBrokerConfig.userName,
            password: solaceBrokerConfig.password,
        });
      } catch (error) {
        this.log(error.toString());
      }
      // define session event listeners
      this.session.on(solace.SessionEventCode.UP_NOTICE,  (sessionEvent) => {
          this.log('=== Successfully connected and ready to subscribe. ===');
          resolve();
      });
      this.session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (sessionEvent) => {
          this.log('Connection failed to the message router: ' + sessionEvent.infoStr +
              ' - check correct parameter values and connectivity!');
      });
      this.session.on(solace.SessionEventCode.DISCONNECTED, (sessionEvent) => {
          this.log('Disconnected.');
          if (this.session !== null) {
            this.session.dispose();
            //this.subscribed = false;
            this.session = null;
          }
      });
      this.session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (sessionEvent) => {
          this.log('Cannot subscribe to topic: ' + sessionEvent.correlationKey);
          delete this.topicSubscriptions[sessionEvent.correlationKey];
      });
      this.session.on(solace.SessionEventCode.SUBSCRIPTION_OK, (sessionEvent) => {
          if (this.topicSubscriptions[sessionEvent.correlationKey] && this.topicSubscriptions[sessionEvent.correlationKey].isSubscribed) {
            delete this.topicSubscriptions[sessionEvent.correlationKey];
            this.log(`Successfully unsubscribed from topic: ${sessionEvent.correlationKey}`);
          } else {
            this.topicSubscriptions[sessionEvent.correlationKey].isSubscribed = true;
            this.log(`Successfully subscribed to topic: ${sessionEvent.correlationKey}`);
          }
      });
      // define message event listener
      this.session.on(solace.SessionEventCode.MESSAGE, (message) => {
        let topicName = message.getDestination().getName();
        this.topicSubscriptions[topicName].callback(message);
      });
      // connect the session
      try {
        this.session.connect();
      } catch (error) {
        this.log(error.toString());
      }
    });
  }  

  subscribe(topicName: string, callback: any) {
    if(!this.session) {
      this.log("[WARNING] Cannot subscribe because not connected to Solace message router!")
      return;
    }
    if(this.topicSubscriptions[topicName]) {
      this.log(`[WARNING] Already subscribed to ${topicName}.`);
      return;
    }
    this.log(`Subscribing to ${topicName}`);
    this.topicSubscriptions[topicName] = {callback: callback, isSubscribed: false}; // gets updated asynchronously
    try {
      this.session.subscribe(
        solace.SolclientFactory.createTopicDestination(topicName),
        true, // generate confirmation when subscription is added successfully
        topicName, // use topic name as correlation key
        10000 // 10 seconds timeout for this operation
      );
    } catch (error) {
      this.log(error.toString());
    }
  }

  publish(topic: string, payload: string) {
    if(!this.session) {
      this.log("[WARNING] Cannot publish because not connected to Solace message router!")
      return;
    }
    this.log(`Publishing message ${payload} to topic ${topic}...`);
    let message = solace.SolclientFactory.createMessage();
    message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
    message.setBinaryAttachment(payload);
    message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
    try {
        this.session.send(message);
        this.log('Message published.');
    } catch (error) {
        this.log(error.toString());
    }
  }
}
