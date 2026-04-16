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
SOURCE_FILE = ROOT_DIR / 'docs' / 'SIT IT 20260416.xlsx'
PART_INFO_FILE = ROOT_DIR / 'docs' / 'Juyue-Part info.xlsx'
OUTPUT_FILE = ROOT_DIR / 'docs' / 'outbound-index.json'
TARGET_HEADERS = ('INVOICE', 'PART', 'QTY')
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


def read_rows_with_refs(source_file: Path) -> dict[str, list[str]]:
    """读取 Excel 行，返回 {cell_ref: value} 列表，保留实际列位置。"""
    with zipfile.ZipFile(source_file) as archive:
        shared_strings = load_shared_strings(archive)
        worksheet_path = resolve_first_sheet_path(archive)
        worksheet = ET.fromstring(archive.read(worksheet_path))

    rows: list[dict[str, str]] = []
    for row in worksheet.findall('.//a:sheetData/a:row', NAMESPACE):
        cells: dict[str, str] = {}
        for cell in row.findall('a:c', NAMESPACE):
            ref = cell.attrib.get('r', '')
            col = ''.join(c for c in ref if c.isalpha())
            cells[col] = read_cell_value(cell, shared_strings)
        rows.append(cells)
    return rows


def parse_part_tray_map() -> dict[str, int]:
    """从 Juyue-Part info.xlsx 提取 Part No. → MOQ/PLT 映射。"""
    if not PART_INFO_FILE.exists():
        return {}

    rows = read_rows_with_refs(PART_INFO_FILE)
    part_tray: dict[str, int] = {}

    for row in rows:
        part_no = row.get('F', '').strip()
        moq_str = row.get('H', '').strip()
        if not part_no or not moq_str:
            continue
        try:
            moq = int(float(moq_str))
        except (ValueError, TypeError):
            continue
        if moq > 0:
            part_tray[part_no] = moq

    return part_tray


def build_index(rows: list[list[str]]) -> dict[str, object]:
    if not rows or not rows[0]:
        raise ValueError('Excel 内容为空')

    header = [cell.strip().upper() for cell in rows[0]]
    if header[0] != 'INVOICE':
        raise ValueError(f'首列表头不是 INVOICE，实际为 {rows[0][0]!r}')

    has_part_qty = len(header) >= 3 and header[1] == 'PART' and header[2] == 'QTY'

    shipped_out_codes: list[str] = []
    in_stock_items: dict[str, list[dict[str, object]]] = {}
    invalid_values: list[str] = []

    for row in rows[1:]:
        invoice_raw = row[0] if len(row) > 0 else ''
        if not invoice_raw or not invoice_raw.strip():
            continue

        normalized = normalize_barcode(invoice_raw)
        if not normalized:
            invalid_values.append(invoice_raw)
            continue

        if has_part_qty:
            part = (row[1] if len(row) > 1 else '').strip()
            qty_str = (row[2] if len(row) > 2 else '').strip()

            if part and qty_str:
                qty: int | float | None = None
                try:
                    qty = int(float(qty_str))
                except (ValueError, TypeError):
                    invalid_values.append(f'{invoice_raw} QTY={qty_str}')
                    continue

                if qty is not None and qty > 0:
                    if normalized not in in_stock_items:
                        in_stock_items[normalized] = []
                    in_stock_items[normalized].append({'part': part, 'qty': qty})
                    continue

            shipped_out_codes.append(normalized)
        else:
            shipped_out_codes.append(normalized)

    if invalid_values:
        preview = ', '.join(repr(value) for value in invalid_values[:5])
        raise ValueError(f'发现不符合条码规则的数据：{preview}')

    if not shipped_out_codes and not in_stock_items:
        raise ValueError('未提取到任何有效数据')

    sorted_shipped = sorted(set(shipped_out_codes))
    shipped_plain = [code[2:] for code in sorted_shipped]

    in_stock_plain = [code[2:] for code in sorted(in_stock_items.keys())]

    part_tray_map = parse_part_tray_map()

    return {
        'version': date.today().isoformat(),
        'source': SOURCE_FILE.name,
        'shippedOut': {
            'count': len(sorted_shipped),
            'codes': sorted_shipped,
            'plainCodes': shipped_plain,
        },
        'inStock': {
            'invoiceCount': len(in_stock_items),
            'items': {
                code: items
                for code, items in sorted(in_stock_items.items())
            },
            'plainCodes': in_stock_plain,
        },
        'partTrayMap': part_tray_map,
    }


def main() -> int:
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(f'未找到源文件：{SOURCE_FILE}')

    rows = read_rows(SOURCE_FILE)
    index_data = build_index(rows)
    OUTPUT_FILE.write_text(json.dumps(index_data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已生成 {OUTPUT_FILE}')
    print(f'已出库票数：{index_data["shippedOut"]["count"]}')
    print(f'在库票数：{index_data["inStock"]["invoiceCount"]}')
    print(f'零件托盘映射：{len(index_data["partTrayMap"])} 条')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'生成失败：{error}', file=sys.stderr)
        raise SystemExit(1)
