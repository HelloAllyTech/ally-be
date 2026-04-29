import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/config.service';
import { dataSourceOptions } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: () => {
        const config = {
          ...dataSourceOptions,
          synchronize: false,
          migrationsRun: true,
        };
        return config;
      },
    }),
  ],
})
export class DatabaseModule {}
