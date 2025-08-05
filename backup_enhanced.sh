#!/bin/bash

# Enhanced backup script with error handling and logging
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

LOG_FILE="backup_$(date +%Y%m%d_%H%M%S).log"
ERROR_COUNT=0
SUCCESS_COUNT=0

# Function to log messages
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to handle errors
handle_error() {
    local error_msg="$1"
    local table_name="$2"
    ERROR_COUNT=$((ERROR_COUNT + 1))
    log_message "ERROR: $error_msg for table: $table_name"
}

# Function to validate database connection
validate_connection() {
    local host=$1
    local port=$2
    local user=$3
    local password=$4
    local database=$5
    local db_type=$6
    
    log_message "Validating $db_type database connection..."
    if PGPASSWORD=$password psql -h $host -p $port -U $user -d $database -c '\q' 2>/dev/null; then
        log_message "✓ $db_type database connection successful"
        return 0
    else
        log_message "✗ $db_type database connection failed"
        return 1
    fi
}

# Function to create backup database schema if not exists
setup_backup_database() {
    log_message "Setting up backup database..."
    PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -c "
        CREATE SCHEMA IF NOT EXISTS backup_info;
        
        CREATE TABLE IF NOT EXISTS backup_info.backup_status (
            table_name VARCHAR(255) PRIMARY KEY,
            last_backup_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            row_count INTEGER DEFAULT 0,
            status VARCHAR(50) DEFAULT 'unknown'
        );
        
        CREATE TABLE IF NOT EXISTS backup_info.backup_log (
            id SERIAL PRIMARY KEY,
            table_name VARCHAR(255),
            operation VARCHAR(50),
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(50),
            error_message TEXT
        );
    " 2>/dev/null
}

# Function to backup a single table with progress tracking
backup_table() {
    local table=$1
    log_message "Processing table: $table"
    
    # Record start of backup
    PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -c "
        INSERT INTO backup_info.backup_log (table_name, operation, status) 
        VALUES ('$table', 'backup', 'started')
        ON CONFLICT DO NOTHING;
    " 2>/dev/null
    
    # Get row count from primary
    log_message "Counting rows in primary table: $table"
    local primary_count
    primary_count=$(PGPASSWORD=$PRIMARY_PASSWORD psql -h $PRIMARY_HOST -p $PRIMARY_PORT -U $PRIMARY_USER -d $PRIMARY_DB -t -c "SELECT COUNT(*) FROM \"$table\";" 2>/dev/null | tr -d ' ')
    
    if [ -z "$primary_count" ] || [ "$primary_count" = "" ]; then
        handle_error "Failed to get row count from primary database" "$table"
        return 1
    fi
    
    log_message "Primary table $table has $primary_count rows"
    
    # Get table structure
    log_message "Getting structure for table: $table"
    PGPASSWORD=$PRIMARY_PASSWORD pg_dump -h $PRIMARY_HOST -p $PRIMARY_PORT -U $PRIMARY_USER -d $PRIMARY_DB -t "$table" --schema-only --no-owner --no-privileges > "${table}_schema.sql" 2>/dev/null
    
    if [ ! -f "${table}_schema.sql" ]; then
        handle_error "Failed to export schema" "$table"
        return 1
    fi
    
    # Create table in backup database (ignore errors if table exists)
    log_message "Creating/updating table structure in backup database: $table"
    PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -f "${table}_schema.sql" 2>/dev/null
    
    # Export data using COPY for better performance
    log_message "Exporting data for table: $table"
    PGPASSWORD=$PRIMARY_PASSWORD psql -h $PRIMARY_HOST -p $PRIMARY_PORT -U $PRIMARY_USER -d $PRIMARY_DB -c "\\copy (SELECT * FROM \"$table\") TO '${table}_data.csv' WITH CSV HEADER;" 2>/dev/null
    
    if [ ! -f "${table}_data.csv" ]; then
        handle_error "Failed to export data" "$table"
        rm -f "${table}_schema.sql"
        return 1
    fi
    
    # Check if CSV file has data
    local csv_lines
    csv_lines=$(wc -l < "${table}_data.csv")
    log_message "Exported $csv_lines lines (including header) for table: $table"
    
    # Import data to backup database with conflict resolution
    if [ -f "${table}_data.csv" ] && [ "$csv_lines" -gt 1 ]; then
        log_message "Importing data to backup database: $table"
        
        # Truncate table first for clean import
        PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -c "TRUNCATE TABLE \"$table\" CASCADE;" 2>/dev/null
        
        # Import data
        PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -c "\\copy \"$table\" FROM '${table}_data.csv' WITH CSV HEADER;" 2>/dev/null
        
        if [ $? -eq 0 ]; then
            # Verify import
            local backup_count
            backup_count=$(PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -t -c "SELECT COUNT(*) FROM \"$table\";" 2>/dev/null | tr -d ' ')
            
            if [ "$backup_count" = "$primary_count" ]; then
                log_message "✓ Successfully backed up table: $table ($backup_count rows)"
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
                
                # Update backup status
                PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -c "
                    INSERT INTO backup_info.backup_status (table_name, last_backup_time, row_count, status) 
                    VALUES ('$table', CURRENT_TIMESTAMP, $backup_count, 'success')
                    ON CONFLICT (table_name) DO UPDATE SET 
                        last_backup_time = CURRENT_TIMESTAMP,
                        row_count = $backup_count,
                        status = 'success';
                        
                    INSERT INTO backup_info.backup_log (table_name, operation, status) 
                    VALUES ('$table', 'backup', 'completed');
                " 2>/dev/null
            else
                handle_error "Row count mismatch: primary=$primary_count, backup=$backup_count" "$table"
            fi
        else
            handle_error "Failed to import data" "$table"
        fi
    elif [ "$csv_lines" -eq 1 ]; then
        log_message "✓ Table $table is empty - backup completed"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        handle_error "CSV file is empty or corrupted" "$table"
    fi
    
    # Clean up temporary files
    rm -f "${table}_schema.sql" "${table}_data.csv"
}

