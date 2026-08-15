import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

// PrismaClient est mocké : le test unitaire ne vérifie que l'instanciation du
// service, il ne doit PAS exiger de vraie DATABASE_URL (absente du job CI
// unit-test, ce qui faisait échouer le job avec
// PrismaClientConstructorValidationError: Invalid value undefined for datasource "db").
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $use = jest.fn();
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
