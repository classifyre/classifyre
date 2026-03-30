import { ApiProperty } from '@nestjs/swagger';
import { GlossaryFilterMappingDto } from './create-glossary-term.dto';

export class UpdateGlossaryTermDto {
  @ApiProperty({ required: false })
  displayName?: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false })
  category?: string;

  @ApiProperty({ type: GlossaryFilterMappingDto, required: false })
  filterMapping?: GlossaryFilterMappingDto;

  @ApiProperty({ required: false })
  color?: string;

  @ApiProperty({ required: false })
  icon?: string;

  @ApiProperty({ required: false })
  isActive?: boolean;
}
