import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateDefaultFuelPricesDto } from './update-default-fuel-prices.dto';

// Reproduit la config du pipe global de main.ts (whitelist + forbidNonWhitelisted).
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta = { type: 'body', metatype: UpdateDefaultFuelPricesDto, data: '' } as any;

describe('UpdateDefaultFuelPricesDto (validation)', () => {
  it('rejects an unknown key with a clear 400', async () => {
    let error: any;
    try {
      await pipe.transform({ mazout: 100 } as any, meta);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const message = (error.getResponse() as any).message as string[];
    console.log(`[unknown key] messages: ${JSON.stringify(message)}`);
    expect(message.some((m) => m.includes('mazout should not exist'))).toBe(true);
  });

  it('rejects a value above the Ariary market cap (50000)', async () => {
    let error: any;
    try {
      await pipe.transform({ diesel: 60000 } as any, meta);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const message = (error.getResponse() as any).message as string[];
    console.log(`[out of bounds] messages: ${JSON.stringify(message)}`);
    expect(message.some((m) => m.includes('diesel must not be greater than 50000'))).toBe(true);
  });

  it('rejects a negative value', async () => {
    let error: any;
    try {
      await pipe.transform({ essence: -1 } as any, meta);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const message = (error.getResponse() as any).message as string[];
    expect(message.some((m) => m.includes('essence must not be less than 0'))).toBe(true);
  });

  it('accepts a valid payload with only known keys in range', async () => {
    const dto = (await pipe.transform(
      { essence: 5000, gasoil: 4900, diesel: 4900, electric: 0, hybrid: 3000 },
      meta,
    )) as UpdateDefaultFuelPricesDto;
    expect(dto).toBeInstanceOf(UpdateDefaultFuelPricesDto);
    expect(dto.essence).toBe(5000);
    expect(dto.gasoil).toBe(4900);
    expect(dto.electric).toBe(0);
  });
});
