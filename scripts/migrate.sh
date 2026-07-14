#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

mv /vault/secrets/.env.${NAMESPACE} $WORKDIR/.env.${NAMESPACE}

ls -la /app/node_modules
ls -la /app/node_modules/@prisma

npm run db:migrate
