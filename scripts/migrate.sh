#!/usr/bin/bash

WORKDIR=/app
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

cp /vault/secrets/.env.$NAMESPACE $WORKDIR/.env.$NAMESPACE
set -a
source $WORKDIR/.env.$NAMESPACE
set +a

npx prisma generate
npm run db:migrate
