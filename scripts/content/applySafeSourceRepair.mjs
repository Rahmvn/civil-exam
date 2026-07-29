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

const DEFAULT_PLAN = "artifacts/replacement-and-tail-set-dry-run-plan.json";
const DEFAULT_AUTH_STATE = ".playwright-auth/admin.json";
const SKIPPED_TAIL_SLUGS = new Set(["public-service-rules"]);

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

function readSessionFromStorageState(state) {
  const localStorageItems = state.origins?.flatMap((origin) => origin.localStorage ?? []) ?? [];
  const authItem = localStorageItems.find((item) => item.name.includes("auth-token"));

  if (!authItem) {
    throw new Error("No Supabase auth token was found in the admin storage state.");
  }

  const parsed = JSON.parse(authItem.value);

  if (!parsed.access_token || !parsed.refresh_token) {
    throw new Error("The admin storage state does not contain a complete Supabase session.");
  }

  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
  };
}

async function requireRpc(client, functionName, args) {
  const { data, error } = await client.rpc(functionName, args);

  if (error) {
    throw new Error(`${functionName}: ${error.message}`);
  }

  return data;
}

async function requireQuery(label, promise) {
  const { data, error } = await promise;

  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }

  return data;
}

async function requireSingle(label, promise) {
  const data = await requireQuery(label, promise);
  if (!data) throw new Error(`${label}: no row returned`);
  return data;
}

function toImportQuestion(action) {
  return {
    batch_position: action.target_batch_position,
    question_text: action.question.question_text,
    option_a: action.question.option_a,
    option_b: action.question.option_b,
    option_c: action.question.option_c,
    option_d: action.question.option_d,
    correct_option: action.question.correct_option,
    explanation: "",
    reference_note: "",
    source_note: "2026 promotion source reconciliation",
    difficulty: "medium",
  };
}

async function getPracticeSetQuestions(serviceClient, practiceSetId) {
  return requireQuery(
    `Load questions for practice set ${practiceSetId}`,
    serviceClient
      .from("questions")
      .select(
        "id,practice_set_id,batch_position,question_text,option_a,option_b,option_c,option_d,correct_option,difficulty,service_level,explanation,reference_note,source_note,status",
      )
      .eq("practice_set_id", practiceSetId)
      .neq("status", "archived")
      .order("batch_position", { ascending: true }),
  );
}

function applyQuestionFieldChanges(question, changes) {
  const next = {
    id: question.id,
    practice_set_id: question.practice_set_id,
    batch_position: question.batch_position,
    question_text: question.question_text,
    option_a: question.option_a,
    option_b: question.option_b,
    option_c: question.option_c,
    option_d: question.option_d,
    correct_option: question.correct_option,
    difficulty: question.difficulty || "medium",
    service_level: question.service_level ?? "",
    explanation: question.explanation ?? "",
    reference_note: question.reference_note ?? "",
    source_note: question.source_note ?? "",
  };

  for (const change of changes) {
    next[change.field] = change.to;
  }

  return next;
}

