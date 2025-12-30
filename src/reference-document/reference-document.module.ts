import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferenceDocument } from './entity/reference-document.entity';
import { ReferenceDocumentController } from './controller/reference-document.controller';
import { ReferenceDocumentService } from './service/reference-document.service';
import { AiModule } from '../ai/ai.module';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReferenceDocument]),
    AiModule,
    forwardRef(() => UserModule),
  ],
  controllers: [ReferenceDocumentController],
  providers: [ReferenceDocumentService],
  exports: [ReferenceDocumentService],
})
export class ReferenceDocumentModule {}
