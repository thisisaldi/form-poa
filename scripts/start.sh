#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

cp /vault/secrets/.env.${NAMESPACE} $WORKDIR/.env.${NAMESPACE}

node $WORKDIR/${NAMESPACE}-server.js
