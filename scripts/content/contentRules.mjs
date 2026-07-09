export const SUBJECT_BATCH_SIZES = {
  "public-financial-management": 30,
  "public-service-rules": 20,
  "current-affairs": 20,
};

export const ACTIVE_SUBJECT_SLUGS = new Set([
  "public-financial-management",
  "public-service-rules",
  "current-affairs",
]);

export const VALID_STATUSES = new Set(["draft", "published", "archived"]);
export const IMPORTER_VALID_STATUSES = new Set(["draft", "review", "published"]);
export const VALID_CORRECT_OPTIONS = new Set(["A", "B", "C", "D", null]);
export const IMPORT_REQUIRED_FIELDS = [
  "subject_slug",
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_option",
  "batch_number",
  "batch_position",
  "status",
  "source_note",
];
export const DEV_SEED_SOURCE_MARKERS = [
  "development seed question",
  "dev_seed_gl07",
  "dev_seed_gl08",
];

export const OBJECTIVE_REQUIRED_FIELDS = [
  "subject_slug",
  "source_number",
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_option",
];

export const ORAL_REQUIRED_FIELDS = [
  "resource_type",
  "prompt",
  "model_answer",
];

export const ORAL_FORBIDDEN_FIELDS = [
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_option",
  "question_text",
  "subject_slug",
];

export const REPORT_DIRECTORIES = {
  reports: "contents/reports",
};

export const IMPORT_READY_DIRECTORY = "contents/import-ready";
export const IMPORTER_INPUT_DIRECTORY = "content/questions";
