import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import type { AiProviderConfig } from '@prisma/client';
import {
  AiProviderConfigResponseDto,
  AiProviderTypeValue,
  UpdateAiProviderConfigDto,
} from './dto/ai-provider-config.dto';

const AI_PROVIDER_CONFIG_ID = 1;

function buildApiKeyPreview(plaintext: string): string {
  if (plaintext.length <= 8) {
    return '•'.repeat(plaintext.length);
  }
  return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
}

@Injectable()
export class AiProviderConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MaskedConfigCryptoService,
  ) {}

  private toResponse(config: AiProviderConfig): AiProviderConfigResponseDto {
    let hasApiKey = false;
    let apiKeyPreview: string | null = null;

    if (config.apiKeyEnc) {
      try {
        const plaintext = this.crypto.decryptString(config.apiKeyEnc);
        hasApiKey = plaintext.length > 0;
        apiKeyPreview = hasApiKey ? buildApiKeyPreview(plaintext) : null;
      } catch {
        hasApiKey = true;
        apiKeyPreview = '••••••••';
      }
    }

    return {
      provider: config.provider as AiProviderTypeValue,
      model: config.model,
      hasApiKey,
      apiKeyPreview,
      baseUrl: config.baseUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private async ensureSingleton(): Promise<AiProviderConfig> {
    return this.prisma.aiProviderConfig.upsert({
      where: { id: AI_PROVIDER_CONFIG_ID },
      create: {
        id: AI_PROVIDER_CONFIG_ID,
        provider: 'CLAUDE',
        model: '',
      },
      update: {},
    });
  }

  async getConfig(): Promise<AiProviderConfigResponseDto> {
    const config = await this.ensureSingleton();
    return this.toResponse(config);
  }

  async getDecryptedApiKey(): Promise<string | null> {
    const config = await this.ensureSingleton();
    if (!config.apiKeyEnc) return null;
    try {
      return this.crypto.decryptString(config.apiKeyEnc);
    } catch {
      return null;
    }
  }

  async updateConfig(
    dto: UpdateAiProviderConfigDto,
  ): Promise<AiProviderConfigResponseDto> {
    await this.ensureSingleton();

    const data: Parameters<
      typeof this.prisma.aiProviderConfig.update
    >[0]['data'] = {};

    if (dto.provider !== undefined) {
      data.provider = dto.provider;
    }

    if (dto.model !== undefined) {
      data.model = dto.model;
    }

    if (dto.apiKey !== undefined) {
      data.apiKeyEnc =
        dto.apiKey.length > 0 ? this.crypto.encryptString(dto.apiKey) : null;
    }

    if (dto.baseUrl !== undefined) {
      data.baseUrl = dto.baseUrl.length > 0 ? dto.baseUrl : null;
    }

    const updated = await this.prisma.aiProviderConfig.update({
      where: { id: AI_PROVIDER_CONFIG_ID },
      data,
    });

    return this.toResponse(updated);
  }
}
