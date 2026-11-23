import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DataQueryModule } from '../data-query/data-query.module';
import { PrismaService } from '../prisma.service';
import { FindingContentInterceptor } from './finding-content.interceptor';
import { FindingContentService } from './finding-content.service';

/** Who reads what findings found, on every surface (finding-content.service.ts). */
@Global()
@Module({
  imports: [DataQueryModule],
  providers: [
    PrismaService,
    FindingContentService,
    { provide: APP_INTERCEPTOR, useClass: FindingContentInterceptor },
  ],
  exports: [FindingContentService],
})
export class FindingContentModule {}
