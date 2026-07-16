const REQUIRED_OBJECTIVE_IMPORT_FIELDS = [
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_option",
];

const REQUIRED_ORAL_IMPORT_FIELDS = ["question_text", "model_answer"];

const HEADER_ALIASES = {
  question: "question_text",
  question_text: "question_text",
  "question text": "question_text",
  option_a: "option_a",
  "option a": "option_a",
  option_b: "option_b",
  "option b": "option_b",
  option_c: "option_c",
  "option c": "option_c",
  option_d: "option_d",
  "option d": "option_d",
  correct_answer: "correct_option",
  "correct answer": "correct_option",
  correct_option: "correct_option",
  explanation: "explanation",
  reference: "reference_note",
  reference_note: "reference_note",
  source: "source_note",
  source_note: "source_note",
  difficulty: "difficulty",
  position: "batch_position",
  batch_position: "batch_position",
  model_answer: "model_answer",
  "model answer": "model_answer",
  key_points: "key_points",
  "key points": "key_points",
  key_point_1: "key_point_1",
  "key point 1": "key_point_1",
  key_point_2: "key_point_2",
  "key point 2": "key_point_2",
  key_point_3: "key_point_3",
  "key point 3": "key_point_3",
  key_point_4: "key_point_4",
  "key point 4": "key_point_4",
  key_point_5: "key_point_5",
  "key point 5": "key_point_5",
  key_point_6: "key_point_6",
  "key point 6": "key_point_6",
};

export const ADMIN_IMPORT_TEMPLATE = [
  "position,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,reference,difficulty",
  '1,"Enter the question here","First option","Second option","Third option","Fourth option",A,"Explain why A is correct","Source or section",medium',
].join("\r\n");

export const ADMIN_IMPORT_JSON_EXAMPLE = JSON.stringify([
  {
    batch_position: 1,
    question_text: "Enter the question here",
    option_a: "First option",
    option_b: "Second option",
    option_c: "Third option",
    option_d: "Fourth option",
    correct_option: "A",
    explanation: "Explain why A is correct",
    reference_note: "Source or section",
    difficulty: "medium",
  },
], null, 2);

export const ADMIN_ORAL_IMPORT_TEMPLATE = [
  "position,question_text,model_answer,key_point_1,key_point_2,key_point_3,key_point_4,key_point_5,key_point_6,reference,difficulty",
  '1,"Explain the topic here","Write the complete model answer here","First essential point","Second essential point","","","","","Source or section",medium',
].join("\r\n");

export const ADMIN_ORAL_IMPORT_JSON_EXAMPLE = JSON.stringify([
  {
    batch_position: 1,
    question_text: "Explain the topic here",
    model_answer: "Write the complete model answer here",
    key_points: ["First essential point", "Second essential point"],
    reference_note: "Source or section",
    difficulty: "medium",
  },
], null, 2);

