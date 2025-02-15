import { Controller, Get } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller('v1/queue')
export class QueueController {
  constructor(private service: QueueService) {}

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }
}
