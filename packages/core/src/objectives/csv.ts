import {
  objectiveStatus,
  type CreateKeyResultInput,
  type CreateObjectiveInput,
  type ObjectiveImportError,
  type ObjectiveStatus,
} from '@palouse/shared';

const STATUS_VALUES = objectiveStatus.options;

/** Guardrail so a pathological file can't spin up an unbounded number of inserts. */
const MAX_DATA_ROWS = 5000;

/**
 * Parse CSV text into rows of string cells. Handles quoted fields (with embedded
 * commas and newlines), doubled quotes as an escaped quote, a leading BOM, and
 * both CRLF and LF line endings. Deliberately small and dependency-free.
 */
function parseCsvRows(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the final field/row when the file has no trailing newline.
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase();

/**
 * Parse a Palouse objectives CSV into create-ready inputs. The format is one row
 * per key result, with objective-level columns repeated; rows are grouped into a
 * single objective by their `objective_title`. The first row for a title sets
 * that objective's fields; each row with a `kr_name` adds a key result. A row
 * with a title and no `kr_name` yields an objective with no key results.
 *
 * Invalid rows are collected as errors (with their spreadsheet row number) and
 * skipped rather than aborting the whole import.
 */
export function parseObjectivesCsv(csv: string): {
  objectives: CreateObjectiveInput[];
  errors: ObjectiveImportError[];
} {
  const errors: ObjectiveImportError[] = [];
  const rows = parseCsvRows(csv);
  if (rows.length === 0 || rows.every((r) => r.every((c) => c.trim() === ''))) {
    return { objectives: [], errors: [{ row: 0, message: 'The file is empty.' }] };
  }
  if (rows.length - 1 > MAX_DATA_ROWS) {
    return {
      objectives: [],
      errors: [{ row: 0, message: `Too many rows (max ${MAX_DATA_ROWS}). Split the file.` }],
    };
  }

  const header = rows[0]!.map(norm);
  const idx = (name: string) => header.indexOf(name);
  const titleIdx = idx('objective_title') !== -1 ? idx('objective_title') : idx('title');
  if (titleIdx === -1) {
    return {
      objectives: [],
      errors: [{ row: 1, message: "Missing a required 'objective_title' column." }],
    };
  }
  const descIdx = idx('description') !== -1 ? idx('description') : idx('objective_description');
  const areaIdx = idx('area');
  const statusIdx = idx('status');
  const targetIdx = idx('target_date');
  const krNameIdx = idx('kr_name');
  const krStartIdx = idx('kr_start');
  const krTargetIdx = idx('kr_target');
  const krCurrentIdx = idx('kr_current');
  const krUnitIdx = idx('kr_unit');

  const byTitle = new Map<string, CreateObjectiveInput>();
  const order: string[] = [];

  for (let d = 1; d < rows.length; d++) {
    const cells = rows[d]!;
    if (cells.every((c) => c.trim() === '')) continue; // skip blank lines
    const rowNum = d + 1; // 1-based spreadsheet row (header is row 1)
    const get = (i: number) => (i >= 0 && i < cells.length ? cells[i]!.trim() : '');

    const title = get(titleIdx);
    if (!title) {
      errors.push({ row: rowNum, message: 'Missing objective_title.' });
      continue;
    }

    let status: ObjectiveStatus | undefined;
    const statusRaw = get(statusIdx);
    if (statusRaw) {
      const candidate = statusRaw.toLowerCase().replace(/\s+/g, '_');
      if (!STATUS_VALUES.includes(candidate as ObjectiveStatus)) {
        errors.push({
          row: rowNum,
          message: `Invalid status "${statusRaw}". Use one of: ${STATUS_VALUES.join(', ')}.`,
        });
        continue;
      }
      status = candidate as ObjectiveStatus;
    }

    let targetDate: string | null = null;
    const targetRaw = get(targetIdx);
    if (targetRaw) {
      const dt = new Date(targetRaw);
      if (Number.isNaN(dt.getTime())) {
        errors.push({
          row: rowNum,
          message: `Invalid target_date "${targetRaw}". Use YYYY-MM-DD.`,
        });
        continue;
      }
      targetDate = dt.toISOString();
    }

    let kr: CreateKeyResultInput | null = null;
    const krName = get(krNameIdx);
    if (krName) {
      const targetStr = get(krTargetIdx);
      const target = Number(targetStr);
      if (targetStr === '' || Number.isNaN(target)) {
        errors.push({ row: rowNum, message: `Key result "${krName}" needs a numeric kr_target.` });
        continue;
      }
      const startStr = get(krStartIdx);
      const start = startStr === '' ? 0 : Number(startStr);
      if (Number.isNaN(start)) {
        errors.push({ row: rowNum, message: `Invalid kr_start "${startStr}".` });
        continue;
      }
      const currentStr = get(krCurrentIdx);
      let current: number | undefined;
      if (currentStr !== '') {
        current = Number(currentStr);
        if (Number.isNaN(current)) {
          errors.push({ row: rowNum, message: `Invalid kr_current "${currentStr}".` });
          continue;
        }
      }
      kr = {
        name: krName,
        startValue: start,
        targetValue: target,
        currentValue: current,
        unit: get(krUnitIdx) || null,
      };
    }

    let obj = byTitle.get(title);
    if (!obj) {
      obj = {
        title,
        descriptionMd: get(descIdx) || null,
        area: get(areaIdx) || null,
        status,
        targetDate,
        keyResults: [],
      };
      byTitle.set(title, obj);
      order.push(title);
    }
    if (kr) obj.keyResults!.push(kr);
  }

  return { objectives: order.map((t) => byTitle.get(t)!), errors };
}
