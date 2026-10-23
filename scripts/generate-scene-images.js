#!/usr/bin/env node
/**
 * Generate illustrated scene images for every exercise scenario (A2 + B1 + KNM),
 * the regenerated Spreken pictures and the landing-page canal hero.
 *
 * House style: warm flat editorial illustration, no text. Rule for scenes:
 * SHOW THE SITUATION, NEVER THE ANSWER. Scene briefs are written by an LLM from
 * the stem/situation only (never the options / correct answer); a vision audit
 * then checks each MCQ image against the options for answer leakage, text and
 * anatomy, and regenerates once on a clear failure.
 *
 * Usage:
 *   node scripts/generate-scene-images.js                 # everything missing
 *   node scripts/generate-scene-images.js --only lezen    # lezen|luisteren|schrijven|spreken|knm|pictures|hero
 *   node scripts/generate-scene-images.js --level b1      # a2|b1 (KNM/hero are level-less)
 *   node scripts/generate-scene-images.js --force a2/lezen/exam1-tips_leren [--force ...]
 *   node scripts/generate-scene-images.js --ids knm/k1-q1,hero/canal   # restrict to these unit ids
 *   node scripts/generate-scene-images.js --dry-run       # list units, write nothing, call nothing
 *   node scripts/generate-scene-images.js --writeback     # only write image fields + contact sheet
 *   flags: --concurrency 4  --budget 15  --no-audit  --note "<extra instruction for forced ids>"
 *
 * Idempotent: units whose image file already exists are skipped (unless forced).
 * Cost is logged per call and accumulated in scripts/scene-manifest.json.
 * Needs OPENAI_API_KEY (read from env or .env).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMAGES = path.join(ROOT, 'public', 'images');
const DATA = path.join(ROOT, 'public', 'data');
const MANIFEST = path.join(__dirname, 'scene-manifest.json');
const SHEET = path.join(ROOT, 'docs', 'plans', 'scene-contact-sheet.html');

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def);
const multi = (name) => argv.reduce((acc, a, i) => (a === name && argv[i + 1] ? acc.concat(argv[i + 1]) : acc), []);
const ONLY = opt('--only', null);
const LEVEL = opt('--level', null);
const FORCE = new Set(multi('--force'));
const IDS = opt('--ids', null) ? new Set(opt('--ids').split(',')) : null; // restrict to these unit ids
const NOTE = opt('--note', '');
const DRY = flag('--dry-run');
const WRITEBACK_ONLY = flag('--writeback');
const CONCURRENCY = Number(opt('--concurrency', 4));
const BUDGET = Number(opt('--budget', 15));
const AUDIT = !flag('--no-audit');

function loadKey() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    try {
        const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^OPENAI_API_KEY=(.*)$/m);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* no .env */ }
    return null;
}
const OPENAI_API_KEY = loadKey();
if (!OPENAI_API_KEY && !DRY && !WRITEBACK_ONLY) {
    console.error('Error: OPENAI_API_KEY required (env or .env)');
    process.exit(1);
}

// ---------- models + pricing (USD per 1M tokens) ----------
const IMAGE_MODEL = 'gpt-image-1';
const BRIEF_MODEL = 'gpt-4o-mini';
const AUDIT_MODEL = 'gpt-4.1-mini';
const PRICE = {
    'gpt-image-1': { text_in: 5, image_in: 10, out: 40 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
    'gpt-4.1-mini': { in: 0.4, out: 1.6 },
};
const EST_IMAGE_COST = 0.05; // conservative pre-call estimate for the budget guard

// ---------- style ----------
const STYLE = [
    'Warm flat editorial illustration, grown-up and friendly (think modern picture-book meets magazine spot illustration), subtle paper grain,',
    'limited consistent palette: warm cream, terracotta orange, deep navy, sage green, soft sky blue, touches of mustard.',
    'Simple confident shapes, soft shadows, natural proportions, expressive but calm faces, correct hands.',
    'Diverse people (vary skin tone, age, gender; some wear a headscarf, some glasses), everyday contemporary life in the Netherlands.',
    'ABSOLUTELY NO text, letters, numbers, words, logos, labels or signage with writing anywhere; any paper or screen shows only abstract shapes.',
].join(' ');
const BANNER_COMPOSITION = 'Composition: one clear scene; keep every important person and object inside the central horizontal band (middle 55% of the height) because the image is shown cropped to a wide 16:9 banner; the top and bottom edges are calm background (wall, sky, floor).';
const PICTURE_COMPOSITION = 'Composition: full square picture for a speaking exam — every detail listed below must be clearly visible and easy to name; uncluttered, nothing important cut off at the edges.';

// ---------- cost tracking ----------
let manifest = { totalCostUsd: 0, entries: {} };
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { /* first run */ }
let runCost = 0;
function addCost(usd, what) {
    runCost += usd;
    manifest.totalCostUsd = +(manifest.totalCostUsd + usd).toFixed(4);
    console.log(`    $ +${usd.toFixed(4)} ${what}  (run $${runCost.toFixed(3)}, all-time $${manifest.totalCostUsd.toFixed(3)})`);
}
function imageCost(usage) {
    if (!usage) return EST_IMAGE_COST;
    const p = PRICE[IMAGE_MODEL];
    const d = usage.input_tokens_details || {};
    const textIn = d.text_tokens ?? usage.input_tokens ?? 0;
    const imgIn = d.image_tokens ?? 0;
    return (textIn * p.text_in + imgIn * p.image_in + (usage.output_tokens || 0) * p.out) / 1e6;
}
function chatCost(model, usage) {
    const p = PRICE[model];
    return ((usage?.prompt_tokens || 0) * p.in + (usage?.completion_tokens || 0) * p.out) / 1e6;
}
let manifestWrite = Promise.resolve();
function saveManifest() {
    manifestWrite = manifestWrite.then(() =>
        fs.promises.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n'));
    return manifestWrite;
}

// ---------- HTTP with retries ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(label, fn, attempts = 4) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); } catch (e) {
            lastErr = e;
            if (e.noRetry) throw e;
            const wait = (e.status === 429 ? 20000 : 4000) * (i + 1);
            console.warn(`    ! ${label} attempt ${i + 1} failed (${e.message.slice(0, 160)}); retry in ${wait / 1000}s`);
            await sleep(wait);
        }
    }
    throw lastErr;
}
async function apiJson(url, init) {
    const resp = await fetch(url, init);
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!resp.ok) {
        const err = new Error(`${resp.status} ${body?.error?.message || text.slice(0, 200)}`);
        err.status = resp.status;
        // moderation / bad request won't fix itself by retrying the same prompt
        if (resp.status === 400) err.noRetry = true;
        throw err;
    }
    return body;
}
const authHeaders = () => ({ Authorization: `Bearer ${OPENAI_API_KEY}` });

