#!/usr/bin/env bash
# ==============================================================================
# One-Click Production Deployment Script
# TIHC Dissemination Monitoring & Reporting Platform
# ==============================================================================
set -e

echo "=== [1/4] Checking System Prerequisites ==="
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    DEPLOY_MODE="docker"
    echo "Found Docker & Docker Compose. Using Containerized Deployment."
elif command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 22 ]; then
        DEPLOY_MODE="node"
        echo "Found Node.js $NODE_VERSION (>= 22). Using Direct Node Deployment."
    else
        echo "Error: Node.js 22 or higher is required for built-in SQLite support. Found: $(node -v)"
        exit 1
    fi
else
    echo "Error: Neither Docker nor Node.js 22+ was found on this system."
    echo "Please install Docker (recommended) or Node.js 22+ to continue."
    exit 1
fi

echo "=== [2/4] Ensuring Data & Upload Directories ==="
mkdir -p data uploads/inbound uploads/custom exports

echo "=== [3/4] Launching TIHC Platform ==="
if [ "$DEPLOY_MODE" = "docker" ]; then
    echo "Building and starting Docker containers..."
    docker-compose up -d --build
    echo "Checking health..."
    sleep 5
    docker-compose ps
else
    echo "Starting Node.js application in background..."
    if command -v pm2 &> /dev/null; then
        pm2 start server.js --name "tihc-dissemination" || pm2 restart "tihc-dissemination"
        pm2 save
    else
        nohup node server.js > platform.log 2>&1 &
        echo "Started server.js (PID: $!). Logs written to platform.log."
    fi
fi

echo "=== [4/4] Deployment Complete! ==="
echo "Access the platform locally at: http://localhost:3080"
echo "Healthcheck: http://localhost:3080/api/health"
echo "Don't forget to configure your Nginx/Caddy reverse proxy and SSL!"

