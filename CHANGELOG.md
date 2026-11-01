# Pizza SIM v0.4.1–0.4.3: Second Slice

*Smaller updates since Slice of Life · October 2026*

- Smarter schedules: Suggest and Auto-schedule now stop as soon as the Cover row is happy, keep people at 40 hours first, and only use overtime (or 12-hour OP-CL shifts) where a real gap is left. No more padding everyone to 48 hours.

# Pizza SIM v0.4.0: Slice of Life

*Noisewater Labs · October 2026*

## Staff and scheduling
- One-tap weekly schedule: Suggest fills it from the forecast with 40-hour weeks, and Auto-schedule keeps it up to date every night.
- Hire up to three managers. They run shifts, cover call-offs, text the crew in a rush and give sharper tips.
- Real-world pay: insiders $13–15, kitchen $13–18, drivers $11 inside and $7 on the road plus tips, managers about $19–23. Overtime past 40 hours.
- A leaner crew can keep up, front of house splits tills and floor work, and cleaning happens when it matters.
- Crew messages and celebrations (lunch, bowling, go-karts) keep morale up after a good run.

## Customers and fame
- Customers have personalities and eat slice by slice, leaving crumbs, cups and napkins behind.
- 25 surprise visitors, from birthday parties to a dancing hot dog. How you handle them builds Buzz.
- Buzz gets you featured, from a local newsletter up to national TV. Each feature brings a rush and more foot traffic for good. See Goals → Wall of Fame.

## Running the shop
- Tomorrow's plan: customers, stock, staff and promo at a glance, then one button to order and open.
- Cheaper, earlier upgrades, deeper ladders and a second store at level 3.
- Clear shortage warnings with one-tap Stock up, and a morning truck reminder.
- Delivery starts slow and can be paused any time.

## Look and feel
- A friendlier crew: elbows, hands, shoes, faces and smooth movement. They build pizzas, slide them into the oven, sweep and wipe tables.
- Steam from the oven, sparkles on clean tables, and litter that grows as the store gets messy (High graphics).
- Pizza rating, food and labor breakdowns on the receipt, a clearer Finance tab and collapsible staff groups.
- Remakes instead of constant drops, and a new title-screen splash every launch.

## Everything else
- Sturdier saves (ready for itch.io), save files to download, and playtest notes that send from inside the game.
- A sideways-phone layout, automatic full screen, and fixes for people walking through the counter and popping music.

# Pizza SIM v0.3.0: The Big Rush

*Noisewater Labs · October 2026 · playtested by Logan Taylor and Ian McQueen*

The in-game version of these notes is in Credits → tap the version number.

