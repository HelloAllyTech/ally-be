import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { CloudTelephonyRepository } from '../repository/cloud-telephony.repository';
import { CloudTelephonyProvider } from '../../common/constants/chat.constants';
import { OzonetelCredentials } from '../type/cloud-telephony.type';
import { CryptoService } from '../../common/service/crypto.service';
import {
  CloudTelephonyIntegrationResponseDto,
  CreateCloudTelephonyIntegrationDto,
} from '../dto/cloud-telephony.dto';
import { CloudTelephonyIntegration } from '../../common/entities/cloud-telephony-integration.entity';

@Injectable()
export class CloudTelephonyService {
  constructor(
    private readonly cloudTelephonyRepository: CloudTelephonyRepository,
    private readonly cryptoService: CryptoService,
  ) {}

  private validateCredentials(
    provider: CloudTelephonyProvider,
    credentials: Record<string, any>,
  ): void {
    switch (provider) {
      case CloudTelephonyProvider.OZONETEL:
        this.validateOzonetelCredentials(credentials);
        break;
      // Add more providers here as needed
      default:
        throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
  }

  private validateOzonetelCredentials(credentials: Record<string, any>): void {
    const requiredFields = ['apiKey', 'username'];
    const missingFields = requiredFields.filter((field) => !credentials[field]);

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Missing required fields for Ozonetel credentials: ${missingFields.join(
          ', ',
        )}`,
      );
    }

    // Validate field types
    if (
      typeof credentials.apiKey !== 'string' ||
      typeof credentials.username !== 'string'
    ) {
      throw new BadRequestException(
        'All Ozonetel credential fields must be strings',
      );
    }
  }

  async createCloudTelephonyIntegration(
    data: CreateCloudTelephonyIntegrationDto,
  ): Promise<CloudTelephonyIntegrationResponseDto> {
    this.validateCredentials(data.provider, data.credentials);

    try {
      const encryptedCredentials = await this.cryptoService.encrypt(
        JSON.stringify(data.credentials),
      );

      const response = await this.cloudTelephonyRepository.create({
        credentials: encryptedCredentials,
        code: data.code,
        tenantId: data.tenantId,
        provider: data.provider,
      });

      return {
        id: response.id,
        provider: response.provider,
      };
    } catch (error) {
      throw new BadRequestException(
        'Failed to create cloud telephony integration',
      );
    }
  }

  async getCloudTelephonyIntegrationByCode(
    code: string,
  ): Promise<
    (CloudTelephonyIntegration & { credentials: OzonetelCredentials }) | null
  > {
    if (!code || code.trim() === '') {
      return null;
    }
    const response = await this.cloudTelephonyRepository.findByCode(code);
    if (!response) {
      return null;
    }
    const credentials = await this.cryptoService.decrypt(response.credentials);
    return {
      ...response,
      credentials: JSON.parse(credentials),
    };
  }

  async getCloudTelephonyIntegrationByTenantId(
    tenantId: string,
  ): Promise<
    (CloudTelephonyIntegration & { credentials: OzonetelCredentials }) | null
  > {
    if (!tenantId || tenantId.trim() === '') {
      return null;
    }
    const response =
      await this.cloudTelephonyRepository.findByTenantId(tenantId);
    if (!response) {
      return null;
    }
    const credentials = await this.cryptoService.decrypt(response.credentials);
    return {
      ...response,
      credentials: JSON.parse(credentials),
    };
  }

  async updateCloudTelephonyIntegration(
    id: string,
    data: Partial<CloudTelephonyIntegration>,
  ): Promise<void> {
    const integration = await this.cloudTelephonyRepository.findById(id);
    if (!integration) {
      throw new NotFoundException('Cloud telephony integration not found');
    }
    await this.cloudTelephonyRepository.updateById(id, data);
  }
}
