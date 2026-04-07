import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DemoModeService } from './demo-mode.service';
import type { InstanceSettings, Prisma } from '@prisma/client';
import { InstanceSettingsResponseDto } from './dto/instance-settings-response.dto';
import { UpdateInstanceSettingsDto } from './dto/update-instance-settings.dto';

const INSTANCE_SETTINGS_ID = 1;

@Injectable()
export class InstanceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly demoMode: DemoModeService,
  ) {}

  private toResponse(settings: InstanceSettings): InstanceSettingsResponseDto {
    return {
      id: settings.id,
      aiEnabled: settings.aiEnabled,
      mcpEnabled: settings.mcpEnabled,
      language: settings.language,
      timezone: settings.timezone,
      timeFormat: settings.timeFormat,
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
        language: 'ENGLISH',
        timezone: 'UTC',
        timeFormat: 'TWELVE_HOUR',
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

    const timezone = updateDto.timezone?.trim();
    if (updateDto.timezone !== undefined && !timezone) {
      throw new BadRequestException('timezone cannot be empty');
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
    };

    const settings = await this.prisma.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data,
    });

    return this.toResponse(settings);
  }
}
