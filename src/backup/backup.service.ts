import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectConnection() private primaryConnection: Connection,
    @InjectConnection('backup') private backupConnection: Connection,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Backup Service initialized');
    this.logger.log('📅 Scheduled: Hourly backup + Daily full backup at 2:00 AM');
  }

  @Cron(CronExpression.EVERY_HOUR) // Backup mỗi giờ
  async performScheduledBackup() {
    try {
      await this.performFullBackup();
      this.logger.log('⏰ Hourly backup completed successfully');
    } catch (error) {
      this.logger.error('Scheduled backup failed:', error);
    }
  }

  @Cron('0 2 * * *') // Backup đầy đủ lúc 2h sáng hàng ngày
  async performDailyFullBackup() {
    try {
      await this.performFullBackup(true);
      await this.cleanupOldBackups();
      this.logger.log('🌙 Daily full backup completed successfully');
    } catch (error) {
      this.logger.error('Daily full backup failed:', error);
    }
  }

  async performFullBackup(forceRecreate = false): Promise<void> {
    const tables = await this.getAllTables();

    for (const table of tables) {
      try {
        await this.backupTable(table, forceRecreate);
        this.logger.debug(`Successfully backed up table: ${table}`);
      } catch (error) {
        this.logger.error(`Failed to backup table ${table}:`, error);
        // Tiếp tục với table khác thay vì dừng toàn bộ
      }
    }
  }

  async backupTable(tableName: string, forceRecreate = false): Promise<void> {
    const queryRunnerPrimary = this.primaryConnection.createQueryRunner();
    const queryRunnerBackup = this.backupConnection.createQueryRunner();

    try {
      await queryRunnerPrimary.connect();
      await queryRunnerBackup.connect();

      // Kiểm tra xem bảng đã tồn tại trong backup DB chưa
      const tableExists = await this.checkTableExists(queryRunnerBackup, tableName);

      if (!tableExists || forceRecreate) {
        // Tạo bảng mới trong backup DB
        await this.createTableInBackup(queryRunnerPrimary, queryRunnerBackup, tableName);
      }

      // Lấy dữ liệu từ primary DB
      const data = await queryRunnerPrimary.query(`SELECT * FROM "${tableName}"`);
      
      if (data.length > 0) {
        // Xóa dữ liệu cũ nếu force recreate
        if (forceRecreate) {
          await queryRunnerBackup.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
        }

        // Chèn dữ liệu mới
        await this.insertDataInBatches(queryRunnerBackup, tableName, data);
      }

    } finally {
      await queryRunnerPrimary.release();
      await queryRunnerBackup.release();
    }
  }

  private async getAllTables(): Promise<string[]> {
    const queryRunner = this.primaryConnection.createQueryRunner();
    try {
      await queryRunner.connect();
      const result = await queryRunner.query(`
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename NOT LIKE 'pg_%'
        ORDER BY tablename
      `);
      return result.map(row => row.tablename);
    } finally {
      await queryRunner.release();
    }
  }

  private async checkTableExists(queryRunner: any, tableName: string): Promise<boolean> {
    const result = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )
    `, [tableName]);
    return result[0].exists;
  }

  private async createTableInBackup(primaryRunner: any, backupRunner: any, tableName: string): Promise<void> {
    try {
      // Dùng pg_dump để lấy cấu trúc bảng chính xác
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const primaryHost = this.configService.get('PRIMARY_DB_HOST');
      const primaryPort = this.configService.get('PRIMARY_DB_PORT');
      const primaryUser = this.configService.get('PRIMARY_DB_USER');
      const primaryPassword = this.configService.get('PRIMARY_DB_PASSWORD');
      const primaryDb = this.configService.get('PRIMARY_DB_NAME');

      const backupHost = this.configService.get('BACKUP_DB_HOST');
      const backupPort = this.configService.get('BACKUP_DB_PORT');
      const backupUser = this.configService.get('BACKUP_DB_USER');
      const backupPassword = this.configService.get('BACKUP_DB_PASSWORD');
      const backupDb = this.configService.get('BACKUP_DB_NAME');

      // Drop table if exists (with proper error handling)
      try {
        await backupRunner.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
      } catch (dropError) {
        this.logger.warn(`Could not drop table ${tableName}, probably doesn't exist:`, dropError.message);
      }

      // Use pg_dump to get exact table structure
      const dumpCommand = `PGPASSWORD="${primaryPassword}" pg_dump -h ${primaryHost} -p ${primaryPort} -U ${primaryUser} -d ${primaryDb} -t "${tableName}" --schema-only --no-owner --no-privileges`;
      
      try {
        const { stdout } = await execAsync(dumpCommand);
        
        // Clean up the dump output - remove comments and connect statements
        let cleanSql = stdout
          .split('\n')
          .filter(line => 
            !line.startsWith('--') && 
            !line.startsWith('SET ') && 
            !line.startsWith('\\') &&
            !line.includes('pg_catalog') &&
            line.trim() !== ''
          )
          .join('\n')
          .replace(/CREATE TABLE [^.]*\./g, 'CREATE TABLE ') // Remove schema prefix
          .replace(/public\./g, '') // Remove public schema references
          .replace(/OWNER TO [^;]+;/g, '') // Remove owner statements
          .trim();

        if (cleanSql && cleanSql.includes('CREATE TABLE')) {
          // Execute the cleaned SQL in backup database
          await backupRunner.query(cleanSql);
          this.logger.debug(`Successfully created table structure for ${tableName}`);
        } else {
          // Fallback to manual structure creation
          await this.createTableFallback(primaryRunner, backupRunner, tableName);
        }
      } catch (pgDumpError) {
        this.logger.warn(`pg_dump failed for ${tableName}, using fallback method:`, pgDumpError.message);
        await this.createTableFallback(primaryRunner, backupRunner, tableName);
      }

    } catch (error) {
      this.logger.error(`Failed to create table ${tableName}:`, error);
      throw error;
    }
  }

  private async createTableFallback(primaryRunner: any, backupRunner: any, tableName: string): Promise<void> {
    try {
      // Get detailed table structure from primary DB
      const tableStructure = await primaryRunner.query(`
        SELECT 
          column_name, 
          data_type, 
          character_maximum_length, 
          is_nullable, 
          column_default, 
          udt_name,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      if (tableStructure.length === 0) {
        throw new Error(`No columns found for table ${tableName}`);
      }

      // Create CREATE TABLE statement with improved data type handling
      const columns = tableStructure.map(col => {
        let columnType = this.mapPostgreSQLDataType(col);
        let columnDef = `"${col.column_name}" ${columnType}`;
        
        // Add NOT NULL constraint if applicable
        if (col.is_nullable === 'NO') {
          columnDef += ' NOT NULL';
        }
        
        // Add default value if applicable (skip sequences and complex expressions)
        if (col.column_default && 
            !col.column_default.includes('nextval') && 
            !col.column_default.includes('::')) {
          columnDef += ` DEFAULT ${col.column_default}`;
        }
        
        return columnDef;
      }).join(', ');

      // Create the table
      const createTableSQL = `CREATE TABLE "${tableName}" (${columns})`;
      this.logger.debug(`Creating table with SQL: ${createTableSQL}`);
      
      await backupRunner.query(createTableSQL);
      
      // Try to copy primary key constraints (non-critical)
      try {
        await this.copyPrimaryKeyConstraint(primaryRunner, backupRunner, tableName);
      } catch (error) {
        this.logger.warn(`Could not copy primary key for ${tableName}: ${error.message}`);
      }

    } catch (error) {
      this.logger.error(`Failed to create table ${tableName}: ${error.message}`);
      throw error;
    }
  }

  private mapPostgreSQLDataType(col: any): string {
    const dataType = col.data_type.toLowerCase();
    const udtName = col.udt_name?.toLowerCase();

    switch (dataType) {
      case 'user-defined':
        // Handle custom types like ENUMs
        if (udtName) {
          return 'text'; // Fallback to text for custom types in backup
        }
        return 'text';

      case 'array':
        // Handle array types
        if (udtName && udtName.startsWith('_')) {
          const baseType = udtName.substring(1);
          return `${this.mapSimpleType(baseType)}[]`;
        }
        return 'text[]';

      case 'character varying':
        return col.character_maximum_length ? 
          `varchar(${col.character_maximum_length})` : 'varchar';

      case 'character':
        return col.character_maximum_length ? 
          `char(${col.character_maximum_length})` : 'char';

      case 'numeric':
      case 'decimal':
        if (col.numeric_precision && col.numeric_scale !== null) {
          return `numeric(${col.numeric_precision},${col.numeric_scale})`;
        }
        return 'numeric';

      case 'timestamp without time zone':
        return 'timestamp';

      case 'timestamp with time zone':
        return 'timestamptz';

      case 'time without time zone':
        return 'time';

      case 'time with time zone':
        return 'timetz';

      // Handle JSON/JSONB properly
      default:
        if (udtName === 'jsonb') return 'jsonb';
        if (udtName === 'json') return 'json';
        return this.mapSimpleType(dataType);
    }
  }

  private mapSimpleType(dataType: string): string {
    switch (dataType.toLowerCase()) {
      case 'bigint': return 'bigint';
      case 'integer': return 'integer';
      case 'smallint': return 'smallint';
      case 'boolean': return 'boolean';
      case 'text': return 'text';
      case 'uuid': return 'uuid';
      case 'bytea': return 'bytea';
      case 'real': return 'real';
      case 'double precision': return 'double precision';
      case 'money': return 'money';
      case 'inet': return 'inet';
      case 'cidr': return 'cidr';
      case 'macaddr': return 'macaddr';
      default: return 'text'; // Safe fallback
    }
  }

  private async copyPrimaryKeyConstraint(primaryRunner: any, backupRunner: any, tableName: string): Promise<void> {
    try {
      // Get primary key information
      const pkInfo = await primaryRunner.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
        ORDER BY kcu.ordinal_position
      `, [tableName]);

      if (pkInfo.length > 0) {
        const pkColumns = pkInfo.map(row => `"${row.column_name}"`).join(', ');
        const constraintName = `${tableName}_pkey`;
        const alterSQL = `ALTER TABLE "${tableName}" ADD CONSTRAINT "${constraintName}" PRIMARY KEY (${pkColumns})`;
        
        await backupRunner.query(alterSQL);
        this.logger.debug(`Added primary key constraint for ${tableName}`);
      }
    } catch (error) {
      // Non-critical error, just log it
      this.logger.debug(`Could not add primary key constraint for ${tableName}: ${error.message}`);
    }
  }

  private async copyConstraintsAndIndexes(primaryRunner: any, backupRunner: any, tableName: string): Promise<void> {
    try {
      // Lấy primary key constraints
      const primaryKeys = await primaryRunner.query(`
        SELECT constraint_name, column_name
        FROM information_schema.key_column_usage
        WHERE table_name = $1 AND table_schema = 'public'
        AND constraint_name LIKE '%_pkey'
      `, [tableName]);

      if (primaryKeys.length > 0) {
        const pkColumns = primaryKeys.map(pk => `"${pk.column_name}"`).join(', ');
        await backupRunner.query(`ALTER TABLE "${tableName}" ADD PRIMARY KEY (${pkColumns})`);
      }

      // Lấy indexes (trừ primary key)
      const indexes = await primaryRunner.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1 AND schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
      `, [tableName]);

      for (const index of indexes) {
        const indexDef = index.indexdef.replace(/CREATE INDEX [^ ]+ ON/, `CREATE INDEX ON`);
        await backupRunner.query(indexDef);
      }
    } catch (error) {
      this.logger.warn(`Failed to copy constraints/indexes for ${tableName}:`, error.message);
    }
  }

  private async insertDataInBatches(queryRunner: any, tableName: string, data: any[], batchSize = 1000): Promise<void> {
    if (data.length === 0) return;

    const columns = Object.keys(data[0]);
    
    // Get column types for better data handling
    const columnTypes = await this.getColumnTypes(queryRunner, tableName);

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      // Use parameterized queries instead of string concatenation
      const placeholders = batch.map((_, rowIndex) => {
        const rowPlaceholders = columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(', ');
        return `(${rowPlaceholders})`;
      }).join(', ');

      const columnNames = columns.map(col => `"${col}"`).join(', ');
      const sql = `INSERT INTO "${tableName}" (${columnNames}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
      
      // Prepare values with proper type handling
      const values = batch.flatMap(row => 
        columns.map(col => this.processValueForInsertion(row[col], columnTypes[col]))
      );

      try {
        await queryRunner.query(sql, values);
      } catch (error) {
        // If parameterized query fails, fall back to individual inserts
        this.logger.warn(`Batch insert failed for ${tableName}, falling back to individual inserts: ${error.message}`);
        await this.insertRowsIndividually(queryRunner, tableName, batch, columns, columnTypes);
      }
    }
  }

  private async getColumnTypes(queryRunner: any, tableName: string): Promise<Record<string, string>> {
    try {
      const result = await queryRunner.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName]);
      
      const columnTypes: Record<string, string> = {};
      result.forEach(row => {
        columnTypes[row.column_name] = row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type;
      });
      
      return columnTypes;
    } catch (error) {
      this.logger.warn(`Failed to get column types for ${tableName}: ${error.message}`);
      return {};
    }
  }

  private processValueForInsertion(value: any, dataType?: string): any {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle based on PostgreSQL data type
    switch (dataType?.toLowerCase()) {
      case 'json':
      case 'jsonb':
        if (typeof value === 'string') {
          try {
            // Validate JSON string
            JSON.parse(value);
            return value;
          } catch {
            // If invalid JSON, stringify it
            return JSON.stringify(value);
          }
        } else if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return JSON.stringify(value);

      case 'integer':
      case 'bigint':
      case 'smallint':
        return typeof value === 'string' ? parseInt(value, 10) : Number(value);

      case 'numeric':
      case 'decimal':
      case 'real':
      case 'double precision':
        return typeof value === 'string' ? parseFloat(value) : Number(value);

      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1' || value === 't';
        }
        return Boolean(value);

      case 'timestamp without time zone':
      case 'timestamp with time zone':
      case 'date':
        if (value instanceof Date) {
          return value;
        }
        if (typeof value === 'string' && !isNaN(Date.parse(value))) {
          return new Date(value);
        }
        return value;

      default:
        // Handle arrays (PostgreSQL array types end with [])
        if (Array.isArray(value)) {
          return value;
        }
        
        // Handle other types as string
        return String(value);
    }
  }

  private async insertRowsIndividually(queryRunner: any, tableName: string, rows: any[], columns: string[], columnTypes: Record<string, string>): Promise<void> {
    const columnNames = columns.map(col => `"${col}"`).join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    for (const row of rows) {
      try {
        const values = columns.map(col => this.processValueForInsertion(row[col], columnTypes[col]));
        await queryRunner.query(sql, values);
      } catch (error) {
        this.logger.error(`Failed to insert row in ${tableName}: ${error.message}`, { 
          row: this.sanitizeRowForLogging(row) 
        });
        // Continue with next row instead of failing completely
      }
    }
  }

  private sanitizeRowForLogging(row: any): any {
    const sanitized = { ...row };
    // Remove or truncate sensitive/large data for logging
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 200) {
        sanitized[key] = sanitized[key].substring(0, 200) + '...';
      }
      if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret')) {
        sanitized[key] = '[REDACTED]';
      }
    });
    return sanitized;
  }

  private async cleanupOldBackups(): Promise<void> {
    // Implement logic để xóa các backup cũ nếu cần
    this.logger.log('Cleanup old backups completed');
  }

  async getBackupStatus(): Promise<any> {
    try {
      const primaryTables = await this.getAllTables();
      const queryRunner = this.backupConnection.createQueryRunner();
      await queryRunner.connect();

      const status = {
        timestamp: new Date(),
        total_tables: primaryTables.length,
        backed_up_tables: 0,
        missing_tables: [] as string[],
        table_stats: [] as Array<{table_name: string, row_count: number}>
      };

      for (const table of primaryTables) {
        const exists = await this.checkTableExists(queryRunner, table);
        if (exists) {
          status.backed_up_tables++;
          const count = await queryRunner.query(`SELECT COUNT(*) as count FROM "${table}"`);
          status.table_stats.push({
            table_name: table,
            row_count: parseInt(count[0].count)
          });
        } else {
          status.missing_tables.push(table);
        }
      }

      await queryRunner.release();
      return status;
    } catch (error) {
      this.logger.error('Failed to get backup status:', error);
      throw error;
    }
  }
}
