import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CustomTypeOrmLogger } from './typeorm-logger';

export function databaseConfig(configService: ConfigService, dbName: 'primary' | 'backup'): TypeOrmModuleOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  const logLevel = configService.get<string>('LOG_LEVEL', 'log');
  
  // Create custom logger instance
  const customLogger = new CustomTypeOrmLogger(isProduction);
  
  if (dbName === 'primary') {
    return {
      type: 'postgres',
      host: configService.get<string>('PRIMARY_DB_HOST'),
      port: configService.get<number>('PRIMARY_DB_PORT'),
      username: configService.get<string>('PRIMARY_DB_USER'),
      password: configService.get<string>('PRIMARY_DB_PASSWORD'),
      database: configService.get<string>('PRIMARY_DB_NAME'),
      autoLoadEntities: true,
      synchronize: false,
      // In production: completely disable all logging
      // In development: only enable if log level allows
      logging: isProduction ? false : (logLevel === 'debug' ? ['query', 'error', 'warn'] : ['error', 'warn']),
      logger: customLogger,
      maxQueryExecutionTime: isProduction ? 2000 : 1000,
    };
  } else {
    return {
      type: 'postgres',
      name: 'backup',
      host: configService.get<string>('BACKUP_DB_HOST'),
      port: configService.get<number>('BACKUP_DB_PORT'),
      username: configService.get<string>('BACKUP_DB_USER'),
      password: configService.get<string>('BACKUP_DB_PASSWORD'),
      database: configService.get<string>('BACKUP_DB_NAME'),
      autoLoadEntities: true,
      synchronize: false,
      // In production: completely disable all logging
      // In development: only enable if log level allows
      logging: isProduction ? false : (logLevel === 'debug' ? ['query', 'error', 'warn'] : ['error', 'warn']),
      logger: customLogger,
      maxQueryExecutionTime: isProduction ? 2000 : 1000,
    };
  }
}
