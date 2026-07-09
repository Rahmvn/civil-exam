import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const contentDir = path.join(projectRoot, "content", "questions");
const validCorrectOptions = new Set(["A", "B", "C", "D"]);
const validStatuses = new Set(["draft", "review", "published"]);
const validDifficulties = new Set(["easy", "medium", "hard"]);

function normalizeSubjectSlug(value) {
  const slug = normalizeText(value);
  return slug === "current-affairs-general-knowledge" ? "current-affairs" : slug;
}

async function loadLocalEnvFile(fileName) {
  const envPath = path.join(projectRoot, fileName);

  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 0) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function getEnv(name, fallbacks = []) {
  const candidates = [name, ...fallbacks];

  for (const candidate of candidates) {
    const value = process.env[candidate]?.trim();
    if (value) {
      return value;
    }
  }

  if (fallbacks.length > 0) {
    throw new Error(`Missing required environment variable: ${name} (or ${fallbacks.join(", ")})`);
  }

  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function buildQuestionKey(subjectSlug, questionText) {
  return `${subjectSlug}::${normalizeText(questionText).toLowerCase()}`;
}

function questionMatches(existing, next) {
  return (
    normalizeText(existing.question_text) === next.question_text &&
    normalizeText(existing.option_a) === next.option_a &&
    normalizeText(existing.option_b) === next.option_b &&
    normalizeText(existing.option_c) === next.option_c &&
    normalizeText(existing.option_d) === next.option_d &&
    normalizeText(existing.correct_option).toUpperCase() === next.correct_option &&
    normalizeText(existing.explanation) === next.explanation &&
    normalizeText(existing.reference_note) === next.reference_note &&
    normalizeText(existing.source_note) === next.source_note &&
    normalizeText(existing.status).toLowerCase() === next.status &&
    normalizeText(existing.difficulty).toLowerCase() === next.difficulty &&
    normalizeOptional(existing.service_level) === next.service_level &&
    Number(existing.batch_number ?? 1) === next.batch_number &&
    Number(existing.batch_position ?? 0) === Number(next.batch_position ?? 0)
  );
}

function validateQuestion(record, sourceFile) {
  const requiredFields = [
    "subject_slug",
    "question_text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct_option",
    "status",
    "explanation",
  ];

  for (const field of requiredFields) {
    if (!normalizeText(record[field])) {
      throw new Error(`${sourceFile}: missing required field "${field}"`);
    }
  }

  const correctOption = String(record.correct_option).trim().toUpperCase();
  if (!validCorrectOptions.has(correctOption)) {
    throw new Error(`${sourceFile}: correct_option must be one of A, B, C, or D`);
  }

  const status = String(record.status).trim().toLowerCase();
  if (!validStatuses.has(status)) {
    throw new Error(`${sourceFile}: status must be draft, review, or published`);
  }

  const difficulty = normalizeText(record.difficulty || "medium").toLowerCase();
  if (!validDifficulties.has(difficulty)) {
    throw new Error(`${sourceFile}: difficulty must be easy, medium, or hard`);
  }

  const batchNumber = Number.parseInt(record.batch_number ?? 1, 10);
  if (!Number.isInteger(batchNumber) || batchNumber < 1) {
    throw new Error(`${sourceFile}: batch_number must be a positive integer`);
  }

  const rawBatchPosition = record.batch_position;
  const batchPosition =
    rawBatchPosition === undefined || rawBatchPosition === null || rawBatchPosition === ""
      ? null
      : Number.parseInt(rawBatchPosition, 10);

  if (batchPosition !== null && (!Number.isInteger(batchPosition) || batchPosition < 1)) {
    throw new Error(`${sourceFile}: batch_position must be a positive integer when provided`);
  }

  return {
    subject_slug: normalizeSubjectSlug(record.subject_slug),
    question_text: normalizeText(record.question_text),
    option_a: normalizeText(record.option_a),
    option_b: normalizeText(record.option_b),
    option_c: normalizeText(record.option_c),
    option_d: normalizeText(record.option_d),
    correct_option: correctOption,
    explanation: normalizeText(record.explanation),
    reference_note: normalizeText(record.reference_note),
    source_note: normalizeText(record.source_note || "Question pool"),
    status,
    difficulty,
    service_level: normalizeOptional(record.service_level),
    batch_number: batchNumber,
    batch_position: batchPosition,
  };
}

async function readQuestionFiles() {
  const entries = await fs.readdir(contentDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    throw new Error(`No question files found in ${contentDir}`);
  }

  const records = [];

  for (const file of files) {
    const absolutePath = path.join(contentDir, file);
    const raw = await fs.readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error(`${file}: expected an array of questions`);
    }

    parsed.forEach((item, index) => {
      const validated = validateQuestion(item, `${file}#${index + 1}`);
      records.push({
        ...validated,
        import_key: buildQuestionKey(validated.subject_slug, validated.question_text),
      });
    });
  }

  return records;
}

