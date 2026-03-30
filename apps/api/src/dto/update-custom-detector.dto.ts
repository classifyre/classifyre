import { PartialType } from '@nestjs/swagger';
import { CreateCustomDetectorDto } from './create-custom-detector.dto';

export class UpdateCustomDetectorDto extends PartialType(
  CreateCustomDetectorDto,
) {}