async function applyReplacementGroup({ adminClient, serviceClient, group, dryRun }) {
  const operations = [];

  if (dryRun) {
    return {
      type: "replacement",
      slug: group.slug,
      source_practice_set_id: group.source_practice_set_id,
      set_number: group.set_number,
      dry_run: true,
      operations: [
        `Would create replacement for ${group.source_practice_set_id}`,
        `Would update ${group.update_count} copied draft question(s)`,
        "Would transition replacement to review",
        "Would publish replacement",
      ],
    };
  }

  const replacement = await requireRpc(adminClient, "admin_create_practice_set_replacement", {
    requested_source_practice_set_id: group.source_practice_set_id,
    requested_copy_questions: true,
  });
  operations.push({ action: "created_replacement", result: replacement });

  const replacementId = replacement.id;
  const copiedQuestions = await getPracticeSetQuestions(serviceClient, replacementId);
  const questionByPosition = new Map(copiedQuestions.map((question) => [question.batch_position, question]));

  for (const action of group.safe_actions) {
    const copiedQuestion = questionByPosition.get(action.batch_position);

    if (!copiedQuestion) {
      throw new Error(
        `${group.slug} set ${group.set_number}: copied question position ${action.batch_position} not found.`,
      );
    }

    const payload = applyQuestionFieldChanges(copiedQuestion, action.changes);
    const saved = await requireRpc(adminClient, "admin_save_question", {
      requested_question: payload,
    });
    operations.push({
      action: "updated_copied_question",
      source_number: action.source_number,
      question_id: saved.id,
      fields: action.changes.map((change) => change.field),
    });
  }

  await requireRpc(adminClient, "admin_transition_practice_set_v2", {
    requested_practice_set_id: replacementId,
    requested_status: "review",
  });
  operations.push({ action: "transitioned_replacement_to_review", replacement_id: replacementId });

  const published = await requireRpc(adminClient, "admin_publish_practice_set_replacement", {
    requested_replacement_practice_set_id: replacementId,
  });
  operations.push({ action: "published_replacement", result: published });

  return {
    type: "replacement",
    slug: group.slug,
    source_practice_set_id: group.source_practice_set_id,
    replacement_practice_set_id: replacementId,
    set_number: group.set_number,
    dry_run: false,
    operations,
  };
}

function validateObjectiveRows(rows, expectedCount) {
  const errors = [];
  const activeRows = rows.filter((row) => row.status !== "archived");
  const positions = activeRows.map((row) => Number(row.batch_position));
  const texts = activeRows.map((row) => String(row.question_text || "").trim().toLowerCase());

  if (activeRows.length !== expectedCount) {
    errors.push(`Expected ${expectedCount} active questions but found ${activeRows.length}.`);
  }

  if (new Set(positions).size !== positions.length) {
    errors.push("Duplicate batch positions detected.");
  }

  if (new Set(texts).size !== texts.length) {
    errors.push("Duplicate question text detected.");
  }

  for (const row of activeRows) {
    const options = [row.option_a, row.option_b, row.option_c, row.option_d]
      .map((value) => String(value || "").trim().toLowerCase());
    if (options.some((value) => !value) || new Set(options).size !== 4) {
      errors.push(`Invalid options at position ${row.batch_position}.`);
    }
    if (!["A", "B", "C", "D"].includes(String(row.correct_option || "").trim().toUpperCase())) {
      errors.push(`Invalid correct option at position ${row.batch_position}.`);
    }
  }

  return errors;
}

