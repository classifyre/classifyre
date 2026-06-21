import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DemoModeService } from './demo-mode.service';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import type { InstanceSettings, Prisma } from '@prisma/client';
import { InstanceSettingsResponseDto } from './dto/instance-settings-response.dto';
import { UpdateInstanceSettingsDto } from './dto/update-instance-settings.dto';

const INSTANCE_SETTINGS_ID = 1;

const isInstanceTokenSet =
  process.env.HF_TOKEN_INSTANCE_SET === '1' ||
  process.env.HF_TOKEN_INSTANCE_SET === 'true';

@Injectable()
export class InstanceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly demoMode: DemoModeService,
    private readonly crypto: MaskedConfigCryptoService,
  ) {}

  private toResponse(settings: InstanceSettings): InstanceSettingsResponseDto {
    return {
      id: settings.id,
      aiEnabled: settings.aiEnabled,
      mcpEnabled: settings.mcpEnabled,
      language: settings.language,
      timezone: settings.timezone,
      timeFormat: settings.timeFormat,
      aiProviderConfigId: settings.aiProviderConfigId,
      autopilotInquiryEnabled: settings.autopilotInquiryEnabled,
      autopilotInquiryDesired: settings.autopilotInquiryDesired,
      autopilotInquirySearchable: settings.autopilotInquirySearchable,
      autopilotCaseEnabled: settings.autopilotCaseEnabled,
      autopilotCaseGuidance: settings.autopilotCaseGuidance,
      autopilotConfigEnabled: settings.autopilotConfigEnabled,
      autopilotConfigGuidance: settings.autopilotConfigGuidance,
      autopilotDetectorEnabled: settings.autopilotDetectorEnabled,
      autopilotDetectorGuidance: settings.autopilotDetectorGuidance,
      autopilotMcpEnabled: settings.autopilotMcpEnabled,
      hfTokenSet: !!settings.hfTokenEnc,
      hfTokenInstanceSet: isInstanceTokenSet,
      demoMode: this.demoMode.isDemoMode,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  private async ensureSingleton(): Promise<InstanceSettings> {
    return this.prisma.instanceSettings.upsert({
      where: { id: INSTANCE_SETTINGS_ID },
      create: {
        id: INSTANCE_SETTINGS_ID,
        aiEnabled: true,
        mcpEnabled: true,
        language: 'AUTOMATIC',
        timezone: 'AUTOMATIC',
        timeFormat: 'AUTOMATIC',
      },
      update: {},
    });
  }

  async getSettings(): Promise<InstanceSettingsResponseDto> {
    const settings = await this.ensureSingleton();
    return this.toResponse(settings);
  }

  async updateSettings(
    updateDto: UpdateInstanceSettingsDto,
  ): Promise<InstanceSettingsResponseDto> {
    await this.ensureSingleton();

    const rawTimezone = updateDto.timezone?.trim();
    if (updateDto.timezone !== undefined && !rawTimezone) {
      throw new BadRequestException('timezone cannot be empty');
    }
    // Allow "AUTOMATIC" as a special value (resolved client-side)
    const timezone = rawTimezone;

    let aiProviderConfigUpdate: Prisma.InstanceSettingsUpdateInput | null =
      null;
    if (updateDto.aiProviderConfigId !== undefined) {
      const targetId = updateDto.aiProviderConfigId?.trim() || null;
      if (targetId) {
        const exists = await this.prisma.aiProviderConfig.findUnique({
          where: { id: targetId },
          select: { id: true },
        });
        if (!exists) {
          throw new BadRequestException(
            `AI provider config "${targetId}" does not exist`,
          );
        }
        aiProviderConfigUpdate = {
          aiProviderConfig: { connect: { id: targetId } },
        };
      } else {
        aiProviderConfigUpdate = {
          aiProviderConfig: { disconnect: true },
        };
      }
    }

    const data: Prisma.InstanceSettingsUpdateInput = {
      ...(updateDto.aiEnabled !== undefined
        ? { aiEnabled: updateDto.aiEnabled }
        : {}),
      ...(updateDto.mcpEnabled !== undefined
        ? { mcpEnabled: updateDto.mcpEnabled }
        : {}),
      ...(updateDto.language !== undefined
        ? { language: updateDto.language }
        : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(updateDto.timeFormat !== undefined
        ? { timeFormat: updateDto.timeFormat }
        : {}),
      ...(updateDto.autopilotInquiryEnabled !== undefined
        ? { autopilotInquiryEnabled: updateDto.autopilotInquiryEnabled }
        : {}),
      ...(updateDto.autopilotInquiryDesired !== undefined
        ? {
            autopilotInquiryDesired: emptyToNull(
              updateDto.autopilotInquiryDesired,
            ),
          }
        : {}),
      ...(updateDto.autopilotInquirySearchable !== undefined
        ? {
            autopilotInquirySearchable: emptyToNull(
              updateDto.autopilotInquirySearchable,
            ),
          }
        : {}),
      ...(updateDto.autopilotCaseEnabled !== undefined
        ? { autopilotCaseEnabled: updateDto.autopilotCaseEnabled }
        : {}),
      ...(updateDto.autopilotCaseGuidance !== undefined
        ? {
            autopilotCaseGuidance: emptyToNull(updateDto.autopilotCaseGuidance),
          }
        : {}),
      ...(updateDto.autopilotConfigEnabled !== undefined
        ? { autopilotConfigEnabled: updateDto.autopilotConfigEnabled }
        : {}),
      ...(updateDto.autopilotConfigGuidance !== undefined
        ? {
            autopilotConfigGuidance: emptyToNull(
              updateDto.autopilotConfigGuidance,
            ),
          }
        : {}),
      ...(updateDto.autopilotDetectorEnabled !== undefined
        ? { autopilotDetectorEnabled: updateDto.autopilotDetectorEnabled }
        : {}),
      ...(updateDto.autopilotDetectorGuidance !== undefined
        ? {
            autopilotDetectorGuidance: emptyToNull(
              updateDto.autopilotDetectorGuidance,
            ),
          }
        : {}),
      ...(updateDto.autopilotMcpEnabled !== undefined
        ? { autopilotMcpEnabled: updateDto.autopilotMcpEnabled }
        : {}),
      ...(aiProviderConfigUpdate ?? {}),
      ...(updateDto.hfToken !== undefined
        ? {
            hfTokenEnc:
              updateDto.hfToken && updateDto.hfToken.length > 0
                ? this.crypto.encryptString(updateDto.hfToken)
                : null,
          }
        : {}),
    };

    const settings = await this.prisma.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data,
    });

    return this.toResponse(settings);
  }

  /** Returns the decrypted user-configured HF token, or null if not set. */
  async getUserHfToken(): Promise<string | null> {
    if (isInstanceTokenSet) {
      return null;
    }
    const settings = await this.ensureSingleton();
    if (!settings.hfTokenEnc) {
      return null;
    }
    return this.crypto.decryptString(settings.hfTokenEnc);
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
