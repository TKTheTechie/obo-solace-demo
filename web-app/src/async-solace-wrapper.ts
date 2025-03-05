
/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as solace from 'solclientjs';
import { v4 as uuidv4 } from 'uuid';

 interface SubManResponse {
	subscriptions: string[];
}


/**
 * The SubscriptionObject represents a combination of the callback function and
 *  whether the subscription has been applied on the PubSub+ broker
 *  @author TKTheTechie
 */
class SubscriptionObject {
	callback: unknown;
	isSubscribed: boolean;

	constructor(_callback: unknown, _isSubscribed: boolean) {
		this.callback = _callback;
		this.isSubscribed = _isSubscribed;
	}
}

//Convenience wrapper class to simplify Solace operations
class AsyncSolaceClient {
	//Solace session object
	private session: solace.Session | undefined;

	//Cache Session Object
	private cacheSession: solace.CacheSession	| undefined;

	private messageConsumer: solace.MessageConsumer | undefined;

	private submanInjectedCallback: any | undefined;

	//Map that holds the topic subscription string and the associated callback function, subscription state
	private topicSubscriptions: Map<string, SubscriptionObject> = new Map<
		string,
		SubscriptionObject
	>();

	private isConsuming = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	constructor() {
		//Initializing the solace client library
		//@ts-ignore
		const factoryProps = new solace.SolclientFactoryProperties();
		factoryProps.profile = solace.SolclientFactoryProfiles.version10;
		solace.SolclientFactory.init(factoryProps);
	}
	/**
	 * Asynchronous function that connects to the Solace Broker and returns a promise.
	 * Only required if a session isn't passed directly to this class
	 */
	connect(url: string, vpnName: string, userName: string, password: string): Promise<string> {
		return new Promise((resolve, reject) => {
			if (this.session != undefined) {
				console.warn('Already connected and ready to subscribe.');
			} else {
				// if there's no session, create one with the properties imported from the game-config file
				try {
					if (url.indexOf('ws') != 0) {
						reject(
							'HostUrl must be the WebMessaging Endpoint that begins with either ws:// or wss://. Please set appropriately!'
						);
						return;
					}

					this.session = solace.SolclientFactory.createSession({
						url,
						vpnName,
						userName,
						password,
						connectRetries: 3,
						publisherProperties: {
							enabled: true,
							acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE,
						},
			
					});

					const cacheSessionProperties = new solace.CacheSessionProperties("CacheSession");
					this.cacheSession = this.session.createCacheSession(cacheSessionProperties);
				} catch (error: unknown) {
					console.error(String(error));
				}
				// define session event listeners

				//The UP_NOTICE dictates whether the session has been established
				this.session?.on(solace.SessionEventCode.UP_NOTICE, () => {
					resolve('Successfully connected to Solace Message Router!');
				});

				//The CONNECT_FAILED_ERROR implies a connection failure
				this.session?.on(
					solace.SessionEventCode.CONNECT_FAILED_ERROR,
					(sessionEvent: solace.SessionEvent) => {
						console.error(
							'Connection failed to the message router: ' +
								sessionEvent.infoStr +
								' - check correct parameter values and connectivity!'
						);
						reject(`Check your connection settings and try again!`);
					}
				);

				//Message callback function
				this.session?.on(solace.SessionEventCode.MESSAGE, (message: solace.Message) => {
					//Get the topic name from the message's destination
					const topicName: string = message?.getDestination()?.getName() ?? '';
					//Iterate over all subscriptions in the subscription map
					for (const sub of Array.from(this.topicSubscriptions.keys())) {
						//Replace all * in the topic filter with a .* to make it regex compatible
						let regexdSub = sub.replace(/\*/g, '.*');

						//if the last character is a '>', replace it with a .* to make it regex compatible
						if (sub.lastIndexOf('>') == sub.length - 1)
							regexdSub = regexdSub.substring(0, regexdSub.length - 1).concat('.*');

						const matched = topicName.match(regexdSub);
						if (matched && matched.index == 0) {
							//Edge case if the pattern is a match but the last character is a *
							if (regexdSub.lastIndexOf('*') == sub.length - 1) {
								//Check if the number of topic sections are equal
								if (regexdSub.split('/').length != topicName.split('/').length) return;
							}
							//if the matched index starts at 0, then the topic is a match with the topic filter
							const callback = this.topicSubscriptions.get(sub)?.callback;
							if (this.topicSubscriptions.get(sub)?.isSubscribed && callback != null) {
								(callback as (message: solace.Message) => void)(message);
							}
						}
					}
				});

				// connect the session
				try {
					this.session?.connect();
				} catch (error: unknown) {
					console.log(String(error));
				}
			}
		});
	}

