/**
 * What Apple's Vision framework actually returned for eight nutrition labels
 * photographed through this app -- curved cans, wrapped bottles, kitchen and
 * bedroom lighting, held in one hand.
 *
 * Captured once with `VNRecognizeTextRequest` (accurate level, language
 * correction off) so the parser's tests run anywhere, with no camera, no
 * Swift and no Xcode. Only the recognised text and its geometry are here:
 * the photographs themselves are not in the repo, because they show hands,
 * rooms and whatever was on the table.
 *
 * Do not hand-edit. These are evidence, not fixtures someone invented, and
 * every oddity in them is real: "Selving size", "Protein Og", "Total Carb.
 * <1g", "Total Carbohydrate 0mg".
 */
import type { RecognisedLine } from '../nutritionPanel';

export const VISION_FIXTURES: Record<string, RecognisedLine[]> = {
  "bai-kula-watermelon": [
    {
      "confidence": 1,
      "text": "Contains 1% Juice",
      "x": 0.3216,
      "y": 0.8498
    },
    {
      "confidence": 1,
      "text": "Nutrition Facts",
      "x": 0.2397,
      "y": 0.7996
    },
    {
      "confidence": 1,
      "text": "Serving size",
      "x": 0.2377,
      "y": 0.7698
    },
    {
      "confidence": 1,
      "text": "1 Bottle",
      "x": 0.5327,
      "y": 0.7756
    },
    {
      "confidence": 1,
      "text": "Amount per serving",
      "x": 0.2379,
      "y": 0.7294
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.2399,
      "y": 0.6958
    },
    {
      "confidence": 1,
      "text": "10",
      "x": 0.5504,
      "y": 0.7035
    },
    {
      "confidence": 1,
      "text": "% Daily Value",
      "x": 0.509,
      "y": 0.6668
    },
    {
      "confidence": 1,
      "text": "Total Fat 0g",
      "x": 0.2383,
      "y": 0.6335
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5853,
      "y": 0.6424
    },
    {
      "confidence": 1,
      "text": "Sodium 140mg",
      "x": 0.2381,
      "y": 0.6043
    },
    {
      "confidence": 1,
      "text": "6%",
      "x": 0.5833,
      "y": 0.6134
    },
    {
      "confidence": 1,
      "text": "Total Carbohydrate 1g",
      "x": 0.2401,
      "y": 0.5717
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5814,
      "y": 0.5843
    },
    {
      "confidence": 1,
      "text": "Total Sugars 1g",
      "x": 0.2674,
      "y": 0.5433
    },
    {
      "confidence": 1,
      "text": "Includes 0g Added Sugars",
      "x": 0.2746,
      "y": 0.5102
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5795,
      "y": 0.5276
    },
    {
      "confidence": 1,
      "text": "Protein Og",
      "x": 0.2386,
      "y": 0.4832
    },
    {
      "confidence": 1,
      "text": "Potassium 150mg 4% \u2022 Vitamin C14mg 15%",
      "x": 0.2393,
      "y": 0.4293
    },
    {
      "confidence": 1,
      "text": "Zinc 1.8mg 15%",
      "x": 0.2381,
      "y": 0.4041
    },
    {
      "confidence": 1,
      "text": "Not a sigificant source of saturated fat, trans tat,",
      "x": 0.2394,
      "y": 0.3702
    },
    {
      "confidence": 1,
      "text": "cholestero, dietar fibe, vitamin D, calcium, andiron.",
      "x": 0.2394,
      "y": 0.3491
    },
    {
      "confidence": 1,
      "text": "INGREDIENTS: FILTERED WATER,",
      "x": 0.2326,
      "y": 0.3241
    },
    {
      "confidence": 1,
      "text": "CLARIFIED",
      "x": 0.5331,
      "y": 0.3334
    },
    {
      "confidence": 1,
      "text": "WATERMELON JUICE CUNCENTRATE, GITRIC ACID,",
      "x": 0.2315,
      "y": 0.3008
    },
    {
      "confidence": 1,
      "text": "POTASSIUM CITRATE, SEA SALT, ASCORBIC ACID (VITAMIN",
      "x": 0.2314,
      "y": 0.2831
    },
    {
      "confidence": 1,
      "text": "C), TEA EXTRACT, STEVIA LEAF EXTRACT, MALIC ACID,",
      "x": 0.2314,
      "y": 0.2647
    },
    {
      "confidence": 1,
      "text": "VEGETABLE JUICE CONCENTRATE (FOR COLOR), NATURAL",
      "x": 0.2297,
      "y": 0.2501
    },
    {
      "confidence": 1,
      "text": "FLAVORS, COFFEE FRUIT EXTRACT, MONK FRUITEXTRACT",
      "x": 0.2313,
      "y": 0.2311
    },
    {
      "confidence": 1,
      "text": "(NATURAL FLAVOR), ZINC SULFATE.",
      "x": 0.2285,
      "y": 0.2172
    },
    {
      "confidence": 1,
      "text": "DISTRIBUTED BY BAI BRANDS LLC, 6425 HALL OFFAME",
      "x": 0.2315,
      "y": 0.19
    },
    {
      "confidence": 1,
      "text": "LANE, FRISCO, TX 75034. \u2122M & \u00a9 2024 BAI BRANOSLLC.",
      "x": 0.2299,
      "y": 0.1737
    },
    {
      "confidence": 1,
      "text": "(855) 411-4BAI DRINKBAI.COM",
      "x": 0.2285,
      "y": 0.16
    },
    {
      "confidence": 1,
      "text": "55MG CAFFEINE PER BOTTLE: LIKEA 12 OZ CUP OFTEA",
      "x": 0.2391,
      "y": 0.1251
    },
    {
      "confidence": 1,
      "text": "GOOD SOURCE OF VITAMIN C & ZINC",
      "x": 0.2263,
      "y": 0.0637
    },
    {
      "confidence": 1,
      "text": "ANTIOXIDANTS (PER BOTTLE): 14MG VITAMIN C; 100MG",
      "x": 0.2316,
      "y": 0.0429
    },
    {
      "confidence": 1,
      "text": "POLYPHENOLS FROM TEA AND COFFEE FRUITEXTRACTS",
      "x": 0.2296,
      "y": 0.0277
    },
    {
      "confidence": 1,
      "text": "SHAKE WELL, REFRIGERATE AFTER OPENING",
      "x": 0.2313,
      "y": -0.0098
    }
  ],
  "bloom-sparkling-energy": [
    {
      "confidence": 1,
      "text": "CRISP APPLE",
      "x": 0.4261,
      "y": 0.8429
    },
    {
      "confidence": 1,
      "text": "CONTAINS 0% JUICE",
      "x": 0.4161,
      "y": 0.8032
    },
    {
      "confidence": 1,
      "text": "Nutrition Facts",
      "x": 0.3913,
      "y": 0.7696
    },
    {
      "confidence": 1,
      "text": "Serving size 1 Can (12 fl oz)",
      "x": 0.3908,
      "y": 0.7495
    },
    {
      "confidence": 1,
      "text": "Amount per serving",
      "x": 0.3927,
      "y": 0.7233
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.3919,
      "y": 0.6976
    },
    {
      "confidence": 1,
      "text": "Total Fat 0g",
      "x": 0.3953,
      "y": 0.6599
    },
    {
      "confidence": 1,
      "text": "Sodium 0mg",
      "x": 0.3972,
      "y": 0.6408
    },
    {
      "confidence": 1,
      "text": "Total Carbohydrate 1g",
      "x": 0.3973,
      "y": 0.6219
    },
    {
      "confidence": 1,
      "text": "Dietary Fiber 0g",
      "x": 0.4045,
      "y": 0.6008
    },
    {
      "confidence": 1,
      "text": "10",
      "x": 0.6008,
      "y": 0.702
    },
    {
      "confidence": 1,
      "text": "% Daily Value*",
      "x": 0.554,
      "y": 0.6787
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.6318,
      "y": 0.6613
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.6318,
      "y": 0.6424
    },
    {
      "confidence": 1,
      "text": "<1%",
      "x": 0.624,
      "y": 0.625
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.6318,
      "y": 0.6061
    },
    {
      "confidence": 1,
      "text": "Total Sugars 0g",
      "x": 0.4031,
      "y": 0.5841
    },
    {
      "confidence": 1,
      "text": "Includes 0g Added Sugars",
      "x": 0.4109,
      "y": 0.5654
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.6318,
      "y": 0.5698
    },
    {
      "confidence": 1,
      "text": "Protein 0g",
      "x": 0.4007,
      "y": 0.5472
    },
    {
      "confidence": 1,
      "text": "Potassium 140mg",
      "x": 0.4007,
      "y": 0.5216
    },
    {
      "confidence": 1,
      "text": "2%",
      "x": 0.6337,
      "y": 0.5276
    },
    {
      "confidence": 1,
      "text": "Niacin 8mg",
      "x": 0.401,
      "y": 0.5021
    },
    {
      "confidence": 1,
      "text": "50%",
      "x": 0.6279,
      "y": 0.5087
    },
    {
      "confidence": 1,
      "text": "Vitamin Be 1.7mg",
      "x": 0.402,
      "y": 0.4848
    },
    {
      "confidence": 1,
      "text": "100%",
      "x": 0.6202,
      "y": 0.4913
    },
    {
      "confidence": 1,
      "text": "Vitamin Btz 2.4mcg",
      "x": 0.402,
      "y": 0.466
    },
    {
      "confidence": 1,
      "text": "100%",
      "x": 0.6202,
      "y": 0.4724
    },
    {
      "confidence": 1,
      "text": "Not a significant source of saturated fat, trans tat,",
      "x": 0.4049,
      "y": 0.4495
    },
    {
      "confidence": 1,
      "text": "cholesterol, vitamin D, calcium, and iron.",
      "x": 0.4044,
      "y": 0.436
    },
    {
      "confidence": 1,
      "text": "*The % Daily Value tolls you how much a nutrient in",
      "x": 0.405,
      "y": 0.42
    },
    {
      "confidence": 1,
      "text": "a serving of food contributes to a daily diet. 2,000",
      "x": 0.4088,
      "y": 0.4088
    },
    {
      "confidence": 1,
      "text": "calories a day is used for general nutrtion advice.",
      "x": 0.4109,
      "y": 0.3968
    },
    {
      "confidence": 1,
      "text": "Horedients: Carbonated Water, Clnic Acid, Xylookgosaochatula",
      "x": 0.4031,
      "y": 0.3762
    },
    {
      "confidence": 1,
      "text": "are, Natural Favors, Potassiurm Ctrate, L-Thearine, Natrm",
      "x": 0.405,
      "y": 0.3642
    },
    {
      "confidence": 0.3,
      "text": "Caltane (fromn Gran Colile Bean Extract), Sucacoes, Plearn",
      "x": 0.4008,
      "y": 0.3515
    },
    {
      "confidence": 1,
      "text": "aruatie (resevalive), Asian Ginseng (Panax girseng) HoC",
      "x": 0.407,
      "y": 0.343
    },
    {
      "confidence": 1,
      "text": "sxract. Aple Cider Vinegar, Niacinarmide, Pynidoxine HC.",
      "x": 0.4069,
      "y": 0.3305
    },
    {
      "confidence": 1,
      "text": "(Marin B6), Cyanocobalanin (Vitanin B124",
      "x": 0.4014,
      "y": 0.3147
    },
    {
      "confidence": 1,
      "text": "CAFFENE: 180mg per 121L. ez. (1 cas)",
      "x": 0.405,
      "y": 0.2914
    },
    {
      "confidence": 1,
      "text": "designed by Bloom Nu LLC",
      "x": 0.4063,
      "y": 0.2682
    },
    {
      "confidence": 1,
      "text": "Distrbuted ty Nutraboll \u00ae",
      "x": 0.4061,
      "y": 0.2532
    },
    {
      "confidence": 1,
      "text": "Asstin, TX 78746",
      "x": 0.4033,
      "y": 0.2459
    },
    {
      "confidence": 1,
      "text": "1.866.442.6866",
      "x": 0.4037,
      "y": 0.2382
    },
    {
      "confidence": 1,
      "text": "Boom \"and Bloom Natrtbon\"",
      "x": 0.4054,
      "y": 0.2097
    },
    {
      "confidence": 1,
      "text": "are tradernarks of",
      "x": 0.4075,
      "y": 0.2073
    },
    {
      "confidence": 1,
      "text": "Boon Nu LLC",
      "x": 0.4048,
      "y": 0.1985
    },
    {
      "confidence": 1,
      "text": "METAL",
      "x": 0.4174,
      "y": 0.1107
    },
    {
      "confidence": 1,
      "text": "CAN",
      "x": 0.427,
      "y": 0.1025
    },
    {
      "confidence": 1,
      "text": "160821ATAC035",
      "x": 0.5368,
      "y": 0.1017
    },
    {
      "confidence": 0.3,
      "text": "ber Aadt ana",
      "x": 0.6899,
      "y": 0.7137
    },
    {
      "confidence": 1,
      "text": "retict",
      "x": 0.6802,
      "y": 0.6017
    }
  ],
  "bloom-sparkling-energy-2": [
    {
      "confidence": 1,
      "text": "CHERRY LIME",
      "x": 0.4024,
      "y": 0.786
    },
    {
      "confidence": 1,
      "text": "CONTAINS 0% JUICE",
      "x": 0.3967,
      "y": 0.7613
    },
    {
      "confidence": 1,
      "text": "Nutrition Facts",
      "x": 0.3776,
      "y": 0.7324
    },
    {
      "confidence": 1,
      "text": "Serving size 1 Can (12 fl oz)",
      "x": 0.3757,
      "y": 0.7149
    },
    {
      "confidence": 1,
      "text": "Amount per serving",
      "x": 0.3759,
      "y": 0.6901
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.3753,
      "y": 0.6657
    },
    {
      "confidence": 1,
      "text": "Total Fat 0g",
      "x": 0.3759,
      "y": 0.6277
    },
    {
      "confidence": 1,
      "text": "Sodium 0mg",
      "x": 0.3759,
      "y": 0.6101
    },
    {
      "confidence": 1,
      "text": "Total Carbohydrate 2g",
      "x": 0.374,
      "y": 0.59
    },
    {
      "confidence": 1,
      "text": "Dietary Fiber 1g",
      "x": 0.3818,
      "y": 0.5725
    },
    {
      "confidence": 1,
      "text": "10",
      "x": 0.5698,
      "y": 0.6628
    },
    {
      "confidence": 1,
      "text": "% Daily Value*",
      "x": 0.5337,
      "y": 0.6401
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5969,
      "y": 0.625
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5969,
      "y": 0.6076
    },
    {
      "confidence": 1,
      "text": "<1%",
      "x": 0.5891,
      "y": 0.5901
    },
    {
      "confidence": 1,
      "text": "4%",
      "x": 0.5969,
      "y": 0.5727
    },
    {
      "confidence": 1,
      "text": "Ollgonor-",
      "x": 0.6279,
      "y": 0.593
    },
    {
      "confidence": 1,
      "text": "Sunfiber",
      "x": 0.6453,
      "y": 0.5814
    },
    {
      "confidence": 1,
      "text": "Total Sugars 0g",
      "x": 0.3796,
      "y": 0.5548
    },
    {
      "confidence": 1,
      "text": "Includes 0g Added Sugars",
      "x": 0.3872,
      "y": 0.5358
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5969,
      "y": 0.5378
    },
    {
      "confidence": 1,
      "text": "Protein 0g",
      "x": 0.3756,
      "y": 0.5196
    },
    {
      "confidence": 1,
      "text": "Riboflavin 1.3mg",
      "x": 0.3752,
      "y": 0.4923
    },
    {
      "confidence": 1,
      "text": "100%",
      "x": 0.5853,
      "y": 0.4956
    },
    {
      "confidence": 1,
      "text": "Niacin 8mg",
      "x": 0.3728,
      "y": 0.4747
    },
    {
      "confidence": 1,
      "text": "50%",
      "x": 0.5891,
      "y": 0.4767
    },
    {
      "confidence": 1,
      "text": "Vitamin Bs 1.7mg",
      "x": 0.3735,
      "y": 0.4576
    },
    {
      "confidence": 1,
      "text": "100%",
      "x": 0.5833,
      "y": 0.4608
    },
    {
      "confidence": 1,
      "text": "Vitamin B1z 2.4mcg",
      "x": 0.3726,
      "y": 0.4369
    },
    {
      "confidence": 1,
      "text": "100%",
      "x": 0.5833,
      "y": 0.4433
    },
    {
      "confidence": 1,
      "text": "Not a significant source of saturated fat, trans tat,",
      "x": 0.374,
      "y": 0.42
    },
    {
      "confidence": 1,
      "text": "cholesterol, potassium, vitamin D, calcium, and iron.",
      "x": 0.3739,
      "y": 0.4075
    },
    {
      "confidence": 1,
      "text": "*The % Daily Value tells you how much a nutrientin",
      "x": 0.3719,
      "y": 0.3902
    },
    {
      "confidence": 1,
      "text": "a serving of food contributes to a daily diet. 2,000",
      "x": 0.3778,
      "y": 0.3799
    },
    {
      "confidence": 1,
      "text": "COF IITON: Do not consume this product If you are pregnant",
      "x": 0.6199,
      "y": 0.3821
    },
    {
      "confidence": 1,
      "text": "place oo not roozed for",
      "x": 0.629,
      "y": 0.4852
    },
    {
      "confidence": 1,
      "text": "calories a day is used for gennral nutrifion advice.",
      "x": 0.3778,
      "y": 0.3683
    },
    {
      "confidence": 1,
      "text": "mngredients: Carbonated Water, Ctric Acid, Galactomaman",
      "x": 0.3701,
      "y": 0.3509
    },
    {
      "confidence": 1,
      "text": "Prabiotic FIber, Taurine, Natural Flavors, L-Theanine, Natral",
      "x": 0.3681,
      "y": 0.339
    },
    {
      "confidence": 1,
      "text": "Caffeine (from Green Coffee Bean Extract), Potasium",
      "x": 0.368,
      "y": 0.329
    },
    {
      "confidence": 1,
      "text": "Benzoate (preservative), Sucralose, Potassium Sotalie",
      "x": 0.3663,
      "y": 0.3181
    },
    {
      "confidence": 1,
      "text": "Pateryative), Asian Ginseng (Panax ginseng) Root Extract,",
      "x": 0.3698,
      "y": 0.3057
    },
    {
      "confidence": 1,
      "text": "ratented Lychee Fruit Extract& Green Tea Leaf Extraci.",
      "x": 0.3721,
      "y": 0.298
    },
    {
      "confidence": 1,
      "text": "Bppe Ckder Vinegar, Niacinamide, Pyridoxine HCI(Vitame",
      "x": 0.3681,
      "y": 0.2845
    },
    {
      "confidence": 1,
      "text": "86), Riboflavin, Cyanocobalamin (Vitamin B12)",
      "x": 0.3693,
      "y": 0.2724
    },
    {
      "confidence": 1,
      "text": "CAFFEINE: 180mg per 12 fl. oz (1 can)",
      "x": 0.3665,
      "y": 0.2551
    },
    {
      "confidence": 1,
      "text": "170891",
      "x": 0.5775,
      "y": 0.2689
    },
    {
      "confidence": 1,
      "text": "Designed by Bloom Nutrition, LLC",
      "x": 0.3647,
      "y": 0.2343
    },
    {
      "confidence": 1,
      "text": "Distributed by Nutrabolt\u00ae",
      "x": 0.3657,
      "y": 0.2175
    },
    {
      "confidence": 1,
      "text": "Austin, TX 78746",
      "x": 0.3646,
      "y": 0.2084
    },
    {
      "confidence": 1,
      "text": "1.866.442.6866",
      "x": 0.3648,
      "y": 0.1998
    },
    {
      "confidence": 1,
      "text": "Bkoom \" and Bloom Nutrition'\u2122",
      "x": 0.3657,
      "y": 0.1805
    },
    {
      "confidence": 1,
      "text": "are trademarks of",
      "x": 0.3631,
      "y": 0.1721
    },
    {
      "confidence": 1,
      "text": "EB2195",
      "x": 0.5078,
      "y": 0.1846
    },
    {
      "confidence": 1,
      "text": "Bloom Nutrition, LLC",
      "x": 0.3649,
      "y": 0.1612
    },
    {
      "confidence": 1,
      "text": "METAL",
      "x": 0.3746,
      "y": 0.0819
    },
    {
      "confidence": 1,
      "text": "CAN",
      "x": 0.3828,
      "y": 0.0701
    },
    {
      "confidence": 1,
      "text": "how2recycle.info",
      "x": 0.4459,
      "y": 0.0637
    },
    {
      "confidence": 1,
      "text": "160408A1BC035",
      "x": 0.4942,
      "y": 0.0785
    }
  ],
  "celsius-green-apple-cherry": [
    {
      "confidence": 1,
      "text": "SPARKLING GREEN APPLE CHERPY",
      "x": 0.2384,
      "y": 0.7718
    },
    {
      "confidence": 1,
      "text": "CELSIUS.UIVE FIT",
      "x": 0.2342,
      "y": 0.6862
    },
    {
      "confidence": 1,
      "text": "Contains 0% Juice",
      "x": 0.3372,
      "y": 0.6686
    },
    {
      "confidence": 1,
      "text": "Nutrition Facts",
      "x": 0.251,
      "y": 0.6224
    },
    {
      "confidence": 1,
      "text": "1 Serving Per Contalner",
      "x": 0.2539,
      "y": 0.6087
    },
    {
      "confidence": 1,
      "text": "Serving Size 12 fl.oz (355mL)",
      "x": 0.2548,
      "y": 0.5861
    },
    {
      "confidence": 1,
      "text": "Amount Per Serving",
      "x": 0.256,
      "y": 0.5573
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.259,
      "y": 0.5367
    },
    {
      "confidence": 1,
      "text": "10",
      "x": 0.5581,
      "y": 0.5436
    },
    {
      "confidence": 1,
      "text": "%Dally Value'",
      "x": 0.4843,
      "y": 0.5087
    },
    {
      "confidence": 1,
      "text": "Total Fat 0mg",
      "x": 0.2607,
      "y": 0.4896
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5717,
      "y": 0.5
    },
    {
      "confidence": 1,
      "text": "Sodium 5mg",
      "x": 0.2607,
      "y": 0.4685
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5698,
      "y": 0.4811
    },
    {
      "confidence": 1,
      "text": "Total Carbohydrate 0mg",
      "x": 0.2625,
      "y": 0.4412
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5659,
      "y": 0.4608
    },
    {
      "confidence": 1,
      "text": "Protein 0mg",
      "x": 0.2634,
      "y": 0.4302
    },
    {
      "confidence": 1,
      "text": "Calcium 50mg",
      "x": 0.266,
      "y": 0.4071
    },
    {
      "confidence": 1,
      "text": "4%",
      "x": 0.5678,
      "y": 0.4244
    },
    {
      "confidence": 1,
      "text": "Vitamin C 60mg",
      "x": 0.266,
      "y": 0.3882
    },
    {
      "confidence": 1,
      "text": "70%",
      "x": 0.5562,
      "y": 0.4041
    },
    {
      "confidence": 1,
      "text": "Riboflavin 1.7mg",
      "x": 0.268,
      "y": 0.3682
    },
    {
      "confidence": 1,
      "text": "130%",
      "x": 0.5484,
      "y": 0.3852
    },
    {
      "confidence": 1,
      "text": "Niacin 20mg",
      "x": 0.2686,
      "y": 0.3541
    },
    {
      "confidence": 1,
      "text": "130%",
      "x": 0.5465,
      "y": 0.3677
    },
    {
      "confidence": 1,
      "text": "Vitamin B6 2mg",
      "x": 0.2707,
      "y": 0.3332
    },
    {
      "confidence": 1,
      "text": "120%",
      "x": 0.5465,
      "y": 0.3503
    },
    {
      "confidence": 1,
      "text": "Vitamin B12 6mcg",
      "x": 0.2712,
      "y": 0.3156
    },
    {
      "confidence": 1,
      "text": "250%",
      "x": 0.5446,
      "y": 0.3328
    },
    {
      "confidence": 1,
      "text": "Biotin 300mcg",
      "x": 0.2726,
      "y": 0.3018
    },
    {
      "confidence": 1,
      "text": "1000%",
      "x": 0.5349,
      "y": 0.3154
    },
    {
      "confidence": 1,
      "text": "Pantothenic Acid 10mg",
      "x": 0.2749,
      "y": 0.2777
    },
    {
      "confidence": 1,
      "text": "200%",
      "x": 0.5446,
      "y": 0.2994
    },
    {
      "confidence": 1,
      "text": "Chromium 50mcg",
      "x": 0.2759,
      "y": 0.2628
    },
    {
      "confidence": 1,
      "text": "740%",
      "x": 0.5426,
      "y": 0.2849
    },
    {
      "confidence": 1,
      "text": "Not a significant source of sat fat, trans fat, cholesterol, dlebay",
      "x": 0.2829,
      "y": 0.2529
    },
    {
      "confidence": 1,
      "text": "noer, total sugar, added sugars, vitamin D, Iron, and pota",
      "x": 0.2832,
      "y": 0.2383
    },
    {
      "confidence": 1,
      "text": "The% Daily Value (DV) telle you how much a nutrient ina",
      "x": 0.2829,
      "y": 0.225
    },
    {
      "confidence": 1,
      "text": "serving of food contributes to a dally dilet. 2,000 calories",
      "x": 0.2868,
      "y": 0.218
    },
    {
      "confidence": 1,
      "text": "terving of tood contributeg i a dally dlet 2.000 calories",
      "x": 0.2868,
      "y": 0.218
    },
    {
      "confidence": 1,
      "text": "Caffeino Content: 200mg",
      "x": 0.2765,
      "y": 0.1855
    },
    {
      "confidence": 1,
      "text": "a day is used for general nutrition advice.",
      "x": 0.2849,
      "y": 0.2078
    },
    {
      "confidence": 0.3,
      "text": "(erodi, Carins Crited Fre Bed ect egead a dlt, (caer, le i",
      "x": 0.281,
      "y": 0.1686
    },
    {
      "confidence": 1,
      "text": "alclum Carbonate, Ascorblc Acld, Glucuronolactone, Sucraloun, Brgen",
      "x": 0.2868,
      "y": 0.1613
    },
    {
      "confidence": 1,
      "text": "xtract, Natural Flavor, Calcium Pantothenate, Necinemide, Pyrldone",
      "x": 0.2888,
      "y": 0.1512
    },
    {
      "confidence": 1,
      "text": "Hydrochloride, Fuboflayin, Chromlum Chalets. Blotr Dencoob",
      "x": 0.2868,
      "y": 0.1437
    },
    {
      "confidence": 1,
      "text": "1 655 B 1880CN",
      "x": 0.3446,
      "y": 0.0851
    },
    {
      "confidence": 1,
      "text": "EBPLED",
      "x": 0.285,
      "y": 0.0259
    }
  ],
  "crisp-apple-bloom-pop": [
    {
      "confidence": 1,
      "text": "CRISP APPLE",
      "x": 0.5028,
      "y": 0.8763
    },
    {
      "confidence": 1,
      "text": "CONTAINS 2% JUICE",
      "x": 0.428,
      "y": 0.8282
    },
    {
      "confidence": 1,
      "text": "Nutrition Facts",
      "x": 0.3603,
      "y": 0.7707
    },
    {
      "confidence": 1,
      "text": "Serving size 1 Can (12 f oz)",
      "x": 0.3597,
      "y": 0.7423
    },
    {
      "confidence": 1,
      "text": "Amount per serving",
      "x": 0.364,
      "y": 0.7006
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.3546,
      "y": 0.6605
    },
    {
      "confidence": 1,
      "text": "20",
      "x": 0.6318,
      "y": 0.6628
    },
    {
      "confidence": 1,
      "text": "% Dally Valuye",
      "x": 0.5736,
      "y": 0.6206
    },
    {
      "confidence": 1,
      "text": "Total Fat 0g",
      "x": 0.3643,
      "y": 0.5928
    },
    {
      "confidence": 1,
      "text": "Sodium 0mg",
      "x": 0.3642,
      "y": 0.5646
    },
    {
      "confidence": 1,
      "text": "Total Carbohydrate 5g",
      "x": 0.3663,
      "y": 0.5349
    },
    {
      "confidence": 1,
      "text": "2%",
      "x": 0.688,
      "y": 0.5378
    },
    {
      "confidence": 1,
      "text": "Total Sugars 3g",
      "x": 0.374,
      "y": 0.5026
    },
    {
      "confidence": 1,
      "text": "Includes 2g Added Sugars",
      "x": 0.3873,
      "y": 0.4724
    },
    {
      "confidence": 1,
      "text": "4%",
      "x": 0.688,
      "y": 0.4797
    },
    {
      "confidence": 1,
      "text": "Protein 0g",
      "x": 0.3679,
      "y": 0.444
    },
    {
      "confidence": 1,
      "text": "Potassium 115mg",
      "x": 0.3679,
      "y": 0.4059
    },
    {
      "confidence": 1,
      "text": "2%",
      "x": 0.688,
      "y": 0.4113
    },
    {
      "confidence": 1,
      "text": "Not a significant source of saturated fat, trans",
      "x": 0.3682,
      "y": 0.3794
    },
    {
      "confidence": 1,
      "text": "y chalestarol, dietary fiber, vitamin D, calcium,",
      "x": 0.3853,
      "y": 0.356
    },
    {
      "confidence": 0.3,
      "text": "and non",
      "x": 0.3702,
      "y": 0.3488
    },
    {
      "confidence": 1,
      "text": "*The & Daily Valbe tills you how moch a mutrien, t",
      "x": 0.3702,
      "y": 0.3125
    },
    {
      "confidence": 1,
      "text": "utas to a dally diet. 2,000",
      "x": 0.549,
      "y": 0.293
    },
    {
      "confidence": 1,
      "text": "saries 3 day is used for gemeral nutrtion atvce.",
      "x": 0.3835,
      "y": 0.2731
    },
    {
      "confidence": 1,
      "text": "Supediente Carbongted Water, Organil Acta,",
      "x": 0.3641,
      "y": 0.2303
    },
    {
      "confidence": 1,
      "text": "Preciote",
      "x": 0.3643,
      "y": 0.2151
    },
    {
      "confidence": 1,
      "text": "pple Julca Concentrate,",
      "x": 0.4339,
      "y": 0.2255
    },
    {
      "confidence": 1,
      "text": "Polassion Curate,",
      "x": 0.3594,
      "y": 0.1839
    },
    {
      "confidence": 1,
      "text": "accharides, Natural Flavors",
      "x": 0.52,
      "y": 0.2021
    },
    {
      "confidence": 1,
      "text": "Pabaua",
      "x": 0.3641,
      "y": 0.1831
    },
    {
      "confidence": 1,
      "text": "Stevia Leaf Extraci",
      "x": 0.5504,
      "y": 0.1878
    },
    {
      "confidence": 1,
      "text": "csida 1, Organle Apple Cider Vitegar",
      "x": 0.4239,
      "y": 0.1694
    },
    {
      "confidence": 1,
      "text": "Desigred by Bloom Nu LLC",
      "x": 0.3676,
      "y": 0.1297
    },
    {
      "confidence": 1,
      "text": "Dlstributed by Nutrabolt*",
      "x": 0.3694,
      "y": 0.1083
    },
    {
      "confidence": 1,
      "text": "Austn, TX. 78746",
      "x": 0.3637,
      "y": 0.0906
    },
    {
      "confidence": 1,
      "text": "1.806.A42.5806",
      "x": 0.3636,
      "y": 0.0738
    },
    {
      "confidence": 0.3,
      "text": "Boxn\" and Bisorm Nutton\"",
      "x": 0.3653,
      "y": 0.0462
    },
    {
      "confidence": 1,
      "text": "as trademarka of",
      "x": 0.366,
      "y": 0.0331
    },
    {
      "confidence": 1,
      "text": "Bicom Ne LLC",
      "x": 0.3632,
      "y": 0.0182
    },
    {
      "confidence": 1,
      "text": "METAL",
      "x": 0.6285,
      "y": 0.0395
    },
    {
      "confidence": 1,
      "text": "CAN",
      "x": 0.6413,
      "y": 0.0302
    },
    {
      "confidence": 0.3,
      "text": "MeInO",
      "x": 0.7771,
      "y": 0.5363
    },
    {
      "confidence": 1,
      "text": "Pretlet",
      "x": 0.7561,
      "y": 0.6004
    }
  ],
  "jarritos-zero-mandarin": [
    {
      "confidence": 1,
      "text": "Nutrition Facts",
      "x": 0.3636,
      "y": 0.8922
    },
    {
      "confidence": 1,
      "text": "Serving Size 1 can (355mL)",
      "x": 0.3624,
      "y": 0.8517
    },
    {
      "confidence": 1,
      "text": "Amount Per Serving",
      "x": 0.3647,
      "y": 0.8017
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.3616,
      "y": 0.754
    },
    {
      "confidence": 1,
      "text": "0",
      "x": 0.6279,
      "y": 0.7529
    },
    {
      "confidence": 1,
      "text": "% Daily Value",
      "x": 0.5186,
      "y": 0.7113
    },
    {
      "confidence": 1,
      "text": "Total Fat 0g",
      "x": 0.3641,
      "y": 0.6752
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.626,
      "y": 0.6744
    },
    {
      "confidence": 1,
      "text": "Sodium 25mg",
      "x": 0.3658,
      "y": 0.6335
    },
    {
      "confidence": 1,
      "text": "1%",
      "x": 0.626,
      "y": 0.6366
    },
    {
      "confidence": 1,
      "text": "Total Carb. <1g",
      "x": 0.3662,
      "y": 0.5943
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.626,
      "y": 0.5945
    },
    {
      "confidence": 1,
      "text": "Total Sugars 0g",
      "x": 0.3779,
      "y": 0.5523
    },
    {
      "confidence": 1,
      "text": "Added Sugars 0g",
      "x": 0.3971,
      "y": 0.5154
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.626,
      "y": 0.5189
    },
    {
      "confidence": 1,
      "text": "Protein 0g",
      "x": 0.368,
      "y": 0.4748
    },
    {
      "confidence": 1,
      "text": "Not a significant source of Saturated",
      "x": 0.3702,
      "y": 0.4256
    },
    {
      "confidence": 1,
      "text": "Fal, Trans Fat, Cholesterol., Dietary",
      "x": 0.3676,
      "y": 0.3976
    },
    {
      "confidence": 1,
      "text": "Fiber. Vitamin D, Calcium, Iron, and",
      "x": 0.366,
      "y": 0.3712
    },
    {
      "confidence": 1,
      "text": "Potassium.",
      "x": 0.3667,
      "y": 0.3537
    },
    {
      "confidence": 1,
      "text": "INGREDIENTS:",
      "x": 0.355,
      "y": 0.3206
    },
    {
      "confidence": 1,
      "text": "CARBONATED",
      "x": 0.4767,
      "y": 0.3195
    },
    {
      "confidence": 1,
      "text": "WATER,",
      "x": 0.6163,
      "y": 0.3241
    },
    {
      "confidence": 1,
      "text": "OITRIC ACID,",
      "x": 0.3509,
      "y": 0.2939
    },
    {
      "confidence": 1,
      "text": "NATURAL",
      "x": 0.5019,
      "y": 0.2951
    },
    {
      "confidence": 1,
      "text": "FLAVOR",
      "x": 0.6064,
      "y": 0.298
    },
    {
      "confidence": 1,
      "text": "POL YDEXTROSE",
      "x": 0.347,
      "y": 0.2694
    },
    {
      "confidence": 1,
      "text": "IDIETARY",
      "x": 0.5058,
      "y": 0.2703
    },
    {
      "confidence": 1,
      "text": "FIBER),",
      "x": 0.6184,
      "y": 0.2749
    },
    {
      "confidence": 1,
      "text": "SODIUM BENZOATE (PRESERNATNE),",
      "x": 0.3525,
      "y": 0.2435
    },
    {
      "confidence": 1,
      "text": "MALIC ACID, ACESULFAME POTASSIUM,",
      "x": 0.3544,
      "y": 0.2184
    },
    {
      "confidence": 1,
      "text": "BUM ARABIC, SUCRALOSE, ASCORBC",
      "x": 0.3486,
      "y": 0.1937
    },
    {
      "confidence": 1,
      "text": "ACD. ESTER GUM, LACTIC ACID, FDBC",
      "x": 0.3543,
      "y": 0.1677
    },
    {
      "confidence": 1,
      "text": "XRLLOW NO. 6, FOBC RED NO.40.",
      "x": 0.3544,
      "y": 0.143
    },
    {
      "confidence": 1,
      "text": "DISTRIBUTED BY. TIPP DISTRIBUTORS INC",
      "x": 0.3578,
      "y": 0.0894
    },
    {
      "confidence": 1,
      "text": "EL PASO, TX 79901",
      "x": 0.3522,
      "y": 0.0682
    },
    {
      "confidence": 1,
      "text": "1-889-668-2539 + www.jarrites.com",
      "x": 0.3479,
      "y": 0.0458
    },
    {
      "confidence": 1,
      "text": "CAFFEINE FREE",
      "x": 0.355,
      "y": 0.0209
    },
    {
      "confidence": 1,
      "text": "PLEASE RECYCLE",
      "x": 0.355,
      "y": -0.0063
    }
  ],
  "joe-s-unsweetened-black-tea": [
    {
      "confidence": 1,
      "text": "No CALORIES. No",
      "x": 0.2865,
      "y": 0.6407
    },
    {
      "confidence": 1,
      "text": "SUGAR.",
      "x": 0.6507,
      "y": 0.6259
    },
    {
      "confidence": 1,
      "text": "Nutrit.on Facts",
      "x": 0.3109,
      "y": 0.5828
    },
    {
      "confidence": 1,
      "text": "Selving size",
      "x": 0.2943,
      "y": 0.5531
    },
    {
      "confidence": 1,
      "text": "1 bottle",
      "x": 0.5267,
      "y": 0.5544
    },
    {
      "confidence": 1,
      "text": "Amahunt per serving",
      "x": 0.3002,
      "y": 0.5157
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.2965,
      "y": 0.4797
    },
    {
      "confidence": 1,
      "text": "0",
      "x": 0.5678,
      "y": 0.4797
    },
    {
      "confidence": 1,
      "text": "% Daily Value*",
      "x": 0.5136,
      "y": 0.4419
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5678,
      "y": 0.4172
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5678,
      "y": 0.3866
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5678,
      "y": 0.3576
    },
    {
      "confidence": 1,
      "text": "MADE IN USA OF US AND IMPORTED INGREDIENTS",
      "x": 0.6242,
      "y": 0.3225
    },
    {
      "confidence": 1,
      "text": "CA CRV CTRV ME-HI S+C",
      "x": 0.6453,
      "y": 0.3285
    },
    {
      "confidence": 1,
      "text": "(37201(973) 744-7502 - WWW.JOETEA.COM",
      "x": 0.7168,
      "y": 0.3355
    },
    {
      "confidence": 1,
      "text": "Total Fat 0g",
      "x": 0.2956,
      "y": 0.4124
    },
    {
      "confidence": 1,
      "text": "Sodium 0mg",
      "x": 0.2925,
      "y": 0.3814
    },
    {
      "confidence": 1,
      "text": "Total Carbohydrate 0g",
      "x": 0.2941,
      "y": 0.3518
    },
    {
      "confidence": 1,
      "text": "Total Sugars 0g",
      "x": 0.3042,
      "y": 0.3209
    },
    {
      "confidence": 1,
      "text": "Includes 0g Added Sugars",
      "x": 0.3115,
      "y": 0.2927
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.5659,
      "y": 0.298
    },
    {
      "confidence": 1,
      "text": "Protein 0g",
      "x": 0.2923,
      "y": 0.2586
    },
    {
      "confidence": 1,
      "text": "not a signilicant source of saturaled fat, trans fat, cholesteror,",
      "x": 0.2946,
      "y": 0.2267
    },
    {
      "confidence": 1,
      "text": "oietary Tiber, vilamin D. calcium, iron and polassium.",
      "x": 0.2922,
      "y": 0.2087
    },
    {
      "confidence": 1,
      "text": "INGREDIENTS:",
      "x": 0.3256,
      "y": 0.173
    },
    {
      "confidence": 1,
      "text": "FILTERED WATER,",
      "x": 0.2984,
      "y": 0.1468
    },
    {
      "confidence": 1,
      "text": "NATURAL BLACK",
      "x": 0.3081,
      "y": 0.1219
    },
    {
      "confidence": 1,
      "text": "TEA, CITRIC ACID.O",
      "x": 0.2957,
      "y": 0.0918
    },
    {
      "confidence": 1,
      "text": "#joetet",
      "x": 0.3333,
      "y": 0.0102
    }
  ],
  "synergy-guava-goddess": [
    {
      "confidence": 1,
      "text": "NEVER PASTEURIZED",
      "x": 0.279,
      "y": 0.5464
    },
    {
      "confidence": 1,
      "text": "5% Juice",
      "x": 0.405,
      "y": 0.7164
    },
    {
      "confidence": 1,
      "text": "Nutrition Facts",
      "x": 0.3178,
      "y": 0.6919
    },
    {
      "confidence": 1,
      "text": "Serving Size 1 bottle",
      "x": 0.3191,
      "y": 0.6823
    },
    {
      "confidence": 1,
      "text": "Amount per serving",
      "x": 0.3173,
      "y": 0.6648
    },
    {
      "confidence": 1,
      "text": "Calories",
      "x": 0.3217,
      "y": 0.6512
    },
    {
      "confidence": 1,
      "text": "Total Fat 0g",
      "x": 0.3217,
      "y": 0.6262
    },
    {
      "confidence": 1,
      "text": "Sodium 10mg",
      "x": 0.3217,
      "y": 0.6131
    },
    {
      "confidence": 1,
      "text": "Total Carbohydrate 16g",
      "x": 0.3232,
      "y": 0.6014
    },
    {
      "confidence": 1,
      "text": "Total Sugars 16g",
      "x": 0.3353,
      "y": 0.593
    },
    {
      "confidence": 1,
      "text": "Includes 3g Added Sugars*",
      "x": 0.3488,
      "y": 0.5799
    },
    {
      "confidence": 1,
      "text": "Protein 0g",
      "x": 0.3275,
      "y": 0.5669
    },
    {
      "confidence": 1,
      "text": "60",
      "x": 0.5252,
      "y": 0.6526
    },
    {
      "confidence": 1,
      "text": "% Daily Value",
      "x": 0.4826,
      "y": 0.641
    },
    {
      "confidence": 1,
      "text": "0%",
      "x": 0.531,
      "y": 0.6148
    },
    {
      "confidence": 1,
      "text": "5%",
      "x": 0.531,
      "y": 0.6032
    },
    {
      "confidence": 1,
      "text": "6%",
      "x": 0.5329,
      "y": 0.5799
    },
    {
      "confidence": 1,
      "text": "|TPER BOTTLE ettime of bottling: Probiotics Bacillus.",
      "x": 0.3217,
      "y": 0.5363
    },
    {
      "confidence": 1,
      "text": "Coagulans GBi-305386: I billion organisms, S. Boulardi",
      "x": 0.3274,
      "y": 0.5271
    },
    {
      "confidence": 1,
      "text": "4 billion organisms, Lactobacillus Bacterium: 4 billion",
      "x": 0.3275,
      "y": 0.5188
    },
    {
      "confidence": 1,
      "text": "organisms, L(+) Lacic Acid: 100mg, Acetic Acid: 75mg,",
      "x": 0.3256,
      "y": 0.5056
    },
    {
      "confidence": 1,
      "text": "Glucuronic Acid: 1400mg, Gluconic Acid: 650mg",
      "x": 0.3256,
      "y": 0.4969
    },
    {
      "confidence": 1,
      "text": "INGREDIENTS: GT's Organic Raw Kombucha**",
      "x": 0.3252,
      "y": 0.477
    },
    {
      "confidence": 1,
      "text": "and guava puree",
      "x": 0.3236,
      "y": 0.4724
    },
    {
      "confidence": 1,
      "text": "*Organically produced",
      "x": 0.3236,
      "y": 0.4619
    },
    {
      "confidence": 1,
      "text": "430-day ferment of Kombucha culture*, black",
      "x": 0.3232,
      "y": 0.4456
    },
    {
      "confidence": 1,
      "text": "tea*, green tea*, kiwi juice*, and cane sugar**",
      "x": 0.3329,
      "y": 0.4361
    },
    {
      "confidence": 1,
      "text": "* Used for fermentation, not as an added sweetener",
      "x": 0.3253,
      "y": 0.4279
    },
    {
      "confidence": 1,
      "text": "MADE WITH 100% PURE LOVE",
      "x": 0.3508,
      "y": 0.4186
    },
    {
      "confidence": 1,
      "text": "Do not shake. Swirl gently. Store upright.",
      "x": 0.3275,
      "y": 0.4069
    },
    {
      "confidence": 1,
      "text": "Please note: Kombucha is a fermented tea that",
      "x": 0.327,
      "y": 0.3913
    },
    {
      "confidence": 1,
      "text": "has naturally occurring alcohol. Do not consume",
      "x": 0.3275,
      "y": 0.3866
    },
    {
      "confidence": 1,
      "text": "if you are avoiding alcohol due to pregnany",
      "x": 0.3295,
      "y": 0.3763
    },
    {
      "confidence": 1,
      "text": "allergies, sensitivities, or religious beliefs.",
      "x": 0.3289,
      "y": 0.3618
    },
    {
      "confidence": 1,
      "text": "BODY.",
      "x": 0.2556,
      "y": 0.2968
    },
    {
      "confidence": 1,
      "text": "473mL",
      "x": 0.2694,
      "y": 0.2733
    },
    {
      "confidence": 0.3,
      "text": "0900",
      "x": 0.2593,
      "y": 0.2578
    },
    {
      "confidence": 1,
      "text": "22430 90016",
      "x": 0.3952,
      "y": 0.2902
    },
    {
      "confidence": 1,
      "text": "Ferishable Keep Refrigerated",
      "x": 0.3346,
      "y": 0.2663
    },
    {
      "confidence": 1,
      "text": "May leak or gush if unrer",
      "x": 0.3391,
      "y": 0.2624
    }
  ]
};
