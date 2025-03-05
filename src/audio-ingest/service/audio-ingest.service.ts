import { Injectable, Query } from '@nestjs/common';
import { OzonetelService } from './ozonetel.service';
@Injectable()
export class AudioIngestService {
  constructor(private readonly ozonetelService: OzonetelService) {}

  initiateOzonetel(@Query() query: any) {
    return this.ozonetelService.initiateOzonetel(query);
  }
}
