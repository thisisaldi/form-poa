#!/usr/bin/bash

WORKDIR=/app

mv /vault/secrets/.env.staging $WORKDIR/staging/.env.staging
mv /vault/secrets/.env.production $WORKDIR/production/.env.production

npx prisma migrate deploy
