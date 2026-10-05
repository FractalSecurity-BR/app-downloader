import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import serverlessExpress from '@vendia/serverless-express';
import { Context, Handler } from 'aws-lambda';
import express from 'express';

import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';
import { configureApp } from './main';

// Mesmo padrão do lambda.ts do i-monitor-back / i-monitor-dta-back: o servidor Nest é
// criado uma vez por container e reaproveitado entre as invocações.
let cachedServer: Handler;

async function bootstrap() {
  if (!cachedServer) {
    const config = loadConfig();
    const expressApp = express();

    const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), new ExpressAdapter(expressApp));
    configureApp(app, config);
    await app.init();

    cachedServer = serverlessExpress({
      app: expressApp,
      binarySettings: {
        isBinary: true,
        contentTypes: ['application/vnd.android.package-archive', 'application/octet-stream', 'image/*'],
      },
    });
  }

  return cachedServer;
}

export const handler = async (event: any, context: Context, callback: any) => {
  process.env.IS_LAMBDA = 'true';

  const server = await bootstrap();
  return server(event, context, callback);
};
