#!/bin/bash

# Configuration
PRIMARY_HOST="185.111.159.86"
PRIMARY_PORT="5432"
PRIMARY_USER="mmuser"
PRIMARY_PASSWORD="mostest"
PRIMARY_DB="mattermost_test"

BACKUP_HOST="185.111.159.86"
BACKUP_PORT="5432"
BACKUP_USER="mmuser"
BACKUP_PASSWORD="mostest"
BACKUP_DB="backup_db"

echo "Starting full database backup..."

# Get list of all tables from primary database
echo "Getting list of tables..."
PGPASSWORD=$PRIMARY_PASSWORD psql -h $PRIMARY_HOST -p $PRIMARY_PORT -U $PRIMARY_USER -d $PRIMARY_DB -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'pg_%' ORDER BY tablename;" | grep -v '^$' | sed 's/^ *//' > tables_list.txt

# Read tables and backup each one
while IFS= read -r table; do
    if [ ! -z "$table" ]; then
        echo "Processing table: $table"
        
        # Get table structure
        echo "Getting structure for table: $table"
        PGPASSWORD=$PRIMARY_PASSWORD pg_dump -h $PRIMARY_HOST -p $PRIMARY_PORT -U $PRIMARY_USER -d $PRIMARY_DB -t $table --schema-only --no-owner --no-privileges > "${table}_schema.sql" 2>/dev/null
        
        # Create table in backup database (ignore errors if table exists)
        echo "Creating table in backup database: $table"
        PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -f "${table}_schema.sql" 2>/dev/null
        
        # Copy data
        echo "Copying data for table: $table"
        PGPASSWORD=$PRIMARY_PASSWORD psql -h $PRIMARY_HOST -p $PRIMARY_PORT -U $PRIMARY_USER -d $PRIMARY_DB -c "\copy (SELECT * FROM $table) TO '${table}_data.csv' WITH CSV HEADER;" 2>/dev/null
        
        # Import data to backup database
        if [ -f "${table}_data.csv" ]; then
            PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -c "\copy $table FROM '${table}_data.csv' WITH CSV HEADER;" 2>/dev/null
            echo "✓ Completed backup for table: $table"
        else
            echo "✗ Failed to export data for table: $table"
        fi
        
        # Clean up temporary files
        rm -f "${table}_schema.sql" "${table}_data.csv"
    fi
done < tables_list.txt

echo "Backup completed!"

# Clean up
rm -f tables_list.txt
