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
      mcpEnabled: settings.mcpEnabled,
      language: settings.language,
      timezone: settings.timezone,
      timeFormat: settings.timeFormat,
      aiProviderConfigId: settings.aiProviderConfigId,
      harnessAiProviderConfigId: settings.harnessAiProviderConfigId,
      autopilotInquiryEnabled: settings.autopilotInquiryEnabled,
      autopilotCaseEnabled: settings.autopilotCaseEnabled,
      autopilotConfigEnabled: settings.autopilotConfigEnabled,
      autopilotDetectorEnabled: settings.autopilotDetectorEnabled,
      autopilotEscalationEnabled: settings.autopilotEscalationEnabled,
      autopilotMcpEnabled: settings.autopilotMcpEnabled,
      harnessRunBudgetMinutes: settings.harnessRunBudgetMinutes,
      harnessRunStaleAfterMinutes: settings.harnessRunStaleAfterMinutes,
      harnessCycleBudgetMinutes: settings.harnessCycleBudgetMinutes,
      harnessEvidenceUsableFindings: settings.harnessEvidenceUsableFindings,
      harnessEvidenceUsableCoverage: settings.harnessEvidenceUsableCoverage,
      harnessEvidenceWarnCoverage: settings.harnessEvidenceWarnCoverage,
      harnessExpressImportance: settings.harnessExpressImportance,
      harnessObservationChars: settings.harnessObservationChars,
      harnessTurnObservationChars: settings.harnessTurnObservationChars,
      harnessMaxRankedFindings: settings.harnessMaxRankedFindings,
      harnessMaxGlossaryEntries: settings.harnessMaxGlossaryEntries,
      harnessMaxRecalledMemories: settings.harnessMaxRecalledMemories,
      harnessDreamIntervalDays: settings.harnessDreamIntervalDays,
      autoScheduleEnabled: settings.autoScheduleEnabled,
      maxConcurrentRunners: settings.maxConcurrentRunners,
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
        mcpEnabled: true,
        autopilotInquiryEnabled: true,
        autopilotCaseEnabled: true,
        autopilotConfigEnabled: true,
        autopilotDetectorEnabled: true,
        autopilotEscalationEnabled: true,
        autopilotMcpEnabled: true,
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

    let harnessAiProviderConfigUpdate: Prisma.InstanceSettingsUpdateInput | null =
      null;
    if (updateDto.harnessAiProviderConfigId !== undefined) {
      const targetId = updateDto.harnessAiProviderConfigId?.trim() || null;
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
        harnessAiProviderConfigUpdate = {
          harnessAiProviderConfig: { connect: { id: targetId } },
        };
      } else {
        harnessAiProviderConfigUpdate = {
          harnessAiProviderConfig: { disconnect: true },
        };
      }
    }

    const data: Prisma.InstanceSettingsUpdateInput = {
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
      ...(updateDto.autopilotCaseEnabled !== undefined
        ? { autopilotCaseEnabled: updateDto.autopilotCaseEnabled }
        : {}),
      ...(updateDto.autopilotConfigEnabled !== undefined
        ? { autopilotConfigEnabled: updateDto.autopilotConfigEnabled }
        : {}),
      ...(updateDto.autopilotDetectorEnabled !== undefined
        ? { autopilotDetectorEnabled: updateDto.autopilotDetectorEnabled }
        : {}),
      ...(updateDto.autopilotEscalationEnabled !== undefined
        ? { autopilotEscalationEnabled: updateDto.autopilotEscalationEnabled }
        : {}),
      ...(updateDto.autopilotMcpEnabled !== undefined
        ? { autopilotMcpEnabled: updateDto.autopilotMcpEnabled }
        : {}),
      ...(updateDto.harnessRunBudgetMinutes !== undefined
        ? { harnessRunBudgetMinutes: updateDto.harnessRunBudgetMinutes }
        : {}),
      ...(updateDto.harnessRunStaleAfterMinutes !== undefined
        ? { harnessRunStaleAfterMinutes: updateDto.harnessRunStaleAfterMinutes }
        : {}),
      ...(updateDto.harnessCycleBudgetMinutes !== undefined
        ? { harnessCycleBudgetMinutes: updateDto.harnessCycleBudgetMinutes }
        : {}),
      ...(updateDto.harnessEvidenceUsableFindings !== undefined
        ? {
            harnessEvidenceUsableFindings:
              updateDto.harnessEvidenceUsableFindings,
          }
        : {}),
      ...(updateDto.harnessEvidenceUsableCoverage !== undefined
        ? {
            harnessEvidenceUsableCoverage:
              updateDto.harnessEvidenceUsableCoverage,
          }
        : {}),
      ...(updateDto.harnessEvidenceWarnCoverage !== undefined
        ? { harnessEvidenceWarnCoverage: updateDto.harnessEvidenceWarnCoverage }
        : {}),
      ...(updateDto.harnessExpressImportance !== undefined
        ? { harnessExpressImportance: updateDto.harnessExpressImportance }
        : {}),
      ...(updateDto.harnessObservationChars !== undefined
        ? { harnessObservationChars: updateDto.harnessObservationChars }
        : {}),
      ...(updateDto.harnessTurnObservationChars !== undefined
        ? { harnessTurnObservationChars: updateDto.harnessTurnObservationChars }
        : {}),
      ...(updateDto.harnessMaxRankedFindings !== undefined
        ? { harnessMaxRankedFindings: updateDto.harnessMaxRankedFindings }
        : {}),
      ...(updateDto.harnessMaxGlossaryEntries !== undefined
        ? { harnessMaxGlossaryEntries: updateDto.harnessMaxGlossaryEntries }
        : {}),
      ...(updateDto.harnessMaxRecalledMemories !== undefined
        ? { harnessMaxRecalledMemories: updateDto.harnessMaxRecalledMemories }
        : {}),
      ...(updateDto.harnessDreamIntervalDays !== undefined
        ? { harnessDreamIntervalDays: updateDto.harnessDreamIntervalDays }
        : {}),
      ...(updateDto.autoScheduleEnabled !== undefined
        ? { autoScheduleEnabled: updateDto.autoScheduleEnabled }
        : {}),
      ...(updateDto.maxConcurrentRunners !== undefined
        ? { maxConcurrentRunners: updateDto.maxConcurrentRunners }
        : {}),
      ...(aiProviderConfigUpdate ?? {}),
      ...(harnessAiProviderConfigUpdate ?? {}),
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
