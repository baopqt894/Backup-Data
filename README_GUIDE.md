# NestJS CDC Backup System

Hệ thống backup dữ liệu tự động sử dụng NestJS với Change Data Capture (CDC) và scheduled backup.

## Tính năng

### 🔄 Backup Tự động
- **CDC Real-time Sync**: Theo dõi thay đổi mỗi 30 giây cho 25 tables có timestamp
- **Scheduled Backup**: Backup toàn bộ mỗi giờ cho tất cả 100 tables
- **Manual Backup**: Kích hoạt backup thủ công qua API
- **Incremental Sync**: CDC chỉ sync records thay đổi, tiết kiệm bandwidth
- **Batch Processing**: Xử lý dữ liệu theo batch để tối ưu performance

### 📊 Monitoring & Health Check
- **Real-time Health Monitoring**: Theo dõi trạng thái backup liên tục
- **Detailed Reports**: Báo cáo chi tiết về backup status
- **Error Tracking**: Ghi lại và theo dõi các lỗi
- **Metrics**: Thu thập metrics về backup performance

### 🗄️ Database Support
- Hỗ trợ PostgreSQL
- Backup từ primary database sang backup database
- Maintain schema và constraints
- Support multiple tables

## Cài đặt

### Prerequisites
- Node.js >= 16
- PostgreSQL >= 12
- npm hoặc yarn

### Installation
```bash
# Clone repository
git clone <repository-url>
cd nest-cdc-backup

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env file với database configurations
```

### Database Setup
```bash
# Setup primary database
psql -h <PRIMARY_HOST> -U <PRIMARY_USER> -d <PRIMARY_DB> -f setup-primary-db.sql

# Setup backup database
psql -h <BACKUP_HOST> -U <BACKUP_USER> -d <BACKUP_DB> -f sql/setup_backup.sql
```

## Configuration

### Environment Variables
```env
# Primary Database
PRIMARY_DB_HOST=localhost
PRIMARY_DB_PORT=5432
PRIMARY_DB_USER=postgres
PRIMARY_DB_PASSWORD=password
PRIMARY_DB_NAME=mattermost_test

# Backup Database
BACKUP_DB_HOST=localhost
BACKUP_DB_PORT=5432
BACKUP_DB_USER=postgres
BACKUP_DB_PASSWORD=password
BACKUP_DB_NAME=backup_db

# Application
NODE_ENV=development
LOG_LEVEL=info
BACKUP_INTERVAL_MINUTES=60
BACKUP_BATCH_SIZE=1000
BACKUP_RETENTION_DAYS=30
```

## Sử dụng

### Start Application
```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

### API Endpoints

#### Backup Operations
```bash
# Trigger manual backup cho tất cả tables
POST /backup/manual

# Backup specific table
POST /backup/manual?table=users

# Force recreate table structure
POST /backup/manual?force=true

# Get backup status
GET /backup/status
```

#### CDC Operations
```bash
# CDC health status
GET /cdc/health

# Force sync specific table
POST /cdc/sync/table_name
```

#### Monitoring
```bash
# Health status
GET /monitoring/health

# Detailed metrics
GET /monitoring/metrics

# Application health
GET /health
```

### Example Responses

#### Backup Status
```json
{
  "success": true,
  "data": {
    "timestamp": "2025-08-04T07:30:00.000Z",
    "total_tables": 45,
    "backed_up_tables": 43,
    "missing_tables": ["temp_table1", "temp_table2"],
    "table_stats": [
      {
        "table_name": "users",
        "row_count": 1250
      }
    ]
  }
}
```

#### Health Monitoring
```json
{
  "success": true,
  "data": {
    "backup_health": "healthy",
    "total_tables": 45,
    "backed_up_tables": 43,
    "coverage_percentage": 96,
    "last_backup_time": "2025-08-04T06:00:00.000Z",
    "errors": [],
    "uptime_seconds": 3600,
    "memory_usage": {
      "rss": 52428800,
      "heapTotal": 26066944,
      "heapUsed": 15953120
    }
  }
}
```

## Backup Scheduling

### Automatic Schedules
- **CDC Monitoring**: Mỗi 30 giây (real-time change detection)
- **Hourly Backup**: Mỗi giờ (full backup tất cả tables)
- **Daily Full Backup**: 2:00 AM hàng ngày (với cleanup)
- **Health Check**: Mỗi 5 phút
- **Daily Report**: 6:00 AM hàng ngày

### Backup Strategy
1. **CDC Real-time**: 25 tables với `updateat` column được sync ngay khi có thay đổi
2. **Hourly Full**: Tất cả 100 tables được backup đầy đủ mỗi giờ
3. **Daily Cleanup**: Xóa backup cũ sau 30 ngày

### Manual Backup Script
```bash
# Run enhanced backup script
./backup_enhanced.sh

# Script sẽ tạo log file với format: backup_YYYYMMDD_HHMMSS.log
```

## Monitoring & Logging

### Log Files
- `logs/application-YYYY-MM-DD.log`: Application logs
- `logs/error-YYYY-MM-DD.log`: Error logs
- `backup_*.log`: Backup script logs

### Monitoring Features
- Database connection health
- Backup coverage percentage
- Last backup timestamp
- Error tracking
- Performance metrics

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   ```bash
   # Check database connectivity
   psql -h <HOST> -U <USER> -d <DATABASE> -c '\l'
   ```

2. **Table Not Found**
   - Verify table exists in primary database
   - Check table permissions

3. **Schema Mismatch**
   - Run backup with `force=true` to recreate schema
   - Check for DDL changes in primary database

4. **Performance Issues**
   - Adjust `BACKUP_BATCH_SIZE` in environment
   - Monitor database resources
   - Check network latency between databases

### Debug Mode
```bash
# Enable debug logging
NODE_ENV=development LOG_LEVEL=debug npm run start:dev
```

## Quick Start Guide

1. **Cài đặt và khởi chạy**:
```bash
npm install
cp .env.example .env
# Chỉnh sửa .env với thông tin database
npm run start:dev
```

2. **Test backup thủ công**:
```bash
curl -X POST http://localhost:3000/backup/manual
```

3. **Kiểm tra backup status**:
```bash
curl http://localhost:3000/backup/status
```

4. **Xem monitoring health**:
```bash
curl http://localhost:3000/monitoring/health
```

5. **Kiểm tra CDC status**:
```bash
curl http://localhost:3000/cdc/health
```

## License

Private project - All rights reserved.
