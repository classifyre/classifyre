import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import { AiConfigError } from './ai/errors';
import type { AiProviderRuntimeConfig } from './ai/types';
import type { AiProviderConfig, Prisma } from '@prisma/client';
import type {
  AiProviderConfigResponseDto,
  CreateAiProviderConfigDto,
  UpdateAiProviderConfigDto,
} from './dto/ai-provider-config.dto';

const INSTANCE_SETTINGS_ID = 1;

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
      id: config.id,
      name: config.name,
      provider: config.provider,
      model: config.model,
      hasApiKey,
      apiKeyPreview,
      baseUrl: config.baseUrl,
      contextSize: config.contextSize,
      supportsVision: config.supportsVision,
      inputCostPerMTok:
        config.inputCostPerMTok != null
          ? Number(config.inputCostPerMTok)
          : null,
      outputCostPerMTok:
        config.outputCostPerMTok != null
          ? Number(config.outputCostPerMTok)
          : null,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private async findOrThrow(id: string): Promise<AiProviderConfig> {
    const config = await this.prisma.aiProviderConfig.findUnique({
      where: { id },
    });
    if (!config) {
      throw new NotFoundException(`AI provider config "${id}" not found.`);
    }
    return config;
  }

  async list(): Promise<AiProviderConfigResponseDto[]> {
    const configs = await this.prisma.aiProviderConfig.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return configs.map((config) => this.toResponse(config));
  }

  async get(id: string): Promise<AiProviderConfigResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async create(
    dto: CreateAiProviderConfigDto,
  ): Promise<AiProviderConfigResponseDto> {
    const created = await this.prisma.aiProviderConfig.create({
      data: {
        name: dto.name,
        provider: dto.provider,
        model: dto.model ?? '',
        apiKeyEnc:
          dto.apiKey && dto.apiKey.length > 0
            ? this.crypto.encryptString(dto.apiKey)
            : null,
        baseUrl: dto.baseUrl && dto.baseUrl.length > 0 ? dto.baseUrl : null,
        contextSize: dto.contextSize ?? null,
        supportsVision: dto.supportsVision ?? false,
        inputCostPerMTok: dto.inputCostPerMTok ?? null,
        outputCostPerMTok: dto.outputCostPerMTok ?? null,
      },
    });
    return this.toResponse(created);
  }

  async update(
    id: string,
    dto: UpdateAiProviderConfigDto,
  ): Promise<AiProviderConfigResponseDto> {
    await this.findOrThrow(id);

    const data: Prisma.AiProviderConfigUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
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
    if (dto.contextSize !== undefined) {
      data.contextSize = dto.contextSize;
    }
    if (dto.supportsVision !== undefined) {
      data.supportsVision = dto.supportsVision;
    }
    if (dto.inputCostPerMTok !== undefined) {
      data.inputCostPerMTok = dto.inputCostPerMTok;
    }
    if (dto.outputCostPerMTok !== undefined) {
      data.outputCostPerMTok = dto.outputCostPerMTok;
    }

    const updated = await this.prisma.aiProviderConfig.update({
      where: { id },
      data,
    });
    return this.toResponse(updated);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);

    // Detectors reference this credential via an onDelete: Restrict FK, so a
    // raw delete throws Prisma P2003. Surface a clear 409 with the dependent
    // detector count instead of a generic 500.
    const dependentDetectors = await this.prisma.customDetector.count({
      where: { aiProviderConfigId: id },
    });
    if (dependentDetectors > 0) {
      throw new ConflictException(
        `Cannot delete this AI provider: it is used by ${dependentDetectors} custom detector` +
          `${dependentDetectors === 1 ? '' : 's'}. Reassign or delete them first.`,
      );
    }

    await this.prisma.aiProviderConfig.delete({ where: { id } });
  }

  /** The provider selected as the instance-wide default, or null when unset. */
  async getDefaultConfigId(): Promise<string | null> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { aiProviderConfigId: true },
    });
    return settings?.aiProviderConfigId ?? null;
  }

  /**
   * Resolve a usable runtime config (with decrypted key) for the given id.
   * Throws AiConfigError when the credential lacks a key or model.
   */
  async getRuntimeConfig(id: string): Promise<AiProviderRuntimeConfig> {
    const config = await this.findOrThrow(id);

    let apiKey: string | null = null;
    if (config.apiKeyEnc) {
      try {
        apiKey = this.crypto.decryptString(config.apiKeyEnc);
      } catch {
        apiKey = null;
      }
    }

    if (!apiKey) {
      throw new AiConfigError(
        `AI provider "${config.name}" has no API key configured.`,
      );
    }
    if (!config.model.trim()) {
      throw new AiConfigError(
        `AI provider "${config.name}" has no model configured.`,
      );
    }

    return {
      provider: config.provider,
      model: config.model,
      apiKey,
      baseUrl: config.baseUrl,
      contextSize: config.contextSize,
      supportsVision: config.supportsVision,
    };
  }
}
