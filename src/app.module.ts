import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CdcModule } from './cdc/cdc.module';
import { BackupModule } from './backup/backup.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { CustomLoggerService } from './logger/logger.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('PRIMARY_DB_HOST'),
        port: configService.get('PRIMARY_DB_PORT'),
        username: configService.get('PRIMARY_DB_USER'),
        password: configService.get('PRIMARY_DB_PASSWORD'),
        database: configService.get('PRIMARY_DB_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // Disable auto sync for primary DB
        logging: configService.get('NODE_ENV') === 'development',
      }),
    }),
    TypeOrmModule.forRootAsync({
      name: 'backup',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('BACKUP_DB_HOST'),
        port: configService.get('BACKUP_DB_PORT'),
        username: configService.get('BACKUP_DB_USER'),
        password: configService.get('BACKUP_DB_PASSWORD'),
        database: configService.get('BACKUP_DB_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // Disable auto sync for backup DB
        logging: configService.get('NODE_ENV') === 'development',
      }),
    }),
    CdcModule,
    BackupModule,
    MonitoringModule,
  ],
  controllers: [AppController],
  providers: [AppService, CustomLoggerService],
})
export class AppModule {}
