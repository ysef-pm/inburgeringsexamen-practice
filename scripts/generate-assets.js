#!/usr/bin/env node
/**
 * Generate TTS audio for luisteren exercises and DALL-E images for spreken exercises.
 * Usage: OPENAI_API_KEY=your_key node scripts/generate-assets.js [--tts] [--images] [--exam exam2]
 */

const fs = require('fs');
const path = require('path');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable required');
    process.exit(1);
}

const args = process.argv.slice(2);
const doTTS = args.includes('--tts') || (!args.includes('--images'));
const doImages = args.includes('--images') || (!args.includes('--tts'));
const examFilter = args.includes('--exam') ? args[args.indexOf('--exam') + 1] : null;

async function generateTTS(text, outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(outputPath)) {
        console.log(`  Skipping (exists): ${outputPath}`);
        return;
    }

    console.log(`  Generating TTS: ${outputPath}`);
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice: 'alloy',
            response_format: 'mp3',
            speed: 0.9
        })
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`TTS API error ${resp.status}: ${err}`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`  Created: ${outputPath} (${(buffer.length / 1024).toFixed(1)}KB)`);
}

async function generateImage(prompt, outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(outputPath)) {
        console.log(`  Skipping (exists): ${outputPath}`);
        return;
    }

    console.log(`  Generating image: ${outputPath}`);
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json'
        })
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`DALL-E API error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    const buffer = Buffer.from(data.data[0].b64_json, 'base64');
    fs.writeFileSync(outputPath, buffer);
    console.log(`  Created: ${outputPath} (${(buffer.length / 1024).toFixed(1)}KB)`);
}

// Image prompts for spreken exercises
const IMAGE_PROMPTS = {
    // Exam 2 images
    'spreken/restaurant.jpg': 'A cozy Dutch restaurant scene. Several people sitting at tables eating dinner together. Warm lighting, typical Dutch/European interior. Food and drinks on tables. Realistic photo style, no text.',
    'spreken/klas.jpg': 'A Dutch primary school classroom. A teacher standing at a whiteboard with young children (ages 8-10) sitting at desks. Colorful drawings on walls, a world map. Realistic photo style, no text.',
    'spreken/kantoor.jpg': 'A modern Dutch office workspace. Several people working at desks with computers. Open plan office with large windows. Coffee mugs, papers. Realistic photo style, no text.',
    'spreken/thuiswerken.jpg': 'A person working from home in the Netherlands. Sitting at a desk with a laptop in a living room. A cup of coffee, comfortable setting, window showing Dutch houses outside. Realistic photo style, no text.',
    'spreken/thuis-koken.jpg': 'A person cooking dinner in a Dutch kitchen. Cutting vegetables on a cutting board. Pots on the stove, fresh ingredients on the counter. Warm home kitchen setting. Realistic photo style, no text.',
    'spreken/uit-eten.jpg': 'People dining at a nice restaurant in the Netherlands. A waiter serving food. Well-set table with plates, glasses, and candles. Elegant but casual atmosphere. Realistic photo style, no text.',
    'spreken/story3-a.jpg': 'A man sitting on a couch at home looking unwell. He has a thermometer and is holding his head. Tissues on the table. He looks tired and sick. Realistic photo style, no text.',
    'spreken/story3-b.jpg': 'A man visiting a Dutch doctor (huisarts). He is sitting in the doctor office while the doctor examines him. Medical equipment visible. Realistic photo style, no text.',
    'spreken/story3-c.jpg': 'A man at a Dutch pharmacy (apotheek). He is receiving medicine from the pharmacist behind the counter. Medicine boxes visible on shelves. Realistic photo style, no text.',
    'spreken/story4-a.jpg': 'A family packing cardboard boxes at home for moving. Boxes stacked, items being wrapped. Living room partly empty. Realistic photo style, no text.',
    'spreken/story4-b.jpg': 'A moving truck (verhuiswagen) parked in front of a Dutch house. People carrying boxes from the house to the truck. Dutch residential street. Realistic photo style, no text.',
    'spreken/story4-c.jpg': 'A happy family in their new home unpacking boxes. Some furniture already placed, boxes being opened. New empty rooms being set up. Realistic photo style, no text.',
    // Exam 3 images
    'spreken/supermarkt.jpg': 'Inside a Dutch supermarket (Albert Heijn style). Shelves with products, fresh produce section, shoppers with carts. Bright lighting, clean aisles. Realistic photo style, no text.',
    'spreken/station.jpg': 'A Dutch train station platform. Yellow NS trains, passengers waiting with bags, electronic departure boards, covered platform. Typical Netherlands rail station. Realistic photo style, no text.',
    'spreken/fietsen.jpg': 'A person cycling to work on a Dutch bike path. Typical Dutch city with canal bridges, other cyclists. Morning commute scene. Realistic photo style, no text.',
    'spreken/autorijden.jpg': 'A person driving a car on a Dutch highway (snelweg). View from outside showing the car, Dutch flat landscape, highway signs. Morning commute. Realistic photo style, no text.',
    'spreken/huis-tuin.jpg': 'A typical Dutch detached house with a garden. Green lawn, flower beds, a fence, suburban neighborhood. Spacious and quiet. Realistic photo style, no text.',
    'spreken/appartement.jpg': 'A modern apartment building in a Dutch city center. Balconies, urban setting, shops below, trams or bikes on the street. Compact city living. Realistic photo style, no text.',
    'spreken/story5-a.jpg': 'A woman looking at a poster that says "Open Dag" on a Dutch school building. She seems interested and curious. Realistic photo style, no text on the poster besides Open Dag.',
    'spreken/story5-b.jpg': 'A woman talking with a teacher in a bright classroom. The teacher is showing her around, pointing at desks and materials. Friendly conversation. Realistic photo style, no text.',
    'spreken/story5-c.jpg': 'A woman filling in a registration form at a school desk. A child standing next to her looking happy. School hallway in background. Realistic photo style, no text.',
    'spreken/story6-a.jpg': 'A man cooking in a kitchen. He is stirring a pot on the stove, ingredients on the counter. Focused and happy. Realistic photo style, no text.',
    'spreken/story6-b.jpg': 'Friends arriving at the front door of a Dutch house. The host opening the door, guests holding a bottle of wine and flowers. Warm greeting. Realistic photo style, no text.',
    'spreken/story6-c.jpg': 'A group of friends sitting around a dinner table eating together. Food, candles, wine glasses. Everyone smiling and talking. Cozy atmosphere. Realistic photo style, no text.'
};

async function runTTS() {
    console.log('\n=== Generating TTS Audio for Luisteren ===\n');
    const luisterenData = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'public', 'data', 'luisteren-exercises.json'), 'utf8'
    ));

    for (const [examKey, exam] of Object.entries(luisterenData.exams)) {
        if (examFilter && examKey !== examFilter) continue;
        console.log(`\nExam: ${exam.title}`);
        for (const q of exam.questions) {
            const audioPath = path.join(__dirname, '..', 'public', 'audio', q.audioFile);
            // Convert transcript to natural dialogue for TTS
            const ttsText = q.transcript.replace(/\n/g, ' ');
            try {
                await generateTTS(ttsText, audioPath);
            } catch (e) {
                console.error(`  Error generating ${q.audioFile}: ${e.message}`);
            }
            // Rate limit: small delay between requests
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

async function runImages() {
    console.log('\n=== Generating DALL-E Images for Spreken ===\n');

    for (const [filename, prompt] of Object.entries(IMAGE_PROMPTS)) {
        const imgPath = path.join(__dirname, '..', 'public', 'images', filename);
        try {
            await generateImage(prompt, imgPath);
        } catch (e) {
            console.error(`  Error generating ${filename}: ${e.message}`);
        }
        // Rate limit
        await new Promise(r => setTimeout(r, 1000));
    }
}

async function main() {
    console.log('Asset Generator for Inburgeringsexamen Practice App');
    console.log(`Mode: ${doTTS ? 'TTS' : ''} ${doImages ? 'Images' : ''}`);
    if (examFilter) console.log(`Exam filter: ${examFilter}`);

    if (doTTS) await runTTS();
    if (doImages) await runImages();

    console.log('\nDone!');
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
