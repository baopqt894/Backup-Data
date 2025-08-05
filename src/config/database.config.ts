import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CustomTypeOrmLogger } from './typeorm-logger';

export function databaseConfig(configService: ConfigService, dbName: 'primary' | 'backup'): TypeOrmModuleOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production' || process.env.NODE_ENV === 'production';
  const logLevel = configService.get<string>('LOG_LEVEL', 'log');
  
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
      // ABSOLUTELY NO LOGGING IN PRODUCTION
      logging: isProduction ? false : (logLevel === 'debug' ? ['query', 'error', 'warn'] : ['error', 'warn']),
      // NO CUSTOM LOGGER IN PRODUCTION to prevent any possible logging
      logger: isProduction ? undefined : new CustomTypeOrmLogger(isProduction),
      maxQueryExecutionTime: isProduction ? 2000 : 1000,
      // Additional production optimizations
      extra: isProduction ? {
        connectionLimit: 10,
        acquireTimeout: 60000,
        timeout: 60000,
      } : {},
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
      // ABSOLUTELY NO LOGGING IN PRODUCTION
      logging: isProduction ? false : (logLevel === 'debug' ? ['query', 'error', 'warn'] : ['error', 'warn']),
      // NO CUSTOM LOGGER IN PRODUCTION to prevent any possible logging  
      logger: isProduction ? undefined : new CustomTypeOrmLogger(isProduction),
      maxQueryExecutionTime: isProduction ? 2000 : 1000,
      // Additional production optimizations
      extra: isProduction ? {
        connectionLimit: 10,
        acquireTimeout: 60000,
        timeout: 60000,
      } : {},
    };
  }
}
