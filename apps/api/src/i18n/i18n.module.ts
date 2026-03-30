import { Module } from '@nestjs/common';
import { I18nService } from './i18n.service';
import { InstanceSettingsService } from '../instance-settings.service';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [I18nService, InstanceSettingsService, PrismaService],
  exports: [I18nService],
})
export class I18nModule {}
