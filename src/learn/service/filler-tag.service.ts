import {
  ConflictException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import isDuplicateKeyException from 'src/exception/custom.exception';
import { FillerTagRepository } from '../repository/filler-tag.repository';
import {
  CreateFillerTagDto,
  CreateFillerTagResponseDto,
  FillerTagResponseDto,
  GetFillerTagsResponseDto,
} from '../dto/filler-tag.dto';
import { Pagination } from 'src/common/type/common.type';
import { FillerTag } from '../entity/filler-tag.entity';

@Injectable()
export class FillerTagService {
  constructor(private readonly fillerTagRepository: FillerTagRepository) {}

  async createFillerTag(
    dto: CreateFillerTagDto,
    createdBy?: number,
  ): Promise<CreateFillerTagResponseDto> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Filler tag name cannot be empty');
    }
    const row = this.fillerTagRepository.create({
      name,
      createdBy,
    });
    try {
      const saved = await this.fillerTagRepository.save(row);
      return {
        id: saved.id,
        name: saved.name,
        createdBy: saved.createdBy,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      };
    } catch (e) {
      if (isDuplicateKeyException(e)) {
        throw new ConflictException(
          'A filler tag with this name already exists (case-insensitive)',
        );
      }
      throw e;
    }
  }

  async getFillerTags(
    name?: string,
    options?: Pagination,
  ): Promise<GetFillerTagsResponseDto> {
    const { data, count } = await this.fillerTagRepository.getFillerTags(
      name,
      options,
    );
    return {
      data: data.map((t) => this.mapToResponseDto(t)),
      count,
    };
  }

  private mapToResponseDto(row: FillerTag): FillerTagResponseDto {
    return {
      id: row.id,
      name: row.name,
    };
  }
}
