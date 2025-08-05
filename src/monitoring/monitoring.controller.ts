import { Controller, Get, Logger } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

@Controller('monitoring')
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);

  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('health')
  async getHealth() {
    try {
      const health = await this.monitoringService.getHealthStatus();
      return {
        success: true,
        data: health,
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error('Failed to get health status:', error);
      return {
        success: false,
        message: error.message,
        timestamp: new Date()
      };
    }
  }

  @Get('report')
  async getDetailedReport() {
    try {
      const report = await this.monitoringService.getDetailedReport();
      return {
        success: true,
        data: report
      };
    } catch (error) {
      this.logger.error('Failed to get detailed report:', error);
      return {
        success: false,
        message: error.message,
        timestamp: new Date()
      };
    }
  }

  @Get('metrics')
  async getMetrics() {
    try {
      const metrics = await this.monitoringService.collectMetrics();
      return {
        success: true,
        data: {
          backup_health: metrics.healthStatus,
          total_tables: metrics.totalTables,
          backed_up_tables: metrics.backedUpTables,
          coverage_percentage: metrics.totalTables > 0 ? 
            Math.round((metrics.backedUpTables / metrics.totalTables) * 100) : 0,
          last_backup_time: metrics.lastBackupTime,
          errors: metrics.errors,
          uptime_seconds: process.uptime(),
          memory_usage: process.memoryUsage()
        },
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error('Failed to get metrics:', error);
      return {
        success: false,
        message: error.message,
        timestamp: new Date()
      };
    }
  }
}
