from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from supabase import create_client

from gestion_desktop.config import Settings
from gestion_desktop.legacy import serialize_legacy_order
from gestion_desktop.models import LegacyRecord, OrderInput, OrderRecord


class RepositoryError(RuntimeError):
    """Raised when an online order operation cannot be completed."""


@dataclass(frozen=True, slots=True)
class ImportFailure:
    line_number: int
    message: str


@dataclass(frozen=True, slots=True)
class ImportSummary:
    imported_records: tuple[LegacyRecord, ...]
    failed: tuple[ImportFailure, ...]

    @property
    def imported(self) -> int:
        return len(self.imported_records)


class SupabaseRepository:
    def __init__(self, settings: Settings | None = None, client: Any | None = None) -> None:
        if client is None:
            if settings is None:
                raise ValueError("settings is required when no Supabase client is supplied")
            client = create_client(settings.url, settings.secret_key)
        self.client = client

    def list_orders(self) -> list[OrderRecord]:
        response = (
            self.client.table("repair_orders")
            .select(
                "id,order_number,customer_id,equipment,accessories,reported_fault,"
                "resolution,budget_cents,status,received_on,picked_up_on,"
                "customers(full_name,address,phone)"
            )
            .order("order_number")
            .execute()
        )
        return [self._record_from_row(row) for row in self._rows(response)]

    def create_order(self, order: OrderInput) -> OrderRecord:
        customer_id = self._resolve_customer(order)
        response = (
            self.client.table("repair_orders")
            .insert(self._order_payload(order, customer_id))
            .execute()
        )
        row = self._one(response, "No se pudo crear la orden")
        return OrderRecord(
            id=str(row["id"]),
            order_number=int(row["order_number"]),
            input=order,
        )

    def update_order(self, order_id: str, order: OrderInput) -> OrderRecord:
        current_response = (
            self.client.table("repair_orders")
            .select("id,order_number,customer_id")
            .eq("id", order_id)
            .limit(1)
            .execute()
        )
        current = self._one(current_response, "No se encontró la orden seleccionada")
        customer_id = str(current["customer_id"])

        (
            self.client.table("customers")
            .update(self._customer_payload(order))
            .eq("id", customer_id)
            .execute()
        )
        (
            self.client.table("repair_orders")
            .update(self._order_payload(order, customer_id))
            .eq("id", order_id)
            .execute()
        )
        return OrderRecord(
            id=order_id,
            order_number=int(current["order_number"]),
            input=order,
        )

    def import_legacy(self, records: Iterable[LegacyRecord]) -> ImportSummary:
        imported: list[LegacyRecord] = []
        failed: list[ImportFailure] = []
        for record in records:
            try:
                customer_id = self._resolve_customer(record.order)
                payload = self._order_payload(record.order, customer_id)
                payload["order_number"] = record.order_number
                (
                    self.client.table("repair_orders")
                    .upsert(payload, on_conflict="order_number")
                    .execute()
                )
                imported.append(record)
            except Exception as error:
                failed.append(ImportFailure(record.line_number, str(error)))
        return ImportSummary(tuple(imported), tuple(failed))

    def write_backup(self, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.tmp")
        temporary.write_text(
            "".join(serialize_legacy_order(record) for record in self.list_orders()),
            encoding="utf-8",
        )
        temporary.replace(destination)
        return destination

    def _resolve_customer(self, order: OrderInput) -> str:
        response = (
            self.client.table("customers")
            .select("id")
            .eq("full_name", order.customer_name)
            .eq("phone", order.phone)
            .limit(1)
            .execute()
        )
        existing = self._rows(response)
        if existing:
            customer_id = str(existing[0]["id"])
            (
                self.client.table("customers")
                .update(self._customer_payload(order))
                .eq("id", customer_id)
                .execute()
            )
            return customer_id

        response = self.client.table("customers").insert(self._customer_payload(order)).execute()
        return str(self._one(response, "No se pudo crear el cliente")["id"])

    @staticmethod
    def _customer_payload(order: OrderInput) -> dict[str, str]:
        return {
            "full_name": order.customer_name,
            "address": order.address,
            "phone": order.phone,
        }

    @staticmethod
    def _order_payload(order: OrderInput, customer_id: str) -> dict[str, object]:
        return {
            "customer_id": customer_id,
            "equipment": order.equipment,
            "accessories": order.accessories,
            "reported_fault": order.reported_fault,
            "resolution": order.resolution,
            "budget_cents": order.budget_cents,
            "status": order.status,
            "received_on": order.received_on.isoformat(),
            "picked_up_on": order.picked_up_on.isoformat() if order.picked_up_on else None,
        }

    @staticmethod
    def _rows(response: Any) -> list[dict[str, Any]]:
        data = getattr(response, "data", response)
        if data is None:
            return []
        if not isinstance(data, list):
            raise RepositoryError("La respuesta de Supabase no contiene una lista")
        return data

    def _one(self, response: Any, message: str) -> dict[str, Any]:
        rows = self._rows(response)
        if not rows:
            raise RepositoryError(message)
        return rows[0]

    @staticmethod
    def _record_from_row(row: dict[str, Any]) -> OrderRecord:
        customer = row.get("customers") or {}
        if isinstance(customer, list):
            customer = customer[0] if customer else {}
        picked_up_raw = row.get("picked_up_on")
        picked_up_on = date.fromisoformat(picked_up_raw) if picked_up_raw else None
        return OrderRecord(
            id=str(row["id"]),
            order_number=int(row["order_number"]),
            input=OrderInput(
                customer_name=str(customer.get("full_name", "")),
                address=str(customer.get("address", "")),
                phone=str(customer.get("phone", "")),
                equipment=str(row["equipment"]),
                accessories=str(row.get("accessories", "")),
                reported_fault=str(row.get("reported_fault", "")),
                resolution=str(row.get("resolution", "")),
                budget_cents=row.get("budget_cents"),
                received_on=date.fromisoformat(str(row["received_on"])),
                picked_up_on=picked_up_on,
                status_override=row.get("status"),
            ),
        )
