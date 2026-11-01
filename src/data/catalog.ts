// Ingredients and menu items. All balance numbers live in /src/data so designers
// can tune the game without touching simulation code.

export type IngId =
  | 'dough' | 'sauce' | 'cheese' | 'pepperoni' | 'ham' | 'sausage' | 'chicken'
  | 'mushroom' | 'pepper' | 'onion' | 'olive' | 'pineapple' | 'basil' | 'bbq'
  | 'garlic' | 'soda' | 'box';

export interface IngredientDef {
  id: IngId;
  name: string;
  /** Base wholesale cost per unit at the Standard supplier. */
  cost: number;
  /** Days before a delivered batch spoils (999 = never). */
  shelf: number;
  /** Cold-storage units each unit occupies (0 = kept on dry shelves or in the drinks fridge). */
  space: number;
  color: string;
  unit: string;
}

export const INGREDIENTS: IngredientDef[] = [
  { id: 'dough', name: 'Dough balls', cost: 0.66, shelf: 3, space: 0.5, color: '#e8c98f', unit: 'ball' },
  { id: 'sauce', name: 'Tomato sauce', cost: 0.42, shelf: 6, space: 0.25, color: '#c8352a', unit: 'ladle' },
  { id: 'cheese', name: 'Mozzarella', cost: 1.25, shelf: 5, space: 0.5, color: '#f6efd2', unit: 'portion' },
  { id: 'pepperoni', name: 'Pepperoni', cost: 1.02, shelf: 6, space: 0.25, color: '#b53a2a', unit: 'portion' },
  { id: 'ham', name: 'Ham', cost: 1.12, shelf: 4, space: 0.25, color: '#e9a3a0', unit: 'portion' },
  { id: 'sausage', name: 'Italian sausage', cost: 1.12, shelf: 4, space: 0.25, color: '#8a4b2e', unit: 'portion' },
  { id: 'chicken', name: 'Roast chicken', cost: 1.49, shelf: 3, space: 0.25, color: '#e3c48f', unit: 'portion' },
  { id: 'mushroom', name: 'Mushrooms', cost: 0.54, shelf: 3, space: 0.25, color: '#b9a58a', unit: 'portion' },
  { id: 'pepper', name: 'Green peppers', cost: 0.48, shelf: 4, space: 0.25, color: '#3e8a3a', unit: 'portion' },
  { id: 'onion', name: 'Red onion', cost: 0.3, shelf: 7, space: 0.25, color: '#b56fb1', unit: 'portion' },
  { id: 'olive', name: 'Black olives', cost: 0.66, shelf: 10, space: 0.15, color: '#2b2724', unit: 'portion' },
  { id: 'pineapple', name: 'Pineapple', cost: 0.59, shelf: 5, space: 0.25, color: '#f2d34b', unit: 'portion' },
  { id: 'basil', name: 'Fresh basil', cost: 0.36, shelf: 3, space: 0.1, color: '#3f9b4a', unit: 'sprig' },
  { id: 'bbq', name: 'BBQ sauce', cost: 0.48, shelf: 14, space: 0.2, color: '#6b2f1a', unit: 'ladle' },
  { id: 'garlic', name: 'Garlic butter', cost: 0.36, shelf: 7, space: 0.15, color: '#f0e3a0', unit: 'pat' },
  { id: 'soda', name: 'Soda cans', cost: 0.42, shelf: 60, space: 0, color: '#2f6fd1', unit: 'can' },
  { id: 'box', name: 'Pizza boxes', cost: 0.24, shelf: 999, space: 0, color: '#c99a62', unit: 'box' },
];
export const ING: Record<IngId, IngredientDef> = Object.fromEntries(INGREDIENTS.map((i) => [i.id, i])) as Record<IngId, IngredientDef>;

export type ItemId =
  | 'margherita' | 'pepperoni' | 'veggie' | 'hawaiian' | 'meatlovers' | 'bbqchicken'
  | 'supreme' | 'bianca' | 'calzone' | 'knots' | 'soda';

export interface MenuItemDef {
  id: ItemId;
  name: string;
  type: 'pizza' | 'side' | 'drink';
  recipe: Partial<Record<IngId, number>>;
  /** Minutes of hands-on prep at skill-1 speed. */
  prep: number;
  /** Multiplier on oven bake time (0 = no oven). */
  bake: number;
  /** The price customers consider fair. */
  fair: number;
  /** Base popularity weight. */
  appeal: number;
  /** Quality bonus inherent to the recipe. */
  craft: number;
  unlockLevel: number;
  unlockCost: number;
  desc: string;
}

