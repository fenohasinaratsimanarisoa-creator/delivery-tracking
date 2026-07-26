import { AsyncLocalStorage } from 'async_hooks';

export class CompanyScopedContext {
  private static readonly storage = new AsyncLocalStorage<string | null>();

  static run<T>(companyId: string | null, fn: () => T): T {
    return this.storage.run(companyId, fn);
  }

  static get(): string | null | undefined {
    return this.storage.getStore();
  }
}
