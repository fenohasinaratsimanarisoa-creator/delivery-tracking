import { acquireCronLock } from './cron-lock';

describe('acquireCronLock', () => {
  it('exécute (retourne true) quand Redis est absent (mono-instance)', async () => {
    await expect(acquireCronLock(null, 'x', 60)).resolves.toBe(true);
    await expect(acquireCronLock(undefined, 'x', 60)).resolves.toBe(true);
  });

  it('retourne true quand le SET NX réussit (verrou acquis)', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK') } as any;
    await expect(acquireCronLock(redis, 'billing.expiry', 3600)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'cron:lock:billing.expiry',
      expect.any(String),
      'EX',
      3600,
      'NX',
    );
  });

  it('retourne false quand le verrou est déjà tenu par une autre instance', async () => {
    const redis = { set: jest.fn().mockResolvedValue(null) } as any;
    await expect(acquireCronLock(redis, 'digest.daily', 3600)).resolves.toBe(false);
  });

  it('retourne true (repli mono-instance) si Redis lève une erreur', async () => {
    const redis = { set: jest.fn().mockRejectedValue(new Error('ECONNRESET')) } as any;
    await expect(acquireCronLock(redis, 'digest.daily', 3600)).resolves.toBe(true);
  });
});
