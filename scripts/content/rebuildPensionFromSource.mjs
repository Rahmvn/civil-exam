import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  createTimestamp,
  ensureDirectoryExists,
  parseCliArgs,
  writeJsonFile,
} from "./contentUtils.mjs";

const DEFAULT_SOURCE_FILE =
  "C:/Users/USER/Downloads/2026 PROMOTION (FINANCIAL REGULATIONS, PSR & CURRENT AFFAIRS) (1).txt";
const FREE_QUESTION_START = 7515;
const FREE_QUESTION_END = 7638;
const FREE_ANSWER_START = 7640;
const FREE_ANSWER_END = 7661;
const PAID_QUESTION_START = 7665;
const PAID_QUESTION_END = 8552;
const PAID_ANSWER_START = 8553;
const PAID_ANSWER_END = 8705;
const PENSION_BATCH_SIZE = 20;

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function loadDotEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const [key, ...rest] = trimmed.split("=");
    let value = rest.join("=").trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function finishQuestion(rows, question) {
  if (!question) return;
  if (!question.option_a || !question.option_b || !question.option_c || !question.option_d) return;
  rows.push(question);
}

function parseQuestionBlock(lines, startLine, endLine) {
  const rows = [];
  let current = null;

  for (let index = startLine - 1; index < endLine; index += 1) {
    const line = cleanText(lines[index]);
    if (!line) continue;

    const questionMatch = line.match(/^(\d{1,3})\.\s+(.+)/);
    const optionMatch = line.match(/^([a-d])\s*[).]\s*(.+)/i) || line.match(/^([a-d])\s+(.+)/i);

    if (questionMatch) {
      finishQuestion(rows, current);
      current = {
        source_number: Number(questionMatch[1]),
        question_text: cleanText(questionMatch[2]),
        option_a: "",
        option_b: "",
        option_c: "",
        option_d: "",
        line_number: index + 1,
        active_option: "",
      };
      continue;
    }

    if (current && optionMatch) {
      const parsedKey = `option_${optionMatch[1].toLowerCase()}`;
      const key = current[parsedKey]
        ? ["option_a", "option_b", "option_c", "option_d"].find((field) => !current[field]) ?? parsedKey
        : parsedKey;
      current[key] = cleanText(optionMatch[2]);
      current.active_option = key;
      continue;
    }

    if (current) {
      if (current.active_option) {
        current[current.active_option] = cleanText(`${current[current.active_option]} ${line}`);
      } else {
        current.question_text = cleanText(`${current.question_text} ${line}`);
      }
    }
  }

  finishQuestion(rows, current);
  return rows.map(({ active_option, ...row }) => row);
}

function parseAnswerBlock(lines, startLine, endLine) {
  const answers = new Map();

  for (let index = startLine - 1; index < endLine; index += 1) {
    const match = cleanText(lines[index]).match(/^(\d{1,3})\.\s*([a-d])\b/i);
    if (match) answers.set(Number(match[1]), match[2].toUpperCase());
  }

  return answers;
}

function attachAnswers(rows, answers) {
  return rows.map((row) => ({
    ...row,
    correct_option: answers.get(row.source_number) ?? "",
  }));
}

function parsePensionSource(text) {
  const lines = text.split(/\r?\n/);
  const free = attachAnswers(
    parseQuestionBlock(lines, FREE_QUESTION_START, FREE_QUESTION_END),
    parseAnswerBlock(lines, FREE_ANSWER_START, FREE_ANSWER_END),
  );
  const paid = attachAnswers(
    parseQuestionBlock(lines, PAID_QUESTION_START, PAID_QUESTION_END),
    parseAnswerBlock(lines, PAID_ANSWER_START, PAID_ANSWER_END),
  );

  return {
    free,
    paid,
    all: [
      ...free.map((row) => ({ ...row, block: "free", target_set_number: 1, target_position: row.source_number })),
      ...paid.map((row) => ({
        ...row,
        block: "paid",
        target_set_number: Math.ceil(row.source_number / PENSION_BATCH_SIZE) + 1,
        target_position: ((row.source_number - 1) % PENSION_BATCH_SIZE) + 1,
      })),
    ],
  };
}

function validateRows(rows) {
  const errors = [];

  for (const row of rows) {
    const options = [row.option_a, row.option_b, row.option_c, row.option_d]
      .map((value) => cleanText(value).toLowerCase());
    if (!row.question_text) errors.push(`${row.block} #${row.source_number}: missing question_text`);
    if (options.some((value) => !value)) errors.push(`${row.block} #${row.source_number}: missing option`);
    if (new Set(options).size !== 4) errors.push(`${row.block} #${row.source_number}: duplicate options`);
    if (!["A", "B", "C", "D"].includes(row.correct_option)) {
      errors.push(`${row.block} #${row.source_number}: invalid correct_option ${row.correct_option || "(blank)"}`);
    }
  }

  return errors;
}

function toQuestionInsert(row, practiceSet, subjectId) {
  return {
    exam_pack_id: practiceSet.exam_pack_id,
    subject_id: subjectId,
    practice_set_id: practiceSet.id,
    batch_number: row.target_set_number,
    batch_position: row.target_position,
    service_level: null,
    difficulty: "medium",
    question_text: row.question_text,
    option_a: row.option_a,
    option_b: row.option_b,
    option_c: row.option_c,
    option_d: row.option_d,
    correct_option: row.correct_option,
    explanation: "",
    reference_note: "",
    source_note: "2026 pension source rebuild",
    status: "published",
    revision_number: 1,
  };
}