export const MENU: MenuItemDef[] = [
  { id: 'margherita', name: 'Margherita', type: 'pizza', recipe: { dough: 1, sauce: 1, cheese: 1, basil: 1 }, prep: 2.5, bake: 1, fair: 10, appeal: 1.0, craft: 0, unlockLevel: 1, unlockCost: 0, desc: 'Tomato, mozzarella, basil. The classic.' },
  { id: 'pepperoni', name: 'Pepperoni', type: 'pizza', recipe: { dough: 1, sauce: 1, cheese: 1, pepperoni: 1 }, prep: 2.5, bake: 1, fair: 12, appeal: 1.4, craft: 0, unlockLevel: 1, unlockCost: 0, desc: 'Everyone\'s favorite. Curls into little cups.' },
  { id: 'soda', name: 'Soda', type: 'drink', recipe: { soda: 1 }, prep: 0, bake: 0, fair: 2.5, appeal: 1, craft: 0, unlockLevel: 1, unlockCost: 0, desc: 'Ice-cold can. Pure margin.' },
  { id: 'veggie', name: 'Garden Veggie', type: 'pizza', recipe: { dough: 1, sauce: 1, cheese: 1, mushroom: 1, pepper: 1, onion: 1, olive: 1 }, prep: 3.5, bake: 1, fair: 13, appeal: 0.8, craft: 2, unlockLevel: 2, unlockCost: 350, desc: 'Mushroom, pepper, onion, olive.' },
  { id: 'knots', name: 'Garlic Knots', type: 'side', recipe: { dough: 1, garlic: 1 }, prep: 1.5, bake: 0.6, fair: 5, appeal: 1, craft: 0, unlockLevel: 2, unlockCost: 250, desc: 'Side order. Raises average ticket.' },
  { id: 'hawaiian', name: 'Hawaiian', type: 'pizza', recipe: { dough: 1, sauce: 1, cheese: 1, ham: 1, pineapple: 1 }, prep: 3, bake: 1, fair: 13, appeal: 0.9, craft: 1, unlockLevel: 3, unlockCost: 500, desc: 'Ham and pineapple. Divisive, profitable.' },
  { id: 'meatlovers', name: 'Meat Lovers', type: 'pizza', recipe: { dough: 1, sauce: 1, cheese: 1, pepperoni: 1, sausage: 1, ham: 1 }, prep: 3.5, bake: 1.1, fair: 16, appeal: 1.1, craft: 2, unlockLevel: 4, unlockCost: 900, desc: 'Pepperoni, sausage, ham.' },
  { id: 'bbqchicken', name: 'BBQ Chicken', type: 'pizza', recipe: { dough: 1, bbq: 1, cheese: 1, chicken: 1, onion: 1 }, prep: 3.5, bake: 1.05, fair: 15, appeal: 1.0, craft: 3, unlockLevel: 5, unlockCost: 1200, desc: 'Smoky sauce, chicken, red onion.' },
  { id: 'supreme', name: 'Supreme', type: 'pizza', recipe: { dough: 1, sauce: 1, cheese: 1, pepperoni: 1, sausage: 1, pepper: 1, onion: 1, mushroom: 1, olive: 1 }, prep: 4.5, bake: 1.15, fair: 17, appeal: 1.1, craft: 4, unlockLevel: 6, unlockCost: 1600, desc: 'The works. Slow to build, big ticket.' },
  { id: 'bianca', name: 'Bianca Funghi', type: 'pizza', recipe: { dough: 1, cheese: 1, garlic: 1, mushroom: 1, basil: 1 }, prep: 3, bake: 1, fair: 14, appeal: 0.8, craft: 5, unlockLevel: 7, unlockCost: 1800, desc: 'White pizza with garlic and mushrooms.' },
  { id: 'calzone', name: 'Calzone', type: 'pizza', recipe: { dough: 1, cheese: 1, ham: 1, mushroom: 1, sauce: 1 }, prep: 4, bake: 1.2, fair: 14, appeal: 0.9, craft: 3, unlockLevel: 8, unlockCost: 2200, desc: 'Folded and stuffed. Travels well.' },
];
export const ITEM: Record<ItemId, MenuItemDef> = Object.fromEntries(MENU.map((m) => [m.id, m])) as Record<ItemId, MenuItemDef>;

export function ingredientCost(item: MenuItemDef, priceMult: (ing: IngId) => number = () => 1): number {
  let c = 0;
  for (const [k, q] of Object.entries(item.recipe) as [IngId, number][]) c += ING[k].cost * q * priceMult(k);
  return c;
}

export type SupplierId = 'budget' | 'standard' | 'premium';
export const SUPPLIERS: Record<SupplierId, { name: string; priceMult: number; quality: number; blurb: string }> = {
  budget: { name: 'ValuMart Wholesale', priceMult: 0.8, quality: -12, blurb: 'Cheap and cheerful. Customers can taste it.' },
  standard: { name: 'Bellini Foods', priceMult: 1, quality: 0, blurb: 'Reliable restaurant-grade supplies.' },
  premium: { name: 'Campania Imports', priceMult: 1.4, quality: 14, blurb: 'San Marzano tomatoes, fior di latte.' },
};