export function slugifyModuleName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function formatAdminCurrency(amountKobo, currency = "NGN") {
  const amount = Number(amountKobo ?? 0) / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  if (quoted) throw new Error("The CSV file contains an unclosed quoted value.");

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeImportRow(row, index, startPosition, practiceType) {
  const suppliedPosition = row.batch_position;
  const position = suppliedPosition === undefined
    || suppliedPosition === null
    || String(suppliedPosition).trim() === ""
    ? startPosition + index
    : suppliedPosition;

  const shared = {
    batch_position: Number(position),
    question_text: String(row.question_text ?? "").trim(),
    reference_note: String(row.reference_note ?? "").trim(),
    source_note: String(row.source_note ?? "Admin bulk import").trim() || "Admin bulk import",
    difficulty: String(row.difficulty ?? "medium").trim().toLowerCase() || "medium",
  };

  if (practiceType === "oral") {
    const suppliedPoints = Array.isArray(row.key_points)
      ? row.key_points
      : row.key_points
        ? [row.key_points]
        : [row.key_point_1, row.key_point_2, row.key_point_3, row.key_point_4, row.key_point_5, row.key_point_6];

    return {
      ...shared,
      model_answer: String(row.model_answer ?? "").trim(),
      key_points: suppliedPoints.map((point) => String(point ?? "").trim()).filter(Boolean),
    };
  }

  return {
    ...shared,
    option_a: String(row.option_a ?? "").trim(),
    option_b: String(row.option_b ?? "").trim(),
    option_c: String(row.option_c ?? "").trim(),
    option_d: String(row.option_d ?? "").trim(),
    correct_option: String(row.correct_option ?? "").trim().toUpperCase(),
    explanation: String(row.explanation ?? "").trim(),
  };
}

function rowsFromTable(tableRows, sourceLabel, practiceType) {
  if (tableRows.length < 2) {
    throw new Error(`The ${sourceLabel} file must contain a header and at least one question.`);
  }

  const mappedHeaders = tableRows[0].map((header) => HEADER_ALIASES[normalizeHeader(header)] ?? "");
  if (!mappedHeaders.includes("question_text")) {
    throw new Error(`The ${sourceLabel} header must include question_text.`);
  }

  if (practiceType === "oral" && !mappedHeaders.includes("model_answer")) {
    throw new Error(`The ${sourceLabel} header must include model_answer.`);
  }

  return tableRows.slice(1).map((values) => Object.fromEntries(
    mappedHeaders
      .map((header, index) => [header, values[index]])
      .filter(([header]) => header),
  ));
}

function rowsFromCsv(text, practiceType) {
  return rowsFromTable(parseCsv(text), "CSV", practiceType);
}

async function rowsFromWorkbook(file, practiceType) {
  const { unzipSync } = await import("fflate");
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const workbook = parseWorkbookXml(archive, "xl/workbook.xml");
  const relationships = parseWorkbookXml(archive, "xl/_rels/workbook.xml.rels");
  const firstSheet = workbook.getElementsByTagNameNS("*", "sheet")[0];

  if (!firstSheet) throw new Error("The Excel file does not contain a worksheet.");

  const relationshipId = firstSheet.getAttributeNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "id",
  ) || firstSheet.getAttribute("r:id");
  const relationship = Array.from(relationships.getElementsByTagNameNS("*", "Relationship"))
    .find((entry) => entry.getAttribute("Id") === relationshipId);

  if (!relationship) throw new Error("The first Excel worksheet could not be located.");

  const sheetPath = normalizeArchivePath(`xl/${relationship.getAttribute("Target") ?? ""}`);
  const worksheet = parseWorkbookXml(archive, sheetPath);
  const sharedStrings = readSharedStrings(archive);
  const rows = Array.from(worksheet.getElementsByTagNameNS("*", "row")).map((row) => {
    const values = [];

    Array.from(row.getElementsByTagNameNS("*", "c")).forEach((cell, fallbackIndex) => {
      const reference = cell.getAttribute("r") ?? "";
      const columnIndex = reference ? columnIndexFromReference(reference) : fallbackIndex;
      values[columnIndex] = readWorkbookCell(cell, sharedStrings);
    });

    return values;
  });

  return rowsFromTable(rows, "Excel", practiceType);
}

function normalizeArchivePath(path) {
  const parts = [];

  String(path).replaceAll("\\", "/").split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });

  return parts.join("/");
}

function parseWorkbookXml(archive, path) {
  const contents = archive[normalizeArchivePath(path)];
  if (!contents) throw new Error(`The Excel file is missing ${path}.`);

  const document = new DOMParser().parseFromString(
    new TextDecoder().decode(contents),
    "application/xml",
  );

  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`The Excel file contains invalid XML in ${path}.`);
  }

  return document;
}

function readSharedStrings(archive) {
  if (!archive["xl/sharedStrings.xml"]) return [];
  const document = parseWorkbookXml(archive, "xl/sharedStrings.xml");

  return Array.from(document.getElementsByTagNameNS("*", "si")).map((entry) => (
    Array.from(entry.getElementsByTagNameNS("*", "t"))
      .map((textNode) => textNode.textContent ?? "")
      .join("")
  ));
}

