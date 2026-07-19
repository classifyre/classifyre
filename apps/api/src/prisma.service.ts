import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const rawUrl = new URL(process.env.DATABASE_URL ?? '');
    const schema = rawUrl.searchParams.get('schema');
    rawUrl.searchParams.delete('schema');
    // Pass config (not a Pool) so PrismaPg creates its own internal pool using
    // its bundled pg version. Passing a Pool from a different pg version causes
    // instanceof checks inside PrismaPg to fail silently.
    const adapter = new PrismaPg(
      {
        connectionString: rawUrl.toString(),
        // Keep `public` on the search_path: extensions (pgvector's `<=>`
        // operator, pgcrypto, …) are installed there, and a schema-only path
        // makes their operators unresolvable.
        ...(schema ? { options: `-c search_path=${schema},public` } : {}),
      },
      { schema: schema ?? undefined },
    );
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
