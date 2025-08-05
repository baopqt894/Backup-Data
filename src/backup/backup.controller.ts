import { Controller, Post, Get, Query, Logger } from '@nestjs/common';
import { BackupService } from './backup.service';

@Controller('backup')
export class BackupController {
  private readonly logger = new Logger(BackupController.name);

  constructor(private readonly backupService: BackupService) {}

  @Post('manual')
  async triggerManualBackup(@Query('table') table?: string, @Query('force') force?: string) {
    
    try {
      if (table) {
        await this.backupService.backupTable(table, force === 'true');
        return { 
          success: true, 
          message: `Backup completed for table: ${table}`,
          timestamp: new Date()
        };
      } else {
        await this.backupService.performFullBackup(force === 'true');
        return { 
          success: true, 
          message: 'Full backup completed successfully',
          timestamp: new Date()
        };
      }
    } catch (error) {
      this.logger.error('Manual backup failed:', error);
      return { 
        success: false, 
        message: error.message,
        timestamp: new Date()
      };
    }
  }

  @Get('status')
  async getBackupStatus() {
    try {
      const status = await this.backupService.getBackupStatus();
      return {
        success: true,
        data: status
      };
    } catch (error) {
      this.logger.error('Failed to get backup status:', error);
      return {
        success: false,
        message: error.message,
        timestamp: new Date()
      };
    }
  }

  @Get('health')
  async healthCheck() {
    return {
      status: 'healthy',
      service: 'backup-service',
      timestamp: new Date(),
      uptime: process.uptime()
    };
  }
}
