-- Fix permissions for backup user
-- Connect to backup_db as postgres user

-- Grant necessary privileges to backup_user
ALTER USER backup_user CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE backup_db TO backup_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO backup_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO backup_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO backup_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO backup_user;

-- Grant default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO backup_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO backup_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO backup_user;

-- Make backup_user owner of the backup_db database (optional but helps)
-- ALTER DATABASE backup_db OWNER TO backup_user;

-- Grant replication privilege for CDC
ALTER USER backup_user REPLICATION;

-- For primary database, grant SELECT on all tables
-- This will be applied to primary database
-- \c mattermost_test
-- GRANT USAGE ON SCHEMA public TO backup_user;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_user;