	async disconnect() {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		return new Promise<void>((resolve, _reject) => {
			console.log('Disconnecting from Solace message router...');

			//DISCONNECTED implies the client was disconnected
			this.session?.on(solace.SessionEventCode.DISCONNECTED, () => {
				console.log('Disconnected.');
				if (this.session !== null) {
					this.session?.dispose();
					this.session = undefined;
					resolve();
				}
			});
			if (this.session !== null) {
				try {
					this.session?.disconnect();
				} catch (error: unknown) {
					console.error(String(error));
				}
			} else {
				console.log('Not connected to Solace message router.');
			}
		});
	}

	getClientName(): string | undefined {
		return this.session?.getSessionProperties().clientName;
	}

	/**
	 * Convenience function to consume from a queue
	 *
	 * @param queueName Name of the queue to consume from
	 * @param callback The callback function for the message receipt
	 */
	consumeFromQueue(queueName: string) {
		if (this.session == null) {
			console.log('Not connected to Solace!');
		} else {
			if (this.isConsuming) console.warn(`Already connected to the queue ${queueName}`);
			else {
				this.messageConsumer = this.session.createMessageConsumer({
					queueDescriptor: { name: queueName, type: solace.QueueType.QUEUE },
					acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
					createIfMissing: true
				});

				this.messageConsumer.on(solace.MessageConsumerEventName.UP, () => {
					console.log('Succesfully connected to and consuming from ' + queueName);
				});

				this.messageConsumer.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, () => {
					console.log('Consumer cannot bind to queue ' + queueName);
				});

				this.messageConsumer.on(solace.MessageConsumerEventName.DOWN, () => {
					console.log('The message consumer is down');
				});

				this.messageConsumer.on(solace.MessageConsumerEventName.DOWN_ERROR, () => {
					console.log('An error happend, the message consumer is down');
				});

				try {
					this.messageConsumer.connect();
					this.isConsuming = true;
				} catch (err) {
					console.log(
						'Cannot start the message consumer on queue ' + queueName + ' because: ' + err
					);
				}
			}
		}
	}

	/**
	 * Function that adds a subscription to a queue
	 * @param topicSubscription - topic subscription string to add to the queue
	 */
	public addSubscriptionToQueue(topicSubscription: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const correlationKey = uuidv4();
			this.resolveRejectSubscriptionFunctions(correlationKey, resolve, reject);
			this.messageConsumer?.addSubscription(
				solace.SolclientFactory.createTopicDestination(topicSubscription),
				correlationKey,
				1000
			);
		});
	}

	/**
	 * Function that removes a topic subscription from a queue
	 * @param topicSubscription Topic to be removed from the queue
	 */
	public removeSubscriptionFromQueue(topicSubscription: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const correlationKey = uuidv4();
			this.resolveRejectSubscriptionFunctions(correlationKey, resolve, reject);
			this.messageConsumer?.removeSubscription(
				solace.SolclientFactory.createTopicDestination(topicSubscription),
				correlationKey,
				1000
			);
		});
	}
	/**
	 * Convenience function to resolve or reject subscription actions based on the co-relationkey
	 * @param correlationKey the unique identifier for the subscription action
	 * @param resolve the resolve function
	 * @param reject the reject function
	 */
	private resolveRejectDirectSubscriptionFunctions(
		topic: string,
		callback: (message: solace.Message) => void,
		_subcribe: boolean,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		correlationKey: any,
		resolve: (value: void | PromiseLike<void>) => void,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		reject: (reason?: any) => void
	) {
		//The function to be called if the Ack happends
		const onAck = (evt: solace.SessionEvent) => {
			this.topicSubscriptions.set(topic, new SubscriptionObject(callback, true));
			if (!evt || evt.correlationKey !== correlationKey) return;
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_OK, onAck);
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_ERROR, onNak);
			resolve();
		};

		//The function to be called if the action is rejected
		const onNak = (evt: solace.MessageConsumerEvent) => {
			if (!evt || evt.correlationKey !== correlationKey) return;
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_OK, onAck);
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_ERROR, onNak);
			reject(evt.infoStr);
		};

		//Add the relevant events
		//@ts-ignore
		this.session.addListener(solace.SessionEventCode.SUBSCRIPTION_OK, onAck);
		//@ts-ignore
		this.session.addListener(solace.SessionEventCode.SUBSCRIPTION_ERROR, onNak);
	}

	/**
	 * Convenience function to resolve or reject subscription actions based on the co-relationkey
	 * @param correlationKey the unique identifier for the subscription action
	 * @param resolve the resolve function
	 * @param reject the reject function
	 */
	private resolveRejectSubscriptionFunctions(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		correlationKey: any,
		resolve: (value: void | PromiseLike<void>) => void,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		reject: (reason?: any) => void
	) {
		//The function to be called if the Ack happends
		const onAck = (evt: solace.SessionEvent) => {
			if (!evt || evt.correlationKey !== correlationKey) return;
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_OK, onAck);
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_ERROR, onNak);
			resolve();
		};

		//The function to be called if the action is rejected
		const onNak = (evt: solace.MessageConsumerEvent) => {
			if (!evt || evt.correlationKey !== correlationKey) return;
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_OK, onAck);
			//@ts-ignore
			this.session.removeListener(solace.SessionEventCode.SUBSCRIPTION_ERROR, onNak);
			reject();
		};

		//Add the relevant events
		//@ts-ignore
		this.session.addListener(solace.SessionEventCode.SUBSCRIPTION_OK, onAck);
		//@ts-ignore
		this.session.addListener(solace.SessionEventCode.SUBSCRIPTION_ERROR, onNak);
	}

	/**
	 *
	 * @param queueName Name of the queue to consume from
	 */
	stopConsumeFromQueue() {
		if (this.isConsuming) {
			this.messageConsumer?.stop();
			this.isConsuming = false;
		}
	}

	/**
	 * Publish a guaranteed message on a topic
	 * @param topic Topic to publish on
	 * @param payload Payload on the topic
	 */
	async publishGuaranteedMessage(topic: string, payload: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.session) {
				console.log('Cannot publish because not connected to Solace message router!');
				reject();
				return;
			}

			const binaryAttachment = new Blob([payload], {
				type: 'text/plain; charset=utf-8'
			}).arrayBuffer();
			const message = solace.SolclientFactory.createMessage();
			message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
			binaryAttachment.then((buffer) => {
				const correlationKey = uuidv4();

				message.setCorrelationKey(correlationKey);
				message.setBinaryAttachment(new Uint8Array(buffer));
				message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);

				//call to be made on succesful publish
				const onAck = (evt: solace.SessionEvent) => {
					if (!evt || (evt.correlationKey as unknown as string) !== correlationKey) {
						return;
					}
					//@ts-ignore
					this.session.removeListener(String(solace.SessionEventCode.ACKNOWLEDGED_MESSAGE), onAck);
					//@ts-ignore
					this.session.removeListener(
						String(solace.SessionEventCode.REJECTED_MESSAGE_ERROR),
						onNak
					);
					resolve();
				};

				//call to be made on rejected publish
				const onNak = (evt: solace.SessionEvent) => {
					console.log('Unsuccesfully published!');
					if (!evt || (evt.correlationKey as unknown as string) !== correlationKey) {
						return;
					}
					//@ts-ignore
					this.session.removeListener(String(solace.SessionEventCode.ACKNOWLEDGED_MESSAGE), onAck);
					//@ts-ignore
					this.session.removeListener(
						String(solace.SessionEventCode.REJECTED_MESSAGE_ERROR),
						onNak
					);
					reject();
				};

				try {
					//register the callbacks on publish
					this.session?.on(solace.SessionEventCode.ACKNOWLEDGED_MESSAGE, onAck);
					this.session?.on(solace.SessionEventCode.REJECTED_MESSAGE_ERROR, onNak);
					this.session?.send(message);
				} catch (error) {
					//remove the callbacks on error
					//@ts-ignore
					this.session.removeListener(String(solace.SessionEventCode.ACKNOWLEDGED_MESSAGE), onAck);
					//@ts-ignore
					this.session.removeListener(
						String(solace.SessionEventCode.REJECTED_MESSAGE_ERROR),
						onNak
					);
					console.error(String(error));
					reject();
				}
			});
		});
	}

	sendCacheRequest(topicString: string): Promise<string> {
		return new Promise((resolve, reject) => {

			const cacheCB = new solace.CacheCBInfo((_requestID: number, result: solace.CacheRequestResult) => {

				let returnCodeStr = "";
				let returnSubCodeStr = "";
		
		
				switch (result.getReturnCode()) {
					case solace.CacheReturnCode.OK:
						returnCodeStr = "OK";
						break;
					case solace.CacheReturnCode.FAIL:
						returnCodeStr = "FAIL";
						break;
					case solace.CacheReturnCode.INCOMPLETE:
						returnCodeStr = "INCOMPLETE";
						break;
					default:
						returnCodeStr = "Unknown!";
				}
		
				switch (result.getReturnSubcode()) {
					case solace.CacheReturnSubcode.REQUEST_COMPLETE:
						returnSubCodeStr = "REQUEST_COMPLETE";
						break;
					case solace.CacheReturnSubcode.LIVE_DATA_FULFILL:
						returnSubCodeStr = "LIVE_DATA_FULFILL";
						break;
					case solace.CacheReturnSubcode.ERROR_RESPONSE:
						returnSubCodeStr = "ERROR_RESPONSE";
						break;
					case solace.CacheReturnSubcode.INVALID_SESSION:
						returnSubCodeStr = "INVALID_SESSION";
						break;
					case solace.CacheReturnSubcode.REQUEST_TIMEOUT:
						returnSubCodeStr = "REQUEST_TIMEOUT";
						break;
					case solace.CacheReturnSubcode.REQUEST_ALREADY_IN_PROGRESS:
						returnSubCodeStr = "REQUEST_ALREADY_IN_PROGRESS";
						break;
					case solace.CacheReturnSubcode.NO_DATA:
						returnSubCodeStr = "NO_DATA";
						break;
					case solace.CacheReturnSubcode.SUSPECT_DATA:
						returnSubCodeStr = "SUSPECT_DATA";
						break;
					case solace.CacheReturnSubcode.CACHE_SESSION_DISPOSED:
						returnSubCodeStr = "CACHE_SESSION_DISPOSED";
						break;
					case solace.CacheReturnSubcode.SUBSCRIPTION_ERROR:
						returnSubCodeStr = "SUBSCRIPTION_ERROR";
						break;
					default:
						returnSubCodeStr = "Unknown";
				}


				if (result.getReturnCode() === solace.CacheReturnCode.OK) {
					resolve(returnCodeStr + ":" + returnSubCodeStr)
				} else {
					reject(returnCodeStr + ":" + returnSubCodeStr)
				}
			}, this);
			
			if (!this.cacheSession) {
				reject('Not connected to Solace session');
			}

			try {
				const topic = solace.SolclientFactory.createTopicDestination(topicString);

				this.cacheSession?.sendCacheRequest(1, topic, false, solace.CacheLiveDataAction.FLOW_THRU, cacheCB);
			} catch (error) {
				console.error(String(error));
				reject(error);
			}
		})
	}


		

	/**
	 * Send a subscription request to the subscription manager
	 * @param topic Topic to subscribe to
	 * @param payload Payload to send to the subscription manager
	 * @param callback Callback function for the message
	 */

	sendSubscriptionRequest(topic: string, payload: string, callback: (message: solace.Message) => void): Promise<string> {
		return new Promise((resolve, reject) => {
			if (!this.session) {
				reject('Not connected to Solace session');
			}

			const binaryAttachment = new Blob([payload], {
				type: 'text/plain; charset=utf-8'
			}).arrayBuffer();

			const message = solace.SolclientFactory.createMessage();
			message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
			binaryAttachment.then((buffer) => {
				message.setBinaryAttachment(new Uint8Array(buffer));
				message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
				try {
					this.session?.sendRequest(
						message,
						2000,
						(_session: solace.Session, msg: solace.Message) => {
							const blob = new Blob([msg.getBinaryAttachment() as BlobPart], {
								type: 'text/plain; charset=utf-8'
							});
							blob.text().then((text) => {
								const subManResponse: SubManResponse = JSON.parse(text);
								subManResponse.subscriptions.forEach((sub) => {
									this.topicSubscriptions.set(sub, new SubscriptionObject(callback, true));
								});
								resolve(text);
							});
						},
						(_session: solace.Session, error: solace.RequestError) => {
							console.error(String(error));
							reject(error);
						}
					);
				} catch (error) {
					console.error(String(error));
					reject(error);
				}
			});
		});
	}

	/**
	 * Publish a direct message on a topic
	 * @param topic Topic to publish on
	 * @param payload Payload on the topic
	 */
	publishDirectMessage(topic: string, payload: string) {
		if (!this.session) {
			return;
		}

		const binaryAttachment = new Blob([payload], {
			type: 'text/plain; charset=utf-8'
		}).arrayBuffer();

		const message = solace.SolclientFactory.createMessage();
		message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
		binaryAttachment.then((buffer) => {
			message.setElidingEligible(true);
			message.setBinaryAttachment(new Uint8Array(buffer));
			message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
			try {
				this.session?.send(message);
			} catch (error) {
				console.log('unable to publish message');
			}
		});
	}

	public unsubscribe(topic: string): Promise<void> {
		return new Promise((resolve, reject) => {
			console.log(this.topicSubscriptions);
			//Check if the session has been established
			if (!this.session) {
				console.error('Cannot subscribe because not connected to Solace message router!');
				reject();
			}
			//Check if the subscription already exists - enable if not using subman
			// if (!this.topicSubscriptions.get(topic)) {
			// 	console.warn(`Not subscribed to ${topic}.`);
			// 	reject();
			// }
			const correlationKey = uuidv4();
			this.resolveRejectDirectSubscriptionFunctions(
				topic,
				() => {},
				false,
				correlationKey,
				resolve,
				reject
			);

			console.log(`Unsubscribing from ${topic}...`);
			this.session?.unsubscribe(
				solace.SolclientFactory.createTopicDestination(topic),
				true,
				correlationKey,
				1000
			);
		});
	}

	/**
	 * Function that adds a subscription to a queue
	 * @param topicSubscription - topic subscription string to add to the queue
	 */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public subscribe(
		topicSubscription: string,
		callback: (message: solace.Message) => void
	): Promise<void> {
		return new Promise((resolve, reject) => {
			//Check if the session has been established
			if (!this.session) {
				console.error('Cannot subscribe because not connected to Solace message router!');
				reject('Not connected to Solace message router.');
			}
			//Check if the subscription already exists
			if (this.topicSubscriptions.get(topicSubscription)) {
				console.warn(`Already subscribed to ${topicSubscription}.`);
				reject('Already subscribed!');
			}
			const correlationKey = uuidv4();

			this.resolveRejectDirectSubscriptionFunctions(
				topicSubscription,
				callback,
				true,
				correlationKey,
				resolve,
				reject
			);
			this.session?.subscribe(
				solace.SolclientFactory.createTopicDestination(topicSubscription),
				true,
				correlationKey,
				1000
			);
		});
	}
}

const solaceClient: AsyncSolaceClient = new AsyncSolaceClient();

export default solaceClient;