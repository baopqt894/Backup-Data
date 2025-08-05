-- Setup script for database permissions and initial configuration

-- Connect to the primary database first
\c mattermost_test;

-- Grant necessary permissions to backup user
GRANT CONNECT ON DATABASE mattermost_test TO mmuser;
GRANT USAGE ON SCHEMA public TO mmuser;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mmuser;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO mmuser;

-- Grant permissions for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT SELECT ON TABLES TO mmuser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT SELECT ON SEQUENCES TO mmuser;

-- Create backup schema info tables if not exists
CREATE SCHEMA IF NOT EXISTS backup_info;

-- Create backup status table
CREATE TABLE IF NOT EXISTS backup_info.backup_status (
    table_name VARCHAR(255) PRIMARY KEY,
    last_backup_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    row_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'unknown',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create backup log table
CREATE TABLE IF NOT EXISTS backup_info.backup_log (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(255),
    operation VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50),
    error_message TEXT,
    execution_time_ms INTEGER
);

-- Grant permissions on backup_info schema
GRANT USAGE ON SCHEMA backup_info TO mmuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA backup_info TO mmuser;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA backup_info TO mmuser;

-- Switch to backup database
\c backup_db;

-- Grant all permissions to backup user on backup database
GRANT ALL PRIVILEGES ON DATABASE backup_db TO mmuser;
GRANT ALL PRIVILEGES ON SCHEMA public TO mmuser;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mmuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mmuser;

-- Grant permissions for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT ALL PRIVILEGES ON TABLES TO mmuser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT ALL PRIVILEGES ON SEQUENCES TO mmuser;

-- Create backup info schema in backup database
CREATE SCHEMA IF NOT EXISTS backup_info;
GRANT ALL PRIVILEGES ON SCHEMA backup_info TO mmuser;

-- Create backup status table in backup database
CREATE TABLE IF NOT EXISTS backup_info.backup_status (
    table_name VARCHAR(255) PRIMARY KEY,
    last_backup_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    row_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'unknown',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create backup log table in backup database
CREATE TABLE IF NOT EXISTS backup_info.backup_log (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(255),
    operation VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50),
    error_message TEXT,
    execution_time_ms INTEGER
);

-- Grant permissions on backup_info tables
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA backup_info TO mmuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA backup_info TO mmuser;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_backup_status_table_name ON backup_info.backup_status(table_name);
CREATE INDEX IF NOT EXISTS idx_backup_status_last_backup ON backup_info.backup_status(last_backup_time);
CREATE INDEX IF NOT EXISTS idx_backup_log_table_name ON backup_info.backup_log(table_name);
CREATE INDEX IF NOT EXISTS idx_backup_log_timestamp ON backup_info.backup_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_backup_log_status ON backup_info.backup_log(status);

-- Insert initial status record
INSERT INTO backup_info.backup_log (table_name, operation, status) 
VALUES ('SYSTEM', 'setup', 'completed')
ON CONFLICT DO NOTHING;

-- Show success message
SELECT 'Database setup completed successfully!' as message;
