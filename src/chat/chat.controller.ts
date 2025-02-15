import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { TokenUser } from '../auth/type/auth.types';
import { ChatService } from './chat.service';

@Controller('v1/chats')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private service: ChatService) {}

  @Get('my-chat')
  async getMyChats(@CurrentUser() tokenUser: TokenUser) {
    return this.service.getMyChats(tokenUser.id);
  }

  @Post('request')
  async requestChat(@CurrentUser() tokenUser: TokenUser) {
    return this.service.requestChat(tokenUser.id);
  }

  @Get('counsellor-chat')
  async getCounsellorChat(@CurrentUser() tokenUser: TokenUser) {
    return this.service.getCounsellorChat(tokenUser.id);
  }

  @Post(':id/accept')
  async accept(@CurrentUser() tokenUser: TokenUser, @Param('id') id: string) {
    return this.service.accept(tokenUser.id, parseInt(id));
  }

  @Post(':id/end')
  async endChat(@CurrentUser() tokenUser: TokenUser, @Param('id') id: string) {
    return this.service.endChat(tokenUser.id, parseInt(id));
  }
}
