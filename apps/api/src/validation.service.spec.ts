import { BadRequestException } from '@nestjs/common';
import { ValidationService } from './validation.service';

describe('ValidationService, Mounted Folder sources', () => {
  const service = new ValidationService();
  const folder = (path: string) => ({
    type: 'LOCAL_FOLDER',
    required: { path },
  });

  it('refuses a folder holding Classifyre’s own state when the source is saved', () => {
    // The all-in-one image's /var/lib/classifyre holds masked-config.key
    // (re-review 2026-11-22); the CLI refuses it again at every run.
    expect(() =>
      service.validate('LOCAL_FOLDER', folder('/var/lib/classifyre')),
    ).toThrow(BadRequestException);
    expect(() => service.validate('LOCAL_FOLDER', folder('/'))).toThrow(
      /cannot be a source/,
    );
  });

  it('takes a folder mounted for data', () => {
    expect(() =>
      service.validate('LOCAL_FOLDER', folder('/data/case-files')),
    ).not.toThrow(/cannot be a source/);
  });
});
