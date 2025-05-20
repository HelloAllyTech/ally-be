import { Body, Controller, Put } from '@nestjs/common';
import { PreferenceService } from '../../common/service/preference.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly preferenceService: PreferenceService) {}

  @Put('summary-fields')
  async updateSummaryFields(
    @Body() body: { summaryFields: string[] },
  ): Promise<void> {
    const { summaryFields } = body;
  }
}
