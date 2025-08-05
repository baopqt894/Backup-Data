import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class CdcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CdcService.name);
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    @InjectConnection('backup') private backupConnection: Connection,
    @InjectConnection() private primaryConnection: Connection,
  ) {}

  async onModuleInit() {
    this.logger.log('🔄 CDC Service initialized');
    await this.startChangeMonitoring();
    this.logger.log('👁️  Real-time change monitoring active (30s interval)');
  }

  onModuleDestroy() {
    this.stopChangeMonitoring();
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async monitorChanges() {
    if (!this.isMonitoring) return;
    
    try {
      await this.detectAndSyncChanges();
    } catch (error) {
      this.logger.error('Error monitoring changes:', error);
    }
  }

  private async startChangeMonitoring() {
    this.isMonitoring = true;
    this.logger.log('🎯 CDC monitoring started');
  }

  private stopChangeMonitoring() {
    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    this.logger.log('⏹️  CDC monitoring stopped');
  }

  private async detectAndSyncChanges() {
    try {
      // Get tables with timestamp columns for CDC
      const tables = await this.getTablesWithTimestamp();
      
      if (tables.length === 0) {
        return;
      }
      
      // Process tables concurrently but with limited concurrency
      const concurrencyLimit = 3;
      for (let i = 0; i < tables.length; i += concurrencyLimit) {
        const batch = tables.slice(i, i + concurrencyLimit);
        await Promise.allSettled(
          batch.map(async (table) => {
            try {
              await this.syncTableChanges(table);
            } catch (error) {
              this.logger.error(`Failed to sync table ${table}:`, error.message);
            }
          })
        );
      }
    } catch (error) {
      this.logger.error('Error in detectAndSyncChanges:', error.message);
      throw error;
    }
  }

  private async getTablesWithTimestamp(): Promise<string[]> {
    const queryRunner = this.primaryConnection.createQueryRunner();
    try {
      await queryRunner.connect();
      
      // Find tables with timestamp columns for tracking changes
      // Look for common timestamp column names
      const result = await queryRunner.query(`
        SELECT DISTINCT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name NOT LIKE 'pg_%'
        AND table_name NOT LIKE 'information_schema%'
        AND (
          column_name LIKE '%updated%' 
          OR column_name LIKE '%modified%' 
          OR column_name = 'updateat'
          OR column_name = 'updated_at'
          OR column_name = 'last_modified'
          OR column_name = 'last_updated'
        )
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone', 'bigint')
        ORDER BY table_name
      `);
      
      const tables = result.map(row => row.table_name);
      
      return tables;
    } catch (error) {
      this.logger.error('Error getting tables with timestamp columns:', error.message);
      return [];
    } finally {
      await queryRunner.release();
    }
  }

  private async syncTableChanges(tableName: string) {
    const primaryRunner = this.primaryConnection.createQueryRunner();
    const backupRunner = this.backupConnection.createQueryRunner();

    try {
      await primaryRunner.connect();
      await backupRunner.connect();

      // Enhanced table existence check with better error handling
      const primaryExists = await this.checkTableExists(primaryRunner, tableName);
      if (!primaryExists) {
        this.logger.debug(`Table ${tableName} does not exist in primary database, skipping sync`);
        return;
      }

      const backupExists = await this.checkTableExists(backupRunner, tableName);
      if (!backupExists) {
        // Optionally, you could auto-create the table here
        await this.handleMissingBackupTable(primaryRunner, backupRunner, tableName);
        return;
      }

      // Enhanced column existence check
      const hasUpdateAt = await this.checkColumnExists(primaryRunner, tableName, 'updateat');
      if (!hasUpdateAt) {
        return; // Skip silently if no updateat column
      }

      // Ensure backup table also has the updateat column
      const backupHasUpdateAt = await this.checkColumnExists(backupRunner, tableName, 'updateat');
      if (!backupHasUpdateAt) {
        return;
      }

      // Get and validate data types
      const primaryUpdateAtType = await this.getColumnDataType(primaryRunner, tableName, 'updateat');
      const backupUpdateAtType = await this.getColumnDataType(backupRunner, tableName, 'updateat');

      let lastSync;
      let query;
      
      // Handle different timestamp types with better error handling
      try {
        if (primaryUpdateAtType === 'bigint') {
          // For bigint timestamps (Unix timestamps)
          const lastSyncResult = await backupRunner.query(`
            SELECT COALESCE(MAX(updateat), 0) as last_sync
            FROM "${tableName}"
          `).catch((error) => {
            return [{ last_sync: 0 }];
          });
          
          lastSync = lastSyncResult[0].last_sync || 0;
          
          query = `
            SELECT * FROM "${tableName}" 
            WHERE updateat > $1
            ORDER BY updateat
            LIMIT 100
          `;
        } else {
          // For timestamp types
          const lastSyncResult = await backupRunner.query(`
            SELECT COALESCE(MAX(updateat), '1970-01-01'::timestamp) as last_sync
            FROM "${tableName}"
          `).catch((error) => {
            return [{ last_sync: '1970-01-01' }];
          });
          
          lastSync = lastSyncResult[0].last_sync || '1970-01-01';
          
          query = `
            SELECT * FROM "${tableName}" 
            WHERE updateat > $1::timestamp
            ORDER BY updateat
            LIMIT 100
          `;
        }

        // Get changed records with error handling
        const changedRecords = await primaryRunner.query(query, [lastSync]).catch((error) => {
          this.logger.error(`Failed to query changed records from ${tableName}:`, error.message);
          return [];
        });

        if (changedRecords.length > 0) {
          await this.upsertRecords(backupRunner, tableName, changedRecords);
          this.logger.log(`✅ CDC synced ${changedRecords.length} records for ${tableName}`);
        }

      } catch (error) {
        this.logger.error(`Error during data synchronization for ${tableName}:`, error.message);
        throw error;
      }

    } catch (error) {
      this.logger.error(`Failed to sync changes for table ${tableName}:`, {
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n') // Limit stack trace
      });
    } finally {
      await primaryRunner.release();
      await backupRunner.release();
    }
  }

  private async handleMissingBackupTable(primaryRunner: any, backupRunner: any, tableName: string) {
    try {
      
      // Get the CREATE TABLE statement from primary database
      const createTableQuery = await primaryRunner.query(`
        SELECT 
          'CREATE TABLE "' || table_name || '" (' ||
          string_agg(
            '"' || column_name || '" ' || 
            CASE 
              WHEN data_type = 'character varying' THEN 'varchar(' || COALESCE(character_maximum_length::text, '255') || ')'
              WHEN data_type = 'character' THEN 'char(' || COALESCE(character_maximum_length::text, '1') || ')'
              WHEN data_type = 'numeric' THEN 'numeric(' || COALESCE(numeric_precision::text, '10') || ',' || COALESCE(numeric_scale::text, '0') || ')'
              WHEN data_type = 'timestamp without time zone' THEN 'timestamp'
              WHEN data_type = 'timestamp with time zone' THEN 'timestamptz'
              WHEN data_type = 'USER-DEFINED' THEN 'text' -- Handle user-defined types as text
              ELSE data_type
            END ||
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
            ', '
          ) || ')' as create_statement
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      if (createTableQuery.length > 0) {
        try {
          await backupRunner.query(createTableQuery[0].create_statement);
          
          // Copy primary key constraints
          const pkConstraints = await primaryRunner.query(`
            SELECT constraint_name, column_name
            FROM information_schema.key_column_usage
            WHERE table_name = $1 AND table_schema = 'public'
            AND constraint_name LIKE '%_pkey'
          `, [tableName]);

          if (pkConstraints.length > 0) {
            const pkColumns = pkConstraints.map(row => `"${row.column_name}"`).join(', ');
            await backupRunner.query(`ALTER TABLE "${tableName}" ADD PRIMARY KEY (${pkColumns})`);
          }
          
        } catch (createError) {
          this.logger.error(`Failed to create table ${tableName} with generated SQL: ${createError.message}`);
          
          // Check if error is due to missing enum types
          if (createError.message.includes('does not exist') && createError.message.includes('type')) {
            try {
              // Copy enum types from primary to backup database
              await this.copyEnumTypes(primaryRunner, backupRunner, tableName);
              // Retry creating table after copying enum types
              await backupRunner.query(createTableQuery[0].create_statement);
            } catch (enumError) {
              // Fall back to simpler approach
              await this.createTableWithFallback(primaryRunner, backupRunner, tableName);
            }
          } else {
            // Try alternative approach for other errors
            await this.createTableWithFallback(primaryRunner, backupRunner, tableName);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to create backup table ${tableName}:`, error.message);
    }
  }

  private async checkTableExists(queryRunner: any, tableName: string): Promise<boolean> {
    try {
      const result = await queryRunner.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `, [tableName]);
      return result[0].exists;
    } catch (error) {
      this.logger.error(`Error checking if table ${tableName} exists:`, error.message);
      return false;
    }
  }

  private async checkColumnExists(queryRunner: any, tableName: string, columnName: string): Promise<boolean> {
    try {
      const result = await queryRunner.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = $1 
          AND column_name = $2
        )
      `, [tableName, columnName]);
      return result[0].exists;
    } catch (error) {
      this.logger.error(`Error checking if column ${columnName} exists in table ${tableName}:`, error.message);
      return false;
    }
  }

  private async getColumnDataType(queryRunner: any, tableName: string, columnName: string): Promise<string> {
    try {
      const result = await queryRunner.query(`
        SELECT data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1 
        AND column_name = $2
      `, [tableName, columnName]);
      return result[0]?.data_type || 'unknown';
    } catch (error) {
      this.logger.error(`Error getting data type for column ${columnName} in table ${tableName}:`, error.message);
      return 'unknown';
    }
  }

  private async getPrimaryKeyColumns(queryRunner: any, tableName: string): Promise<string[]> {
    try {
      const result = await queryRunner.query(`
        SELECT column_name
        FROM information_schema.key_column_usage
        WHERE table_name = $1 AND table_schema = 'public'
        AND constraint_name LIKE '%_pkey'
        ORDER BY ordinal_position
      `, [tableName]);

      return result.map(row => row.column_name);
    } catch (error) {
      this.logger.error(`Error getting primary key columns for table ${tableName}:`, error.message);
      return [];
    }
  }

  private async upsertRecords(queryRunner: any, tableName: string, records: any[]) {
    if (records.length === 0) return;

    try {
      // Get table schema information
      const tableSchema = await this.getTableSchema(queryRunner, tableName);
      if (!tableSchema || tableSchema.length === 0) {
        this.logger.error(`Unable to get schema for table ${tableName}`);
        return;
      }

      // Get primary key columns
      const pkColumns = await this.getPrimaryKeyColumns(queryRunner, tableName);
      
      // Process records in batches for better performance
      const batchSize = 50;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        await this.processBatch(queryRunner, tableName, batch, tableSchema, pkColumns);
      }

    } catch (error) {
      this.logger.error(`Failed to upsert records to ${tableName}:`, error.message);
      throw error;
    }
  }

  private async processBatch(
    queryRunner: any,
    tableName: string,
    records: any[],
    tableSchema: any[],
    pkColumns: string[]
  ) {
    // Create a map of column names to their data types
    const columnTypeMap = new Map();
    tableSchema.forEach(col => {
      columnTypeMap.set(col.column_name, col.data_type);
    });

    const columns = Object.keys(records[0]);
    const validColumns = columns.filter(col => columnTypeMap.has(col));
    
    if (validColumns.length === 0) {
      this.logger.warn(`No valid columns found for table ${tableName}`);
      return;
    }

    const columnNames = validColumns.map(col => `"${col}"`).join(', ');

    for (const record of records) {
      try {
        const placeholders = validColumns.map((_, i) => `$${i + 1}`).join(', ');
        const values = validColumns.map(col => {
          const dataType = columnTypeMap.get(col);
          return this.processColumnValue(record[col], dataType);
        });

        let sql: string;
        if (pkColumns.length > 0) {
          // UPSERT with ON CONFLICT
          const conflictTarget = pkColumns
            .filter(col => validColumns.includes(col))
            .map(col => `"${col}"`)
            .join(', ');
          
          if (conflictTarget) {
            const updateSet = validColumns
              .filter(col => !pkColumns.includes(col))
              .map(col => `"${col}" = EXCLUDED."${col}"`)
              .join(', ');

            sql = `
              INSERT INTO "${tableName}" (${columnNames}) 
              VALUES (${placeholders})
              ON CONFLICT (${conflictTarget}) 
              ${updateSet ? `DO UPDATE SET ${updateSet}` : 'DO NOTHING'}
            `;
          } else {
            // If primary key columns are not in the record, just insert
            sql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;
          }
        } else {
          // Fallback if no primary key - use INSERT IGNORE equivalent
          sql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        }

        await queryRunner.query(sql, values);
      } catch (error) {
        // Only log errors in development, not warnings in production
        this.logger.error(`Failed to upsert record in ${tableName}: ${error.message}`);
        // Continue with next record instead of failing completely
      }
    }
  }

  private processColumnValue(value: any, dataType: string): any {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle different PostgreSQL data types
    switch (dataType.toLowerCase()) {
      case 'bigint':
      case 'integer':
      case 'smallint':
        return typeof value === 'string' ? parseInt(value, 10) : value;
      
      case 'numeric':
      case 'decimal':
      case 'real':
      case 'double precision':
        return typeof value === 'string' ? parseFloat(value) : value;
      
      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1' || value === 't';
        }
        return Boolean(value);
      
      case 'timestamp without time zone':
      case 'timestamp with time zone':
      case 'date':
        if (typeof value === 'string' && !isNaN(Date.parse(value))) {
          return new Date(value);
        }
        return value;
      
      case 'json':
      case 'jsonb':
        if (typeof value === 'string') {
          try {
            // If it's already a valid JSON string, parse and re-stringify to ensure it's valid
            JSON.parse(value);
            return value;
          } catch {
            return value;
          }
        } else if (typeof value === 'object' || Array.isArray(value)) {
          // If it's an object or array, stringify it
          return JSON.stringify(value);
        }
        return value;
      
      case 'uuid':
      case 'text':
      case 'character varying':
      case 'varchar':
      case 'character':
      case 'char':
      default:
        return String(value);
    }
  }

  private sanitizeRecordForLogging(record: any): any {
    // Remove sensitive fields and limit size for logging
    const sanitized = { ...record };
    const sensitiveFields = ['password', 'token', 'secret', 'key'];
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    // Limit string lengths in logs
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 100) {
        sanitized[key] = sanitized[key].substring(0, 100) + '...';
      }
    });
    
    return sanitized;
  }

  private async getTableSchema(queryRunner: any, tableName: string): Promise<any[]> {
    try {
      const result = await queryRunner.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' 
        AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);
      return result;
    } catch (error) {
      this.logger.error(`Failed to get schema for table ${tableName}:`, error.message);
      return [];
    }
  }

  private async handleData(log: any) {
    // WARNING: This is a simplified parser for the 'test_decoding' output.
    // It is NOT robust and will fail on complex data types or statements.
    // For production, using wal2json is strongly recommended.
    const text = log.payload.toString();
    console.log('Received raw data:', text);

    const tableMatch = text.match(/table public\.(\w+): (\w+):/);
    if (!tableMatch) {
        console.log('Could not parse table and operation from:', text);
        return;
    }

    const [, tableName, operation] = tableMatch;
    const queryRunner = this.backupConnection.createQueryRunner();
    await queryRunner.connect();

    try {
        if (operation.toUpperCase() === 'INSERT') {
            const data = this.parseInsert(text);
            if (data) {
                const columns = Object.keys(data).join(', ');
                const values = Object.values(data);
                const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
                const sql = `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`;
                console.log(`Executing INSERT: ${sql} with values:`, values);
                await queryRunner.query(sql, values);
            }
        } else if (operation.toUpperCase() === 'UPDATE') {
            const { key, changes } = this.parseUpdate(text);
            if (key && changes) {
                const setClauses = Object.keys(changes).map((k, i) => `"${k}" = $${i + 1}`).join(', ');
                const whereClauses = Object.keys(key).map((k, i) => `"${k}" = $${i + 1 + Object.keys(changes).length}`).join(' AND ');
                const values = [...Object.values(changes), ...Object.values(key)];
                const sql = `UPDATE "${tableName}" SET ${setClauses} WHERE ${whereClauses}`;
                console.log(`Executing UPDATE: ${sql} with values:`, values);
                await queryRunner.query(sql, values);
            }
        } else if (operation.toUpperCase() === 'DELETE') {
            const key = this.parseDelete(text);
            if (key) {
                const whereClauses = Object.keys(key).map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
                const values = Object.values(key);
                const sql = `DELETE FROM "${tableName}" WHERE ${whereClauses}`;
                console.log(`Executing DELETE: ${sql} with values:`, values);
                await queryRunner.query(sql, values);
            }
        }
    } catch (error) {
        console.error('Error processing CDC data:', error);
    } finally {
        await queryRunner.release();
    }
  }

  private parseInsert(text: string): { [key: string]: any } | null {
      const dataMatch = text.match(/INSERT: (.*)/);
      if (!dataMatch) return null;
      return this.parseRowData(dataMatch[1]);
  }

  private parseUpdate(text: string): { key: { [key: string]: any } | null, changes: { [key: string]: any } | null } {
      const oldDataMatch = text.match(/old-key: (.*) new-tuple:/);
      const newDataMatch = text.match(/new-tuple: (.*)/);
      const key = oldDataMatch ? this.parseRowData(oldDataMatch[1]) : null;
      const changes = newDataMatch ? this.parseRowData(newDataMatch[1]) : null;
      return { key, changes };
  }

  private parseDelete(text: string): { [key: string]: any } | null {
      const dataMatch = text.match(/DELETE: (.*)/);
      if (!dataMatch) return null;
      return this.parseRowData(dataMatch[1]);
  }

  private parseRowData(rowData: string): { [key: string]: any } {
      const result = {};
      // This regex is very basic. It splits by space and assumes 'key[type]:value' format.
      // It will fail with spaces in values, nulls, etc.
      const columns = rowData.trim().split(/\s+(?=\w+\[)/);
      for (const col of columns) {
          const match = col.match(/(\w+)\[(.*?)\]:'(.*?)'/);
          if (match) {
              const [, key, , value] = match;
              result[key] = value;
          }
      }
      return result;
  }

  async getHealthStatus(): Promise<any> {
    const status = {
      isMonitoring: this.isMonitoring,
      timestamp: new Date().toISOString(),
      databases: {} as Record<string, any>,
      tables: [] as string[],
      errors: [] as string[]
    };

    try {
      // Check primary database connection
      const primaryRunner = this.primaryConnection.createQueryRunner();
      try {
        await primaryRunner.connect();
        status.databases['primary'] = { connected: true };
        await primaryRunner.release();
      } catch (error) {
        status.databases['primary'] = { connected: false, error: error.message };
        status.errors.push(`Primary database connection failed: ${error.message}`);
      }

      // Check backup database connection
      const backupRunner = this.backupConnection.createQueryRunner();
      try {
        await backupRunner.connect();
        status.databases['backup'] = { connected: true };
        await backupRunner.release();
      } catch (error) {
        status.databases['backup'] = { connected: false, error: error.message };
        status.errors.push(`Backup database connection failed: ${error.message}`);
      }

      // Get monitored tables
      if (status.databases['primary']?.connected) {
        status.tables = await this.getTablesWithTimestamp();
      }

    } catch (error) {
      status.errors.push(`Health check failed: ${error.message}`);
    }

    return status;
  }

  async forceSyncTable(tableName: string): Promise<{ success: boolean; message: string; recordsProcessed: number }> {
    
    try {
      const primaryRunner = this.primaryConnection.createQueryRunner();
      const backupRunner = this.backupConnection.createQueryRunner();

      try {
        await primaryRunner.connect();
        await backupRunner.connect();

        // Check if table exists in both databases
        const primaryExists = await this.checkTableExists(primaryRunner, tableName);
        const backupExists = await this.checkTableExists(backupRunner, tableName);

        if (!primaryExists) {
          return { success: false, message: `Table ${tableName} does not exist in primary database`, recordsProcessed: 0 };
        }

        if (!backupExists) {
          return { success: false, message: `Table ${tableName} does not exist in backup database`, recordsProcessed: 0 };
        }

        // Get all records from primary (limit to prevent memory issues)
        const allRecords = await primaryRunner.query(`SELECT * FROM "${tableName}" LIMIT 1000`);
        
        if (allRecords.length > 0) {
          await this.upsertRecords(backupRunner, tableName, allRecords);
          return { 
            success: true, 
            message: `Successfully force synced ${allRecords.length} records`, 
            recordsProcessed: allRecords.length 
          };
        } else {
          return { success: true, message: 'No records to sync', recordsProcessed: 0 };
        }

      } finally {
        await primaryRunner.release();
        await backupRunner.release();
      }

    } catch (error) {
      this.logger.error(`Force sync failed for table ${tableName}:`, error.message);
      return { success: false, message: error.message, recordsProcessed: 0 };
    }
  }

  private async copyEnumTypes(primaryRunner: any, backupRunner: any, tableName: string) {
    try {
      // Get all enum types used by the table
      const enumTypes = await primaryRunner.query(`
        SELECT DISTINCT udt_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1 
        AND data_type = 'USER-DEFINED'
      `, [tableName]);

      for (const enumType of enumTypes) {
        const typeName = enumType.udt_name;
        
        // Check if enum type already exists in backup database
        const typeExists = await backupRunner.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_type 
            WHERE typname = $1 AND typtype = 'e'
          )
        `, [typeName]);

        if (!typeExists[0].exists) {
          // Get enum values from primary database
          const enumValues = await primaryRunner.query(`
            SELECT enumlabel 
            FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            WHERE t.typname = $1
            ORDER BY e.enumsortorder
          `, [typeName]);

          if (enumValues.length > 0) {
            const values = enumValues.map(v => `'${v.enumlabel}'`).join(', ');
            await backupRunner.query(`CREATE TYPE ${typeName} AS ENUM (${values})`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to copy enum types for ${tableName}:`, error.message);
      throw error;
    }
  }

  private async createTableWithFallback(primaryRunner: any, backupRunner: any, tableName: string) {
    try {
      // Get column definitions in a simpler way
      const columns = await primaryRunner.query(`
        SELECT column_name, data_type, is_nullable, character_maximum_length, udt_name
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);
      
      const columnDefs = columns.map(col => {
        let def = `"${col.column_name}" `;
        switch(col.data_type) {
          case 'character varying':
            def += `varchar(${col.character_maximum_length || 255})`;
            break;
          case 'text':
            def += 'text';
            break;
          case 'bigint':
            def += 'bigint';
            break;
          case 'integer':
            def += 'integer';
            break;
          case 'boolean':
            def += 'boolean';
            break;
          case 'timestamp without time zone':
            def += 'timestamp';
            break;
          case 'timestamp with time zone':
            def += 'timestamptz';
            break;
          case 'USER-DEFINED':
            // Use the actual type name for user-defined types (like enums)
            def += col.udt_name;
            break;
          default:
            def += 'text'; // Fallback to text for unknown types
        }
        if (col.is_nullable === 'NO') {
          def += ' NOT NULL';
        }
        return def;
      }).join(', ');
      
      const createSQL = `CREATE TABLE "${tableName}" (${columnDefs})`;
      await backupRunner.query(createSQL);
      
    } catch (fallbackError) {
      this.logger.error(`All table creation methods failed for ${tableName}: ${fallbackError.message}`);
      throw fallbackError;
    }
  }
}
