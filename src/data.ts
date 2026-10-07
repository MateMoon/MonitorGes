import type { Garantia } from './types';
export type { Garantia } from './types';
export type Status = 'normal' | 'atencion' | 'proxima' | 'critica' | 'vencida';
export const TODAY = new Date(2026, 9, 6);
export const STATUS: Record<Status, { label: string; short: string; dot: string; badge: string; card: string; hex: string; range: string }> = {
  normal: { label: 'Normal', short: 'Normal', dot: 'bg-[#3c9a67]', badge: 'bg-[#e6f4ec] text-[#256b45] ring-[#bfe1cd]', card: 'border-t-[#3c9a67]', hex: '#3c9a67', range: 'Más de 30 días' },
  atencion: { label: 'Atención', short: 'Atención', dot: 'bg-[#d9a416]', badge: 'bg-[#fcf4d9] text-[#7d5c07] ring-[#efdc9a]', card: 'border-t-[#d9a416]', hex: '#d9a416', range: '16–30 días' },
  proxima: { label: 'Próxima a vencer', short: 'Próxima', dot: 'bg-[#dd7a2c]', badge: 'bg-[#fdeadb] text-[#9a4a10] ring-[#f3c9a4]', card: 'border-t-[#dd7a2c]', hex: '#dd7a2c', range: '8–15 días' },
  critica: { label: 'Crítica', short: 'Crítica', dot: 'bg-[#cc4339]', badge: 'bg-[#fbe7e5] text-[#a12a22] ring-[#f1b9b4]', card: 'border-t-[#cc4339]', hex: '#cc4339', range: '0–7 días' },
  vencida: { label: 'Vencida', short: 'Vencida', dot: 'bg-[#3d4756]', badge: 'bg-[#e4e7ec] text-[#2c3542] ring-[#c5cad3]', card: 'border-t-[#3d4756]', hex: '#3d4756', range: 'Menos de 0 días' },
};
export const STATUS_ORDER: Status[] = ['normal', 'atencion', 'proxima', 'critica', 'vencida'];
export function statusFor(days: number): Status { if (days < 0) return 'vencida'; if (days <= 7) return 'critica'; if (days <= 15) return 'proxima'; if (days <= 30) return 'atencion'; return 'normal'; }
export const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
export const rutFull = (g: Garantia) => `${g.rut}-${g.dv}`;
