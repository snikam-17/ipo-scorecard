import type { ListingProvider } from './types';
import { UpstoxProvider } from './upstox';

export function getProvider(): ListingProvider {
  // Add more providers here (e.g. a second feed for cross-checking) and switch on an env var.
  return new UpstoxProvider();
}
