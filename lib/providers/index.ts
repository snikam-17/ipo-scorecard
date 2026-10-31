import type { IpoProvider } from './types';
import { GenericJsonProvider } from './generic-json';

export function getProvider(): IpoProvider {
  // Add more providers here (e.g. a CSV/manual-upload provider) and switch on an env var.
  return new GenericJsonProvider();
}
