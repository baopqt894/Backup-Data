#!/bin/bash

# Production Deployment Script for CDC Backup System

echo "🚀 Starting production deployment..."

# Ensure we're in production mode
export NODE_ENV=production
export LOG_LEVEL=warn

# Stop current application
echo "⏹️ Stopping current application..."
pm2 stop Backup-Data

# Install dependencies (if package.json changed)
echo "📦 Installing dependencies..."
npm ci --only=production

# Build application
echo "🔨 Building application..."
npm run build

# Verify .env file has production settings
if [ ! -f .env ]; then
    echo "⚠️ No .env file found. Please ensure production environment variables are set."
else
    echo "✅ Environment file found - checking production settings..."
    # Ensure production settings are in .env
    if ! grep -q "NODE_ENV=production" .env; then
        echo "⚠️ Setting NODE_ENV=production in .env file..."
        sed -i 's/^# NODE_ENV=production/NODE_ENV=production/' .env
        sed -i 's/^NODE_ENV=development/# NODE_ENV=development/' .env
    fi
    if ! grep -q "LOG_LEVEL=warn" .env; then
        echo "⚠️ Setting LOG_LEVEL=warn in .env file..."
        sed -i 's/^# LOG_LEVEL=warn/LOG_LEVEL=warn/' .env
        sed -i 's/^LOG_LEVEL=log/# LOG_LEVEL=log/' .env
    fi
fi

# Start application with updated configuration
echo "▶️ Starting application with new configuration..."
pm2 start ecosystem.config.js

# Show status
echo "✅ Deployment completed!"
echo "📊 Application status:"
pm2 status

echo ""
echo "🔍 To check logs:"
echo "   pm2 logs Backup-Data"
echo ""
echo "📈 To monitor:"
echo "   pm2 monit"
