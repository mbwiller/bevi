import { parseNutritionPanel, type RecognisedLine } from '../nutritionPanel';
import { VISION_FIXTURES } from '../__fixtures__/visionFixtures';

const line = (text: string, over: Partial<RecognisedLine> = {}): RecognisedLine =>
  ({ text, confidence: 1, x: 0.02, y: 0.5, ...over });

// ---------------------------------------------------------------------------
// Real photographs, taken through this app. Four of the eight were checked
// value by value against the physical package; those are marked, and they are
// the ones that prove the parser is right rather than merely consistent. The
// other four are regression locks on real OCR output.
// ---------------------------------------------------------------------------

describe('panels photographed through the app', () => {
  it('reads a slim energy can — verified against the package', () => {
    // Bloom Crisp Apple: Calories 10, Total Fat 0g, Sodium 0mg,
    // Total Carbohydrate 1g, Total Sugars 0g, Protein 0g.
    expect(parseNutritionPanel(VISION_FIXTURES['bloom-sparkling-energy']!)).toEqual({
      basis: 'Per serving (1 Can (12 fl oz))',
      calories: 10, fatGrams: 0, carbohydrateGrams: 1, sugarGrams: 0, proteinGrams: 0, sodiumMg: 0,
    });
  });

  it('reads a wrapped bottle, sodium and all — verified against the package', () => {
    // Bai Kula Watermelon really does print Sodium 140mg; it has sea salt.
    // Its "Protein 0g" is the line Vision returned as "Protein Og".
    expect(parseNutritionPanel(VISION_FIXTURES['bai-kula-watermelon']!)).toEqual({
      basis: 'Per serving (1 Bottle)',
      calories: 10, fatGrams: 0, carbohydrateGrams: 1, sugarGrams: 1, proteinGrams: 0, sodiumMg: 140,
    });
  });

  it('reads a dim, curved kombucha bottle — verified against the package', () => {
    // Synergy Guava Goddess. "Includes 3g Added Sugars" sits right under
    // "Total Sugars 16g"; taking it would report 3 and look plausible.
    expect(parseNutritionPanel(VISION_FIXTURES['synergy-guava-goddess']!)).toEqual({
      basis: 'Per serving (1 bottle)',
      calories: 60, fatGrams: 0, carbohydrateGrams: 16, sugarGrams: 16, proteinGrams: 0, sodiumMg: 10,
    });
  });

  it('leaves an abbreviated "Total Carb. <1g" unread — verified against the package', () => {
    // Jarritos Zero prints a bound, not a value. "Not listed" is the correct
    // reading of it; 0 or 1 would both be inventions.
    const panel = parseNutritionPanel(VISION_FIXTURES['jarritos-zero-mandarin']!);
    expect(panel).toEqual({
      basis: 'Per serving (1 can (355mL))',
      calories: 0, fatGrams: 0, carbohydrateGrams: null, sugarGrams: 0, proteinGrams: 0, sodiumMg: 25,
    });
  });

  it('reads a panel whose every word Vision mangled', () => {
    // Joe Tea came back with "Selving size", "Nutrit.on Facts" and "Amahunt
    // per serving" — all at confidence 1.00 — while every number was perfect.
    // An exact phrase match threw the whole panel away.
    const panel = parseNutritionPanel(VISION_FIXTURES['joe-s-unsweetened-black-tea']!);
    expect(panel?.basis).toBe('Per serving (1 bottle)');
    expect(panel).toMatchObject({ calories: 0, fatGrams: 0, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: 0, sodiumMg: 0 });
  });

  it('refuses the gram nutrients on a can that misread their units', () => {
    // Celsius came back as "Total Carbohydrate 0mg" / "Protein 0mg", which is
    // Vision misreading "0g". Dividing by 1000 would turn a misread "46g"
    // into a believable 0.05g, so these stay unread. Sodium IS milligrams and
    // survives. Its "Total Sugars" really is absent from the package.
    expect(parseNutritionPanel(VISION_FIXTURES['celsius-green-apple-cherry']!)).toEqual({
      basis: 'Per serving (12 fl.oz (355mL))',
      calories: 10, fatGrams: null, carbohydrateGrams: null, sugarGrams: null, proteinGrams: null, sodiumMg: 5,
    });
  });

  it('reads every remaining fixture without inventing a number', () => {
    // Named in the assertion rather than passed as a message: jest's `expect`
    // takes one argument.
    const unread = Object.entries(VISION_FIXTURES)
      .filter(([, lines]) => parseNutritionPanel(lines) === null)
      .map(([name]) => name);
    expect(unread).toEqual([]);

    const nonFinite = Object.entries(VISION_FIXTURES).flatMap(([name, lines]) =>
      Object.entries(parseNutritionPanel(lines)!)
        .filter(([key, value]) => key !== 'basis' && value !== null && !Number.isFinite(value as number))
        .map(([key]) => `${name}.${key}`));
    expect(nonFinite).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The rules that keep a wrong number off the screen.
// ---------------------------------------------------------------------------

describe('what it refuses', () => {
  it('takes the per-serving column on a dual-column panel, not per-container', () => {
    const panel = parseNutritionPanel([
      line('Serving size 8 fl oz (240 mL)', { y: 0.9 }),
      line('Calories', { y: 0.8, x: 0.02 }),
      line('110', { y: 0.8, x: 0.59 }),
      line('220', { y: 0.8, x: 0.74 }),
    ]);
    expect(panel?.calories).toBe(110);
  });

  it('never lets "Includes Xg Added Sugars" overwrite Total Sugars', () => {
    const panel = parseNutritionPanel([
      line('Serving size 12 fl oz (355 mL)', { y: 0.9 }),
      line('Total Sugars 39g', { y: 0.6 }),
      line('Includes 46g Added Sugars', { y: 0.58, x: 0.08 }),
    ]);
    expect(panel?.sugarGrams).toBe(39);
  });

  it('never lets Saturated or Trans Fat become Total Fat', () => {
    const panel = parseNutritionPanel([
      line('Serving size 355 mL', { y: 0.9 }),
      line('Saturated Fat 1.5g', { y: 0.7, x: 0.05 }),
      line('Trans Fat 0g', { y: 0.68, x: 0.05 }),
      line('Total Fat 8g', { y: 0.72 }),
    ]);
    expect(panel?.fatGrams).toBe(8);
  });

  it('keeps a printed zero and invents nothing for an absent nutrient', () => {
    const panel = parseNutritionPanel([
      line('Serving size 355 mL', { y: 0.9 }),
      line('Total Fat 0g', { y: 0.7 }),
      line('Sodium 45mg', { y: 0.68 }),
    ]);
    expect(panel?.fatGrams).toBe(0);
    expect(panel?.proteinGrams).toBeNull();
    expect(panel?.carbohydrateGrams).toBeNull();
    expect(panel?.calories).toBeNull();
  });

  it('treats "<1g" as the bound it is, not as a number', () => {
    const panel = parseNutritionPanel([
      line('Serving size 355 mL', { y: 0.9 }),
      line('Total Fat 12g', { y: 0.7 }),
      line('Protein <1g', { y: 0.68 }),
    ]);
    expect(panel?.proteinGrams).toBeNull();
  });

  it('refuses a whole reading when the basis cannot be pinned down', () => {
    // Amounts with no basis are numbers attached to an unknown quantity.
    const panel = parseNutritionPanel([
      line('Total Fat 2.5g', { y: 0.7 }),
      line('Sodium 125mg', { y: 0.68 }),
    ]);
    expect(panel).toBeNull();
  });

  it('ignores a region Vision says it could not read', () => {
    const panel = parseNutritionPanel([
      line('Serving size 355 mL', { y: 0.9 }),
      line('Total Fat 99g', { y: 0.7, confidence: 0.2 }),
    ]);
    expect(panel).toBeNull();
  });

  it('is not fooled by a photo of the front of the can', () => {
    expect(parseNutritionPanel([
      line('MOUNTAIN DEW', { y: 0.6 }),
      line('12 FL OZ (355 mL)', { y: 0.4 }),
    ])).toBeNull();
  });

  it('converts sodium printed in grams, and reads the abbreviated carb row', () => {
    const panel = parseNutritionPanel([
      line('Serving Size 1 can (355mL)', { y: 0.9 }),
      line('Sodium 1.2g', { y: 0.7 }),
      line('Total Carb. 24g', { y: 0.68 }),
    ]);
    expect(panel?.sodiumMg).toBe(1200);
    expect(panel?.carbohydrateGrams).toBe(24);
  });
});