async function chatJson(model, messages, label) {
    const body = await withRetry(label, () => apiJson('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.4 }),
    }));
    addCost(chatCost(model, body.usage), `${model} ${label}`);
    return JSON.parse(body.choices[0].message.content);
}

async function generateImage({ prompt, size = '1024x1024', refFile = null, label }) {
    let body;
    if (refFile) {
        body = await withRetry(label, async () => {
            const form = new FormData();
            form.append('model', IMAGE_MODEL);
            form.append('prompt', prompt);
            form.append('size', size);
            form.append('quality', 'medium');
            form.append('output_format', 'webp');
            form.append('output_compression', '72');
            form.append('image[]', new Blob([fs.readFileSync(refFile)], { type: 'image/webp' }), path.basename(refFile));
            return apiJson('https://api.openai.com/v1/images/edits', { method: 'POST', headers: authHeaders(), body: form });
        });
    } else {
        body = await withRetry(label, () => apiJson('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: IMAGE_MODEL, prompt, size, quality: 'medium', n: 1,
                output_format: 'webp', output_compression: 72,
            }),
        }));
    }
    const cost = imageCost(body.usage);
    addCost(cost, `${IMAGE_MODEL} ${label}`);
    return { buffer: Buffer.from(body.data[0].b64_json, 'base64'), cost };
}

// ---------- content ----------
const readData = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');