async function applyReplacementGroupDirect({ serviceClient, group, dryRun }) {
  if (dryRun) {
    return applyReplacementGroup({ adminClient: null, serviceClient, group, dryRun });
  }

  const now = new Date().toISOString();
  const sourceSet = await requireSingle(
    `Load source practice set ${group.source_practice_set_id}`,
    serviceClient
      .from("practice_sets")
      .select("*")
      .eq("id", group.source_practice_set_id)
      .single(),
  );

  if (!["published", "withdrawn"].includes(sourceSet.status)) {
    throw new Error(`${group.slug} set ${group.set_number}: source set is not replaceable.`);
  }

  if (sourceSet.replaced_by_practice_set_id) {
    throw new Error(`${group.slug} set ${group.set_number}: source set already has a replacement.`);
  }

  const sourceQuestions = await getPracticeSetQuestions(serviceClient, sourceSet.id);
  const backup = { sourceSet, sourceQuestions };
  const replacementId = randomUUID();
  const replacementSet = await requireSingle(
    `Create direct replacement set for ${sourceSet.id}`,
    serviceClient
      .from("practice_sets")
      .insert({
        id: replacementId,
        exam_pack_id: sourceSet.exam_pack_id,
        subject_id: sourceSet.subject_id,
        set_number: sourceSet.set_number,
        expected_question_count: sourceSet.expected_question_count,
        status: "draft",
        practice_type: sourceSet.practice_type,
        logical_set_key: sourceSet.logical_set_key,
        version_number: Number(sourceSet.version_number || 1) + 1,
        replaces_practice_set_id: sourceSet.id,
      })
      .select("*")
      .single(),
  );

  const copiedRows = sourceQuestions.map((question) => ({
    exam_pack_id: sourceSet.exam_pack_id,
    subject_id: sourceSet.subject_id,
    practice_set_id: replacementId,
    batch_number: sourceSet.set_number,
    batch_position: question.batch_position,
    service_level: question.service_level,
    difficulty: question.difficulty || "medium",
    question_text: question.question_text,
    option_a: question.option_a,
    option_b: question.option_b,
    option_c: question.option_c,
    option_d: question.option_d,
    correct_option: question.correct_option,
    explanation: question.explanation || "",
    reference_note: question.reference_note || "",
    source_note: `Copied from version ${sourceSet.version_number}`,
    status: "draft",
    revision_number: 1,
  }));

  await requireQuery(
    `Copy questions into replacement ${replacementId}`,
    serviceClient.from("questions").insert(copiedRows).select("id"),
  );

  const replacementQuestions = await getPracticeSetQuestions(serviceClient, replacementId);
  const byPosition = new Map(replacementQuestions.map((question) => [question.batch_position, question]));
  const updates = [];

  for (const action of group.safe_actions) {
    const copied = byPosition.get(action.batch_position);
    if (!copied) {
      throw new Error(`${group.slug} set ${group.set_number}: copied position ${action.batch_position} missing.`);
    }
    const patch = Object.fromEntries(action.changes.map((change) => [change.field, change.to]));
    const updated = await requireSingle(
      `Patch copied question ${copied.id}`,
      serviceClient.from("questions").update(patch).eq("id", copied.id).select("*").single(),
    );
    updates.push({ source_number: action.source_number, question_id: updated.id, patch });
  }

  const finalDraftQuestions = await getPracticeSetQuestions(serviceClient, replacementId);
  const validationErrors = validateObjectiveRows(finalDraftQuestions, sourceSet.expected_question_count);
  if (validationErrors.length > 0) {
    throw new Error(`${group.slug} set ${group.set_number}: replacement validation failed: ${validationErrors.join(" ")}`);
  }

  await requireQuery(
    `Archive source questions ${sourceSet.id}`,
    serviceClient.from("questions").update({ status: "archived" }).eq("practice_set_id", sourceSet.id).eq("status", "published").select("id"),
  );
  await requireQuery(
    `Publish replacement questions ${replacementId}`,
    serviceClient.from("questions").update({ status: "published" }).eq("practice_set_id", replacementId).in("status", ["draft", "review"]).select("id"),
  );
  await requireQuery(
    `Archive source practice set ${sourceSet.id}`,
    serviceClient
      .from("practice_sets")
      .update({
        status: "archived",
        retired_at: now,
        archived_at: now,
        retirement_reason: "Replaced by corrected version",
        replaced_by_practice_set_id: replacementId,
      })
      .eq("id", sourceSet.id)
      .select("id"),
  );
  await requireQuery(
    `Publish replacement practice set ${replacementId}`,
    serviceClient
      .from("practice_sets")
      .update({
        status: "published",
        published_at: now,
        ever_published: true,
        first_published_at: now,
      })
      .eq("id", replacementId)
      .select("id"),
  );

  return {
    type: "replacement_direct",
    slug: group.slug,
    set_number: group.set_number,
    source_practice_set_id: sourceSet.id,
    replacement_practice_set_id: replacementId,
    updates,
    backup,
  };
}

async function ensureTailPracticeSet({ adminClient, serviceClient, group }) {
  if (group.target_practice_set_id) {
    return group.target_practice_set_id;
  }

  const subject = await requireQuery(
    `Load subject ${group.slug}`,
    serviceClient.from("subjects").select("id,slug").eq("slug", group.slug).maybeSingle(),
  );

  if (!subject) {
    throw new Error(`Subject not found: ${group.slug}`);
  }

  const created = await requireRpc(adminClient, "admin_create_practice_set", {
    requested_subject_id: subject.id,
    requested_expected_question_count: group.proposed_expected_question_count,
  });

  return created.id;
}

