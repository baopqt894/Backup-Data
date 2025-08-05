
import { Controller, Get, Post, Param, Logger } from '@nestjs/common';
import { CdcService } from './cdc.service';

@Controller('cdc')
export class CdcController {
  private readonly logger = new Logger(CdcController.name);

  constructor(private readonly cdcService: CdcService) {}

  @Get('health')
  async getHealthStatus() {
    return this.cdcService.getHealthStatus();
  }

  @Post('sync/:tableName')
  async forceSyncTable(@Param('tableName') tableName: string) {
    return this.cdcService.forceSyncTable(tableName);
  }

  @Get('status')
  getStatus() {
    return {
      message: 'CDC Service is running',
      timestamp: new Date().toISOString()
    };
  }
}
