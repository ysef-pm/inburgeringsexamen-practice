// Schema validation for the level-keyed content files under public/data/{a2,b1}/
// plus the (level-independent) knm-exercises.json.
//
// A2 files are REQUIRED — the app ships with them, a missing one is a bug.
// B1 files are validated only when present (they are authored in later tasks);
// while absent they are skipped silently.
//
// Field-name ground truth (inspected from the real a2 files):
//   lezen:     exams.{id} = { name, questions[], sectionNames{} }
//              question = { passage, passageTitle, text, question, options[3-4], correct }
//              (B1 uses the same shape; `correctAnswer` is accepted as an alias
//               of `correct`, and B1 questions additionally carry `explanation`.)
//   schrijven: questions[] = { prompt, modelAnswer, ... } (+ wordGuidance at B1)
//   luisteren: exams.{id} = { questions[] }, question = { id, questionText,
//              audioFile, transcript, options, correctAnswer, explanation }
//   spreken:   exams.{id} = { parts[] }, part = { partNumber, exercises[] },
//              exercise = { id, prompt } (+ taskType 'short'|'long' at B1)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const LEVELS = ['a2', 'b1'];
const MODES = ['lezen', 'schrijven', 'luisteren', 'spreken'];

function contentFile(level, mode) {
    return path.join(DATA_DIR, level, mode + '.json');
}

function loadJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

// Multiple-choice invariants shared by every MC question in the app.
// `answerField` names which key holds the correct-answer index.
function assertMcQuestion(q, answerField, where) {
    assert.ok(Array.isArray(q.options), `${where}: options must be an array`);
    assert.ok(
        q.options.length >= 3 && q.options.length <= 4,
        `${where}: options length ${q.options.length} outside 3-4`
    );
    for (const opt of q.options) {
        assert.ok(isNonEmptyString(opt), `${where}: every option must be a non-empty string`);
    }
    const answer = q[answerField];
    assert.ok(Number.isInteger(answer), `${where}: ${answerField} must be an integer`);
    assert.ok(
        answer >= 0 && answer < q.options.length,
        `${where}: ${answerField} ${answer} out of bounds for ${q.options.length} options`
    );
}

// ---------- per-mode validators ----------

function validateLezen(data, level) {
    assert.ok(data.exams && typeof data.exams === 'object', `${level} lezen: top-level exams object`);
    const examIds = Object.keys(data.exams);
    assert.ok(examIds.length > 0, `${level} lezen: at least one exam`);

    for (const examId of examIds) {
        const exam = data.exams[examId];
        const where = `${level} lezen ${examId}`;
        assert.ok(isNonEmptyString(exam.name), `${where}: name`);
        assert.ok(Array.isArray(exam.questions) && exam.questions.length > 0, `${where}: questions array`);
        assert.ok(exam.sectionNames && typeof exam.sectionNames === 'object', `${where}: sectionNames object`);

        exam.questions.forEach((q, i) => {
            const qWhere = `${where} q${i + 1}`;
            assert.ok(isNonEmptyString(q.passage), `${qWhere}: passage`);
            assert.ok(isNonEmptyString(q.passageTitle), `${qWhere}: passageTitle`);
            assert.ok(isNonEmptyString(q.text), `${qWhere}: text`);
            assert.ok(isNonEmptyString(q.question), `${qWhere}: question`);
            // a2 uses `correct`; the B1 format spec names it `correctAnswer`.
            // Exactly one of the two must be present.
            const answerField = 'correct' in q ? 'correct' : 'correctAnswer';
            assert.ok(answerField in q, `${qWhere}: needs correct or correctAnswer`);
            assert.ok(
                !('correct' in q && 'correctAnswer' in q),
                `${qWhere}: must not carry both correct and correctAnswer`
            );
            assertMcQuestion(q, answerField, qWhere);
            assert.ok(
                q.passage in exam.sectionNames,
                `${qWhere}: passage "${q.passage}" missing from sectionNames`
            );
            if (level === 'b1') {
                assert.ok(isNonEmptyString(q.explanation), `${qWhere}: B1 lezen requires explanation`);
            }
        });
    }

    if (level === 'b1') {
        // Volume spec: 2 exams x 30 questions = 6 distinct passages x 5 each.
        assert.equal(examIds.length, 2, 'b1 lezen: exactly 2 exams');
        for (const examId of examIds) {
            const exam = data.exams[examId];
            assert.equal(exam.questions.length, 30, `b1 lezen ${examId}: exactly 30 questions`);
            const perPassage = {};
            for (const q of exam.questions) {
                perPassage[q.passage] = (perPassage[q.passage] || 0) + 1;
            }
            const passages = Object.keys(perPassage);
            assert.equal(passages.length, 6, `b1 lezen ${examId}: exactly 6 distinct passages`);
            for (const p of passages) {
                assert.equal(perPassage[p], 5, `b1 lezen ${examId}: passage "${p}" must have exactly 5 questions`);
            }
        }
    }
}

function validateSchrijven(data, level) {
    assert.ok(Array.isArray(data.questions) && data.questions.length > 0, `${level} schrijven: questions array`);
    data.questions.forEach((q, i) => {
        const where = `${level} schrijven q${i + 1}`;
        assert.ok(isNonEmptyString(q.prompt), `${where}: prompt`);
        assert.ok(isNonEmptyString(q.modelAnswer), `${where}: modelAnswer`);
        if (level === 'b1') {
            assert.ok(isNonEmptyString(q.wordGuidance), `${where}: B1 schrijven requires wordGuidance`);
        }
    });
    if (level === 'b1') {
        assert.ok(data.questions.length >= 20, `b1 schrijven: at least 20 assignments (got ${data.questions.length})`);
    }
}

