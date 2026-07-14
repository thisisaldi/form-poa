#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

mv /vault/secrets/.env.${NAMESPACE} $WORKDIR/${NAMESPACE}/.env.${NAMESPACE}

node $WORKDIR/${NAMESPACE}-server.js
