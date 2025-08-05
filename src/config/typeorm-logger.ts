import { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';
import { Logger } from '@nestjs/common';

export class CustomTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new Logger('TypeORM');
  private readonly isProductionEnv: boolean;
  
  constructor(private readonly isProduction: boolean = false) {
    // Double check for production environment to ensure complete logging silence
    this.isProductionEnv = isProduction || process.env.NODE_ENV === 'production';
  }

  logQuery(query: string, parameters?: any[], queryRunner?: QueryRunner) {
    // ABSOLUTELY NO QUERY LOGGING IN PRODUCTION - PERIOD!
    if (this.isProductionEnv) {
      return; // Silent exit
    }
    
    // In development, only log if LOG_LEVEL is debug
    if (process.env.LOG_LEVEL === 'debug') {
      this.logger.debug(`Query: ${query}`);
      if (parameters && parameters.length) {
        this.logger.debug(`Parameters: ${JSON.stringify(parameters)}`);
      }
    }
  }

  logQueryError(error: string | Error, query: string, parameters?: any[], queryRunner?: QueryRunner) {
    // Even errors should be minimal in production
    if (this.isProductionEnv) {
      this.logger.error(`Database query error occurred`);
      this.logger.error(`${error}`);
    } else {
      this.logger.error(`Query failed: ${query}`);
      this.logger.error(`Error: ${error}`);
      if (parameters && parameters.length) {
        this.logger.error(`Parameters: ${JSON.stringify(parameters)}`);
      }
    }
  }

  logQuerySlow(time: number, query: string, parameters?: any[], queryRunner?: QueryRunner) {
    // Only log slow queries in production (very minimal)
    if (this.isProductionEnv && time > 2000) {
      this.logger.warn(`Slow database query detected (${time}ms)`);
    } else if (!this.isProductionEnv && time > 1000) {
      this.logger.warn(`Slow query detected (${time}ms): ${query}`);
      if (parameters && parameters.length) {
        this.logger.warn(`Parameters: ${JSON.stringify(parameters)}`);
      }
    }
  }

  logSchemaBuild(message: string, queryRunner?: QueryRunner) {
    // Never log schema build in production
    if (!this.isProduction) {
      this.logger.debug(`Schema build: ${message}`);
    }
  }

  logMigration(message: string, queryRunner?: QueryRunner) {
    // Only log migrations if they happen (usually they don't in production)
    if (!this.isProduction) {
      this.logger.log(`Migration: ${message}`);
    }
  }

  log(level: 'log' | 'info' | 'warn', message: any, queryRunner?: QueryRunner) {
    // In production, only log warnings and errors
    if (this.isProduction) {
      if (level === 'warn') {
        this.logger.warn(message);
      }
      return;
    }
    
    switch (level) {
      case 'log':
      case 'info':
        this.logger.log(message);
        break;
      case 'warn':
        this.logger.warn(message);
        break;
    }
  }
}
