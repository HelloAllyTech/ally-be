import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HelplineAfterIdQueryDto,
  HelplineFeedbackDto,
} from '../dto/helpline.dto';
import {
  CurrentGuest,
  HelplineGuestGuard,
} from '../guard/helpline-guest.guard';
import {
  GuestContext,
  HelplineGuestService,
} from '../service/helpline-guest.service';
import { GuestChatDto, GuestMessageDto } from '../type/helpline.types';

/**
 * Talker endpoints, authenticated by the guest token only (contract §5.2).
 * Deliberately no AuthGuard('jwt'): a user access token is not accepted here,
 * and a guest token is not accepted anywhere else.
 */
@ApiTags('Text helpline — guest')
@ApiBearerAuth()
@UseGuards(HelplineGuestGuard)
@Controller({ path: 'helpline/guest', version: '1' })
export class HelplineGuestController {
  constructor(private readonly guests: HelplineGuestService) {}

  @Get('chat')
  @ApiOperation({ summary: 'My chat and its talker-visible messages' })
  getChat(
    @CurrentGuest() guest: GuestContext,
    @Query() query: HelplineAfterIdQueryDto,
  ): Promise<{ chat: GuestChatDto; messages: GuestMessageDto[] }> {
    return this.guests.getChat(guest, query.afterId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A fresh guest token (until 24 h after the chat ended)',
  })
  refresh(@CurrentGuest() guest: GuestContext) {
    return this.guests.refresh(guest);
  }

  @Post('end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave the queue, or end the chat' })
  end(@CurrentGuest() guest: GuestContext): Promise<{ chat: GuestChatDto }> {
    return this.guests.end(guest);
  }

  @Post('erase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my conversation now (ends it if open, revokes this token)',
  })
  async erase(@CurrentGuest() guest: GuestContext): Promise<void> {
    await this.guests.erase(guest);
  }

  @Post('feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rate the chat (once)' })
  async feedback(
    @CurrentGuest() guest: GuestContext,
    @Body() body: HelplineFeedbackDto,
  ): Promise<void> {
    await this.guests.submitFeedback(guest, body.rating, body.comment);
  }
}
