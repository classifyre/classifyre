import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    console.log(
      '[PrismaService] DATABASE_URL:',
      process.env.DATABASE_URL?.substring(0, 100),
    );
    const rawUrl = new URL(process.env.DATABASE_URL ?? '');
    const schema = rawUrl.searchParams.get('schema');
    rawUrl.searchParams.delete('schema');
    const pool = new Pool({
      connectionString: rawUrl.toString(),
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    const adapter = new PrismaPg(pool, { schema: schema ?? undefined });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