function validateLuisteren(data, level) {
    assert.ok(data.exams && typeof data.exams === 'object', `${level} luisteren: top-level exams object`);
    const examIds = Object.keys(data.exams);
    assert.ok(examIds.length > 0, `${level} luisteren: at least one exam`);

    for (const examId of examIds) {
        const exam = data.exams[examId];
        const where = `${level} luisteren ${examId}`;
        assert.ok(Array.isArray(exam.questions) && exam.questions.length > 0, `${where}: questions array`);
        exam.questions.forEach((q, i) => {
            const qWhere = `${where} q${i + 1}`;
            assert.ok(isNonEmptyString(q.questionText), `${qWhere}: questionText`);
            assert.ok(isNonEmptyString(q.audioFile), `${qWhere}: audioFile`);
            assert.ok(isNonEmptyString(q.transcript), `${qWhere}: transcript`);
            assertMcQuestion(q, 'correctAnswer', qWhere);
            if (level === 'b1') {
                assert.match(
                    q.audioFile,
                    /b1-luisteren\/exam\d+\/q\d+\.mp3$/,
                    `${qWhere}: B1 audioFile must live under b1-luisteren/exam{N}/q{n}.mp3`
                );
            }
        });
    }

    if (level === 'b1') {
        // Volume spec: 3 exams x 10 questions.
        assert.equal(examIds.length, 3, 'b1 luisteren: exactly 3 exams');
        for (const examId of examIds) {
            assert.equal(data.exams[examId].questions.length, 10, `b1 luisteren ${examId}: exactly 10 questions`);
        }
    }
}

function validateSpreken(data, level) {
    assert.ok(data.exams && typeof data.exams === 'object', `${level} spreken: top-level exams object`);
    const examIds = Object.keys(data.exams);
    assert.ok(examIds.length > 0, `${level} spreken: at least one exam`);

    for (const examId of examIds) {
        const exam = data.exams[examId];
        const where = `${level} spreken ${examId}`;
        assert.ok(Array.isArray(exam.parts) && exam.parts.length > 0, `${where}: parts array`);

        let shortCount = 0;
        let longCount = 0;
        exam.parts.forEach((part, pi) => {
            const pWhere = `${where} part${pi + 1}`;
            assert.ok(Number.isInteger(part.partNumber), `${pWhere}: partNumber integer`);
            assert.ok(Array.isArray(part.exercises) && part.exercises.length > 0, `${pWhere}: exercises array`);
            part.exercises.forEach((ex, ei) => {
                const eWhere = `${pWhere} ex${ei + 1}`;
                assert.ok(isNonEmptyString(ex.id), `${eWhere}: id`);
                assert.ok(isNonEmptyString(ex.prompt), `${eWhere}: prompt`);
                if (level === 'b1') {
                    assert.ok(
                        ['short', 'long'].includes(ex.taskType),
                        `${eWhere}: B1 spreken requires taskType 'short'|'long' (got ${JSON.stringify(ex.taskType)})`
                    );
                    if (ex.taskType === 'short') shortCount++;
                    else longCount++;
                }
            });
        });

        if (level === 'b1') {
            // Volume spec per exam: 8 short + 4 long tasks.
            assert.equal(shortCount, 8, `${where}: exactly 8 short tasks (got ${shortCount})`);
            assert.equal(longCount, 4, `${where}: exactly 4 long tasks (got ${longCount})`);
        }
    }

    if (level === 'b1') {
        assert.equal(examIds.length, 3, 'b1 spreken: exactly 3 exams');
    }
}

const VALIDATORS = {
    lezen: validateLezen,
    schrijven: validateSchrijven,
    luisteren: validateLuisteren,
    spreken: validateSpreken,
};

// ---------- test registration ----------

for (const level of LEVELS) {
    for (const mode of MODES) {
        const file = contentFile(level, mode);
        const exists = fs.existsSync(file);

        if (level === 'a2') {
            test(`a2 ${mode} content file exists and matches schema`, () => {
                assert.ok(exists, `required content file missing: ${file}`);
                VALIDATORS[mode](loadJson(file), level);
            });
        } else if (exists) {
            // B1 files land in later tasks; validate only once present.
            test(`b1 ${mode} content file matches schema + volume spec`, () => {
                VALIDATORS[mode](loadJson(file), level);
            });
        }
    }
}

test('knm-exercises.json has valid exams and questions', () => {
    const file = path.join(DATA_DIR, 'knm-exercises.json');
    assert.ok(fs.existsSync(file), `required content file missing: ${file}`);
    const data = loadJson(file);
    assert.ok(data.exams && typeof data.exams === 'object', 'knm: top-level exams object');
    const examIds = Object.keys(data.exams);
    assert.ok(examIds.length > 0, 'knm: at least one exam');
    for (const examId of examIds) {
        const exam = data.exams[examId];
        assert.ok(Array.isArray(exam.questions) && exam.questions.length > 0, `knm ${examId}: questions array`);
        exam.questions.forEach((q, i) => {
            const where = `knm ${examId} q${i + 1}`;
            assert.ok(isNonEmptyString(q.questionText), `${where}: questionText`);
            assertMcQuestion(q, 'correctAnswer', where);
        });
    }
});
