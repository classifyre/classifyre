import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

type PgBossModule = typeof import('pg-boss');
type PgBossInstance = InstanceType<PgBossModule['PgBoss']>;

@Injectable()
export class PgBossService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBossInstance | null = null;

  private async ensureBoss(): Promise<PgBossInstance> {
    if (this.boss) {
      return this.boss;
    }

    const { PgBoss } = await import('pg-boss');
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });

    boss.on('error', (error) => {
      this.logger.error('pg-boss error:', error);
    });

    this.boss = boss;
    return boss;
  }

  async onApplicationBootstrap(): Promise<void> {
    const boss = await this.ensureBoss();
    await boss.start();
    this.logger.log('pg-boss started');
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.boss) {
      return;
    }

    await this.boss.stop({ graceful: true, timeout: 10_000 });
    this.boss = null;
    this.logger.log('pg-boss stopped');
  }

  async getBossAsync(): Promise<PgBossInstance> {
    return this.ensureBoss();
  }

  getBoss(): PgBossInstance {
    if (!this.boss) {
      throw new Error('pg-boss is not initialized yet');
    }
    return this.boss;
  }
}