// Spreken pictures: hand-written briefs. Each lists every detail the exercise
// prompt + tip asks the learner to describe. Story triptychs share one
// character description and frames b/c are made with frame a as reference.
const STORY_CAST = {
    story1: 'a man in his thirties with short dark curly hair and a trimmed beard, wearing a mustard-yellow jacket and dark jeans',
    story2: 'a woman in her forties with a navy headscarf, a terracotta coat and a canvas shopping bag',
    story3: 'a man in his fifties with grey hair, glasses and a sage-green cardigan',
    story4: 'a family: a father with light brown skin and short black hair, a mother with long red hair, and their two children (a girl of about 8 and a boy of about 5)',
    story5: 'a woman in her thirties with dark brown skin and braided hair in a bun, wearing a sky-blue coat, holding the hand of her daughter of about 5 with pigtails',
    story6: 'a man in his late twenties with East Asian features, short black hair, wearing a navy apron over a white T-shirt',
};
const PICTURE_BRIEFS = {
    'markt': 'A lively Dutch outdoor street market on a sunny day with a few white clouds. Stalls with fruit and vegetables, cheese wheels, flowers and fresh bread. About eight people: a vendor handing a bag of apples to a customer, a woman choosing tulips, a man paying, a parent with a child. Clear blue sky so the weather is obvious.',
    'park': 'A green Dutch city park on a sunny afternoon. A pond with ducks, a dog on a leash walking with its owner, two children playing on a playground slide, a couple having a picnic on a blanket on the grass, an older man reading on a bench, trees and a cyclist on the path.',
    'stad': 'A busy Dutch city street: tall buildings and canal houses, many people walking on the pavement, a tram, cars and lots of cyclists, shops with awnings (no writing), a few small trees. Lots of movement and traffic.',
    'dorp': 'A quiet Dutch village: a small church, low brick houses with gardens, a narrow road with one cyclist and one person walking a dog, green fields, cows and a windmill in the distance, big trees. Calm and peaceful, very few people.',
    'zomer': 'A hot summer day at a Dutch beach or lake: bright sun, blue sky, people in T-shirts, shorts and swimwear, children building a sandcastle, someone eating an ice cream, a family under a parasol, people swimming.',
    'winter': 'A cold winter day in a Dutch village: snow on the roofs and ground, grey sky with falling snowflakes, people in thick coats, scarves, hats and gloves, children making a snowman, people ice skating on a frozen canal, someone drinking hot chocolate.',
    'story1-a': `{story1} stands next to his bicycle on a street, looking down at it with a puzzled, worried face. The bike is parked; his hand rests on the handlebar.`,
    'story1-b': `{story1} crouches next to his bicycle and points at the front tyre, which is completely flat and squashed against the ground. He looks unhappy.`,
    'story1-c': `{story1} repairs his bicycle on the pavement in front of his house: the bike is upside down, he holds a tyre lever and a bicycle pump, a small repair kit lies next to him. He looks satisfied.`,
    'story2-a': `{story2} walks towards the entrance of a Dutch supermarket with sliding glass doors; shopping trolleys stand outside; she holds her empty shopping bag.`,
    'story2-b': `{story2} shops inside the supermarket, pushing a trolley, taking tomatoes from the vegetable shelf; the trolley already holds bread, milk, pasta and vegetables.`,
    'story2-c': `{story2} cooks at home in her kitchen: stirring a pot of pasta on the stove, the groceries (tomatoes, vegetables, bread) on the counter. Warm and cosy.`,
    'restaurant': 'A cosy Dutch restaurant interior in the evening with warm lighting. Several tables; at the front a group of four friends eats dinner together: plates with fish, fries, salad and pasta, glasses of water and wine, a bread basket, a candle. A waiter carries plates. Other diners in the background. Relaxed, happy atmosphere.',
    'klas': 'A bright Dutch primary school classroom. A teacher stands at the whiteboard (whiteboard shows only simple drawings of shapes and a sun, no writing) explaining a lesson to about twelve children aged 8 to 10 sitting at desks with notebooks, some raising their hands. On the walls: a world map, colourful children\'s drawings and a plant on the windowsill.',
    'kantoor': 'A modern Dutch open-plan office: several colleagues working at desks with computers (screens show abstract shapes), two colleagues talking at a desk, a coffee machine, big windows, plants. Busy but pleasant.',
    'thuiswerken': 'A person working from home alone at a desk in a quiet living room with a laptop and a cup of coffee, a cat sleeping on the sofa, a window showing Dutch canal houses outside. Calm and focused.',
    'thuis-koken': 'A person cooking dinner at home in a Dutch kitchen: cutting vegetables on a cutting board, pots on the stove, fresh ingredients (carrots, onions, peppers) on the counter, a family member setting the table in the background.',
    'uit-eten': 'Two people dining in a nice restaurant: a waiter serving plates of food, a well-set table with plates, glasses and a candle, other guests in the background. Elegant but casual.',
    'story3-a': `{story3} sits on the sofa at home looking ill and tired, holding his head, a thermometer in his mouth, a box of tissues and used tissues on the coffee table.`,
    'story3-b': `{story3} sits in a Dutch GP (huisarts) consulting room while the female doctor with a stethoscope examines him; a desk, an examination couch and medical equipment are visible.`,
    'story3-c': `{story3} stands at the counter of a pharmacy (apotheek) and receives a small bag with medicine from the pharmacist in a white coat; shelves with medicine boxes (no writing) behind the counter.`,
    'story4-a': `{story4} pack cardboard boxes in their living room: stacked moving boxes, items being wrapped in paper, the room is half empty, a rolled-up rug.`,
    'story4-b': `{story4} carry moving boxes from their Dutch brick terraced house to a large moving van parked in front of the house with its back door open; a bicycle leans against the wall.`,
    'story4-c': `{story4} unpack boxes in their new home: a new bright living room with some furniture already in place, open boxes, the children happily putting toys on a shelf, the parents hanging a picture.`,
    'supermarkt': 'Inside a bright Dutch supermarket: shelves with many products (fruit, vegetables, bread, milk cartons, cheese, cereal boxes with no writing), a fresh produce section in front, about five shoppers with trolleys and baskets, a cashier at the checkout in the background.',
    'station': 'A Dutch train station platform: a yellow and blue Dutch train arriving, passengers waiting on the platform with suitcases and backpacks, some sitting on a bench, a covered platform roof, a departure board showing only abstract coloured bars, a person with a bicycle. Quite busy.',
    'fietsen': 'A person cycling to work on a red Dutch bike path in the morning, other cyclists, canal houses and a canal bridge, a backpack on the bike, fresh air and sunshine.',
    'autorijden': 'A person driving to work in a car on a Dutch motorway in the morning, seen from outside: other cars, a traffic jam ahead, flat green Dutch landscape, blue motorway signs with only arrows (no writing).',
    'huis-tuin': 'A large detached Dutch house with a big garden: green lawn, flower beds, a fence, a tree, a garden table, a child playing on the grass. Spacious and quiet suburban street, a car in the driveway.',
    'appartement': 'A small apartment in a modern building in a Dutch city centre: balconies with plants, shops below with awnings, a tram and bicycles in the street, a person on a small balcony watering plants. Compact and lively city living.',
    'story5-a': `{story5} stand in front of a Dutch primary school building on an open day: a big festive banner decorated only with balloons, bunting and simple pictograms of children (no letters), the school doors wide open, other parents walking in. She looks at it interested and curious.`,
    'story5-b': `{story5} talk with a friendly teacher in a bright classroom; the teacher shows them around, pointing at small desks, a reading corner with books and colourful materials.`,
    'story5-c': `{story5} sit at a table in the school hallway: the mother fills in a registration form with a pen (form shows only abstract lines), the daughter stands next to her looking happy; a school secretary smiles across the table.`,
    'story6-a': `{story6} cooks in his kitchen: stirring a big pot on the stove, chopped vegetables, herbs and a cutting board on the counter. Focused and happy.`,
    'story6-b': `{story6} opens the front door of his Dutch house and greets three friends who arrive holding a bottle of wine and a bunch of flowers. Warm greeting, smiles.`,
    'story6-c': `{story6} and his three friends sit around a dinner table eating together: the pot of food in the middle, plates, candles, glasses of wine, everyone smiling and talking. Cosy evening atmosphere.`,
};
const PICTURE_ALT = {
    'markt': 'Een drukke markt met kraampjes en mensen in de zon',
    'park': 'Een park met kinderen, een hond, eenden en mensen op het gras',
    'stad': 'Een drukke straat in de stad met tram, fietsers en veel mensen',
    'dorp': 'Een rustig dorp met huizen, een kerk, weilanden en een molen',
    'zomer': 'Een zomerdag aan het strand met zon en zwemmende mensen',
    'winter': 'Een winterdag met sneeuw, een sneeuwpop en schaatsers',
    'story1-a': 'Een man kijkt naar zijn fiets', 'story1-b': 'De voorband van de fiets is lek', 'story1-c': 'De man repareert zijn fiets',
    'story2-a': 'Een vrouw gaat naar de supermarkt', 'story2-b': 'De vrouw doet boodschappen', 'story2-c': 'De vrouw kookt thuis',
    'restaurant': 'Vrienden eten samen in een gezellig restaurant',
    'klas': 'Een juf geeft les aan kinderen in een klaslokaal',
    'kantoor': 'Collega\'s werken samen op kantoor', 'thuiswerken': 'Iemand werkt thuis met een laptop',
    'thuis-koken': 'Iemand kookt thuis in de keuken', 'uit-eten': 'Twee mensen eten in een restaurant',
    'story3-a': 'Een man is ziek thuis', 'story3-b': 'De man is bij de huisarts', 'story3-c': 'De man haalt medicijnen bij de apotheek',
    'story4-a': 'Een gezin pakt dozen in', 'story4-b': 'Een verhuiswagen staat voor het huis', 'story4-c': 'Het gezin pakt uit in het nieuwe huis',
    'supermarkt': 'Mensen doen boodschappen in een supermarkt',
    'station': 'Reizigers wachten op het perron bij de trein',
    'fietsen': 'Iemand fietst naar het werk', 'autorijden': 'Iemand rijdt met de auto naar het werk',
    'huis-tuin': 'Een groot huis met een tuin', 'appartement': 'Een klein appartement in de stad',
    'story5-a': 'Een moeder en dochter bij een school met open dag', 'story5-b': 'De moeder praat met een leraar in de klas', 'story5-c': 'De moeder schrijft haar kind in',
    'story6-a': 'Een man kookt in de keuken', 'story6-b': 'Vrienden komen aan de deur', 'story6-c': 'De vrienden eten samen aan tafel',
};

