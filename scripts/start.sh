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

# 896 leaves ~128Mi headroom below k8s/values.yaml's 1Gi pod memory limit
# for non-heap overhead (Node itself, native buffers, etc.) — bumped in
# tandem with that limit, see its comment for why.
node --max-old-space-size=896 $WORKDIR/$NAMESPACE-server.js
