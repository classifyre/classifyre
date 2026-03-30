import { Injectable } from '@nestjs/common';
import { InstanceSettingsService } from '../instance-settings.service';
import * as en from './en.json';
import * as de from './de.json';

type TranslationObject = { [key: string]: string | TranslationObject };
type Translations = typeof en;

const translationMap: Record<string, Translations> = {
  ENGLISH: en,
  GERMAN: de,
};

@Injectable()
export class I18nService {
  constructor(
    private readonly instanceSettingsService: InstanceSettingsService,
  ) {}

  /**
   * Translate a dot-notation key using the current instance language.
   * Supports {{param}} interpolation.
   *
   * Example: t('errors.source.notFound', { id: '123' })
   */
  async t(
    key: string,
    params?: Record<string, string | number>,
  ): Promise<string> {
    const settings = await this.instanceSettingsService.getSettings();
    const translations: Translations = translationMap[settings.language] ?? en;
    return I18nService.resolve(
      translations as unknown as TranslationObject,
      key,
      params,
    );
  }

  private static resolve(
    translations: TranslationObject,
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const parts = key.split('.');
    let value: string | TranslationObject | undefined = translations;

    for (const part of parts) {
      if (typeof value === 'object' && value !== null) {
        value = value[part];
      } else {
        return key;
      }
    }

    if (typeof value !== 'string') return key;

    if (!params) return value;

    return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) =>
      String(params[paramKey] ?? `{{${paramKey}}}`),
    );
  }
}