async function applyTailGroup({ adminClient, serviceClient, group, dryRun }) {
  if (SKIPPED_TAIL_SLUGS.has(group.slug)) {
    return {
      type: "missing_tail_set",
      slug: group.slug,
      set_number: group.target_set_number,
      skipped: true,
      reason: "Skipped because this tail set has an unresolved manual-review source row.",
    };
  }

  if (dryRun) {
    return {
      type: "missing_tail_set",
      slug: group.slug,
      set_number: group.target_set_number,
      dry_run: true,
      operations: [
        group.target_practice_set_id
          ? `Would use existing ${group.target_set_status} set ${group.target_practice_set_id}`
          : `Would create set ${group.target_set_number} with expected ${group.proposed_expected_question_count}`,
        `Would import ${group.insert_count} missing question(s)`,
        "Would transition set to review",
        "Would publish set",
      ],
    };
  }

  const practiceSetId = await ensureTailPracticeSet({ adminClient, serviceClient, group });
  const existingQuestions = await getPracticeSetQuestions(serviceClient, practiceSetId);

  if (existingQuestions.length > 0) {
    throw new Error(
      `${group.slug} set ${group.target_set_number} is not empty; refusing append repair.`,
    );
  }

  const imported = await requireRpc(adminClient, "admin_import_questions", {
    requested_practice_set_id: practiceSetId,
    requested_questions: group.missing_questions.map(toImportQuestion),
  });

  await requireRpc(adminClient, "admin_transition_practice_set_v2", {
    requested_practice_set_id: practiceSetId,
    requested_status: "review",
  });

  const published = await requireRpc(adminClient, "admin_transition_practice_set_v2", {
    requested_practice_set_id: practiceSetId,
    requested_status: "published",
  });

  return {
    type: "missing_tail_set",
    slug: group.slug,
    set_number: group.target_set_number,
    practice_set_id: practiceSetId,
    dry_run: false,
    operations: [
      { action: "imported_questions", result: imported },
      { action: "published_set", result: published },
    ],
  };
}

async function applyTailGroupDirect({ serviceClient, group, dryRun }) {
  if (SKIPPED_TAIL_SLUGS.has(group.slug)) {
    return {
      type: "missing_tail_set_direct",
      slug: group.slug,
      set_number: group.target_set_number,
      skipped: true,
      reason: "Skipped because this tail set has an unresolved manual-review source row.",
    };
  }

  if (dryRun) {
    return applyTailGroup({ adminClient: null, serviceClient, group, dryRun });
  }

  const now = new Date().toISOString();
  let practiceSet = null;
  const backup = {};

  if (group.target_practice_set_id) {
    practiceSet = await requireSingle(
      `Load tail set ${group.target_practice_set_id}`,
      serviceClient.from("practice_sets").select("*").eq("id", group.target_practice_set_id).single(),
    );
  } else {
    const subject = await requireSingle(
      `Load subject ${group.slug}`,
      serviceClient.from("subjects").select("id,slug").eq("slug", group.slug).single(),
    );
    const activePack = await requireSingle(
      "Load active exam pack",
      serviceClient
        .from("exam_packs")
        .select("id")
        .eq("is_active", true)
        .order("active_from", { ascending: false })
        .limit(1)
        .single(),
    );
    practiceSet = await requireSingle(
      `Create tail set ${group.slug} ${group.target_set_number}`,
      serviceClient
        .from("practice_sets")
        .insert({
          exam_pack_id: activePack.id,
          subject_id: subject.id,
          set_number: group.target_set_number,
          expected_question_count: group.proposed_expected_question_count,
          status: "draft",
          practice_type: "objective",
        })
        .select("*")
        .single(),
    );
  }

  backup.practiceSet = practiceSet;
  backup.existingQuestions = await getPracticeSetQuestions(serviceClient, practiceSet.id);

  if (backup.existingQuestions.length > 0) {
    throw new Error(`${group.slug} set ${group.target_set_number}: target set is not empty.`);
  }

  const rows = group.missing_questions.map((action) => ({
    exam_pack_id: practiceSet.exam_pack_id,
    subject_id: practiceSet.subject_id,
    practice_set_id: practiceSet.id,
    batch_number: practiceSet.set_number,
    ...toImportQuestion(action),
    status: "published",
  }));
  const validationErrors = validateObjectiveRows(rows, practiceSet.expected_question_count);
  if (validationErrors.length > 0) {
    throw new Error(`${group.slug} set ${group.target_set_number}: tail validation failed: ${validationErrors.join(" ")}`);
  }

  const inserted = await requireQuery(
    `Insert tail questions ${group.slug} set ${group.target_set_number}`,
    serviceClient.from("questions").insert(rows).select("id,batch_position"),
  );
  await requireQuery(
    `Publish tail practice set ${practiceSet.id}`,
    serviceClient
      .from("practice_sets")
      .update({
        status: "published",
        published_at: now,
        ever_published: true,
        first_published_at: practiceSet.first_published_at || now,
      })
      .eq("id", practiceSet.id)
      .select("id"),
  );

  return {
    type: "missing_tail_set_direct",
    slug: group.slug,
    set_number: group.target_set_number,
    practice_set_id: practiceSet.id,
    inserted,
    backup,
  };
}

