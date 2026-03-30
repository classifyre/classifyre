import { Global, Module } from '@nestjs/common';
import { PgBossService } from './pg-boss.service';

@Global()
@Module({ providers: [PgBossService], exports: [PgBossService] })
export class PgBossModule {}
