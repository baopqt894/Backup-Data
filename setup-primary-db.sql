-- Setup script for PostgreSQL Logical Replication
-- Run this on your PRIMARY database (mattermost_test)
-- This script only sets up CDC replication, does not create any new tables

-- 1. Enable logical replication (requires superuser privileges)
-- Add to postgresql.conf:
-- wal_level = logical
-- max_replication_slots = 4
-- max_wal_senders = 4
-- Then restart PostgreSQL

-- 2. Create replication slot
SELECT pg_create_logical_replication_slot('cdc_backup_slot', 'wal2json');

-- 3. Check if slot was created successfully
SELECT slot_name, plugin, slot_type, database, active, restart_lsn, confirmed_flush_lsn 
FROM pg_replication_slots 
WHERE slot_name = 'cdc_backup_slot';

-- 4. Grant necessary permissions to the replication user
GRANT USAGE ON SCHEMA public TO mmuser;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mmuser;
GRANT REPLICATION ON DATABASE mattermost_test TO mmuser;

-- 5. Enable REPLICA IDENTITY for existing tables (required for CDC)
-- This enables CDC to capture full row data for UPDATE/DELETE operations
-- Run this for each table you want to replicate

-- Example for common tables (adjust based on your actual tables):
-- ALTER TABLE users REPLICA IDENTITY FULL;
-- ALTER TABLE posts REPLICA IDENTITY FULL;
-- ALTER TABLE channels REPLICA IDENTITY FULL;

-- To see all tables in the database:
SELECT schemaname, tablename 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- 6. Test the replication slot (optional)
-- This command will show you the changes in JSON format
-- SELECT * FROM pg_logical_slot_get_changes('cdc_backup_slot', NULL, NULL);

-- 7. Useful queries for monitoring
-- Check replication lag:
-- SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lag
-- FROM pg_replication_slots WHERE slot_name = 'cdc_backup_slot';

-- Check replication slot status:
-- SELECT * FROM pg_replication_slots WHERE slot_name = 'cdc_backup_slot';

-- Drop slot if needed (for cleanup):
-- SELECT pg_drop_replication_slot('cdc_backup_slot');