const HERO_BRIEF = 'A wide panoramic illustration of an Amsterdam canal on a calm spring morning: a row of tall narrow gabled canal houses (step gables and bell gables) in terracotta, cream and navy, a humpbacked brick bridge with white railings over the canal, bicycles parked along the bridge railing and one person cycling across, a small boat on the gently rippling water reflecting the houses, elm trees along the quay, a soft sky with a few clouds. Calm, airy, lots of breathing room; no people close-up. Composition is wide and horizontal with the canal and bridge across the middle.';

// Build the list of generation units.
function collectUnits() {
    const units = [];
    const levels = ['a2', 'b1'];
    for (const lv of levels) {
        // lezen: one unit per passage (questions sharing a text share an image)
        const lezen = readData(`${lv}/lezen.json`);
        for (const [examKey, exam] of Object.entries(lezen.exams)) {
            const byPassage = {};
            exam.questions.forEach((q) => { (byPassage[q.passage] ||= []).push(q); });
            for (const [passage, qs] of Object.entries(byPassage)) {
                const id = `${lv}/lezen/${examKey}-${passage}`;
                units.push({
                    id, level: lv, section: 'lezen', kind: 'scene', file: `scenes/${id}.webp`,
                    title: qs[0].passageTitle, stem: qs[0].text,
                    questionStems: qs.map((q) => q.question),
                    mcq: qs.map((q) => ({ question: q.question, options: q.options, correct: q.options[q.correct] })),
                    target: { file: `${lv}/lezen.json`, match: (q) => q.passage === passage, examKey },
                });
            }
        }
        // luisteren: one unit per item
        const luis = readData(`${lv}/luisteren.json`);
        for (const exam of Object.values(luis.exams)) {
            for (const q of exam.questions) {
                const id = `${lv}/luisteren/${q.id}`;
                units.push({
                    id, level: lv, section: 'luisteren', kind: 'scene', file: `scenes/${id}.webp`,
                    title: q.questionText, stem: q.transcript, questionStems: [q.questionText],
                    mcq: [{ question: q.questionText, options: q.options, correct: q.options[q.correctAnswer] }],
                    target: { file: `${lv}/luisteren.json`, objId: q.id },
                });
            }
        }
        // schrijven: one unit per prompt (no ids in the data → stable index)
        const schr = readData(`${lv}/schrijven.json`);
        schr.questions.forEach((q, i) => {
            const id = `${lv}/schrijven/q${pad(i + 1)}`;
            units.push({
                id, level: lv, section: 'schrijven', kind: 'scene', file: `scenes/${id}.webp`,
                title: q.type, stem: q.prompt, questionStems: [],
                target: { file: `${lv}/schrijven.json`, index: i },
            });
        });
        // spreken: picture parts use their own (regenerated) pictures; every
        // other exercise gets a scene.
        const spr = readData(`${lv}/spreken.json`);
        for (const exam of Object.values(spr.exams)) {
            for (const part of exam.parts) {
                for (const ex of part.exercises) {
                    if (ex.images && ex.images.length) {
                        for (const img of ex.images) {
                            const name = path.basename(img).replace(/\.(jpe?g|png|webp)$/, '');
                            if (!PICTURE_BRIEFS[name]) throw new Error(`no picture brief for ${img}`);
                            const id = `${lv}/spreken/pictures/${name}`;
                            if (units.some((u) => u.id === id)) continue;
                            const story = name.match(/^(story\d)-([abc])$/);
                            units.push({
                                id, level: lv, section: 'pictures', kind: 'picture', file: `scenes/${id}.webp`,
                                title: `${ex.id} picture`, stem: `${ex.prompt}\nTip: ${ex.tipText || ''}`,
                                brief: PICTURE_BRIEFS[name].replace(/\{(story\d)\}/g, (_, k) => STORY_CAST[k]),
                                alt: PICTURE_ALT[name],
                                refId: story && story[2] !== 'a' ? `${lv}/spreken/pictures/${story[1]}-a` : null,
                                exerciseId: ex.id,
                                target: { file: `${lv}/spreken.json`, oldImage: img },
                            });
                        }
                    } else {
                        const id = `${lv}/spreken/${ex.id}`;
                        units.push({
                            id, level: lv, section: 'spreken', kind: 'scene', file: `scenes/${id}.webp`,
                            title: `Deel ${part.partNumber}: ${part.title}`, stem: ex.prompt, questionStems: [],
                            target: { file: `${lv}/spreken.json`, objId: ex.id },
                        });
                    }
                }
            }
        }
    }
    // KNM (level-less)
    const knm = readData('knm-exercises.json');
    for (const exam of Object.values(knm.exams)) {
        for (const q of exam.questions) {
            const id = `knm/${q.id}`;
            units.push({
                id, level: null, section: 'knm', kind: 'scene', file: `scenes/${id}.webp`,
                title: `${q.category}: ${q.questionText}`, stem: q.scenario, questionStems: [q.questionText],
                mcq: [{ question: q.questionText, options: q.options, correct: q.options[q.correctAnswer] }],
                target: { file: 'knm-exercises.json', objId: q.id },
            });
        }
    }
    units.push({
        id: 'hero/canal', level: null, section: 'hero', kind: 'hero', file: 'scenes/hero-canal.webp',
        title: 'Landing hero', stem: 'Amsterdam canal panorama', brief: HERO_BRIEF,
        alt: '', size: '1536x1024', target: null,
    });
    return units;
}