## Stock (the "I always run out" bug)
- **Root cause:** the forecast was right, but a busy day's stock didn't fit the starting fridge, so orders were silently trimmed and each day used nearly everything. Bot runs went from 375 sell-outs over 40 days to about 25–35.
- Storage: 450 → 750 → 1,100 → 1,700 → 2,600 units (cheaper early steps). Old saves map onto the new ladder.
- **Order buffer** (Stock): Auto or 0–50% on top of the forecast for Fill to forecast, the morning truck, auto-reorder and the manager.
- **Inventory System** levels: Clipboard ±25%, Inventory Software ±12% (learns from your real sales), Smart Forecasting ±6%.
- **Morning truck** step at Open for business: order and open, order and stay in prep, adjust, skip, or order what you can afford. If you upgrade or hire after ordering, it offers a top-up truck.
- **Low-stock warnings** mid-day (2.5–4 hours' lead depending on the Inventory System).
- **Express**: 90 minutes, ×1.5 prices + $15 fee, +10% per back-to-back day. Reported on the receipt.
- Days of cover per ingredient.
- Managers at skill 2+ can place the morning truck and rush express orders up to a limit.

## Staff
- Shifts: lunch 10–4, dinner 4–close, lunch rush 11–3, dinner rush 5–9, full day. New hires default to the thinner half-day, not 12 hours.
- Team view: coverage strip, gaps with who to add, labor % of expected sales, group by shift or role, filters, compact expandable rows.
- Weekly schedule (opt-in) with per-day coverage and a suggested schedule.
- Performance reviews (grade A–D vs teammates, drops, pay); raise requests can be answered with training.
- Hiring pool persists a few days, has 6–9 applicants, a job ad ($150, 3 days), balanced traits, and Great / Good / Fair / Pricey deal labels.
- New traits: Early Bird, Team Player, Ambitious, Multitasker, Grumpy, Thin-Skinned.

## Visitors
- **Inspector Logan** (renamed): walks the store with a clipboard (3D), stricter checks, tiers Outstanding / Good / Passed / Needs work / Failed / Failed badly. Fines are small and capped; failures mostly cost customers for a few days. Arrival, pass and fail photos.
- **Food critic** (rarer, about 1–2 per 40 days): his own 3D model; judges food (cooks, oven, supplier), wait, freshness (last-day ingredients) and the room. Rave / pass / meh / pan.
- Review and report effects start the next day.

## Menu & prices
- Fair price per item depends on neighborhood, ingredients, oven, rating, weather (drinks on hot days) and crowds, with a visible breakdown. Customers have their own price tolerance.
- Specials: lunch, dinner or all day, 10–40% off, up to 3. Clearance deals for stock expiring tonight.

## Everything else
- Reviews: composed from more lines, no repeats, and tap to see the order, wait, price, food quality and factors.
- Six music tracks with adaptive calm/rush crossfades and a percussion layer that follows how busy it is.
- Full screen by default (Settings to play windowed); one-finger pan, pinch zoom, two-finger twist; optional camera buttons; Classic camera option.
- Speeds 1×, 3×, 8×.
- Calendar (tap the day in the top bar).
- Playtest notes: saved on device; Send delivers them straight to the studio's inbox from inside the game.
- Low-cash loan reminders.
- What's New: tap the version in Credits to read every update.
- More personality: title quips, receipt one-liners.

## Balance (bot, 40 days, 3 seeds)
- Relaxed ≈ $1.9k/day, Standard ≈ $1.4k/day, Hard ≈ $0.75k/day (v0.2.5: standard ≈ $0.9k, hard ≈ $0.7k, held down by constant sell-outs).
- Wages +8% and steeper pay for skill, ingredients +19%, rents up (Maple $280/day), hard's multipliers eased.
- Stock planning allows 30% over the capacity estimate, so busy days don't run dry.

# Pizza SIM v0.2.0: balance & robustness pass

*Noisewater Labs · playtested by Logan Taylor and Ian McQueen*

## Playtest feedback, fixed

| Feedback | What changed |
|---|---|
| "Time is stopped" but the speed selector isn't paused | The selector always shows the real state. It reads paused during morning prep, at the end-of-day receipt, behind any pop-up, and whenever nothing is at stake. The game pauses itself at close. |
| Positions too granular | Four roles: **Kitchen Crew**, **Front of House** (till, running food, bussing, mopping), **Driver**, **Manager**. Old saves convert cashiers and cleaners automatically. |
| Clumsiness should be universal | Everyone can drop a pizza (more likely when tired or low-skill). **Butterfingers** makes it 4× likelier. New **Steady Hands** trait removes it. Drops are counted on the receipt. |
| Prices should be typeable / finer steps | Type any price (to the cent) or use 25¢ buttons. |
| Pause should freeze the scene | Pausing freezes people, cars, smoke, rain and particles, dims the view and shows a PAUSED badge. |
| Sim runs ahead of the visuals | Walking now takes game time in the simulation. Customers only order once they reach the till, food is only eaten once they're seated and served, and takeout is collected from the shelf. People walk at exactly the sim's pace (and hurry if they fall behind). 1× is half as fast as before. |
| People walk through tables and each other | A* pathfinding on a shared floor plan, with no corner-cutting, plus crowd avoidance. Staff use a gate in the counter and the back door. |
| Pausing makes foot traffic vanish or clone | Fixed: leaving customers were re-created every frame until the sim dropped them. Now each is handed off exactly once. |
| Hard to see the bottleneck | Live service meters (line, make line, oven, food waiting for a runner, dirty tables, deliveries) with the worst one highlighted and a fix. An hour-by-hour **day plan** shows demand vs capacity and what limits it. Finance → **Service** shows where customers were lost. The receipt gives one plain-language tip. |
| Raises/cuts too coarse | Type a wage or use 25¢ steps. Morale reacts in proportion to the change. |
| Shortages hit with no warning | Supply shortages are announced **two days ahead** (receipt, prep card, Stock), so there's a morning to stock up at normal prices. |
| Boxes stored in the fridge | Boxes and soda go on dry shelves and in the drinks fridge; only perishables use cold storage. |
| Hires with useless traits | Traits are role-specific (no upselling cooks or perfectionist cashiers). New ones: Neat Freak, Knows Shortcuts, Mentor, Steady Hands. |
| Rain falls inside | Rain stops at the roof and awning. |
| Training not worth it | Training is now an **evening class**: no time off, +1 skill the next morning. On-the-job learning is earned per minute of real work. |
| No warning before quitting | Morale shows a label, trend arrow and last night's reasons (pay vs market, workload, long shifts, breakroom, manager). Warnings at Unhappy and Fed up, and a one-night final warning before anyone quits. |

## Balance

- **Hard was easier** because difficulty only lowered traffic, which reduced overload. Difficulty now changes patience, price sensitivity, rent, wages, ingredient costs, review harshness, bad-event odds and loan rates. Traffic is the same everywhere. Bot runs over 40 days on three seeds average about $2.6k/day profit on relaxed, $1.1k on standard and $0.8k on hard.
- **Always running out of stock** had three causes:
  - The forecast averaged in today's empty day.
  - A day of stock didn't fit the starting fridge.
  - Pizza boxes silently ran out because tiny dining rooms push most diners to takeout.

  The new forecast models each hour (weather, weekday, events, staff schedule, capacity, seats, upsellers) and tracks real use within a few percent on normal days. Stock rows show "runs out ~6:40 PM".
- **Refund spirals:** the till quotes a wait. People balk at very long ones before paying, and those who accept a long quote are more patient. The starting oven holds 3 pizzas.
- Customers who never got in no longer drag the rating down; they show as missed demand.
- Rents, wages and store prices tightened so early upgrades are real decisions.

## New features

- **Shifts:** full day, lunch (10–4) or dinner (4–close); wages are paid by the hour. Plus unpaid **days off** for a morale boost.
- **Front of house runs the room:** finished dine-in pizzas wait under a heat lamp for a runner (and cool off), and dirty tables block seating until bused.
- **Tills:** the register upgrade adds tills.
- **Daily special:** 15% off and 60% more popular.
- **Delivery fee:** $2.99 on delivery orders.
- **Auto-reorder** can order to the forecast instead of fixed par levels (unlocks at level 4).
- **Food cost % and labor % KPIs**, an average ticket, and a two-day weather outlook.
- **New events:** concert crowds, plus shortages of any ingredient on the menu.
- Walkouts show why ("Too slow!", "25 min wait?!", "Sold out"), and people who see a full line visibly walk past.
- **Logan Taylor**, the health & operations inspector, drops in unannounced every week or two of game time. He watches for an hour, then gives health and operations grades, a score, pointers, and a rating boost, a dip or a fine.
- Saves from the previous version load and convert automatically (save version 2).
