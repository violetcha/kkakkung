import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The product Compose overlay is the only source of the deployed room capacity. */
export function productCapacityOverlay(operatingMode) {
  return operatingMode === 'continuous'
    ? 'infra/compose.continuous.yaml'
    : 'infra/compose.product.yaml';
}

export function readProductCapacity(root, operatingMode) {
  const text = readFileSync(resolve(root, productCapacityOverlay(operatingMode)), 'utf8');
  const value = (name) => {
    const matches = [...text.matchAll(new RegExp(`^\\s+${name}: '(\\d+)'$`, 'gm'))];
    if (matches.length !== 1) throw new Error('PRODUCT_CAPACITY_INVALID');
    return matches[0][1];
  };
  const capacity = { MAX_ROOMS: value('MAX_ROOMS'), MAX_SLOTS: value('MAX_SLOTS') };
  if (Number(capacity.MAX_SLOTS) !== Number(capacity.MAX_ROOMS) * 6)
    throw new Error('PRODUCT_CAPACITY_INVALID');
  return capacity;
}
