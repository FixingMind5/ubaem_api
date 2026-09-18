#!/bin/bash

set -e

PROJECT="ubaem-650c6"
ZONE="us-central1-a"
VM="ubaem-dev-proxy"
INSTANCE_CONNECTION_NAME="ubaem-650c6:us-central1:ubaem"
LOCAL_PORT="5432"

echo "🚀 Preparando entorno UBAEM..."

# --------------------------------------------------
# 1. Comprobar / encender VM
# --------------------------------------------------

STATUS=$(gcloud compute instances describe "$VM" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --format="value(status)")

if [ "$STATUS" != "RUNNING" ]; then
  echo "▶️ Encendiendo VM..."

  gcloud compute instances start "$VM" \
    --zone="$ZONE" \
    --project="$PROJECT"

  echo "⏳ Esperando a que arranque..."
  sleep 10
else
  echo "✅ VM ya está encendida."
fi

# --------------------------------------------------
# 2. Levantar Cloud SQL Auth Proxy en la VM
# --------------------------------------------------

echo "🔌 Levantando Cloud SQL Auth Proxy..."

gcloud compute ssh "$VM" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap \
  --command="
    pkill -x cloud-sql-proxy || true

    nohup ~/cloud-sql-proxy \
      --private-ip \
      --address 127.0.0.1 \
      --port 5432 \
      $INSTANCE_CONNECTION_NAME \
      > ~/cloud-sql-proxy.log 2>&1 < /dev/null &
  "

echo "✅ Cloud SQL Proxy iniciado."

sleep 2

# --------------------------------------------------
# 3. Cerrar túnel anterior si existe
# --------------------------------------------------

if [ -f /tmp/ubaem-cloud-tunnel.pid ]; then
  OLD_PID=$(cat /tmp/ubaem-cloud-tunnel.pid)

  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "♻️ Cerrando túnel anterior..."
    kill "$OLD_PID" || true
  fi

  rm -f /tmp/ubaem-cloud-tunnel.pid
fi

# --------------------------------------------------
# 4. Crear túnel SSH/IAP
# --------------------------------------------------

echo "🌉 Creando túnel localhost:$LOCAL_PORT → VM..."

nohup gcloud compute ssh "$VM" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap \
  -- \
  -N \
  -L "$LOCAL_PORT:127.0.0.1:5432" \
  > /tmp/ubaem-tunnel.log 2>&1 &

TUNNEL_PID=$!

echo "$TUNNEL_PID" > /tmp/ubaem-cloud-tunnel.pid

sleep 4

# --------------------------------------------------
# 5. Verificar que siga vivo
# --------------------------------------------------

if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
  echo "❌ El túnel SSH no pudo iniciarse."
  echo ""
  cat /tmp/ubaem-tunnel.log
  exit 1
fi

# --------------------------------------------------
# 6. Verificar puerto local
# --------------------------------------------------

if ! lsof -nP -iTCP:$LOCAL_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "❌ No hay ningún proceso escuchando en localhost:$LOCAL_PORT."
  echo ""
  cat /tmp/ubaem-tunnel.log

  kill "$TUNNEL_PID" 2>/dev/null || true
  exit 1
fi

echo ""
echo "✅ Entorno de desarrollo listo."
echo ""
echo "VM:       $VM"
echo "Postgres: localhost:$LOCAL_PORT"
echo ""
echo "Ahora puedes ejecutar:"
echo ""
echo "  npm run dev"
echo ""
echo "Postman:"
echo ""
echo "  http://localhost:8080"