import { Database } from "bun:sqlite";
import type {
  EvalExpectedFinding,
  EvalFixture,
  EvalFixtureWithFindings,
  EvalReviewerReport,
  EvalMergedReport,
  EvalJudgeResult,
  EvalRun,
} from "../../types";

export interface EvalFixtureInput {
  name: string;
  fileName: string;
  language: string;
  code: string;
  notes: string;
  findings: Array<{
    title: string;
    description: string;
    severity: EvalExpectedFinding["severity"];
    lineHint: string;
    required: boolean;
    tags: string[];
  }>;
}

export function listEvalFixtures(db: Database): EvalFixtureWithFindings[] {
  const fixtures = db.query(
    `SELECT id, name, file_name, language, code, notes, created_at, updated_at
     FROM eval_fixtures
     ORDER BY id DESC`,
  ).all() as EvalFixtureRow[];
  return fixtures.map((row) => ({
    ...rowToFixture(row),
    findings: listEvalFindingsForFixture(db, row.id),
  }));
}

export function getEvalFixture(db: Database, id: number): EvalFixtureWithFindings | null {
  const row = db.query(
    `SELECT id, name, file_name, language, code, notes, created_at, updated_at
     FROM eval_fixtures WHERE id = ?`,
  ).get(id) as EvalFixtureRow | null;
  if (!row) return null;
  return {
    ...rowToFixture(row),
    findings: listEvalFindingsForFixture(db, row.id),
  };
}

export function getEvalFixturesByIds(db: Database, ids: number[]): EvalFixtureWithFindings[] {
  return ids.map((id) => getEvalFixture(db, id)).filter((fixture): fixture is EvalFixtureWithFindings => fixture !== null);
}

export function createEvalFixture(db: Database, input: EvalFixtureInput): EvalFixtureWithFindings {
  const result = db.run(
    `INSERT INTO eval_fixtures (name, file_name, language, code, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [input.name, input.fileName, input.language, input.code, input.notes],
  );
  const fixtureId = Number(result.lastInsertRowid);
  replaceFindings(db, fixtureId, input.findings);
  return getEvalFixture(db, fixtureId)!;
}

export function updateEvalFixture(db: Database, id: number, input: EvalFixtureInput): EvalFixtureWithFindings | null {
  const existing = getEvalFixture(db, id);
  if (!existing) return null;
  db.run(
    `UPDATE eval_fixtures
     SET name = ?, file_name = ?, language = ?, code = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.name, input.fileName, input.language, input.code, input.notes, id],
  );
  db.run("DELETE FROM eval_expected_findings WHERE fixture_id = ?", [id]);
  replaceFindings(db, id, input.findings);
  return getEvalFixture(db, id);
}

export function deleteEvalFixture(db: Database, id: number): boolean {
  const result = db.run("DELETE FROM eval_fixtures WHERE id = ?", [id]);
  return Number(result.changes) > 0;
}

export function saveEvalRun(
  db: Database,
  input: {
    fixtureIds: number[];
    reviewerSlugs: string[];
    reviewerReports: EvalReviewerReport[];
    mergedReport: EvalMergedReport;
    judgeResult: EvalJudgeResult;
    judgeProvider: string;
    judgeModel: string;
  },
): EvalRun {
  const result = db.run(
    `INSERT INTO eval_runs (
      fixture_ids_json,
      reviewer_slugs_json,
      reviewer_reports_json,
      merged_report_json,
      judge_result_json,
      judge_provider,
      judge_model
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      JSON.stringify(input.fixtureIds),
      JSON.stringify(input.reviewerSlugs),
      JSON.stringify(input.reviewerReports),
      JSON.stringify(input.mergedReport),
      JSON.stringify(input.judgeResult),
      input.judgeProvider,
      input.judgeModel,
    ],
  );
  return getEvalRun(db, Number(result.lastInsertRowid))!;
}

export function listEvalRuns(db: Database): EvalRun[] {
  const rows = db.query(
    `SELECT id, fixture_ids_json, reviewer_slugs_json, reviewer_reports_json, merged_report_json,
            judge_result_json, judge_provider, judge_model, created_at
     FROM eval_runs ORDER BY id DESC`,
  ).all() as EvalRunRow[];
  return rows.map(rowToEvalRun);
}

export function getEvalRun(db: Database, id: number): EvalRun | null {
  const row = db.query(
    `SELECT id, fixture_ids_json, reviewer_slugs_json, reviewer_reports_json, merged_report_json,
            judge_result_json, judge_provider, judge_model, created_at
     FROM eval_runs WHERE id = ?`,
  ).get(id) as EvalRunRow | null;
  return row ? rowToEvalRun(row) : null;
}

function replaceFindings(db: Database, fixtureId: number, findings: EvalFixtureInput["findings"]): void {
  const stmt = db.prepare(
    `INSERT INTO eval_expected_findings (
      fixture_id, title, description, severity, line_hint, required, tags_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const finding of findings) {
    stmt.run(
      fixtureId,
      finding.title,
      finding.description,
      finding.severity,
      finding.lineHint,
      finding.required ? 1 : 0,
      JSON.stringify(finding.tags),
    );
  }
}

function listEvalFindingsForFixture(db: Database, fixtureId: number): EvalExpectedFinding[] {
  const rows = db.query(
    `SELECT id, fixture_id, title, description, severity, line_hint, required, tags_json, created_at, updated_at
     FROM eval_expected_findings
     WHERE fixture_id = ?
     ORDER BY id`,
  ).all(fixtureId) as EvalFindingRow[];
  return rows.map(rowToFinding);
}

function rowToFixture(row: EvalFixtureRow): EvalFixture {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    language: row.language,
    code: row.code,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToFinding(row: EvalFindingRow): EvalExpectedFinding {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    title: row.title,
    description: row.description,
    severity: row.severity as EvalExpectedFinding["severity"],
    lineHint: row.line_hint,
    required: row.required === 1,
    tags: JSON.parse(row.tags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvalRun(row: EvalRunRow): EvalRun {
  return {
    id: row.id,
    fixtureIds: JSON.parse(row.fixture_ids_json),
    reviewerSlugs: JSON.parse(row.reviewer_slugs_json),
    reviewerReports: JSON.parse(row.reviewer_reports_json),
    mergedReport: JSON.parse(row.merged_report_json),
    judgeResult: JSON.parse(row.judge_result_json),
    judgeProvider: row.judge_provider as EvalRun["judgeProvider"],
    judgeModel: row.judge_model,
    createdAt: row.created_at,
  };
}

interface EvalFixtureRow {
  id: number;
  name: string;
  file_name: string;
  language: string;
  code: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface EvalFindingRow {
  id: number;
  fixture_id: number;
  title: string;
  description: string;
  severity: string;
  line_hint: string;
  required: number;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

interface EvalRunRow {
  id: number;
  fixture_ids_json: string;
  reviewer_slugs_json: string;
  reviewer_reports_json: string;
  merged_report_json: string;
  judge_result_json: string;
  judge_provider: string;
  judge_model: string;
  created_at: string;
}
