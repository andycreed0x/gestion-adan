from datetime import date

import pytest

from gestion_desktop.models import OrderInput, parse_ars_cents


def test_parse_ars_cents_accepts_grouping_and_decimal_comma() -> None:
    assert parse_ars_cents("12.500,50") == 1_250_050


def test_parse_ars_cents_returns_none_for_blank_budget() -> None:
    assert parse_ars_cents("   ") is None


def test_parse_ars_cents_rejects_repeated_decimal_separator() -> None:
    with pytest.raises(ValueError, match="numérico"):
        parse_ars_cents("1,2,3")


def test_order_input_marks_pickup_date_as_picked_up() -> None:
    order = OrderInput(
        customer_name="Ana",
        address="Calle 1",
        phone="11 1234 5678",
        equipment="TV",
        accessories="Control",
        reported_fault="No enciende",
        resolution="Pendiente",
        budget_cents=None,
        received_on=date(2026, 9, 1),
        picked_up_on=date(2026, 9, 2),
    )

    assert order.status == "picked_up"
