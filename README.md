# OBO Sample Application

This is a sample application that demonstrates an OBO Backend with the Solace JCSMP API and an OBO Client using the Solace JavaScript API

The app consists of two components.

## subscription-manager

This is a Java Backend that uses a Subscription Manager user to receive requests and inject subscriptions into the client's session

## web-app

This is an HTML/JavaScript front end that uses the Solace JavaScript APIs to receive messages from Solace.

Start it by running `npm run start`