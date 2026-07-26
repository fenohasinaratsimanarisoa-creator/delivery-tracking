import { Test, TestingModule } from '@nestjs/testing';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlertService } from '../alerting/alert.service';
import type { ArgumentsHost } from '@nestjs/common';

function mockRequest(url = '/test', overrides = {}) {
  return {
    url,
    requestId: 'test-req-1',
    log: { error: jest.fn() },
    ...overrides,
  } as any;
}

function mockResponse() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as any;
}

function mockHost(req: any, res: any): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => ({}),
    }),
    getArgs: () => [req, res],
    getArgByIndex: (_i: number) => req,
    switchToRpc: () => { throw new Error('Not implemented'); },
    switchToWs: () => { throw new Error('Not implemented'); },
    getType: () => 'http' as any,
  } as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllExceptionsFilter,
        { provide: AlertService, useValue: { sendCriticalError: jest.fn() } },
      ],
    }).compile();

    filter = module.get<AllExceptionsFilter>(AllExceptionsFilter);
  });

  describe('Prisma P2002 — Unique constraint', () => {
    it('should return 409 Conflict with field name', () => {
      const req = mockRequest('/users');
      const res = mockResponse();
      const err = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        { code: 'P2002', clientVersion: '5.22' },
      );
      (err as any).meta = { target: ['email'] };

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          message: 'Cette ressource existe déjà : email',
        }),
      );
    });

    it('should return 409 Conflict for multi-field unique', () => {
      const req = mockRequest('/drivers');
      const res = mockResponse();
      const err = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`license_number`)',
        { code: 'P2002', clientVersion: '5.22' },
      );
      (err as any).meta = { target: ['licenseNumber'] };

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          message: 'Cette ressource existe déjà : licenseNumber',
        }),
      );
    });
  });

  describe('Prisma P2003 — Foreign key constraint', () => {
    it('should return 400 Bad Request with field name', () => {
      const req = mockRequest('/deliveries');
      const res = mockResponse();
      const err = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed on the field: `vehicle_id`',
        { code: 'P2003', clientVersion: '5.22' },
      );
      (err as any).meta = { field_name: 'vehicle_id' };

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Référence invalide : vehicle_id introuvable',
        }),
      );
    });
  });

  describe('Prisma P2025 — Record not found', () => {
    it('should return 404 Not Found', () => {
      const req = mockRequest('/users/some-id');
      const res = mockResponse();
      const err = new Prisma.PrismaClientKnownRequestError(
        'Record to update not found.',
        { code: 'P2025', clientVersion: '5.22' },
      );

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Ressource introuvable',
        }),
      );
    });
  });

  describe('Prisma P2000 — Value too long', () => {
    it('should return 400 Bad Request', () => {
      const req = mockRequest('/vehicles');
      const res = mockResponse();
      const err = new Prisma.PrismaClientKnownRequestError(
        'The provided value for the column is too long',
        { code: 'P2000', clientVersion: '5.22' },
      );

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Valeur trop longue pour la colonne',
        }),
      );
    });
  });

  describe('Prisma unmapped code', () => {
    it('should return 500 with generic message and include requestId', () => {
      const req = mockRequest('/some-route');
      const res = mockResponse();
      const err = new Prisma.PrismaClientKnownRequestError(
        'Some obscure Prisma error with schema details',
        { code: 'P2010', clientVersion: '5.22' },
      );

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Erreur interne de la base de données',
          requestId: 'test-req-1',
        }),
      );
      expect(res.json).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('schema') }),
      );
    });
  });

  describe('PrismaClientValidationError', () => {
    it('should return 400 Bad Request', () => {
      const req = mockRequest('/users');
      const res = mockResponse();
      const err = new Prisma.PrismaClientValidationError(
        'Invalid value for argument',
        { clientVersion: '5.22' },
      );

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Données invalides envoyées à la base de données',
        }),
      );
    });
  });

  describe('HttpException', () => {
    it('should pass through HttpException status and message', () => {
      const req = mockRequest('/users');
      const res = mockResponse();
      const err = new HttpException('Custom error', HttpStatus.FORBIDDEN);

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Custom error',
        }),
      );
    });

    it('should handle HttpException with object response', () => {
      const req = mockRequest('/users');
      const res = mockResponse();
      const err = new HttpException(
        { message: ['email must be an email', 'password too short'] },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: ['email must be an email', 'password too short'],
        }),
      );
    });
  });

  describe('Unknown error', () => {
    it('should return 500 with generic message and include requestId', () => {
      const req = mockRequest('/unknown');
      const res = mockResponse();
      const err = new Error('Something completely unexpected');

      filter.catch(err, mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
          requestId: 'test-req-1',
        }),
      );
    });
  });
});
