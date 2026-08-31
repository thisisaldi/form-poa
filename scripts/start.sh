#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

cp "/vault/secrets/.env.$NAMESPACE" "$WORKDIR/.env.$NAMESPACE"
mkdir -p $WORKDIR/assets/serviceaccounts && \
  cp "/vault/secrets/$NAMESPACE.json" \
     "$WORKDIR/assets/serviceaccounts/$NAMESPACE.json"

set -a
source $WORKDIR/.env.$NAMESPACE
set +a

node --max-old-space-size=512 $WORKDIR/$NAMESPACE-server.js
