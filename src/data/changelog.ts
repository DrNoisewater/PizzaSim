// What's new, shown in the game (Credits → tap the version). Newest first. Player-facing words.
// Major updates get their own entry with a fun title. Small versions in between are rolled up
// into ONE summary entry spanning the range (e.g. '0.3.1–0.3.22'): extend its range and add a
// bullet when something worth mentioning ships; start a new range after the next major update.
export interface UpdateNote {
  version: string;
  title: string;
  date: string;
  /** Section heading → bullet points. */
  sections: [string, string[]][];
}

export const UPDATES: UpdateNote[] = [
  {
    version: '0.4.1–0.4.3',
    title: 'Second Slice',
    date: 'October 2026',
    sections: [
      ['Smaller updates since Slice of Life', [
        'Smarter schedules: Suggest and Auto-schedule now stop as soon as the Cover row is happy, keep people at 40 hours first, and only use overtime (or 12-hour OP-CL shifts) where a real gap is left. No more padding everyone to 48 hours.',
      ]],
    ],
  },
  {
    version: '0.4.0',
    title: 'Slice of Life',
    date: 'October 2026',
    sections: [
      ['Staff and scheduling', [
        'One-tap weekly schedule: Suggest fills it from the forecast with 40-hour weeks, and Auto-schedule keeps it up to date every night.',
        'Hire up to three managers. They run shifts, cover call-offs, text the crew in a rush and give sharper tips.',
        'Real-world pay: insiders $13–15, kitchen $13–18, drivers $11 inside and $7 on the road plus tips, managers about $19–23. Overtime past 40 hours.',
        'A leaner crew can keep up, front of house splits tills and floor work, and cleaning happens when it matters.',
        'Crew messages and celebrations (lunch, bowling, go-karts) keep morale up after a good run.',
      ]],
      ['Customers and fame', [
        'Customers have personalities and eat slice by slice, leaving crumbs, cups and napkins behind.',
        '25 surprise visitors, from birthday parties to a dancing hot dog. How you handle them builds Buzz.',
        'Buzz gets you featured, from a local newsletter up to national TV. Each feature brings a rush and more foot traffic for good. See Goals → Wall of Fame.',
      ]],
      ['Running the shop', [
        "Tomorrow's plan: customers, stock, staff and promo at a glance, then one button to order and open.",
        'Cheaper, earlier upgrades, deeper ladders and a second store at level 3.',
        'Clear shortage warnings with one-tap Stock up, and a morning truck reminder.',
        'Delivery starts slow and can be paused any time.',
      ]],
      ['Look and feel', [
        'A friendlier crew: elbows, hands, shoes, faces and smooth movement. They build pizzas, slide them into the oven, sweep and wipe tables.',
        'Steam from the oven, sparkles on clean tables, and litter that grows as the store gets messy (High graphics).',
        'Pizza rating, food and labor breakdowns on the receipt, a clearer Finance tab and collapsible staff groups.',
        'Remakes instead of constant drops, and a new title-screen splash every launch.',
      ]],
      ['Everything else', [
        'Sturdier saves (ready for itch.io), save files to download, and playtest notes that send from inside the game.',
        'A sideways-phone layout, automatic full screen, and fixes for people walking through the counter and popping music.',
      ]],
    ],
  },
  {
    version: '0.3.0',
    title: 'The Big Rush',
    date: 'October 2026',
    sections: [
      ['Stock that actually lasts', [
        'Found it: on busy days a day of stock couldn\'t fit in the starting fridge. The fridge is bigger and storage has more, cheaper steps.',
        'Order buffer: "Fill to forecast" and every auto-order now add a safety margin on top (Auto, or pick 0–50%).',
        'Better Inventory Systems learn from your real sales and tighten forecasts (±25% → ±12% → ±6%).',
        'A morning truck step before opening: review it, tweak it, or skip it. Order more after an upgrade without waiting a day.',
        'Low-stock warnings during the day, with enough lead time to react.',
        'Express delivery takes 90 minutes, costs more, and the surcharge climbs if you lean on it every day.',
        'Each ingredient shows how many days your stock lasts.',
      ]],
      ['Managers do the ordering', [
        'Train a manager to skill 2 and they can place the morning truck, and rush express orders up to a limit you set.',
      ]],
      ['Staff, sorted', [
        'Team list grouped by shift or role, with filters. Tap anyone to open their card.',
        'Coverage strip: hour by hour, green when you have enough people, red where customers will go unserved, plus who to add.',
        'Shorter shifts: lunch rush (11–3) and dinner rush (5–9). New hires start on a 6-hour shift, not 12.',
        'Labor cost as a % of expected sales.',
        'Weekly schedule (optional): plan the whole week on a grid, see gaps per day, or let the game suggest one.',
        'Performance reviews with grades, so raises go to the people who earned them. Raise requests can be answered with training instead.',
        'Hiring pool: applicants stick around a few days, there are more of them, and a job ad brings better ones. Every applicant gets a Great / Good / Fair / Pricey deal label.',
        'Six new traits: Early Bird, Team Player, Ambitious, Multitasker, Grumpy and Thin-Skinned.',
      ]],
      ['Visitors', [
        'Inspector Logan walks the store with his clipboard and checks more (the walk-in, the pass, staff energy). Rewards and consequences are tiered: outstanding, good, passed, needs work, failed. Fines stay small; a bad report mostly costs you customers for a few days.',
        'A rare food critic comes to dinner. He judges the food, the wait, the freshness and the room, and he always knows when something was on its last day.',
      ]],
      ['Menu & prices', [
        'Fair prices move with the neighborhood, your ingredients, your rating, the weather and crowds. Cold drinks on a heatwave? People will pay a bit more.',
        'Not everyone agrees on a fair price: some shrug at a markup, some walk.',
        'Specials can run at lunch, at dinner or all day, from 10% to 40% off, up to three at a time.',
        'Clearance deals: when stock is about to expire, the menu suggests a discount that uses it up.',
      ]],
      ['Menus and screens', [
        'Tomorrow\'s plan is the quick way to start a day: customers, stock, staff and promo checks at a glance, then one button orders the truck and opens the doors.',
        'Your rating is a pizza now: slices bake in to one decimal place, with the number in the middle.',
        'The receipt folds out food cost and labor, and Finance shows where the money came from, where it went, and how to make more.',
        'Staff groups are bigger, collapse with a tap, and say whether each role covers the forecast.',
      ]],
      ['Everything else', [
        'Reviews are longer and more varied. Tap one to see what that customer ordered, waited and paid.',
        'Six music tracks. Calm ones rotate, and the music picks up when the shop gets slammed.',
        'Full screen by default, simpler touch controls (one finger slides, pinch zooms, twist turns) and optional zoom buttons.',
        'Faster speed buttons: 1×, 3× and 8×.',
        'A calendar with the week\'s weather, events, shortages and promos.',
        'Playtest notes: jot things down while you play and send them straight to the studio from inside the game.',
        'What\'s new: tap the version in Credits to read every update.',
        'A reminder about loans when cash runs low.',
      ]],
    ],
  },
  {
    version: '0.2.0',
    title: 'Fresh Out of the Oven',
    date: 'October 2026',
    sections: [
      ['Playtest fixes', [
        'Four roles: Kitchen Crew, Front of House, Driver, Manager.',
        'Everyone can drop a pizza; Steady Hands never does.',
        'Typeable prices and wages, in 25¢ steps.',
        'Pause freezes the whole scene, and the game pauses itself when nothing is happening.',
        'People walk at the sim\'s real pace, with pathfinding and no walking through tables.',
        'Bottleneck meters and an hour-by-hour day plan.',
        'Shortages announced two days ahead.',
        'Evening-class training, and warnings before anyone quits.',
      ]],
      ['New', ['Inspector Logan\'s surprise visits.', 'Shifts, days off, dirty tables, food going cold, daily specials, delivery fees.']],
    ],
  },
  {
    version: '0.1.0',
    title: 'Grand Opening',
    date: 'October 2026',
    sections: [['The first slice', ['One deck oven, one cook, one dream: the first playable Pizza SIM.']]],
  },
];