async function requireQuery(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function main() {
  const args = parseCliArgs();
  const isConfirm = Boolean(args.confirm);
  const sourcePath = path.resolve(String(args.source || DEFAULT_SOURCE_FILE));
  const outPath = path.resolve(String(args.out || `artifacts/pension-rebuild-${createTimestamp()}.json`));

  loadDotEnv(await fs.readFile(String(args.env || ".env"), "utf8"));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) throw new Error("Missing Supabase URL or SUPABASE_SECRET_KEY.");

  const parsed = parsePensionSource(await fs.readFile(sourcePath, "utf8"));
  const validationErrors = validateRows(parsed.all);
  if (validationErrors.length > 0) {
    throw new Error(`Source validation failed: ${validationErrors.slice(0, 5).join(" ")}${validationErrors.length > 5 ? " ..." : ""}`);
  }

  const client = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const subject = await requireQuery(
    "Load pension subject",
    client.from("subjects").select("*").eq("slug", "pension-module").single(),
  );
  const activePack = await requireQuery(
    "Load active pack",
    client.from("exam_packs").select("*").eq("is_active", true).order("active_from", { ascending: false }).limit(1).single(),
  );
  const existingSets = await requireQuery(
    "Load pension practice sets",
    client.from("practice_sets").select("*").eq("subject_id", subject.id).order("set_number"),
  );
  const existingQuestions = await requireQuery(
    "Load pension questions",
    client.from("questions").select("*").eq("subject_id", subject.id).order("batch_number").order("batch_position"),
  );
  const rowsBySet = Map.groupBy(parsed.all, (row) => row.target_set_number);
  const operations = [...rowsBySet.entries()].map(([setNumber, rows]) => ({
    set_number: setNumber,
    source_count: rows.length,
    expected_question_count: rows.length,
    mode: existingSets.some((set) => set.set_number === setNumber && set.status === "published")
      ? "replace_published_set"
      : "create_new_set",
  }));

  const report = {
    generated_at: new Date().toISOString(),
    mode: isConfirm ? "confirm" : "dry-run",
    source_file: sourcePath,
    source_counts: { free: parsed.free.length, paid: parsed.paid.length, total: parsed.all.length },
    target_host: new URL(supabaseUrl).hostname,
    operations,
    backup: isConfirm ? { existingSets, existingQuestions } : undefined,
    results: [],
  };

  if (isConfirm) {
    const now = new Date().toISOString();

    for (const [setNumber, sourceRows] of rowsBySet.entries()) {
      const existingPublishedSet = existingSets.find(
        (set) => set.set_number === setNumber && set.status === "published",
      );
      let targetSet;

      if (existingPublishedSet) {
        const replacementId = randomUUID();
        targetSet = await requireQuery(
          `Create pension replacement set ${setNumber}`,
          client
            .from("practice_sets")
            .insert({
              id: replacementId,
              exam_pack_id: existingPublishedSet.exam_pack_id,
              subject_id: subject.id,
              set_number: setNumber,
              expected_question_count: sourceRows.length,
              status: "draft",
              practice_type: "objective",
              logical_set_key: existingPublishedSet.logical_set_key,
              version_number: Number(existingPublishedSet.version_number || 1) + 1,
              replaces_practice_set_id: existingPublishedSet.id,
            })
            .select("*")
            .single(),
        );
      } else {
        targetSet = await requireQuery(
          `Create pension set ${setNumber}`,
          client
            .from("practice_sets")
            .insert({
              exam_pack_id: activePack.id,
              subject_id: subject.id,
              set_number: setNumber,
              expected_question_count: sourceRows.length,
              status: "draft",
              practice_type: "objective",
            })
            .select("*")
            .single(),
        );
      }

      const inserted = await requireQuery(
        `Insert pension set ${setNumber}`,
        client.from("questions").insert(sourceRows.map((row) => toQuestionInsert(row, targetSet, subject.id))).select("id"),
      );

      if (existingPublishedSet) {
        await requireQuery(
          `Archive pension source questions set ${setNumber}`,
          client.from("questions").update({ status: "archived" }).eq("practice_set_id", existingPublishedSet.id).eq("status", "published").select("id"),
        );
        await requireQuery(
          `Archive pension source set ${setNumber}`,
          client
            .from("practice_sets")
            .update({
              status: "archived",
              retired_at: now,
              archived_at: now,
              retirement_reason: "Rebuilt from verified pension source",
              replaced_by_practice_set_id: targetSet.id,
            })
            .eq("id", existingPublishedSet.id)
            .select("id"),
        );
      }

      await requireQuery(
        `Publish pension target set ${setNumber}`,
        client
          .from("practice_sets")
          .update({
            status: "published",
            published_at: now,
            ever_published: true,
            first_published_at: targetSet.first_published_at || now,
          })
          .eq("id", targetSet.id)
          .select("id"),
      );

      report.results.push({
        set_number: setNumber,
        practice_set_id: targetSet.id,
        replaced_practice_set_id: existingPublishedSet?.id ?? null,
        inserted_count: inserted.length,
      });
    }
  }

  await ensureDirectoryExists(path.dirname(outPath));
  await writeJsonFile(outPath, report);

  console.log(`${isConfirm ? "Apply" : "Dry-run"} complete.`);
  console.log(`Source rows: ${parsed.all.length} (${parsed.free.length} free, ${parsed.paid.length} paid)`);
  console.log(`Operations: ${operations.length}`);
  console.log(`Report: ${path.relative(process.cwd(), outPath)}`);
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`Pension rebuild failed: ${error.message}`);
    process.exitCode = 1;
  });
}