function columnIndexFromReference(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((index, letter) => (index * 26) + letter.charCodeAt(0) - 64, 0) - 1;
}

function readWorkbookCell(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";

  if (type === "s") return sharedStrings[Number(value)] ?? "";
  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagNameNS("*", "t"))
      .map((textNode) => textNode.textContent ?? "")
      .join("");
  }
  if (type === "b") return value === "1";
  if (type === "n" || (!type && value !== "" && Number.isFinite(Number(value)))) return Number(value);
  return value;
}

async function sha256File(file) {
  if (!globalThis.crypto?.subtle) return "";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateAdminImportRows(rows, startPosition = 1, practiceType = "objective") {
  if (!Array.isArray(rows)) throw new Error("The imported file must contain a list of questions.");
  if (rows.length < 1) throw new Error("The imported file has no questions.");
  if (rows.length > 200) throw new Error("Import no more than 200 questions at once.");

  if (!['objective', 'oral'].includes(practiceType)) throw new Error("Choose a valid practice type.");
  const questions = rows.map((row, index) => normalizeImportRow(row, index, startPosition, practiceType));
  const errors = [];
  const seenPositions = new Set();
  const seenQuestions = new Set();

  questions.forEach((question, index) => {
    const rowNumber = index + 2;

    const requiredFields = practiceType === "oral" ? REQUIRED_ORAL_IMPORT_FIELDS : REQUIRED_OBJECTIVE_IMPORT_FIELDS;
    for (const field of requiredFields) {
      if (!question[field]) errors.push(`Row ${rowNumber}: ${field.replaceAll("_", " ")} is required.`);
    }

    if (!Number.isInteger(question.batch_position) || question.batch_position < 1) {
      errors.push(`Row ${rowNumber}: position must be a positive whole number.`);
    } else if (seenPositions.has(question.batch_position)) {
      errors.push(`Row ${rowNumber}: position ${question.batch_position} is duplicated.`);
    }
    seenPositions.add(question.batch_position);

    if (practiceType === "oral") {
      if (question.key_points.length < 1) {
        errors.push(`Row ${rowNumber}: add at least one key point.`);
      } else if (new Set(question.key_points.map((point) => point.toLowerCase())).size !== question.key_points.length) {
        errors.push(`Row ${rowNumber}: key points must be different.`);
      }
    } else {
      const optionValues = [question.option_a, question.option_b, question.option_c, question.option_d]
        .map((value) => value.toLowerCase());
      if (new Set(optionValues).size !== 4) {
        errors.push(`Row ${rowNumber}: answer options must be different.`);
      }

      if (!["A", "B", "C", "D"].includes(question.correct_option)) {
        errors.push(`Row ${rowNumber}: correct answer must be A, B, C, or D.`);
      }
    }

    if (!["easy", "medium", "hard"].includes(question.difficulty)) {
      errors.push(`Row ${rowNumber}: difficulty must be easy, medium, or hard.`);
    }

    const questionKey = question.question_text.toLowerCase().replace(/\s+/g, " ");
    if (questionKey && seenQuestions.has(questionKey)) {
      errors.push(`Row ${rowNumber}: question text is duplicated.`);
    }
    seenQuestions.add(questionKey);
  });

  return { questions, errors };
}

export async function parseAdminImportFile(file, startPosition = 1, practiceType = "objective") {
  if (!file) throw new Error("Choose a CSV, Excel, or JSON file first.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file smaller than 5 MB.");

  const extension = file.name.split(".").pop()?.toLowerCase();
  let rows;

  if (extension === "json") {
    rows = JSON.parse(await file.text());
  } else if (extension === "csv") {
    rows = rowsFromCsv(await file.text(), practiceType);
  } else if (extension === "xlsx") {
    rows = await rowsFromWorkbook(file, practiceType);
  } else {
    throw new Error("Use a .csv, .xlsx, or .json file.");
  }

  return {
    ...validateAdminImportRows(rows, startPosition, practiceType),
    metadata: {
      checksum: await sha256File(file),
      fileName: file.name.slice(0, 255),
      format: extension,
    },
  };
}
