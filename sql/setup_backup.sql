-- Backup Database Setup
-- Run this on your backup PostgreSQL database

-- 1. Connect to backup_db
\c backup_db;

-- 2. Create the same table structure as primary
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    age INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions to backup_user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO backup_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO backup_user;
