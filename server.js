const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html from root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Perplexity API endpoint
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Official DUO Rubric for grading
const OFFICIAL_RUBRIC = `
## Official DUO Grading Rubric for Inburgeringsexamen Schrijven

You MUST grade using these EXACT criteria from the official DUO "Grading document for Message and Text to everybody":

### 1. EXECUTION OF EXERCISE (Uitvoering) - Maximum 3 points
- 0 points: The text is not readable and/or recognisable as an execution of the exercise, or is not an execution of the exercise at all.
- 1 point: The text is hardly acceptable and with a lot of effort recognisable as an execution of the exercise and/or does not completely meet with the specific exercise description.
- 2 points: The text is acceptable and recognizable as an execution of the exercise.
- 3 points: The text is completely acceptable and a good execution of the exercise.

**CRITICAL RULE: If Execution = 0 points, ALL other categories MUST be scored 0 points.**

### 2. GRAMMAR (Grammatica) - Maximum 2 points
- 0 points: The text contains a lot of grammar mistakes
- 1 point: The text contains quite some grammar mistakes
- 2 points: The text contains hardly any or no grammar mistakes

### 3. SPELLING - Maximum 2 points
- 0 points: The text has many spelling mistakes.
- 1 point: Frequent short words are phonetically spelled reasonably correctly and personal details are spelled correctly.
- 2 points: The spelling is reasonably correct. Spelling mistakes do not affect the understandability.

### 4. CLEARNESS/UNDERSTANDABILITY (Duidelijkheid) - Maximum 1 point
- 0 points: The text shows hardly any structure.
- 1 point: The expression shows some structure, whether or not achieved by the use of simple conjunctions (such as en, maar, want and omdat) and/or reference words (such as hij, zij, die or dat).

### 5. VOCABULARY (Woordenschat) - Maximum 2 points
- 0 points: The text does not meet the requirements in point 1 (below).
- 1 point: The text consists of standard patterns, expressions and small groups of words that transfer limited information.
- 2 points: The vocabulary in the text is reasonably diverse.

TOTAL MAXIMUM: 10 points (3+2+2+1+2)
`;

app.post('/api/grade-writing', async (req, res) => {
    const { userText, prompt, modelAnswer } = req.body;

    if (!userText || userText.trim().length === 0) {
        return res.json({
            success: false,
            error: 'Please write something first!'
        });
    }

    if (!PERPLEXITY_API_KEY) {
        return res.json({
            success: false,
            error: 'API key not configured. Please set PERPLEXITY_API_KEY environment variable.'
        });
    }

    try {
        const systemPrompt = `You are an official examiner for the Dutch Inburgeringsexamen (civic integration exam) A2 writing test.

Your task is to grade Dutch text written by a candidate using the OFFICIAL DUO grading rubric EXACTLY as specified.

${OFFICIAL_RUBRIC}

## Your Response Format

You MUST respond with ONLY a valid JSON object in this exact structure (no markdown, no extra text):

{
    "scores": {
        "execution": {
            "score": <0-3>,
            "justification": "<IN ENGLISH: Brief explanation of why this score>"
        },
        "grammar": {
            "score": <0-2>,
            "justification": "<IN ENGLISH: Brief explanation with specific examples>"
        },
        "spelling": {
            "score": <0-2>,
            "justification": "<IN ENGLISH: Brief explanation with specific examples>"
        },
        "clearness": {
            "score": <0-1>,
            "justification": "<IN ENGLISH: Did they use conjunctions/reference words?>"
        },
        "vocabulary": {
            "score": <0-2>,
            "justification": "<IN ENGLISH: Brief explanation of vocabulary diversity>"
        }
    },
    "total": <sum of all scores, max 10>,
    "grammarErrors": [
        {"error": "<the Dutch text they wrote>", "correction": "<correct Dutch version>", "explanation": "<IN ENGLISH: brief grammar rule explanation>"}
    ],
    "spellingErrors": [
        {"error": "<misspelled Dutch word>", "correction": "<correct Dutch spelling>"}
    ],
    "strengths": ["<IN ENGLISH: positive point 1>", "<IN ENGLISH: positive point 2>"],
    "improvements": ["<IN ENGLISH: specific tip 1>", "<IN ENGLISH: specific tip 2>"],
    "overallFeedback": "<IN ENGLISH: 2-3 sentences of encouraging, constructive feedback>"
}

CRITICAL - ALL FEEDBACK MUST BE IN ENGLISH:
1. ALL justifications, explanations, strengths, improvements, and overallFeedback MUST be written in ENGLISH
2. Only the "error" and "correction" fields contain Dutch text (showing what they wrote vs correct Dutch)
3. The user is learning Dutch but understands English - they need English explanations to learn
4. Be strict but fair - this is A2 level, not native speaker level
5. If execution = 0, you MUST set ALL other scores to 0
6. Always provide specific examples from the text
7. Be encouraging - this is someone learning a new language!`;

        const userMessage = `Grade this writing submission:

**TASK PROMPT:**
${prompt}

**CANDIDATE'S ANSWER:**
${userText}

**MODEL ANSWER (for comparison):**
${modelAnswer}

Evaluate using the official DUO rubric and respond with ONLY the JSON object.`;

        const response = await fetch(PERPLEXITY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.2,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Perplexity API error:', errorText);
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        let feedback = data.choices[0].message.content;

        // Try to parse JSON from the response
        // Sometimes the model wraps it in markdown code blocks
        feedback = feedback.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const gradingResult = JSON.parse(feedback);

            // Enforce the execution = 0 rule
            if (gradingResult.scores.execution.score === 0) {
                gradingResult.scores.grammar.score = 0;
                gradingResult.scores.spelling.score = 0;
                gradingResult.scores.clearness.score = 0;
                gradingResult.scores.vocabulary.score = 0;
                gradingResult.total = 0;
            }

            res.json({
                success: true,
                grading: gradingResult
            });
        } catch (parseError) {
            // If JSON parsing fails, return the raw feedback
            console.error('Failed to parse grading JSON:', parseError);
            res.json({
                success: true,
                rawFeedback: feedback,
                parseError: true
            });
        }

    } catch (error) {
        console.error('Error grading writing:', error);
        res.json({
            success: false,
            error: 'Failed to grade your text. Please try again.'
        });
    }
});

// Keep the old endpoint for backwards compatibility
app.post('/api/check-grammar', async (req, res) => {
    // Redirect to new grading endpoint
    req.url = '/api/grade-writing';
    app.handle(req, res);
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
    console.log(`\n🇳🇱 Inburgeringsexamen Practice App running at http://localhost:${PORT}\n`);
    if (!PERPLEXITY_API_KEY) {
        console.log('⚠️  Warning: PERPLEXITY_API_KEY not set. AI grading will not work.');
        console.log('   Run with: PERPLEXITY_API_KEY=your_key npm start\n');
    } else {
        console.log('✅ Perplexity API key configured. AI grading enabled.\n');
    }
});
