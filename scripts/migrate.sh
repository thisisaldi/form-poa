#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

cp /vault/secrets/.env.${NAMESPACE} $WORKDIR/.env.${NAMESPACE}

npx prisma generate
npm run db:migrate
