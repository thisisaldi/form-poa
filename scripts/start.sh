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

# 1792 leaves ~256Mi headroom below k8s/values.yaml's 2Gi pod memory limit
# for non-heap overhead (Node itself, native buffers, etc.) — bumped in
# tandem with that limit (2026-10-12, was 896/1Gi), see its comment for why.
node --max-old-space-size=1792 $WORKDIR/$NAMESPACE-server.js
