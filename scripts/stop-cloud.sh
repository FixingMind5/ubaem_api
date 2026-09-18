#!/bin/bash

PROJECT="ubaem-650c6"
ZONE="us-central1-a"
VM="ubaem-dev-proxy"

echo "🛑 Cerrando entorno de desarrollo..."

if [ -f /tmp/ubaem-cloud-tunnel.pid ]; then
  PID=$(cat /tmp/ubaem-cloud-tunnel.pid)

  kill "$PID" 2>/dev/null || true

  rm /tmp/ubaem-cloud-tunnel.pid

  echo "✅ Túnel cerrado."
fi

echo "⏹ Apagando VM..."

gcloud compute instances stop "$VM" \
  --zone="$ZONE" \
  --project="$PROJECT"

echo "✅ Entorno UBAEM apagado."