/* ============================================================================
   UniMart — catalogue data
   Four bays, 66 products. Prices are in THAI BAHT and are the base currency for
   the whole application: the database stores these numbers, the admin console
   edits them, and the storefront derives US dollars from them at a fixed rate.

   Prices are curated Thai retail figures (November 2026): supermarket anchors
   for produce, dairy and pantry lines, and 7-Eleven anchors for drinks. They are
   estimates for a demonstration catalogue, not scraped shelf prices — the
   retailer sites block automated access, and several of these brands are not
   stocked in Thailand at all. Each product carries a price_source note in the
   database and the admin console so the basis is visible.
   ========================================================================== */
'use strict';

const SHELVES = [
  { id: "produce", name: "Fresh Produce", items: [
    ["strawberries","Driscoll's Strawberries, 1 lb",259],["blueberries","Driscoll's Blueberries, 6 oz",139],["bananas","Chiquita Bananas, bunch",35],
    ["avocados","Hass Avocados, 3 ct",139],["apples","Envy Apples, 3 lb",239],["romaine","Dole Romaine Hearts, 3 ct",119],["carrots","Bolthouse Farms Baby Carrots",89],
    ["raspberries","Driscoll's Raspberries, 6 oz",149],["grapes","Red Seedless Grapes, 2 lb",219],["lemons","Lemons, 3 ct",59],["spinach","Earthbound Farm Baby Spinach",99],
    ["tomatoes","Tomatoes on the Vine",55],["pineapple","Whole Pineapple",35],["oranges","Sunkist Navel Oranges, 4 lb",189],["caesar","Fresh Express Caesar Chopped Kit",129],
    ["broccoli","Birds Eye Steamfresh Broccoli",79]]},
  { id: "dairy", name: "Dairy, Eggs & Deli", items: [
    ["milk","Organic Valley Whole Milk, ½ gal",139],["chobani","Chobani Greek Yogurt Plain, 32 oz",259],["philadelphia","Philadelphia Original Cream Cheese",119],
    ["kerrygold","Kerrygold Pure Irish Butter",229],["ham","Oscar Mayer Deli Fresh Ham",159],["eggs","Eggland's Best Large Eggs, 12 ct",85],
    ["tillamook","Tillamook Medium Cheddar, 8 oz",199],["yoplait","Yoplait Original Strawberry",29],["fairlife","fairlife 2% Milk, 52 oz",199],
    ["landolakes","Land O Lakes Salted Butter",239],["sargento","Sargento Sliced Swiss, 10 ct",189],["silk","Silk Almondmilk Original, ½ gal",169],
    ["wieners","Oscar Mayer Classic Wieners",99],["tyson","Tyson Chicken Nuggets, 29 oz",259]]},
  { id: "pantry", name: "Pantry & Snacks", items: [
    ["barilla","Barilla Penne, 1 lb",89],["classico","Classico Tomato Basil Sauce",149],["hellmanns","Hellmann's Real Mayonnaise",229],["heinz","Heinz Tomato Ketchup",119],
    ["lays","Lay's Classic Potato Chips",79],["oreo","Oreo Original Cookies",119],["cheezit","Cheez-It Original",99],["kraft","Kraft Mac & Cheese Original",129],
    ["skippy","Skippy Creamy Peanut Butter",169],["cheerios","Cheerios Cereal",199],["doritos","Doritos Nacho Cheese",75],["ritz","Ritz Original Crackers",99],
    ["kind","KIND Dark Chocolate Nuts & Sea Salt",69],["prego","Prego Traditional Sauce",139],["ranch","Hidden Valley Ranch Dressing",179],["frenchs","French's Classic Yellow Mustard",109],
    ["vlasic","Vlasic Kosher Dill Wholes",159],["smuckers","Smucker's Strawberry Preserves",149],["welchs","Welch's Concord Grape Jelly",139],["chunky","Campbell's Chunky Beef Soup",119],
    ["progresso","Progresso Chicken Noodle Soup",109],["tomatosoup","Campbell's Tomato Soup",89],["tuna","Bumble Bee Albacore Tuna, 2 pk",119],
    ["corn","Green Giant Cream Style Corn",79],["greenbeans","Del Monte Cut Green Beans",75]]},
  { id: "drinks", name: "Drinks", items: [
    ["coke","Coca-Cola, 12 cans",252],["pepsi","Pepsi, 12 cans",240],["sprite","Sprite, 12 cans",240],["bubly","bubly Lime Sparkling Water, 12 cans",219],
    ["gatorade","Gatorade Cool Blue, 28 oz",45],["lacroix","LaCroix Pamplemousse, 12 cans",429],["drpepper","Dr Pepper, 12 cans",419],
    ["frappuccino","Starbucks Frappuccino Mocha",89],["lemonade","Simply Lemonade, 89 oz",289],["cranberry","Ocean Spray Cranberry Cocktail",329],["redbull","Red Bull Energy Drink, 4 pk",139]]}
];

const PRODUCTS = {};
SHELVES.forEach(s => s.items.forEach(([id, name, price]) => PRODUCTS[id] = { id, name, price, shelf: s.id }));

/* Commerce constants, in baht */
const FREE_AT = 500, FEE = 39;

/* Round-bottomed produce that should sink a little into the shelf (1 = fully round). */
const SEAT = { avocados: 1, apples: 1, lemons: 1, tomatoes: 1, grapes: .7, oranges: .6, pineapple: .8, bananas: .6 };

/* Fixed slots inside the basket: back row (r0) is drawn darker, front row (r1) larger.
   Positions are percentages of the cart tile; rotations are degrees. */
const SPOTS = [
  { x: 50, r: 1, rot: -3 }, { x: 27, r: 1, rot: 5 }, { x: 73, r: 1, rot: -6 },
  { x: 38, r: 0, rot: 3 }, { x: 62, r: 0, rot: -3 }, { x: 19, r: 0, rot: 8 }, { x: 81, r: 0, rot: -8 },
  { x: 50, r: 0, rot: 1 }, { x: 15, r: 1, rot: -5 }, { x: 85, r: 1, rot: 6 }
];

/* The icon set: every glyph in the UI is an inline SVG built from these strings. */
const icons = {
  plus: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.3s-7.8-4.6-7.8-10.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.7c0 5.8-7.8 10.4-7.8 10.4Z" stroke="#1d241f" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5-7 7 7 7" stroke="#1d241f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="#1d241f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
