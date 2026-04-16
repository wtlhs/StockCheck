#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_FILE = ROOT_DIR / 'docs' / 'SIT IT.xlsx'
OUTPUT_FILE = ROOT_DIR / 'docs' / 'outbound-index.json'
TARGET_HEADER = 'INVOICE'
NAMESPACE = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
PACKAGE_NAMESPACE = {'p': 'http://schemas.openxmlformats.org/package/2006/relationships'}
OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
BARCODE_PATTERN = re.compile(r'^(?:JY)?\d{7}$')


def normalize_barcode(value: str) -> str | None:
    normalized = re.sub(r'\s+', '', value).upper()
    if not normalized or not BARCODE_PATTERN.fullmatch(normalized):
        return None
    if normalized.startswith('JY'):
        return normalized
    return 'JY' + normalized


def load_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if 'xl/sharedStrings.xml' not in archive.namelist():
        return []

    root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
    shared_strings: list[str] = []
    for item in root.findall('a:si', NAMESPACE):
        parts = [text.text or '' for text in item.findall('.//a:t', NAMESPACE)]
        shared_strings.append(''.join(parts))
    return shared_strings


def resolve_first_sheet_path(archive: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    relationship_map = {
        rel.attrib['Id']: rel.attrib['Target']
        for rel in relationships.findall('p:Relationship', PACKAGE_NAMESPACE)
    }
    sheets = workbook.find('a:sheets', NAMESPACE)
    if sheets is None or not list(sheets):
        raise ValueError('Excel 中未找到工作表')

    first_sheet = list(sheets)[0]
    relation_id = first_sheet.attrib.get(f'{{{OFFICE_REL_NS}}}id')
    if not relation_id or relation_id not in relationship_map:
        raise ValueError('无法解析首个工作表路径')

    return 'xl/' + relationship_map[relation_id]


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    value = cell.find('a:v', NAMESPACE)
    if value is None or value.text is None:
        return ''

    cell_type = cell.attrib.get('t')
    if cell_type == 's':
        return shared_strings[int(value.text)]
    return value.text


def read_rows(source_file: Path) -> list[list[str]]:
    with zipfile.ZipFile(source_file) as archive:
        shared_strings = load_shared_strings(archive)
        worksheet_path = resolve_first_sheet_path(archive)
        worksheet = ET.fromstring(archive.read(worksheet_path))

    rows: list[list[str]] = []
    for row in worksheet.findall('.//a:sheetData/a:row', NAMESPACE):
        rows.append([read_cell_value(cell, shared_strings) for cell in row.findall('a:c', NAMESPACE)])
    return rows


def build_index(rows: list[list[str]]) -> dict[str, object]:
    if not rows or not rows[0]:
        raise ValueError('Excel 内容为空')

    header = (rows[0][0] or '').strip().upper()
    if header != TARGET_HEADER:
        raise ValueError(f'首列表头不是 {TARGET_HEADER}，实际为 {rows[0][0]!r}')

    normalized_codes: list[str] = []
    invalid_values: list[str] = []
    for row in rows[1:]:
        raw_value = row[0] if row else ''
        if not raw_value or not raw_value.strip():
            continue
        normalized = normalize_barcode(raw_value)
        if not normalized:
            invalid_values.append(raw_value)
            continue
        normalized_codes.append(normalized)

    if invalid_values:
        preview = ', '.join(repr(value) for value in invalid_values[:5])
        raise ValueError(f'发现不符合条码规则的数据：{preview}')

    if not normalized_codes:
        raise ValueError('未提取到任何有效条码')

    sorted_codes = sorted(normalized_codes)
    plain_codes = [code[2:] for code in sorted_codes]
    return {
        'version': date.today().isoformat(),
        'source': SOURCE_FILE.name,
        'count': len(sorted_codes),
        'codes': sorted_codes,
        'plainCodes': plain_codes,
    }


def main() -> int:
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(f'未找到源文件：{SOURCE_FILE}')

    rows = read_rows(SOURCE_FILE)
    index_data = build_index(rows)
    OUTPUT_FILE.write_text(json.dumps(index_data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已生成 {OUTPUT_FILE}')
    print(f'索引条数：{index_data["count"]}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'生成失败：{error}', file=sys.stderr)
        raise SystemExit(1)
