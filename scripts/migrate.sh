#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

mv /vault/secrets/.env.${NAMESPACE} $WORKDIR/.env.${NAMESPACE}

npx prisma migrate deploy
