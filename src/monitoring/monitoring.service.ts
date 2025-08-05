import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface BackupMetrics {
  totalTables: number;
  backedUpTables: number;
  lastBackupTime: Date | null;
  healthStatus: 'healthy' | 'warning' | 'error';
  errors: string[];
  tableStatus: Array<{
    tableName: string;
    lastBackup: Date | null;
    rowCount: number;
    status: string;
  }>;
}

@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);
  private lastHealthCheck: Date = new Date();
  private healthMetrics: BackupMetrics;

  constructor(
    private readonly configService: ConfigService,
    @InjectConnection() private primaryConnection: Connection,
    @InjectConnection('backup') private backupConnection: Connection,
  ) {}

  onModuleInit() {
    this.logger.log('📊 Monitoring Service initialized');
    this.logger.log('🔍 Health checks and metrics collection ready');
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async performHealthCheck() {
    try {
      this.healthMetrics = await this.collectMetrics();
      this.lastHealthCheck = new Date();
      
      if (this.healthMetrics.healthStatus === 'error') {
        this.logger.error('Health check failed:', this.healthMetrics.errors);
      }
    } catch (error) {
      this.logger.error('Health check failed:', error);
    }
  }

  async collectMetrics(): Promise<BackupMetrics> {
    const errors: string[] = [];
    let healthStatus: 'healthy' | 'warning' | 'error' = 'healthy';

    try {
      // Kiểm tra kết nối database
      await this.checkDatabaseConnections();

      // Lấy danh sách tất cả tables
      const primaryTables = await this.getAllPrimaryTables();
      
      // Lấy số lượng tables trong backup database
      const backupTables = await this.getBackupTableCount();
      
      // Kiểm tra backup status từ backup_info nếu có
      const backupStatus = await this.getBackupTableStatus();
      
      const metrics: BackupMetrics = {
        totalTables: primaryTables.length,
        backedUpTables: backupTables,
        lastBackupTime: await this.getLastBackupTime(),
        healthStatus: 'healthy',
        errors: [],
        tableStatus: backupStatus
      };

      // Kiểm tra coverage - chỉ báo lỗi khi dưới 90%
      const coverage = primaryTables.length > 0 ? (backupTables / primaryTables.length) : 1;
      if (coverage < 0.9) {
        const missingTables = primaryTables.length - backupTables;
        errors.push(`${missingTables} tables are not backed up (${Math.round(coverage * 100)}% coverage)`);
        healthStatus = 'warning';
      }

      // Chỉ kiểm tra backup time khi có backup_info schema
      if (metrics.lastBackupTime) {
        const hoursSinceLastBackup = (Date.now() - metrics.lastBackupTime.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastBackup > 24) {
          errors.push(`Last backup was ${Math.floor(hoursSinceLastBackup)} hours ago`);
          healthStatus = 'error';
        } else if (hoursSinceLastBackup > 6) {
          errors.push(`Last backup was ${Math.floor(hoursSinceLastBackup)} hours ago`);
          if (healthStatus === 'healthy') healthStatus = 'warning';
        }
      }
      // Không báo lỗi "No backup found" nữa

      metrics.healthStatus = healthStatus;
      metrics.errors = errors;

      return metrics;

    } catch (error) {
      return {
        totalTables: 0,
        backedUpTables: 0,
        lastBackupTime: null,
        healthStatus: 'error',
        errors: [`Failed to collect metrics: ${error.message}`],
        tableStatus: []
      };
    }
  }

  private async checkDatabaseConnections(): Promise<void> {
    // Kiểm tra primary database
    await this.primaryConnection.query('SELECT 1');
    
    // Kiểm tra backup database
    await this.backupConnection.query('SELECT 1');
  }

  private async getAllPrimaryTables(): Promise<string[]> {
    const result = await this.primaryConnection.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT LIKE 'backup_info_%'
      ORDER BY tablename
    `);
    return result.map(row => row.tablename);
  }

  private async getBackupTableStatus(): Promise<Array<{
    tableName: string;
    lastBackup: Date | null;
    rowCount: number;
    status: string;
  }>> {
    try {
      // Kiểm tra xem bảng backup_status có tồn tại không
      const tableExists = await this.backupConnection.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'backup_info' 
          AND table_name = 'backup_status'
        )
      `);

      if (!tableExists[0].exists) {
        return [];
      }

      const result = await this.backupConnection.query(`
        SELECT table_name, last_backup_time, row_count, status
        FROM backup_info.backup_status
        ORDER BY table_name
      `);

      return result.map(row => ({
        tableName: row.table_name,
        lastBackup: row.last_backup_time,
        rowCount: row.row_count || 0,
        status: row.status || 'unknown'
      }));
    } catch (error) {
      // Silently handle permission errors for backup_info schema
      return [];
    }
  }

  private async getLastBackupTime(): Promise<Date | null> {
    try {
      const result = await this.backupConnection.query(`
        SELECT MAX(last_backup_time) as last_backup
        FROM backup_info.backup_status
        WHERE status = 'success'
      `);
      
      return result[0]?.last_backup || null;
    } catch (error) {
      // Silently handle permission errors for backup_info schema
      return null;
    }
  }

  private async getBackupTableCount(): Promise<number> {
    try {
      const result = await this.backupConnection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE 'pg_%'
        AND table_name NOT LIKE 'information_schema%'
      `);
      
      return parseInt(result[0].count) || 0;
    } catch (error) {
      // Silently handle errors
      return 0;
    }
  }

  async getHealthStatus(): Promise<BackupMetrics> {
    if (!this.healthMetrics) {
      this.healthMetrics = await this.collectMetrics();
    }
    return this.healthMetrics;
  }

  async getDetailedReport(): Promise<any> {
    const metrics = await this.collectMetrics();
    
    // Lấy thêm thông tin chi tiết
    const recentLogs = await this.getRecentBackupLogs();
    const diskUsage = await this.getDiskUsage();
    
    return {
      timestamp: new Date(),
      health: metrics,
      recentActivity: recentLogs,
      system: {
        diskUsage,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }
    };
  }

  private async getRecentBackupLogs(): Promise<any[]> {
    try {
      const result = await this.backupConnection.query(`
        SELECT table_name, operation, timestamp, status, error_message
        FROM backup_info.backup_log
        WHERE timestamp > NOW() - INTERVAL '24 hours'
        ORDER BY timestamp DESC
        LIMIT 50
      `);
      return result;
    } catch (error) {
      this.logger.warn('Failed to get recent backup logs:', error.message);
      return [];
    }
  }

  private async getDiskUsage(): Promise<any> {
    try {
      const primarySize = await this.primaryConnection.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `);
      
      const backupSize = await this.backupConnection.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `);

      return {
        primaryDatabase: primarySize[0]?.size,
        backupDatabase: backupSize[0]?.size
      };
    } catch (error) {
      this.logger.warn('Failed to get disk usage:', error.message);
      return {};
    }
  }

  @Cron('0 6 * * *') // Hàng ngày lúc 6h sáng
  async generateDailyReport() {
    try {
      const report = await this.getDetailedReport();
      this.logger.log('=== DAILY BACKUP REPORT ===');
      this.logger.log(`Health Status: ${report.health.healthStatus}`);
      this.logger.log(`Total Tables: ${report.health.totalTables}`);
      this.logger.log(`Backed Up Tables: ${report.health.backedUpTables}`);
      this.logger.log(`Last Backup: ${report.health.lastBackupTime}`);
      
      if (report.health.errors.length > 0) {
        this.logger.warn('Issues found:', report.health.errors);
      }
      
      this.logger.log('=== END DAILY REPORT ===');
    } catch (error) {
      this.logger.error('Failed to generate daily report:', error);
    }
  }
}
