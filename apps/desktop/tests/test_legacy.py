from datetime import date

from gestion_desktop.legacy import (
    parse_legacy_contents,
    serialize_legacy_order,
    write_sample_legacy_file,
)
from gestion_desktop.models import OrderInput, OrderRecord


def test_parser_preserves_pipe_in_reported_fault() -> None:
    parsed = parse_legacy_contents(
        "N° Orden: 9380 | Fecha Ingreso: 01/09/2026 | Cliente: Ana | "
        "Equipo: TV | Falla: Sin imagen | intermitente | Resolución: Pendiente\n"
    )

    assert len(parsed.accepted) == 1
    assert parsed.accepted[0].order.reported_fault == "Sin imagen | intermitente"


def test_parser_rejects_invalid_line_without_stopping_other_records() -> None:
    parsed = parse_legacy_contents(
        "línea inválida\n"
        "N° Orden: 9381 | Fecha Ingreso: 01/09/2026 | Cliente: Bea | Equipo: Radio\n"
    )

    assert [record.order_number for record in parsed.accepted] == [9381]
    assert parsed.rejected[0].line_number == 1


def test_sample_file_contains_deterministic_open_and_picked_up_orders(tmp_path) -> None:
    path = write_sample_legacy_file(tmp_path / "ordenes_servicio_ejemplo.txt")
    parsed = parse_legacy_contents(path.read_text(encoding="utf-8"))

    assert [record.order_number for record in parsed.accepted] == [9380, 9381]
    assert [record.order.status for record in parsed.accepted] == ["received", "picked_up"]


def test_serialize_legacy_order_round_trips_supported_fields() -> None:
    order = OrderRecord(
        id="order-id",
        order_number=9382,
        input=OrderInput(
            customer_name="Carla",
            address="Av. Siempre Viva 123",
            phone="11 9999 1111",
            equipment="Notebook",
            accessories="Cargador",
            reported_fault="No inicia",
            resolution="Cambio de disco",
            budget_cents=1_250_050,
            received_on=date(2026, 9, 3),
            picked_up_on=None,
        ),
    )

    serialized = serialize_legacy_order(order)

    assert "N° Orden: 9382" in serialized
    assert "Fecha Ingreso: 03/09/2026" in serialized
    assert "Presupuesto: $12.500,50" in serialized
    assert "Fecha Retiro:" in serialized
