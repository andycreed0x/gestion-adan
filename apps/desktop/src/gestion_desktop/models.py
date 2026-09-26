from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Literal

OrderStatus = Literal["received", "in_progress", "ready", "picked_up", "cancelled"]


def parse_ars_cents(value: str) -> int | None:
    """Parse a non-negative ARS amount into integer cents."""
    compact = value.replace("$", "").replace(" ", "")
    if not compact:
        return None
    if not re.fullmatch(r"\d+(?:[.,]\d+)*", compact):
        raise ValueError("El presupuesto debe ser numérico")

    comma = compact.rfind(",")
    dot = compact.rfind(".")
    decimal_index = max(comma, dot)
    decimal_separator: str | None = None
    if decimal_index >= 0 and len(compact) - decimal_index - 1 <= 2:
        decimal_separator = compact[decimal_index]

    if decimal_separator:
        integer_part, fraction = compact.rsplit(decimal_separator, 1)
        if not fraction or not fraction.isdigit() or len(fraction) > 2:
            raise ValueError("El presupuesto admite como máximo dos decimales")
        if decimal_separator in integer_part:
            raise ValueError("El presupuesto debe ser numérico")
        normalized = (
            integer_part.replace(".", "").replace(",", "")
            + "."
            + fraction.ljust(2, "0")
        )
    else:
        normalized = compact.replace(".", "").replace(",", "")

    try:
        cents = (Decimal(normalized) * 100).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    except InvalidOperation as error:
        raise ValueError("El presupuesto debe ser numérico") from error
    if cents < 0:
        raise ValueError("El presupuesto debe ser positivo")
    return int(cents)


def format_ars_cents(cents: int | None) -> str:
    if cents is None:
        return ""
    if cents < 0:
        raise ValueError("El presupuesto debe ser positivo")
    whole, fraction = divmod(cents, 100)
    grouped = f"{whole:,}".replace(",", ".")
    return f"{grouped},{fraction:02d}"


@dataclass(frozen=True, slots=True)
class OrderInput:
    customer_name: str
    address: str
    phone: str
    equipment: str
    accessories: str
    reported_fault: str
    resolution: str
    budget_cents: int | None
    received_on: date
    picked_up_on: date | None
    status_override: OrderStatus | None = None

    @property
    def status(self) -> OrderStatus:
        if self.picked_up_on is not None:
            return "picked_up"
        return self.status_override or "received"


@dataclass(frozen=True, slots=True)
class OrderRecord:
    id: str
    order_number: int
    input: OrderInput


@dataclass(frozen=True, slots=True)
class LegacyRecord:
    line_number: int
    raw_line: str
    order_number: int
    order: OrderInput


@dataclass(frozen=True, slots=True)
class RejectedLegacyLine:
    line_number: int
    raw_line: str
    message: str


@dataclass(frozen=True, slots=True)
class LegacyParseResult:
    accepted: tuple[LegacyRecord, ...]
    rejected: tuple[RejectedLegacyLine, ...]
