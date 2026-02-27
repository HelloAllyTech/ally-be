import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';

type ClassConstructor<T> = new (...args: unknown[]) => T;

/**
 * Pipe that ensures the request body is an array of DTOs.
 * Rejects single objects or non-array payloads with 400.
 * Validates each element with the given DTO class.
 */
@Injectable()
export class ParseArrayBodyPipe<T extends object> implements PipeTransform<
  unknown,
  Promise<T[]>
> {
  constructor(private readonly itemType: ClassConstructor<T>) {}

  async transform(value: unknown): Promise<T[]> {
    if (value === null || value === undefined) {
      throw new BadRequestException('Request body is required');
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException('Request body must be an array');
    }

    const array = value;

    const result = await Promise.all(
      array.map(async (item, index) => {
        const transformed = plainToInstance(this.itemType, item, {
          enableImplicitConversion: true,
        });
        try {
          await validateOrReject(transformed, {
            whitelist: true,
            forbidNonWhitelisted: false,
          });
        } catch (errors) {
          throw new BadRequestException({
            message: `Validation failed for item at index ${index}`,
            errors,
          });
        }
        return transformed;
      }),
    );

    return result;
  }
}
