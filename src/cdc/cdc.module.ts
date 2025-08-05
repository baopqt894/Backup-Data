
import { Module } from '@nestjs/common';
import { CdcService } from './cdc.service';
import { CdcController } from './cdc.controller';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forFeature([], 'backup'),
  ],
  providers: [CdcService],
  controllers: [CdcController],
})
export class CdcModule {}
