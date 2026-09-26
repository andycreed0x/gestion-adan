from __future__ import annotations

from datetime import date
from typing import Iterable

from gestion_desktop.app import OrderController
from gestion_desktop.models import LegacyRecord, OrderInput, OrderRecord
from gestion_desktop.repository import ImportSummary


def make_order(number: int, customer_name: str) -> OrderRecord:
    return OrderRecord(
        id=f"order-{number}",
        order_number=number,
        input=OrderInput(
            customer_name=customer_name,
            address="Calle 1",
            phone="11 1111",
            equipment="TV",
            accessories="",
            reported_fault="No enciende",
            resolution="",
            budget_cents=None,
            received_on=date(2026, 9, 1),
            picked_up_on=None,
        ),
    )


class FakeRepository:
    def __init__(self, orders: list[OrderRecord]) -> None:
        self.orders = orders
        self.refreshes = 0
        self.created: list[OrderInput] = []

    def list_orders(self) -> list[OrderRecord]:
        self.refreshes += 1
        return list(self.orders)

    def create_order(self, order: OrderInput) -> OrderRecord:
        self.created.append(order)
        created = make_order(9390, order.customer_name)
        self.orders.append(created)
        return created

    def update_order(self, order_id: str, order: OrderInput) -> OrderRecord:
        return next(item for item in self.orders if item.id == order_id)

    def import_legacy(self, records: Iterable[LegacyRecord]) -> ImportSummary:
        accepted = tuple(records)
        return ImportSummary(accepted, ())


def test_search_cycles_through_refreshed_order_cache() -> None:
    repository = FakeRepository([make_order(9380, "Ana"), make_order(9381, "Ana María")])
    controller = OrderController(repository)
    controller.refresh()

    first = controller.find_next("ana")
    second = controller.find_next("ana")

    assert first.order_number == 9380
    assert second.order_number == 9381


def test_save_refreshes_cache_after_creating_an_order() -> None:
    repository = FakeRepository([make_order(9380, "Ana")])
    controller = OrderController(repository)
    controller.refresh()

    saved = controller.save(make_order(9389, "Bea").input)

    assert saved.order_number == 9390
    assert repository.refreshes == 2
    assert controller.selected_id == "order-9390"


def test_import_feedback_includes_parsed_counts() -> None:
    repository = FakeRepository([make_order(9380, "Ana")])
    controller = OrderController(repository)

    feedback = controller.import_legacy_contents(
        "línea inválida\n"
        "N° Orden: 9381 | Fecha Ingreso: 01/09/2026 | Cliente: Bea | Equipo: Radio\n"
    )

    assert feedback.accepted == 1
    assert feedback.rejected == 1
    assert feedback.imported == 1
