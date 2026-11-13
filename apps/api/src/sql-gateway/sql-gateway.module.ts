import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataQueryModule } from '../data-query/data-query.module';
import { SqlConnectionsModule } from '../sql-connections/sql-connections.module';
import { SqlGatewayService } from './sql-gateway.service';

/** The PostgreSQL endpoint for SQL connections (docs/prd/DQ-data-query.md §5.7). */
@Module({
  imports: [DataQueryModule, SqlConnectionsModule],
  providers: [PrismaService, SqlGatewayService],
})
export class SqlGatewayModule {}
