import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AwsModule } from 'src/aws/aws.module';

import { BlogController } from './controller/blog.controller';
import { Blog } from './entity/blog.entity';
import { BlogRepository } from './repository/blog.repository';
import { BlogService } from './service/blog.service';

@Module({
  imports: [TypeOrmModule.forFeature([Blog]), AwsModule],
  controllers: [BlogController],
  providers: [BlogRepository, BlogService],
  exports: [BlogService],
})
export class BlogModule {}
