import { Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from './config';
import { APP_CONFIG, M0Controller } from './http';
import { composePorts } from './modules/composition';
import { M0Store } from './store';

const config: AppConfig = loadConfig();
const store = new M0Store(config, composePorts());

@Module({
  controllers: [M0Controller],
  providers: [
    { provide: M0Store, useValue: store },
    { provide: APP_CONFIG, useValue: config },
  ],
})
export class AppModule {}

export function runtime(): { config: AppConfig; store: M0Store } {
  return { config, store };
}
