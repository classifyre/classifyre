import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SourceService } from './source.service';
import { AssetService } from './asset.service';
import { ValidationService } from './validation.service';
import { CliRunnerService } from './cli-runner/cli-runner.service';

// Mock the uuid module to avoid ESM issues
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}));

describe('AppController', () => {
  let appController: AppController;

  const mockSourceService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockAssetService = {
    bulkIngest: jest.fn(),
  };

  const mockValidationService = {
    validateRecipe: jest.fn(),
  };

  const mockCliRunnerService = {
    startRun: jest.fn(),
    updateRunnerStatus: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: SourceService, useValue: mockSourceService },
        { provide: AssetService, useValue: mockAssetService },
        { provide: ValidationService, useValue: mockValidationService },
        { provide: CliRunnerService, useValue: mockCliRunnerService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
