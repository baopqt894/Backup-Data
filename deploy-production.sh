#!/bin/bash

# Production Deployment Script for CDC Backup System

echo "🚀 Starting production deployment..."

# Stop current application
echo "⏹️ Stopping current application..."
pm2 stop Backup-Data

# Install dependencies (if package.json changed)
echo "📦 Installing dependencies..."
npm ci --only=production

# Build application
echo "🔨 Building application..."
npm run build

# Copy environment file if needed
if [ ! -f .env ]; then
    echo "⚠️ No .env file found. Please ensure production environment variables are set."
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
