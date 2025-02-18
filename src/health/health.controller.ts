import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { AppConfigService } from '../config/config.service';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private configService: AppConfigService,
    private db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck(this.configService.database.database as string),
    ]);
  }
}