async function main() {
  await loadLocalEnvFile(".env");
  await loadLocalEnvFile(".env.local");

  const supabaseUrl = getEnv("SUPABASE_URL", ["VITE_SUPABASE_URL"]);
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      transport: WebSocket,
    },
  });

  const questions = await readQuestionFiles();

  const { data: packs, error: packError } = await supabase
    .from("exam_packs")
    .select("id, name")
    .eq("is_active", true)
    .order("active_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (packError) throw packError;

  const activePack = packs?.[0];
  if (!activePack?.id) {
    throw new Error("No active exam pack found.");
  }

  const { data: subjects, error: subjectError } = await supabase
    .from("subjects")
    .select("id, slug, name")
    .eq("is_active", true);

  if (subjectError) throw subjectError;

  const subjectBySlug = new Map();

  for (const subject of subjects ?? []) {
    subjectBySlug.set(subject.slug, subject);
    subjectBySlug.set(normalizeSubjectSlug(subject.slug), subject);
  }

  for (const question of questions) {
    if (!subjectBySlug.has(question.subject_slug)) {
      throw new Error(`Unknown subject_slug "${question.subject_slug}" in content/questions`);
    }
  }

  const { data: existingQuestions, error: existingError } = await supabase
    .from("questions")
    .select(
      "id, subject_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, reference_note, source_note, status, difficulty, service_level, batch_number, batch_position",
    )
    .eq("exam_pack_id", activePack.id);

  if (existingError) throw existingError;

  const existingByKey = new Map(
    (existingQuestions ?? []).map((question) => {
      const subject = subjects.find((item) => item.id === question.subject_id);
      const subjectSlug = subject?.slug ?? "";
      return [buildQuestionKey(subjectSlug, question.question_text), question];
    }),
  );

  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const inserts = [];
  const updates = [];

  for (const question of questions) {
    const subject = subjectBySlug.get(question.subject_slug);
    const existing = existingByKey.get(question.import_key);

    const nextRow = {
      exam_pack_id: activePack.id,
      subject_id: subject.id,
      service_level: question.service_level,
      difficulty: question.difficulty,
      question_text: question.question_text,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d,
      correct_option: question.correct_option,
      explanation: question.explanation,
      reference_note: question.reference_note,
      source_note: question.source_note,
      status: question.status,
      batch_number: question.batch_number,
      batch_position: question.batch_position,
    };

    if (existing?.id) {
      nextRow.id = existing.id;
    }

    if (existing && questionMatches(existing, nextRow)) {
      skippedCount += 1;
      continue;
    }

    if (existing?.id) {
      updates.push(nextRow);
    } else {
      inserts.push(nextRow);
    }
  }

  if (inserts.length > 0) {
    const { data: result, error: insertError } = await supabase
      .from("questions")
      .insert(inserts)
      .select("id");

    if (insertError) {
      failedCount += inserts.length;
      throw insertError;
    }

    importedCount += result?.length ?? inserts.length;
  }

  for (const row of updates) {
    const { data: result, error: updateError } = await supabase
      .from("questions")
      .update({
        exam_pack_id: row.exam_pack_id,
        subject_id: row.subject_id,
        service_level: row.service_level,
        difficulty: row.difficulty,
        question_text: row.question_text,
        option_a: row.option_a,
        option_b: row.option_b,
        option_c: row.option_c,
        option_d: row.option_d,
        correct_option: row.correct_option,
        explanation: row.explanation,
        reference_note: row.reference_note,
        source_note: row.source_note,
        status: row.status,
        batch_number: row.batch_number,
        batch_position: row.batch_position,
      })
      .eq("id", row.id)
      .select("id");

    if (updateError) {
      failedCount += 1;
      throw updateError;
    }

    importedCount += result?.length ?? 1;
  }

  console.log(`Active pack: ${activePack.name}`);
  console.log(`Imported: ${importedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Failed: ${failedCount}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
