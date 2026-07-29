import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { parseBulkObjectiveText } from "../../src/lib/bulkTextConverter.js";
import {
  createTimestamp,
  ensureDirectoryExists,
  hasValue,
  normalizeText,
  parseCliArgs,
  writeJsonFile,
} from "./contentUtils.mjs";

const DEFAULT_SOURCE_FILE =
  "C:/Users/USER/Downloads/2026 PROMOTION (FINANCIAL REGULATIONS, PSR & CURRENT AFFAIRS) (1).txt";

const OBJECTIVE_SECTION_MATCHERS = {
  "public-financial-management": (section) => section.title.startsWith("A. PUBLIC FINANCIAL MANAGEMENT"),
  "public-service-rules": (section) => section.title.startsWith("B. PUBLIC SERVICE RULES"),
  "current-affairs": (section) => section.title === "QUESTIONS:",
};

const SUBJECT_BATCH_SIZES = {
  "public-financial-management": 30,
  "public-service-rules": 20,
  "current-affairs": 20,
};

const OBJECTIVE_FIELDS = [
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_option",
];

function loadDotEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

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

function normalizeQuestionText(value) {
  return normalizeText(value)
    .replace(/[?.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedOption(value) {
  return normalizeText(value)
    .replace(/[?.]+$/g, "")
    .trim();
}

function summarizeBy(items, getKey) {
  return items.reduce((summary, item) => {
    const key = getKey(item);
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

function findSection(parsed, slug) {
  const matcher = OBJECTIVE_SECTION_MATCHERS[slug];
  return matcher ? parsed.sections.find(matcher) : null;
}

function buildSourceRows(parsed) {
  return Object.fromEntries(
    Object.keys(OBJECTIVE_SECTION_MATCHERS).map((slug) => [
      slug,
      findSection(parsed, slug)?.questions ?? [],
    ]),
  );
}

function indexByQuestionText(rows) {
  const index = new Map();

  for (const row of rows) {
    const key = normalizeQuestionText(row.question_text);

    if (!key) {
      continue;
    }

    const matches = index.get(key) ?? [];
    matches.push(row);
    index.set(key, matches);
  }

  return index;
}

function compareObjectiveRow(sourceRow, dbRow) {
  const changes = [];

  for (const field of OBJECTIVE_FIELDS) {
    const sourceValue = sourceRow[field] ?? "";
    const dbValue = dbRow[field] ?? "";
    const same = field.startsWith("option_")
      ? normalizedOption(sourceValue) === normalizedOption(dbValue)
      : normalizeText(sourceValue) === normalizeText(dbValue);

    if (!same) {
      changes.push({
        field,
        from: dbValue,
        to: sourceValue,
      });
    }
  }

  return changes;
}

function parseKeyPoints(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|[;•]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

async function fetchAll(client, table, select, order = "created_at") {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .order(order, { ascending: true })
      .range(from, from + 999);

    if (error) {
      throw error;
    }

    rows.push(...(data ?? []));

    if (!data || data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return rows;
}

function groupSafeActionsByPracticeSet({ safeActions, objectiveRows, subjectsById }) {
  const sourceRowsById = new Map(objectiveRows.map((row) => [row.id, row]));
  const groups = new Map();

  for (const action of safeActions) {
    if (action.action !== "update_question_fields") {
      continue;
    }

    let practiceSetId = null;

    if (action.db_id) {
      practiceSetId = sourceRowsById.get(action.db_id)?.practice_set_id ?? null;
    }

    const key = practiceSetId || `${action.slug}:unmapped`;
    const group = groups.get(key) ?? {
      source_practice_set_id: practiceSetId,
      slug: action.slug,
      set_number: null,
      current_published_count: 0,
      safe_actions: [],
    };

    group.safe_actions.push(action);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const setRows = objectiveRows.filter(
      (row) => row.practice_set_id === group.source_practice_set_id && row.status === "published",
    );
    group.current_published_count = setRows.length;
    group.set_number = setRows[0]?.batch_number ?? null;
    group.insert_count = group.safe_actions.filter(
      (action) => action.action === "insert_missing_question",
    ).length;
    group.update_count = group.safe_actions.filter(
      (action) => action.action === "update_question_fields",
    ).length;
    group.expected_replacement_question_count = group.current_published_count + group.insert_count;
    group.execution_outline = [
      "admin_create_practice_set_replacement(source_practice_set_id, copyQuestions=true)",
      group.insert_count > 0
        ? `admin_update_practice_set(replacement_id, ${group.expected_replacement_question_count})`
        : null,
      "patch copied draft questions / append missing source questions",
      "admin_transition_practice_set_v2(replacement_id, 'review')",
      "admin_publish_practice_set_replacement(replacement_id)",
    ].filter(Boolean);
  }

  return [...groups.values()].sort((left, right) => (
    `${left.slug}:${left.set_number}`.localeCompare(`${right.slug}:${right.set_number}`)
  ));
}

function buildMissingQuestionPlan({ safeActions, practiceSets, subjectsById }) {
  const setsBySlugAndNumber = new Map();

  for (const practiceSet of practiceSets) {
    const slug = subjectsById.get(practiceSet.subject_id)?.slug;

    if (!slug) {
      continue;
    }

    setsBySlugAndNumber.set(`${slug}:${practiceSet.set_number}`, practiceSet);
  }

  const groups = new Map();

  for (const action of safeActions) {
    if (action.action !== "insert_missing_question") {
      continue;
    }

    const batchSize = SUBJECT_BATCH_SIZES[action.slug];
    const sourceNumber = Number(action.source_number);

    if (!batchSize || !Number.isInteger(sourceNumber) || sourceNumber < 1) {
      const key = `${action.slug}:unmapped`;
      const group = groups.get(key) ?? {
        slug: action.slug,
        target_set_number: null,
        target_practice_set_id: null,
        target_set_status: "unmapped",
        missing_questions: [],
      };
      group.missing_questions.push(action);
      groups.set(key, group);
      continue;
    }

    const targetSetNumber = Math.ceil(sourceNumber / batchSize);
    const targetPosition = ((sourceNumber - 1) % batchSize) + 1;
    const existingSet = setsBySlugAndNumber.get(`${action.slug}:${targetSetNumber}`);
    const key = `${action.slug}:${targetSetNumber}`;
    const group = groups.get(key) ?? {
      slug: action.slug,
      target_set_number: targetSetNumber,
      target_practice_set_id: existingSet?.id ?? null,
      target_set_status: existingSet?.status ?? "missing",
      expected_question_count: existingSet?.expected_question_count ?? batchSize,
      missing_questions: [],
    };

    group.missing_questions.push({
      ...action,
      target_batch_position: targetPosition,
    });
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.insert_count = group.missing_questions.length;
    group.max_target_batch_position = Math.max(
      ...group.missing_questions.map((question) => question.target_batch_position ?? 0),
    );
    group.proposed_expected_question_count = group.target_set_status === "missing"
      ? group.max_target_batch_position
      : group.expected_question_count;
    group.execution_outline = [
      group.target_set_status === "missing"
        ? `admin_create_practice_set(${group.slug}, expected=${group.proposed_expected_question_count})`
        : `use existing ${group.target_set_status} practice set ${group.target_set_number}`,
      "admin_import_questions(target_practice_set_id, missing_questions)",
      "admin_transition_practice_set_v2(target_practice_set_id, 'review')",
      "admin_transition_practice_set_v2(target_practice_set_id, 'published') or existing publish flow",
    ];
  }

  return [...groups.values()].sort((left, right) => (
    `${left.slug}:${left.target_set_number}`.localeCompare(`${right.slug}:${right.target_set_number}`)
  ));
}

function reconcileObjectiveModule({ slug, sourceRows, dbRows }) {
  const sourceByText = indexByQuestionText(sourceRows);
  const dbByText = indexByQuestionText(dbRows);
  const proposed = [];
  const warnings = [];

  for (const [key, matches] of dbByText.entries()) {
    if (matches.length > 1) {
      warnings.push({
        type: "duplicate_db_question_text",
        slug,
        count: matches.length,
        question_text: matches[0].question_text,
        db_ids: matches.map((row) => row.id),
        positions: matches.map((row) => row.batch_position),
      });
    }

    if (!sourceByText.has(key)) {
      proposed.push({
        action: "investigate_extra_db_row",
        slug,
        db_id: matches[0].id,
        batch_number: matches[0].batch_number,
        batch_position: matches[0].batch_position,
        question_text: matches[0].question_text,
        reason: "Published DB question text was not found in the parsed source section.",
      });
    }
  }

  for (const sourceRow of sourceRows) {
    const matches = dbByText.get(normalizeQuestionText(sourceRow.question_text)) ?? [];

    if (matches.length === 0) {
      proposed.push({
        action: "insert_missing_question",
        slug,
        source_number: sourceRow.source_number,
        batch_position: sourceRow.batch_position,
        question: Object.fromEntries(
          OBJECTIVE_FIELDS.map((field) => [field, sourceRow[field] ?? ""]),
        ),
        reason: "Source question is not present in the published DB rows for this module.",
      });
      continue;
    }

    if (matches.length > 1) {
      continue;
    }

    const changes = compareObjectiveRow(sourceRow, matches[0]);

    if (changes.length > 0) {
      proposed.push({
        action: "update_question_fields",
        slug,
        db_id: matches[0].id,
        source_number: sourceRow.source_number,
        batch_number: matches[0].batch_number,
        batch_position: matches[0].batch_position,
        question_text: matches[0].question_text,
        changes,
        reason: "DB row differs from the parsed source row.",
      });
    }
  }

  return {
    slug,
    source_count: sourceRows.length,
    db_published_count: dbRows.length,
    proposed_count: proposed.length,
    warning_count: warnings.length,
    proposed,
    warnings,
  };
}

function reviewOral({ oralRows, subjectsById }) {
  const warnings = [];

  for (const row of oralRows) {
    const keyPoints = parseKeyPoints(row.key_points);

    if (!hasValue(row.question_text)) {
      warnings.push({ type: "oral_missing_question_text", id: row.id });
    }

    if (!hasValue(row.model_answer)) {
      warnings.push({ type: "oral_missing_model_answer", id: row.id });
    }

    if (keyPoints.length < 3 || keyPoints.length > 6) {
      warnings.push({
        type: "oral_keypoint_count_outside_3_to_6",
        id: row.id,
        subject: subjectsById.get(row.subject_id)?.slug ?? "unknown",
        status: row.status,
        position: row.batch_position,
        keypoint_count: keyPoints.length,
        question_text: row.question_text,
      });
    }
  }

  return {
    oral_count: oralRows.length,
    warnings,
    summary: summarizeBy(warnings, (warning) => warning.type),
  };
}

function classifyObjectiveAction(action) {
  if (action.action === "insert_missing_question") {
    if (!action.question.correct_option) {
      return {
        bucket: "manual_review",
        reason: "Missing source correct_option; insert requires manual answer-key verification.",
      };
    }

    return {
      bucket: "safe_auto",
      reason: "Source question is missing from DB and has complete objective fields.",
    };
  }

  if (action.action === "update_question_fields") {
    const changedFields = action.changes.map((change) => change.field);

    if (changedFields.length === 1 && changedFields[0] === "correct_option") {
      const nextCorrectOption = String(action.changes[0].to || "").trim().toUpperCase();

      if (!["A", "B", "C", "D"].includes(nextCorrectOption)) {
        return {
          bucket: "manual_review",
          reason: "Source correct_option is not A, B, C, or D; answer-key verification required.",
        };
      }

      return {
        bucket: "safe_auto",
        reason: "Only correct_option differs from the parsed source answer key.",
      };
    }

    return {
      bucket: "manual_review",
      reason: `Field changes require human review: ${changedFields.join(", ")}.`,
    };
  }

  return {
    bucket: "manual_review",
    reason: "Non-mutating investigation item.",
  };
}

function buildRepairPlan(objective) {
  const safeAuto = [];
  const manualReview = [];

  for (const module of Object.values(objective)) {
    for (const action of module.proposed) {
      const classification = classifyObjectiveAction(action);
      const item = {
        ...action,
        classification_reason: classification.reason,
      };

      if (classification.bucket === "safe_auto") {
        safeAuto.push(item);
      } else {
        manualReview.push(item);
      }
    }
  }

  return {
    safe_auto_count: safeAuto.length,
    manual_review_count: manualReview.length,
    safe_auto_summary: summarizeBy(safeAuto, (item) => `${item.slug}:${item.action}`),
    manual_review_summary: summarizeBy(manualReview, (item) => `${item.slug}:${item.action}`),
    safe_auto: safeAuto,
    manual_review: manualReview,
  };
}

async function main() {
  const args = parseCliArgs();
  const sourceFile = path.resolve(String(args.source || DEFAULT_SOURCE_FILE));
  const envFile = path.resolve(String(args.env || ".env"));
  const outputPath = path.resolve(
    String(args.out || `artifacts/source-db-dry-run-${createTimestamp()}.json`),
  );

  loadDotEnv(await fs.readFile(envFile, "utf8"));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  }

  const client = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const parsed = parseBulkObjectiveText(await fs.readFile(sourceFile, "utf8"));
  const sourceRowsBySlug = buildSourceRows(parsed);
  const [objectiveRows, oralRows, subjects] = await Promise.all([
    fetchAll(
      client,
      "questions",
      "id,subject_id,practice_set_id,question_text,option_a,option_b,option_c,option_d,correct_option,status,batch_number,batch_position",
    ),
    fetchAll(
      client,
      "oral_questions",
      "id,subject_id,practice_set_id,question_text,model_answer,key_points,status,batch_position",
    ),
    fetchAll(client, "subjects", "id,slug,name,practice_type,lifecycle_status,candidate_availability", "name"),
  ]);
  const practiceSets = await fetchAll(
    client,
    "practice_sets",
    "id,subject_id,set_number,status,practice_type,expected_question_count,version_number,replaces_practice_set_id,replaced_by_practice_set_id",
  );
  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));
  const subjectIdBySlug = new Map(subjects.map((subject) => [subject.slug, subject.id]));

  const objective = Object.fromEntries(
    Object.entries(sourceRowsBySlug).map(([slug, sourceRows]) => {
      const subjectId = subjectIdBySlug.get(slug);
      const publishedRows = objectiveRows.filter(
        (row) => row.subject_id === subjectId && row.status === "published",
      );
      return [slug, reconcileObjectiveModule({ slug, sourceRows, dbRows: publishedRows })];
    }),
  );
  const oral = reviewOral({ oralRows, subjectsById });
  const proposedActions = Object.values(objective).flatMap((module) => module.proposed);
  const repairPlan = buildRepairPlan(objective);
  const replacementPlan = groupSafeActionsByPracticeSet({
    safeActions: repairPlan.safe_auto,
    objectiveRows,
    subjectsById,
  });
  const missingQuestionPlan = buildMissingQuestionPlan({
    safeActions: repairPlan.safe_auto,
    practiceSets,
    subjectsById,
  });

  const report = {
    generated_at: new Date().toISOString(),
    mode: "dry-run",
    source_file: sourceFile,
    target_host: new URL(supabaseUrl).hostname,
    note: "No database writes were performed. Objective explanation/reference/source fields are intentionally optional.",
    totals: {
      objective_rows_in_db: objectiveRows.length,
      oral_rows_in_db: oralRows.length,
      practice_sets_in_db: practiceSets.length,
      proposed_objective_actions: proposedActions.length,
      safe_auto_objective_actions: repairPlan.safe_auto_count,
      manual_review_objective_actions: repairPlan.manual_review_count,
      objective_warnings: Object.values(objective).reduce(
        (total, module) => total + module.warning_count,
        0,
      ),
      oral_warnings: oral.warnings.length,
    },
    objective,
    oral,
    repair_plan: repairPlan,
    replacement_plan: {
      replacement_set_count: replacementPlan.length,
      groups: replacementPlan,
    },
    missing_question_plan: {
      target_set_count: missingQuestionPlan.length,
      groups: missingQuestionPlan,
    },
  };

  await ensureDirectoryExists(path.dirname(outputPath));
  await writeJsonFile(outputPath, report);

  console.log(`Dry-run complete. No database writes were performed.`);
  console.log(`Target: ${report.target_host}`);
  console.log(`Proposed objective actions: ${report.totals.proposed_objective_actions}`);
  console.log(`Safe automatic objective actions: ${report.totals.safe_auto_objective_actions}`);
  console.log(`Manual-review objective actions: ${report.totals.manual_review_objective_actions}`);
  console.log(`Replacement practice sets needed: ${report.replacement_plan.replacement_set_count}`);
  console.log(`Missing-question target sets needed: ${report.missing_question_plan.target_set_count}`);
  console.log(`Objective warnings: ${report.totals.objective_warnings}`);
  console.log(`Oral warnings: ${report.totals.oral_warnings}`);
  console.log(`Report: ${path.relative(process.cwd(), outputPath)}`);
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`Source/DB reconciliation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
