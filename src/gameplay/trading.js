// Trading economy — STUB pending fan-out #2.
// CONTRACT:
//   priceOf(itemId, system)        → buy price at this system (sell = 0.72x)
//   stationStock(system)           → [{ id, qty, price }] seeded per system
//   ship/tool/suit upgrade purchases handled by the trade UI using UPGRADES.
import { ITEMS } from './items.js';
import { RNG, hashString } from '../core/rng.js';

export function priceOf(itemId, system) {
  const base = ITEMS[itemId]?.value ?? 10;
  const rng = new RNG(hashString(`${system.id}:${itemId}:price`));
  return Math.max(1, Math.round(base * rng.range(0.8, 1.35)));
}

export function stationStock(system) {
  const rng = new RNG(hashString(`${system.id}:stock`));
  const pool = Object.keys(ITEMS).filter((id) => ITEMS[id].category !== 'artifact');
  const count = rng.int(6, 10);
  const stock = [];
  for (let i = 0; i < count && pool.length; i++) {
    const id = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    stock.push({ id, qty: rng.int(5, 60), price: priceOf(id, system) });
  }
  return stock;
}
