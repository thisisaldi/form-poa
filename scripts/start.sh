#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

cp /vault/secrets/.env.$NAMESPACE $WORKDIR/.env.$NAMESPACE
set -a
# shellcheck source=/dev/null
source $WORKDIR/.env.$NAMESPACE
set +a

node $WORKDIR/$NAMESPACE-server.js
