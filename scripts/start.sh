#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

cp /vault/secrets/.env.$NAMESPACE $WORKDIR/.env.$NAMESPACE
cp -r /vault/secrets/$NAMESPACE.json $WORKDIR/assets/serviceaccount/$NAMESPACE.json

set -a
# shellcheck source=/dev/null
source $WORKDIR/.env.$NAMESPACE
set +a

node --max-old-space-size=512 $WORKDIR/$NAMESPACE-server.js
