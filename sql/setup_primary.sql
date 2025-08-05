-- Primary Database Setup for CDC
-- Run this on your primary PostgreSQL database

-- 1. Enable logical replication (requires superuser privileges)
-- Add to postgresql.conf:
-- wal_level = logical
-- max_replication_slots = 4
-- max_wal_senders = 4
-- Then restart PostgreSQL

-- 2. Create database and user if not exists
CREATE DATABASE IF NOT EXISTS primary_db;
CREATE USER IF NOT EXISTS postgres WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE primary_db TO postgres;

-- 3. Connect to primary_db and create tables
\c primary_db;

-- Create users table
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

-- 4. Create logical replication slot
-- This will be created automatically by the CDC service, but you can create it manually:
-- SELECT pg_create_logical_replication_slot('cdc_backup_slot', 'wal2json');

-- 5. Grant necessary permissions
GRANT REPLICATION ON DATABASE primary_db TO postgres;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO postgres;

-- 6. Insert sample data for testing
INSERT INTO users (name, email, age) VALUES 
('John Doe', 'john@example.com', 30),
('Jane Smith', 'jane@example.com', 25),
('Bob Johnson', 'bob@example.com', 35)
ON CONFLICT (email) DO NOTHING;
