import { Module } from '@nestjs/common';
import { AnalyticsController } from './controller/analytics.controller';
import { AnalyticsService } from './service/analytics.service';
import { MetabaseService } from './service/metabase.service';
import { AppConfigModule } from '../config/config.module';
import { ProviderFactory } from '../factory/provider.factory';
import { UserModule } from '../user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dashboard } from './entity/dashboard.entity';
import { DashboardRepository } from './repository/dashboard.repository';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    AppConfigModule,
    UserModule,
    TypeOrmModule.forFeature([Dashboard]),
    ChatModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    MetabaseService,
    ProviderFactory.getAnalyticsFactory(),
    DashboardRepository,
  ],
})
export class AnalyticsModule {}
