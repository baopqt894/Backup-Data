import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function databaseConfig(configService: ConfigService, dbName: 'primary' | 'backup'): TypeOrmModuleOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  
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
      logging: isProduction ? false : ['error'],
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
      logging: isProduction ? false : ['error'],
    };
  }
}
