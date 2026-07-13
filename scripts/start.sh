#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

mv /vault/secrets/.env.staging $WORKDIR/staging/.env.staging
mv /vault/secrets/.env.production $WORKDIR/production/.env.production

node $WORKDIR/${NAMESPACE}-server.js
