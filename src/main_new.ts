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
  
  console.log(`Application is running on: http://localhost:${port}`);
  console.log('Available endpoints:');
  console.log('- GET  /health');
  console.log('- POST /backup/manual');
  console.log('- GET  /backup/status'); 
  console.log('- GET  /monitoring/health');
  console.log('- GET  /monitoring/metrics');
}

bootstrap().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