// ---------- scene briefs (LLM, stem only) ----------
const SECTION_GUIDE = {
    lezen: 'The learner reads this Dutch text (notice, letter, article, message) and then answers questions about it. Illustrate the everyday topic or place the text is about, as a general scene. Do NOT depict specific details the questions could ask about (times, days, prices, quantities, choices, names, outcomes, rules). Do not show the document itself.',
    luisteren: 'The learner first sees this image, then hears this short Dutch conversation or announcement once, then answers the question. Illustrate ONLY who is speaking and the setting where the conversation takes place at its start. NEVER depict the information the question asks for (if it asks where someone goes, do not show that place; what someone buys, do not show the item; when, do not show a time; why, do not show the reason). When in doubt, show the speakers talking in a neutral setting.',
    knm: 'This is a Dutch civic knowledge (KNM) multiple-choice question. Illustrate the situation in the scenario at the moment the person has to decide what to do. NEVER show the action, place, professional, institution, phone call or outcome that could be the answer — only the situation before the decision. Nobody holds or uses a phone.',
    schrijven: 'The learner must write this message, email or form. Illustrate the real-life situation that is the reason for writing (for example "tell your boss you are sick" → a person in bed blowing their nose into a tissue, phone in hand). Show the writer in the situation. Do not show the written message, letters or forms.',
    spreken: 'The learner answers this Dutch speaking question out loud. Illustrate the topic as an inviting, neutral everyday scene that helps them start talking. Do not suggest a particular opinion or answer.',
};
async function writeBrief(u) {
    const sys = [
        'You are the art director for RateMyDutch, a Dutch integration-exam practice app. You write ONE illustration brief per exercise.',
        'Golden rule: SHOW THE SITUATION, NEVER THE ANSWER.',
        'Constraints: 1 to 3 main people (diverse), contemporary Dutch everyday setting, nothing that requires text, letters, numbers, logos or readable screens. Do not include clocks, calendars, phones or screens unless the situation truly cannot be shown without them.',
        'The "scene" must describe ONLY what IS in the picture (positive description). Never mention the forbidden things in the scene text, not even as "no X" — an image model would draw them.',
        'Reply as JSON: {"asked_about": "<what the question(s) ask the learner to find or produce, in English>", "forbidden": ["<concrete things that must NOT appear because they would reveal or hint at answers>"], "scene": "<40-80 word English visual description of the illustration, concrete and drawable>", "alt": "<short simple Dutch (A2) alt text, max 12 words, describing the scene, starting with a capital, no final period>"}',
    ].join('\n');
    const user = [
        `Section guidance: ${SECTION_GUIDE[u.section]}`,
        `Title: ${u.title}`,
        `Situation / text:\n${u.stem}`,
        u.questionStems.length ? `Question(s) the learner must answer (stems only):\n- ${u.questionStems.join('\n- ')}` : '',
        NOTE && FORCE.has(u.id) ? `Extra instruction from the reviewer: ${NOTE}` : '',
    ].filter(Boolean).join('\n\n');
    return chatJson(BRIEF_MODEL, [{ role: 'system', content: sys }, { role: 'user', content: user }], `brief ${u.id}`);
}

