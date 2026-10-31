import type { Ipo } from '../types';

/** A data provider turns some external source into canonical Ipo records. */
export interface IpoProvider {
  name: string;
  fetchUpcoming(): Promise<Ipo[]>;
}
