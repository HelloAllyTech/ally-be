import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from '../chat/entity/chat.entity';
import { CallDetails } from '../chat/entity/call.details.entity';
import { CustomFieldDefinition } from './entity/custom-field-definition.entity';
import { ChatCustomFieldValue } from './entity/chat-custom-field-value.entity';
import { CustomFieldsService } from './service/custom-fields.service';
import { CustomFieldsController } from './controller/custom-fields.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Chat,
      CallDetails,
      CustomFieldDefinition,
      ChatCustomFieldValue,
    ]),
    AuthorizationModule,
    UserModule,
  ],
  providers: [CustomFieldsService],
  controllers: [CustomFieldsController],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
