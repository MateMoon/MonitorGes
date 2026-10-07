// Adaptador mock temporal: sustituir estas funciones por llamadas HTTP a /api/garantias.
import { GARANTIAS_DATA } from '../data/mockData';
import type { Garantia } from '../types';
export function getGarantias(): Garantia[] { return GARANTIAS_DATA; }
export function getGarantiaById(id: number): Garantia | undefined { return GARANTIAS_DATA.find((g) => g.id === id); }
