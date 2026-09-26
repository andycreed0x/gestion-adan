from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

from gestion_desktop.models import (
    LegacyParseResult,
    LegacyRecord,
    OrderInput,
    OrderRecord,
    RejectedLegacyLine,
    format_ars_cents,
    parse_ars_cents,
)

LABELS = (
    "N° Orden",
    "Fecha Ingreso",
    "Cliente",
    "Dir",
    "Tel",
    "Equipo",
    "Accesorios",
    "Falla",
    "Resolución",
    "Presupuesto",
    "Fecha Retiro",
)
LABEL_PATTERN = re.compile(
    r"(?:^|\s\|\s)(" + "|".join(re.escape(label) for label in LABELS) + r"):\s*"
)


class LegacyParseError(ValueError):
    """Raised for a malformed legacy order line."""


def _field_values(line: str) -> dict[str, str]:
    matches = list(LABEL_PATTERN.finditer(line))
    values: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        value = line[start:end].strip()
        if value.endswith("|"):
            value = value[:-1].rstrip()
        values[match.group(1)] = value
    return values


def _parse_date(value: str, *, fallback: date | None = None) -> date | None:
    if not value:
        return fallback
    try:
        return datetime.strptime(value, "%d/%m/%Y").date()
    except ValueError as error:
        raise LegacyParseError(f"Fecha inválida: {value}") from error


def parse_legacy_line(raw_line: str, line_number: int) -> LegacyRecord:
    fields = _field_values(raw_line)
    digits = re.sub(r"\D", "", fields.get("N° Orden", ""))
    if not digits or not fields.get("Cliente") or not fields.get("Equipo"):
        raise LegacyParseError("Orden incompleta o sin número válido")

    received_on = _parse_date(fields.get("Fecha Ingreso", ""), fallback=date.today())
    assert received_on is not None
    picked_up_on = _parse_date(fields.get("Fecha Retiro", ""))
    try:
        budget_cents = parse_ars_cents(fields.get("Presupuesto", ""))
    except ValueError as error:
        raise LegacyParseError(str(error)) from error

    return LegacyRecord(
        line_number=line_number,
        raw_line=raw_line,
        order_number=int(digits),
        order=OrderInput(
            customer_name=fields["Cliente"],
            address=fields.get("Dir", ""),
            phone=fields.get("Tel", ""),
            equipment=fields["Equipo"],
            accessories=fields.get("Accesorios", ""),
            reported_fault=fields.get("Falla", ""),
            resolution=fields.get("Resolución", ""),
            budget_cents=budget_cents,
            received_on=received_on,
            picked_up_on=picked_up_on,
        ),
    )


def parse_legacy_contents(contents: str) -> LegacyParseResult:
    accepted: list[LegacyRecord] = []
    rejected: list[RejectedLegacyLine] = []
    for line_number, raw_line in enumerate(contents.splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            accepted.append(parse_legacy_line(raw_line, line_number))
        except LegacyParseError as error:
            rejected.append(
                RejectedLegacyLine(
                    line_number=line_number,
                    raw_line=raw_line,
                    message=str(error),
                )
            )
    return LegacyParseResult(tuple(accepted), tuple(rejected))


def serialize_legacy_order(record: OrderRecord) -> str:
    order = record.input
    received_on = order.received_on.strftime("%d/%m/%Y")
    picked_up_on = (
        order.picked_up_on.strftime("%d/%m/%Y") if order.picked_up_on else ""
    )
    return (
        f"N° Orden: {record.order_number} | Fecha Ingreso: {received_on} | "
        f"Cliente: {order.customer_name} | Dir: {order.address} | "
        f"Tel: {order.phone} | Equipo: {order.equipment} | "
        f"Accesorios: {order.accessories} | Falla: {order.reported_fault} | "
        f"Resolución: {order.resolution} | Presupuesto: $"
        + format_ars_cents(order.budget_cents)
        + f" | Fecha Retiro: {picked_up_on}\n"
    )


def _sample_records() -> tuple[OrderRecord, OrderRecord]:
    return (
        OrderRecord(
            id="sample-9380",
            order_number=9380,
            input=OrderInput(
                customer_name="Ana Ejemplo",
                address="Calle de prueba 100",
                phone="11 4000 0001",
                equipment="TV LED",
                accessories="Control remoto",
                reported_fault="Sin imagen | sonido normal",
                resolution="Pendiente de diagnóstico",
                budget_cents=None,
                received_on=date(2026, 9, 1),
                picked_up_on=None,
            ),
        ),
        OrderRecord(
            id="sample-9381",
            order_number=9381,
            input=OrderInput(
                customer_name="Bruno Ejemplo",
                address="Avenida de prueba 200",
                phone="11 4000 0002",
                equipment="Notebook",
                accessories="Cargador",
                reported_fault="No inicia",
                resolution="Cambio de disco realizado",
                budget_cents=125_000,
                received_on=date(2026, 9, 2),
                picked_up_on=date(2026, 9, 5),
            ),
        ),
    )


def write_sample_legacy_file(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(serialize_legacy_order(record) for record in _sample_records()),
        encoding="utf-8",
    )
    return path
