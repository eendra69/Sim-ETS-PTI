export const number = new Intl.NumberFormat('id-ID');
export const money = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${number.format(value)}`;
}
export function priceOrDash(value: number | null): string {
  return value === null ? '—' : money.format(value);
}
