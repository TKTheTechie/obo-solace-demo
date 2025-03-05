package com.solace.obo;

import java.io.InputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.Scanner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.solacesystems.jcsmp.BytesXMLMessage;
import com.solacesystems.jcsmp.ClientName;
import com.solacesystems.jcsmp.JCSMPException;
import com.solacesystems.jcsmp.JCSMPFactory;
import com.solacesystems.jcsmp.JCSMPProperties;
import com.solacesystems.jcsmp.JCSMPSession;
import com.solacesystems.jcsmp.JCSMPStreamingPublishCorrelatingEventHandler;
import com.solacesystems.jcsmp.Message;
import com.solacesystems.jcsmp.SessionEventArgs;
import com.solacesystems.jcsmp.SessionEventHandler;
import com.solacesystems.jcsmp.TextMessage;
import com.solacesystems.jcsmp.Topic;
import com.solacesystems.jcsmp.XMLMessageConsumer;
import com.solacesystems.jcsmp.XMLMessageListener;
import com.solacesystems.jcsmp.XMLMessageProducer;

public class SubscriptionManager implements SessionEventHandler, XMLMessageListener {

    JCSMPSession session = null;
    XMLMessageProducer producer = null;
    XMLMessageConsumer consumer = null;
    final ObjectMapper mapper = new ObjectMapper();
    JCSMPFactory jcsmpFactory = JCSMPFactory.onlyInstance();

    public static class SubManRequest {

        private String username;
        private String clientName;

        public String getUsername() {
            return username;
        }

        public String getClientName() {
            return clientName;
        }

    }

    public class SubManResponse {
        private List<String> subscriptions;

        public SubManResponse() {
            subscriptions = new ArrayList<String>();
        }

        public List<String> getSubscriptions() {
            return subscriptions;
        }

        public void addSubscription(String subscription) {
            subscriptions.add(subscription);
        }

    }

    public SubscriptionManager(String username, String password, String host, String vpn) {
        JCSMPProperties properties = new JCSMPProperties();
        properties.setProperty(JCSMPProperties.HOST, host); // host:port
        properties.setProperty(JCSMPProperties.USERNAME, username); // client-username
        properties.setProperty(JCSMPProperties.PASSWORD, password); // client-password
        properties.setProperty(JCSMPProperties.VPN_NAME, vpn); // message-vpn

        try {
            session = jcsmpFactory.createSession(properties, null, this);
            session.connect();
            producer = session.getMessageProducer(new JCSMPStreamingPublishCorrelatingEventHandler() {

                @Override
                public void handleErrorEx(Object key, JCSMPException cause, long timestamp) {
                    System.out
                            .println(" Error occurred for message with key " + key + " at " + timestamp + ". " + cause);
                }

                @Override
                public void responseReceivedEx(Object key) {
                    System.out.println("Response received for message with key " + key);
                }

            });

            addSubscriptionManagerRequestSubscription();
            consumer = session.getMessageConsumer(this);
            consumer.start();

        } catch (JCSMPException e) {
            System.out.println("Error connecting to Solace message broker.");
            e.printStackTrace();
        }

    }

    public void addSubscriptionManagerRequestSubscription() throws JCSMPException {
        System.out.println("Adding subscription manager request subscription on topic topic/request/*");
        session.addSubscription(jcsmpFactory.createTopic("topic/request/*"), true);

    }

    public static void main(String[] args) {
        Properties properties = new Properties();
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        try (InputStream fileInputStream = loader.getResourceAsStream("solace.properties")) {
            properties.load(fileInputStream);

            String username = properties.getProperty("solace.username");
            String password = properties.getProperty("solace.password");
            String host = properties.getProperty("solace.host");
            String vpn = properties.getProperty("solace.vpn");

            new SubscriptionManager(username, password, host, vpn);

            Scanner scanner = new Scanner(System.in);
            System.out.println("Enter something:");
            scanner.nextLine();
            System.out.println("exiting...");
            scanner.close();

        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    @Override
    public void handleEvent(SessionEventArgs event) {
        System.out.println("Session event: " + event.getEvent());
    }

    @Override
    public void onException(JCSMPException exception) {
        System.out.println("Exception: " + exception);
    }

    @Override
    public void onReceive(BytesXMLMessage message) {
        System.out.println("Received a request...");
        byte[] bytes = new byte[message.getAttachmentContentLength()];
        message.readAttachmentBytes(bytes);
        String requestString = new String(bytes);
        System.out.println(requestString);
        try {
            SubManRequest subManRequest = mapper.readValue(requestString, SubManRequest.class);
            System.out.println(
                    "Received a SubMan request: " + subManRequest.getUsername() + " " + subManRequest.getClientName());

            /**
             * Validate the request,do lookup etc
             */

            ClientName clientName = jcsmpFactory.createClientName(subManRequest.getClientName());
            Topic billTopic = jcsmpFactory.createTopic("topic1/*");
            Topic bondTopic = jcsmpFactory.createTopic("topic2/*");
            Topic noteTopic = jcsmpFactory.createTopic("topic3/*");

            SubManResponse response = new SubManResponse();
            response.addSubscription("topic1/*");
            response.addSubscription("topic2/*");
            response.addSubscription("topic3/*");

            System.out.println("Adding topic 1,2,3 subscription on behalf of " + subManRequest.getUsername());
            session.addSubscription(clientName, billTopic, JCSMPSession.WAIT_FOR_CONFIRM);
            session.addSubscription(clientName, noteTopic, JCSMPSession.WAIT_FOR_CONFIRM);
            session.addSubscription(clientName, bondTopic, JCSMPSession.WAIT_FOR_CONFIRM);

            Message replyMessage = jcsmpFactory.createMessage(TextMessage.class);
            replyMessage.writeAttachment(mapper.writeValueAsBytes(response));

            producer.sendReply(message, replyMessage);
        } catch (IOException e) {
            System.out.println(e);
        } catch (JCSMPException e) {
            System.out.println(e);
        }
    }
}
