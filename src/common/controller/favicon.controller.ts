import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class FaviconController {
  @Get('favicon.ico')
  getFavicon(@Res() res: Response) {
    res.status(204).send();
  }
}
