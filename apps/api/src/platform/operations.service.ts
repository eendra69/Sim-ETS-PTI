import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class OperationsService implements OnModuleDestroy {
  private readonly pool?: Pool;

  constructor() {
    if (process.env.NODE_ENV !== 'test' && process.env.PERSISTENCE_MODE === 'postgres' && process.env.DATABASE_URL) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    }
  }

  async readiness(): Promise<{ status: 'ready'; database: 'postgres' | 'in-memory' }> {
    if (!this.pool) return { status: 'ready', database: 'in-memory' };
    await this.pool.query('SELECT 1');
    return { status: 'ready', database: 'postgres' };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