# Main execution
main() {
    log_message "=== Starting enhanced database backup ==="
    log_message "Log file: $LOG_FILE"
    
    # Validate connections
    if ! validate_connection "$PRIMARY_HOST" "$PRIMARY_PORT" "$PRIMARY_USER" "$PRIMARY_PASSWORD" "$PRIMARY_DB" "primary"; then
        log_message "Failed to connect to primary database. Exiting."
        exit 1
    fi
    
    if ! validate_connection "$BACKUP_HOST" "$BACKUP_PORT" "$BACKUP_USER" "$BACKUP_PASSWORD" "$BACKUP_DB" "backup"; then
        log_message "Failed to connect to backup database. Exiting."
        exit 1
    fi
    
    # Setup backup database
    setup_backup_database
    
    # Get list of all tables from primary database
    log_message "Getting list of tables from primary database..."
    PGPASSWORD=$PRIMARY_PASSWORD psql -h $PRIMARY_HOST -p $PRIMARY_PORT -U $PRIMARY_USER -d $PRIMARY_DB -t -c "
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename NOT LIKE 'pg_%' 
        AND tablename NOT LIKE 'backup_info_%'
        ORDER BY tablename;
    " | grep -v '^$' | sed 's/^ *//' > tables_list.txt
    
    if [ ! -s tables_list.txt ]; then
        log_message "No tables found to backup. Exiting."
        exit 1
    fi
    
    local total_tables
    total_tables=$(wc -l < tables_list.txt)
    log_message "Found $total_tables tables to backup"
    
    # Process each table
    local current_table=0
    while IFS= read -r table; do
        if [ ! -z "$table" ]; then
            current_table=$((current_table + 1))
            log_message "Progress: $current_table/$total_tables"
            backup_table "$table"
        fi
    done < tables_list.txt
    
    # Final summary
    log_message "=== Backup Summary ==="
    log_message "Total tables processed: $total_tables"
    log_message "Successful backups: $SUCCESS_COUNT"
    log_message "Failed backups: $ERROR_COUNT"
    log_message "Success rate: $(( SUCCESS_COUNT * 100 / total_tables ))%"
    
    # Record overall backup completion
    PGPASSWORD=$BACKUP_PASSWORD psql -h $BACKUP_HOST -p $BACKUP_PORT -U $BACKUP_USER -d $BACKUP_DB -c "
        INSERT INTO backup_info.backup_log (table_name, operation, status) 
        VALUES ('ALL_TABLES', 'full_backup', 'completed');
    " 2>/dev/null
    
    # Cleanup
    rm -f tables_list.txt
    
    if [ $ERROR_COUNT -eq 0 ]; then
        log_message "✓ All backups completed successfully!"
        exit 0
    else
        log_message "⚠ Backup completed with $ERROR_COUNT errors. Check log for details."
        exit 1
    fi
}

# Execute main function
main "$@"