// ---------- vision audit ----------
async function audit(u, absFile, brief) {
    const b64 = fs.readFileSync(absFile).toString('base64');
    const mcqText = (u.mcq || []).map((m, i) =>
        `Q${i + 1}: ${m.question}\n  options: ${m.options.map((o) => `"${o}"`).join(', ')}\n  correct: "${m.correct}"`).join('\n');
    const sys = 'You are a strict QA reviewer for illustrations in a language-exam practice app. Answer as JSON only.';
    const user = [
        `Section: ${u.section}. Intended brief: ${brief}`,
        u.kind === 'picture' ? `This is a speaking-exam picture. Exercise:\n${u.stem}` : `Situation: ${u.stem.slice(0, 1500)}`,
        mcqText ? `Multiple-choice question(s) shown next to the image:\n${mcqText}` : '',
        'Check the image and reply JSON: {"has_text": bool (any readable or pseudo letters, words, numbers or logos — ignore abstract squiggles), "anatomy_problem": bool (clearly wrong hands/limbs/faces, duplicated objects in a hand, merged people), "matches_brief": bool (the main situation of the brief is recognisable), "reveals_answer": bool (ONLY for multiple choice: the image clearly depicts the content of the correct option, or clearly rules out the wrong ones, so a learner could answer from the picture; false if no MCQ), "missing_details": [list of details from the brief that a speaking-exam picture needs but are not visible; empty for non-pictures], "severity": "ok"|"minor"|"major", "notes": "short reason"}',
    ].filter(Boolean).join('\n\n');
    return chatJson(AUDIT_MODEL, [
        { role: 'system', content: sys },
        { role: 'user', content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: `data:image/webp;base64,${b64}`, detail: 'high' } },
        ] },
    ], `audit ${u.id}`);
}
// Scenes only fail on objective problems (text, anatomy, answer leakage) —
// the auditor is too picky about brief details to regenerate on those.
// Pictures must also show what the speaking exercise asks about.
function auditFails(a, u) {
    if (!a) return false;
    if (u.mcq && a.reveals_answer) return true;
    if (a.severity !== 'major') return false;
    if (a.has_text || a.anatomy_problem) return true;
    return u.kind === 'picture' && (!a.matches_brief || (a.missing_details || []).length > 1);
}

// ---------- one unit ----------
const done = {}; // id -> promise (for story reference frames)
function buildPrompt(u, scene, retryNote) {
    const comp = u.kind === 'picture' ? PICTURE_COMPOSITION : u.kind === 'hero' ? '' : BANNER_COMPOSITION;
    const parts = [STYLE, comp, `Scene: ${scene}`];
    if (u.refId) parts.push('Keep the SAME character(s) as in the reference image (same face, hair, skin tone, clothes) and the same illustration style and palette, but draw this new scene.');
    if (retryNote) parts.push(`Important correction: ${retryNote}`);
    return parts.filter(Boolean).join('\n\n');
}
async function processUnit(u) {
    const abs = path.join(IMAGES, u.file);
    const entry = manifest.entries[u.id] || {};
    if (u.refId) await done[u.refId];
    if (runCost + EST_IMAGE_COST > BUDGET - 0 || manifest.totalCostUsd + EST_IMAGE_COST > BUDGET) {
        console.warn(`  SKIP ${u.id}: budget $${BUDGET} reached`);
        return;
    }
    console.log(`→ ${u.id}`);
    let brief = u.brief;
    let alt = u.alt;
    let meta = {};
    if (u.kind === 'scene') {
        meta = await writeBrief(u);
        brief = meta.scene;
        alt = meta.alt;
        if (!brief || !String(brief).trim()) throw new Error('brief writer returned no scene — not generating from an empty prompt');
        alt = String(alt || '').trim().replace(/\.$/, '');
    }
    const refFile = u.refId ? path.join(IMAGES, `scenes/${u.refId}.webp`) : null;
    let attempts = 0;
    let cost = 0;
    let a = null;
    let retryNote = FORCE.has(u.id) && NOTE ? NOTE : '';
    while (attempts < 2) {
        attempts++;
        const { buffer, cost: c } = await generateImage({
            prompt: buildPrompt(u, brief, retryNote), size: u.size || '1024x1024',
            refFile: refFile && fs.existsSync(refFile) ? refFile : null, label: u.id,
        });
        cost += c;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buffer);
        console.log(`  ✓ ${u.file} (${(buffer.length / 1024).toFixed(0)} KB)`);
        if (!AUDIT || u.kind === 'hero') break;
        a = await audit(u, abs, brief).catch((e) => ({ severity: 'unknown', notes: `audit failed: ${e.message}` }));
        if (!auditFails(a, u)) break;
        retryNote = [
            a.has_text && 'there must be NO text, letters or numbers anywhere',
            a.anatomy_problem && 'draw anatomy carefully: correct hands, one object per hand, natural limbs',
            u.kind === 'picture' && !a.matches_brief && 'follow the scene description exactly',
            a.reveals_answer && 'show only the people and the setting described, nothing else',
            // never echo auditor details into a scene prompt: they can contain the answer
            u.kind === 'picture' && (a.missing_details || []).length && `make these clearly visible: ${a.missing_details.join(', ')}`,
        ].filter(Boolean).join('; ');
        console.warn(`  ↻ audit failed (${a.notes}); regenerating with: ${retryNote}`);
        if (attempts >= 2) break;
    }
    manifest.entries[u.id] = {
        ...entry, id: u.id, section: u.section, level: u.level, file: u.file, title: u.title,
        stem: u.stem, questions: u.questionStems || [], brief, alt,
        forbidden: meta.forbidden || [], askedAbout: meta.asked_about || '',
        audit: a, attempts: (entry.attempts || 0) + attempts,
        costUsd: +((entry.costUsd || 0) + cost).toFixed(4), generatedAt: new Date().toISOString(),
        flagged: auditFails(a, u) || (a && a.severity === 'unknown') || undefined,
    };
    if (manifest.rejected && manifest.rejected[u.id]) {
        delete manifest.rejected[u.id];
        console.log(`  cleared rejection for ${u.id} — re-review it in the contact sheet`);
    }
    await saveManifest();
}

