export class PrismaClient {
  $connect() {
    return Promise.resolve();
  }

  $disconnect() {
    return Promise.resolve();
  }

  $transaction(fn: any) {
    return typeof fn === 'function' ? fn(this) : Promise.all(fn);
  }

  lead = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  conversation = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  message = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  agentAnalysis = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  knowledgeBase = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  agentSettings = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

/**
 * Minimal stand-in for the `Prisma` namespace exported by the real
 * `@prisma/client`. The settings service uses `Prisma.JsonNull` (and friends)
 * as sentinel values when writing nullable JSON columns, so the mock must
 * expose them. The string values are only used for identity comparisons in
 * tests.
 */
export const Prisma = {
  JsonNull: 'JsonNull',
  DbNull: 'DbNull',
  AnyNull: 'AnyNull',
};
