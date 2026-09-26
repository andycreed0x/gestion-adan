from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from gestion_desktop.legacy import parse_legacy_contents, write_sample_legacy_file
from gestion_desktop.models import LegacyRecord, OrderInput
from gestion_desktop.repository import SupabaseRepository


@dataclass
class Response:
    data: list[dict[str, Any]]


class FakeQuery:
    def __init__(self, client: "FakeSupabaseClient", table_name: str) -> None:
        self.client = client
        self.table_name = table_name
        self.action = "select"
        self.payload: dict[str, Any] | None = None
        self.filters: list[tuple[str, Any]] = []
        self.select_expression = ""
        self.limit_value: int | None = None
        self.order_column = ""

    def select(self, expression: str) -> "FakeQuery":
        self.select_expression = expression
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self.filters.append((column, value))
        return self

    def limit(self, value: int) -> "FakeQuery":
        self.limit_value = value
        return self

    def order(self, column: str, **_: Any) -> "FakeQuery":
        self.order_column = column
        return self

    def insert(self, payload: dict[str, Any]) -> "FakeQuery":
        self.action = "insert"
        self.payload = payload
        return self

    def update(self, payload: dict[str, Any]) -> "FakeQuery":
        self.action = "update"
        self.payload = payload
        return self

    def upsert(self, payload: dict[str, Any], **_: Any) -> "FakeQuery":
        self.action = "upsert"
        self.payload = payload
        return self

    def execute(self) -> Response:
        self.client.requests.append(
            (self.action, self.table_name, deepcopy(self.payload), tuple(self.filters))
        )
        rows = self.client.rows[self.table_name]
        selected = [
            row
            for row in rows
            if all(row.get(column) == value for column, value in self.filters)
        ]
        if self.action == "select":
            selected = deepcopy(selected)
            if self.table_name == "repair_orders" and "customers(" in self.select_expression:
                for row in selected:
                    row["customers"] = deepcopy(
                        next(
                            customer
                            for customer in self.client.rows["customers"]
                            if customer["id"] == row["customer_id"]
                        )
                    )
            if self.order_column:
                selected.sort(key=lambda row: row[self.order_column])
            if self.limit_value is not None:
                selected = selected[: self.limit_value]
            return Response(selected)

        assert self.payload is not None
        if self.action == "insert":
            row = deepcopy(self.payload)
            row.setdefault("id", f"{self.table_name}-{len(rows) + 1}")
            if self.table_name == "repair_orders":
                row.setdefault(
                    "order_number",
                    max((order["order_number"] for order in rows), default=9379) + 1,
                )
            rows.append(row)
            return Response([deepcopy(row)])

        if self.action == "update":
            for row in selected:
                row.update(self.payload)
            return Response(deepcopy(selected))

        if self.action == "upsert":
            if self.payload.get("order_number") in self.client.fail_order_numbers:
                raise RuntimeError("remote insert failed")
            existing = next(
                (
                    row
                    for row in rows
                    if row.get("order_number") == self.payload.get("order_number")
                ),
                None,
            )
            if existing:
                existing.update(self.payload)
                return Response([deepcopy(existing)])
            return self.insert(self.payload).execute()

        raise AssertionError(f"Unsupported action: {self.action}")


class FakeSupabaseClient:
    def __init__(self) -> None:
        self.rows: dict[str, list[dict[str, Any]]] = {
            "customers": [
                {
                    "id": "customer-1",
                    "full_name": "Ana",
                    "address": "Calle 1",
                    "phone": "11 1111",
                }
            ],
            "repair_orders": [
                {
                    "id": "order-1",
                    "order_number": 9380,
                    "customer_id": "customer-1",
                    "equipment": "TV",
                    "accessories": "",
                    "reported_fault": "No enciende",
                    "resolution": "",
                    "budget_cents": None,
                    "status": "received",
                    "received_on": "2026-09-01",
                    "picked_up_on": None,
                }
            ],
        }
        self.requests: list[tuple[str, str, dict[str, Any] | None, tuple[tuple[str, Any], ...]]] = []
        self.fail_order_numbers: set[int] = set()

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(self, table_name)


def make_input(**changes: Any) -> OrderInput:
    values: dict[str, Any] = {
        "customer_name": "Ana",
        "address": "Calle 1",
        "phone": "11 1111",
        "equipment": "TV",
        "accessories": "Control",
        "reported_fault": "No enciende",
        "resolution": "Pendiente",
        "budget_cents": 100_000,
        "received_on": date(2026, 9, 1),
        "picked_up_on": None,
    }
    values.update(changes)
    return OrderInput(**values)


def test_create_order_uses_database_number_and_existing_customer() -> None:
    client = FakeSupabaseClient()
    repository = SupabaseRepository(client=client)

    created = repository.create_order(make_input())

    insert = next(
        request
        for request in client.requests
        if request[0] == "insert" and request[1] == "repair_orders"
    )
    assert "order_number" not in (insert[2] or {})
    assert created.order_number == 9381
    assert created.input.customer_name == "Ana"


def test_update_order_targets_selected_order_and_current_customer() -> None:
    client = FakeSupabaseClient()
    repository = SupabaseRepository(client=client)

    updated = repository.update_order(
        "order-1",
        make_input(customer_name="Ana Actualizada", address="Calle 2"),
    )

    customer_update = next(
        request
        for request in client.requests
        if request[0] == "update" and request[1] == "customers"
    )
    order_update = next(
        request
        for request in client.requests
        if request[0] == "update" and request[1] == "repair_orders"
    )
    assert customer_update[3] == (("id", "customer-1"),)
    assert order_update[3] == (("id", "order-1"),)
    assert updated.input.address == "Calle 2"


def test_import_upserts_legacy_numbers_and_reports_later_failure() -> None:
    client = FakeSupabaseClient()
    client.fail_order_numbers.add(9382)
    repository = SupabaseRepository(client=client)
    first = LegacyRecord(1, "first", 9381, make_input(customer_name="Bea", phone="11 2222"))
    failing = LegacyRecord(2, "bad", 9382, make_input(customer_name="Caro", phone="11 3333"))
    later = LegacyRecord(3, "later", 9383, make_input(customer_name="Dani", phone="11 4444"))

    summary = repository.import_legacy([first, failing, later])
    retry_summary = repository.import_legacy([first])

    assert summary.imported == 2
    assert summary.failed[0].line_number == 2
    assert retry_summary.imported == 1
    assert [row["order_number"] for row in client.rows["repair_orders"]] == [9380, 9381, 9383]


def test_imports_the_generated_legacy_sample(tmp_path: Path) -> None:
    sample_path = write_sample_legacy_file(tmp_path / "ordenes_servicio.txt")
    parsed = parse_legacy_contents(sample_path.read_text(encoding="utf-8"))
    client = FakeSupabaseClient()

    summary = SupabaseRepository(client=client).import_legacy(parsed.accepted)

    assert parsed.rejected == ()
    assert summary.imported == 2
    assert summary.failed == ()
    assert [row["order_number"] for row in client.rows["repair_orders"]] == [9380, 9381]


def test_write_backup_queries_orders_and_writes_legacy_text(tmp_path: Path) -> None:
    client = FakeSupabaseClient()
    repository = SupabaseRepository(client=client)
    output = tmp_path / "Backups" / "Lunes" / "ordenes_servicio.txt"

    saved = repository.write_backup(output)

    assert saved == output
    assert "N° Orden: 9380" in output.read_text(encoding="utf-8")
    assert any(
        request[0] == "select" and request[1] == "repair_orders"
        for request in client.requests
    )