// ---------- write image fields back into the JSON ----------
// Hand-formatted files (inline arrays) are edited textually so the diff only
// shows the new lines; plain JSON.stringify files are rewritten.
// setField(text, objId, key, value, afterKey): set "key": value on the object
// whose "id" is objId; inserts after `afterKey`'s line (or the id line).
function setField(text, objId, key, value, afterKey = null) {
    const idRe = new RegExp(`^([ \\t]*)"id": "${objId.replace(/[-]/g, '\\-')}",\\r?\\n`, 'm');
    const m = idRe.exec(text);
    if (!m) throw new Error(`id ${objId} not found`);
    const indent = m[1];
    const start = m.index + m[0].length;
    // the object ends at the first closing brace at its own (outer) indent
    const closeRe = new RegExp(`^${indent.slice(0, Math.max(0, indent.length - 4))}}`, 'm');
    const rest = text.slice(start);
    const close = closeRe.exec(rest);
    if (!close) throw new Error(`end of object ${objId} not found`);
    let span = rest.slice(0, close.index);
    const line = `${indent}"${key}": ${JSON.stringify(value)}`;
    const keyRe = new RegExp(`^${indent}"${key}": .*?(,?)$`, 'm');
    if (keyRe.test(span)) {
        span = span.replace(keyRe, (_, comma) => line + comma);
    } else {
        const afterRe = afterKey && new RegExp(`^${indent}"${afterKey}": .*,\\r?\\n`, 'm');
        const am = afterRe && afterRe.exec(span);
        const at = am ? am.index + am[0].length : 0;
        span = span.slice(0, at) + line + ',\n' + span.slice(at);
    }
    return text.slice(0, start) + span + text.slice(start + close.index);
}
function removeField(text, objId, key) {
    const idRe = new RegExp(`^([ \\t]*)"id": "${objId.replace(/[-]/g, '\\-')}",\\r?\\n`, 'm');
    const m = idRe.exec(text);
    if (!m) return text;
    const start = m.index + m[0].length;
    const closeRe = new RegExp(`^${m[1].slice(0, Math.max(0, m[1].length - 4))}}`, 'm');
    const rest = text.slice(start);
    const close = closeRe.exec(rest);
    if (!close) return text;
    const span = rest.slice(0, close.index).replace(new RegExp(`^${m[1]}"${key}": .*,\\r?\\n`, 'm'), '');
    return text.slice(0, start) + span + text.slice(start + close.index);
}
// Reviewer-rejected or never-generated units: { id: reason }. Their image
// fields are stripped (the UI renders fine without a card) until a --force
// regeneration succeeds, which clears the entry.
const rejected = () => manifest.rejected || {};
const altOf = (u) => String((manifest.entries[u.id] || {}).alt || u.alt || '').trim().replace(/\.$/, '');
function writeBack(units) {
    const byFile = {};
    for (const u of units) {
        if (!u.target) continue;
        if (!rejected()[u.id] && !fs.existsSync(path.join(IMAGES, u.file))) continue;
        (byFile[u.target.file] ||= []).push(u);
    }
    for (const [rel, us] of Object.entries(byFile)) {
        const abs = path.join(DATA, rel);
        const original = fs.readFileSync(abs, 'utf8');
        let out;
        if (/(lezen|schrijven)\.json$/.test(rel)) {
            const d = JSON.parse(original);
            for (const u of us) {
                const qs = u.section === 'lezen'
                    ? d.exams[u.target.examKey].questions.filter(u.target.match)
                    : [d.questions[u.target.index]];
                if (rejected()[u.id]) qs.forEach((q) => { delete q.image; delete q.imageAlt; });
                else qs.forEach((q) => { q.image = u.file; q.imageAlt = altOf(u); });
            }
            out = JSON.stringify(d, null, 2) + '\n';
        } else {
            out = original;
            const pictureAlts = {}; // exerciseId -> {oldImage: alt}
            for (const u of us) {
                if (u.target.objId && rejected()[u.id]) {
                    out = removeField(removeField(out, u.target.objId, 'imageAlt'), u.target.objId, 'image');
                } else if (u.target.objId) {
                    out = setField(out, u.target.objId, 'image', u.file);
                    out = setField(out, u.target.objId, 'imageAlt', altOf(u), 'image');
                } else if (u.target.oldImage) {
                    out = out.split(`"${u.target.oldImage}"`).join(`"${u.file}"`);
                    (pictureAlts[u.exerciseId] ||= {})[u.file] = altOf(u);
                }
            }
            // imageAlts parallel to images[], for every picture exercise touched
            const parsed = JSON.parse(out);
            for (const exam of Object.values(parsed.exams || {})) for (const part of exam.parts || []) for (const ex of part.exercises || []) {
                if (!pictureAlts[ex.id]) continue;
                const alts = ex.images.map((img, i) => pictureAlts[ex.id][img] || `Afbeelding ${i + 1}`);
                out = setField(out, ex.id, 'imageAlts', alts, 'images');
            }
        }
        JSON.parse(out); // must stay valid
        if (out !== original) { fs.writeFileSync(abs, out); console.log(`  wrote image fields → public/data/${rel}`); }
    }
}

