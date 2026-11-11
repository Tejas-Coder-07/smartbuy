import type { Category } from "./types";

const RULES: [Category, RegExp][] = [
  ["wearables", /\b(smart ?watch|watch (series|ultra|se)|fitness band|smart band|galaxy watch|apple watch|fitbit|garmin)\b/],
  ["audio", /\b(headphones?|earphones?|earbuds?|airpods|neckband|soundbar|speakers?|tws|headset|home theat(re|er))\b/],
  ["tablets", /\b(tablet|ipad|galaxy tab|\btab\b|kindle|e-?reader)\b/],
  ["laptops", /\b(laptop|notebook|macbook|chromebook|ultrabook|thinkpad|ideapad|vivobook|zenbook|inspiron|pavilion)\b/],
  ["tvs", /\b(tv|television|smart tv|oled tv|qled|android tv|google tv|monitor|projector)\b/],
  ["cameras", /\b(camera|dslr|mirrorless|gopro|action cam|lens|camcorder|drone)\b/],
  ["gaming", /\b(playstation|ps5|ps4|xbox|nintendo|switch (oled|lite)|gaming console|controller|gamepad|graphics card|gpu)\b/],
  ["mobiles", /\b(phone|smartphone|mobile|iphone|galaxy [sazmf]\d|pixel \d|oneplus|redmi|poco|realme|vivo [a-z]?\d|oppo|nothing phone|moto [ge]\d|5g)\b/],
  ["appliances", /\b(refrigerator|fridge|washing machine|air conditioner|\bac\b|microwave|oven|air fryer|mixer|grinder|vacuum|purifier|geyser|water heater|dishwasher|induction|cooler|fan|iron|kettle|toaster|chimney)\b/],
  ["footwear", /\b(shoes?|sneakers?|sandals?|slippers?|flip ?flops?|boots?|loafers?|heels|trainers?|crocs)\b/],
  ["beauty", /\b(lipstick|perfume|fragrance|serum|moisturi[sz]er|sunscreen|shampoo|conditioner|face wash|foundation|kajal|mascara|trimmer|hair dryer|straightener)\b/],
  ["fashion", /\b(shirt|t-?shirt|jeans|trousers?|kurta|kurti|saree|dress|jacket|hoodie|sweatshirt|sweater|shorts|leggings|top|blazer|suit|lehenga|dupatta|handbag|backpack|wallet|sunglasses|watch)\b/],
  ["home", /\b(mattress|bedsheet|pillow|sofa|chair|table|desk|curtains?|lamp|cookware|pressure cooker|bottle|storage|wardrobe|shelf)\b/],
];

export function categorise(title: string): Category {
  const t = title.toLowerCase();
  for (const [category, pattern] of RULES) {
    if (pattern.test(t)) return category;
  }
  return "other";
}

export const CATEGORY_LABELS: Record<Category, string> = {
  mobiles: "Mobiles",
  laptops: "Laptops",
  tablets: "Tablets",
  audio: "Audio",
  tvs: "TVs & displays",
  wearables: "Wearables",
  cameras: "Cameras",
  appliances: "Appliances",
  gaming: "Gaming",
  fashion: "Fashion",
  footwear: "Footwear",
  beauty: "Beauty & grooming",
  home: "Home",
  other: "Other",
};
