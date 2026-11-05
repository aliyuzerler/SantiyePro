/** ISO DateTime → YYYY-MM-DD (PostgreSQL DATE kolonu UTC gece yarısı döner; kayma yaşanmaz). */
export function dateOnlyValue(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}