// ---------- contact sheet ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function buildSheet(units) {
    const groups = {};
    for (const u of units) (groups[u.level ? `${u.level.toUpperCase()} · ${u.section}` : u.section] ||= []).push(u);
    const cards = Object.entries(groups).map(([g, us]) => `
<h2>${esc(g)} <small>(${us.length})</small></h2>
<div class="grid">${us.map((u) => {
        const e = manifest.entries[u.id] || {};
        const exists = fs.existsSync(path.join(IMAGES, u.file));
        const au = e.audit;
        const rej = rejected()[u.id];
        const badge = rej ? `<b class="bad">REJECTED — ${esc(rej)}</b>` : !exists ? '<b class="bad">MISSING</b>' : e.flagged ? '<b class="bad">FLAGGED</b>' : au && au.severity === 'minor' ? '<b class="warn">minor</b>' : '';
        return `<figure class="${u.kind}">
  ${exists ? `<img loading="lazy" src="../../public/images/${esc(u.file)}" alt="${esc(e.alt || u.alt)}">` : '<div class="ph">no image</div>'}
  <figcaption><code>${esc(u.id)}</code> ${badge}<br><strong>${esc(u.title)}</strong>
  <p>${esc((u.stem || '').slice(0, 280))}${(u.stem || '').length > 280 ? '…' : ''}</p>
  ${(u.questionStems || []).length ? `<p class="q">Q: ${esc(u.questionStems.join(' / '))}</p>` : ''}
  ${e.alt ? `<p class="alt">alt: ${esc(e.alt)}</p>` : ''}
  ${au && au.notes ? `<p class="audit">audit: ${esc(au.severity)} — ${esc(au.notes)}</p>` : ''}</figcaption>
</figure>`;
    }).join('')}</div>`).join('\n');
    const total = units.length;
    const have = units.filter((u) => fs.existsSync(path.join(IMAGES, u.file))).length;
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scene Contact Sheet</title>
<style>
:root{--bg:#faf6ef;--fg:#1a2332;--muted:#5d6675;--card:#fff;--line:#e6dfd3}
@media (prefers-color-scheme:dark){:root{--bg:#141a24;--fg:#eef0f3;--muted:#a3abb8;--card:#1d2532;--line:#2c3646}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:24px 16px}
h1{margin:0 0 4px}h2{margin:32px 0 12px;font-size:18px;text-transform:capitalize}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
figure img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
figure.picture img,figure.hero img{aspect-ratio:auto;object-fit:contain}
figcaption{padding:10px 12px}figcaption p{margin:6px 0 0;color:var(--muted);white-space:pre-line}
.q{color:var(--fg)!important}.alt,.audit{font-size:12px}.bad{color:#c0392b}.warn{color:#b9770e}
.ph{aspect-ratio:16/9;display:grid;place-items:center;color:#c0392b}
code{font-size:12px}
</style></head><body>
<h1>Scene contact sheet</h1>
<p>${have}/${total} images · generated with ${IMAGE_MODEL} (medium) · total spend $${manifest.totalCostUsd.toFixed(2)} · scene cards are shown cropped to 16:9 exactly as in the app; spreken pictures are shown whole.</p>
${cards}
</body></html>
`;
    fs.writeFileSync(SHEET, html);
    console.log(`  contact sheet → ${path.relative(ROOT, SHEET)} (${have}/${total})`);
}

// ---------- main ----------
async function main() {
    const all = collectUnits();
    let units = all.filter((u) => (!ONLY || u.section === ONLY) && (!LEVEL || !u.level || u.level === LEVEL) && (!IDS || IDS.has(u.id)));
    const todo = units.filter((u) => FORCE.has(u.id) || !fs.existsSync(path.join(IMAGES, u.file)));
    if (FORCE.size) for (const id of FORCE) if (!all.some((u) => u.id === id)) console.warn(`unknown --force id: ${id}`);
    console.log(`${all.length} units total, ${units.length} selected, ${todo.length} to generate (budget $${BUDGET}, spent so far $${manifest.totalCostUsd.toFixed(3)})`);
    if (DRY) {
        const counts = {};
        for (const u of units) counts[`${u.level || '-'}/${u.section}`] = (counts[`${u.level || '-'}/${u.section}`] || 0) + 1;
        console.log(counts);
        todo.forEach((u) => console.log(`  ${u.id}  ← ${u.title}`));
        return;
    }
    if (!WRITEBACK_ONLY) {
        // pictures with a reference frame must run after it; FIFO queue + done{} handles that
        const queue = [...todo];
        let failures = 0;
        async function worker() {
            while (queue.length) {
                const u = queue.shift();
                const p = processUnit(u).catch((e) => { failures++; console.error(`  ✗ ${u.id}: ${e.message}`); });
                done[u.id] = p;
                await p;
            }
        }
        await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
        await manifestWrite;
        console.log(`\nDone. Run spend $${runCost.toFixed(3)}, all-time $${manifest.totalCostUsd.toFixed(3)}, failures ${failures}`);
    }
    writeBack(all);
    buildSheet(all);
}

main().catch((e) => { console.error(e); process.exit(1); });
