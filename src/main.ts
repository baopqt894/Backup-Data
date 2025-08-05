import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable validation pipes
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  console.log('\n🚀 NestJS CDC Backup System Started Successfully!');
  console.log(`📡 Server: http://localhost:${port}`);
  console.log(`🗃️  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Log Level: ${process.env.LOG_LEVEL || 'log'}`);
  console.log('\n📋 Available API Endpoints:');
  console.log('   Health & Status:');
  console.log('   - GET  /health              (App health check)');
  console.log('   - GET  /monitoring/health   (System health & metrics)');
  console.log('   - GET  /backup/status       (Backup status)');
  console.log('   - GET  /cdc/health          (CDC health)');
  console.log('\n   Operations:');
  console.log('   - POST /backup/manual       (Trigger manual backup)');
  console.log('   - POST /cdc/sync/:table     (Sync specific table)');
  console.log('\n🔄 Background Services:');
  console.log('   - CDC: Real-time monitoring (every 30 seconds)');
  console.log('   - Backup: Hourly + Daily full (2:00 AM)');
  console.log('\n✅ System Ready for Production!');
}

bootstrap().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