async function main() {
  const args = parseCliArgs();
  const dryRun = !args["confirm-safe-auto"];
  const serviceDirect = Boolean(args["service-direct"]);
  const planPath = path.resolve(String(args.plan || DEFAULT_PLAN));
  const envPath = path.resolve(String(args.env || ".env"));
  const authStatePath = path.resolve(String(args["auth-state"] || DEFAULT_AUTH_STATE));
  const outputPath = path.resolve(
    String(args.out || `artifacts/safe-source-repair-apply-${createTimestamp()}.json`),
  );

  loadDotEnv(await fs.readFile(envPath, "utf8"));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !secretKey || !publishableKey) {
    throw new Error("Missing Supabase URL, SUPABASE_SECRET_KEY, or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!dryRun && !serviceDirect) {
    const authState = JSON.parse(await fs.readFile(authStatePath, "utf8"));
    const { error: sessionError } = await adminClient.auth.setSession(readSessionFromStorageState(authState));

    if (sessionError) {
      throw new Error(`Admin session setup failed: ${sessionError.message}`);
    }
  }

  const results = [];

  for (const group of plan.replacement_plan.groups) {
    results.push(serviceDirect
      ? await applyReplacementGroupDirect({ serviceClient, group, dryRun })
      : await applyReplacementGroup({ adminClient, serviceClient, group, dryRun }));
  }

  for (const group of plan.missing_question_plan.groups) {
    results.push(serviceDirect
      ? await applyTailGroupDirect({ serviceClient, group, dryRun })
      : await applyTailGroup({ adminClient, serviceClient, group, dryRun }));
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: dryRun ? "dry-run" : "confirm-safe-auto",
    service_direct: serviceDirect,
    plan_file: planPath,
    target_host: new URL(supabaseUrl).hostname,
    skipped_tail_slugs: [...SKIPPED_TAIL_SLUGS],
    results,
  };

  await ensureDirectoryExists(path.dirname(outputPath));
  await writeJsonFile(outputPath, report);

  console.log(`${dryRun ? "Dry-run" : "Apply"} complete.`);
  console.log(`Database writes: ${dryRun ? "no" : "yes"}`);
  console.log(`Results: ${results.length}`);
  console.log(`Report: ${path.relative(process.cwd(), outputPath)}`);
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`Safe source repair failed: ${error.message}`);
    process.exitCode = 1;
  });
}
