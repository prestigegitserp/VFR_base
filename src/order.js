export function lineFor(item, size, color, result) {
  const swatch = item.colors[color] ?? item.colors[0];
  return {
    id: `${item.id}|${size.sku}|${swatch.value}`,
    itemId: item.id, title: item.title, sku: size.sku, size: size.label,
    color: swatch.label, hex: swatch.value, fit: result?.status ?? 'insufficient',
    availability: size.url ? 'merchant' : 'demo', url: size.url ?? null,
  };
}

export function makeOrder(lines) {
  return {
    protocol: 'vfr.order-draft/1',
    createdAt: new Date().toISOString(),
    items: lines.map(({ itemId, title, sku, size, color, availability }) => ({ itemId, title, sku, size, color, availability, quantity: 1 })),
  };
}
