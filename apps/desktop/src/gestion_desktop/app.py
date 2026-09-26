from __future__ import annotations

import os
import sys
import webbrowser
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from gestion_desktop.config import ConfigurationError, load_settings
from gestion_desktop.legacy import (
    LegacyParseResult,
    parse_legacy_contents,
    write_sample_legacy_file,
)
from gestion_desktop.models import LegacyRecord, OrderInput, OrderRecord, format_ars_cents, parse_ars_cents
from gestion_desktop.repository import ImportSummary, RepositoryError, SupabaseRepository

DATA_DIRECTORY = Path.home() / "ServicioTecnicoADAN"
BACKUP_TIME = "17:30"
ORDER_STATUSES = ("received", "in_progress", "ready", "picked_up", "cancelled")


@dataclass(frozen=True, slots=True)
class ImportFeedback:
    accepted: int
    rejected: int
    imported: int
    failed_lines: tuple[int, ...]


class OrderController:
    """Testable state and workflow layer shared by the Tkinter callbacks."""

    def __init__(self, repository: Any) -> None:
        self.repository = repository
        self.orders: list[OrderRecord] = []
        self.selected_id: str | None = None
        self._search_index = -1
        self._last_search = ""

    def refresh(self) -> list[OrderRecord]:
        self.orders = self.repository.list_orders()
        self.orders.sort(key=lambda record: record.order_number)
        if self.selected_id and not any(record.id == self.selected_id for record in self.orders):
            self.selected_id = None
        return self.orders

    def set_orders(self, orders: Iterable[OrderRecord]) -> None:
        self.orders = sorted(orders, key=lambda record: record.order_number)
        self.selected_id = None
        self._search_index = -1
        self._last_search = ""

    def next_number_hint(self) -> int:
        return max((record.order_number for record in self.orders), default=9379) + 1

    def select(self, record: OrderRecord | None) -> None:
        self.selected_id = record.id if record else None

    def selected(self) -> OrderRecord | None:
        return next((record for record in self.orders if record.id == self.selected_id), None)

    def find_next(self, term: str) -> OrderRecord | None:
        needle = term.strip().casefold()
        if not needle or not self.orders:
            return None
        if needle != self._last_search:
            self._last_search = needle
            self._search_index = -1
        for _ in range(len(self.orders)):
            self._search_index = (self._search_index + 1) % len(self.orders)
            record = self.orders[self._search_index]
            searchable = " ".join(
                (
                    str(record.order_number),
                    record.input.customer_name,
                    record.input.address,
                    record.input.phone,
                    record.input.equipment,
                    record.input.accessories,
                    record.input.reported_fault,
                    record.input.resolution,
                )
            ).casefold()
            if needle in searchable:
                self.select(record)
                return record
        return None

    def navigate(self, forward: bool) -> OrderRecord | None:
        if not self.orders:
            return None
        current = self.selected()
        if current is None:
            record = self.orders[0 if forward else -1]
            self.select(record)
            return record
        index = self.orders.index(current)
        candidate = index + (1 if forward else -1)
        if candidate < 0 or candidate >= len(self.orders):
            return None
        record = self.orders[candidate]
        self.select(record)
        return record

    def save(self, order: OrderInput) -> OrderRecord:
        current = self.selected()
        saved = (
            self.repository.update_order(current.id, order)
            if current
            else self.repository.create_order(order)
        )
        self.refresh()
        self.selected_id = saved.id
        return saved

    def import_legacy_contents(self, contents: str) -> ImportFeedback:
        return self.import_parsed(parse_legacy_contents(contents))

    def import_parsed(self, parsed: LegacyParseResult) -> ImportFeedback:
        summary: ImportSummary = self.repository.import_legacy(parsed.accepted)
        if summary.imported:
            self.refresh()
        return ImportFeedback(
            accepted=len(parsed.accepted),
            rejected=len(parsed.rejected) + len(summary.failed),
            imported=summary.imported,
            failed_lines=tuple(
                [rejected.line_number for rejected in parsed.rejected]
                + [failed.line_number for failed in summary.failed]
            ),
        )

    def write_backup(self, path: Path) -> Path:
        return self.repository.write_backup(path)


class DesktopApplication:
    def __init__(self, root: tk.Tk, controller: OrderController) -> None:
        self.root = root
        self.controller = controller
        self.status_var = tk.StringVar(value="")
        self.order_number_var = tk.StringVar()
        self.received_on_var = tk.StringVar()
        self.status_choice_var = tk.StringVar(value="received")
        self._last_backup_date: date | None = None

        self.root.title("Servicio Técnico ADAN - Orden de Reparación")
        self.root.geometry("700x980")
        self.root.minsize(700, 820)
        self._build_ui()
        self.new_order()
        self.refresh_list()
        self._schedule_backup()

    def _build_ui(self) -> None:
        header = tk.Frame(self.root, bg="#1E3A8A", pady=8)
        header.pack(fill="x")
        tk.Label(
            header,
            text="SERVICIO TÉCNICO ADAN",
            font=("Arial", 13, "bold"),
            fg="white",
            bg="#1E3A8A",
        ).pack()

        search_frame = tk.Frame(self.root, padx=10, pady=4)
        search_frame.pack(fill="x", padx=10)
        tk.Label(search_frame, text="Buscar:", font=("Arial", 8, "bold")).pack(
            side="left", padx=2
        )
        self.search_entry = tk.Entry(search_frame, width=20, font=("Arial", 8))
        self.search_entry.pack(side="left", padx=2)
        self.search_entry.bind("<Return>", lambda _: self.search_order())
        tk.Button(search_frame, text="Buscar", command=self.search_order).pack(
            side="left", padx=2
        )
        tk.Button(
            search_frame,
            text="Nueva orden",
            command=self.new_order,
            bg="#4CAF50",
            fg="white",
        ).pack(side="left", padx=6)
        tk.Button(search_frame, text="◀ Ant", command=lambda: self.navigate(False)).pack(
            side="left", padx=2
        )
        tk.Button(search_frame, text="Sig ▶", command=lambda: self.navigate(True)).pack(
            side="left", padx=2
        )

        form = tk.LabelFrame(
            self.root,
            text=" ORDEN DE REPARACIÓN ",
            padx=8,
            pady=4,
            font=("Arial", 9, "bold"),
        )
        form.pack(fill="x", padx=10, pady=2)
        top = tk.Frame(form)
        top.grid(row=0, column=0, columnspan=2, sticky="ew", pady=4)
        tk.Label(top, text="N° Orden:", font=("Arial", 11, "bold")).pack(side="left")
        tk.Label(top, textvariable=self.order_number_var, font=("Arial", 12, "bold"), fg="blue").pack(
            side="left", padx=(4, 0)
        )
        tk.Label(top, text="Fecha ingreso:", font=("Arial", 9, "bold")).pack(
            side="right", padx=(0, 4)
        )
        tk.Label(top, textvariable=self.received_on_var, font=("Arial", 9, "bold")).pack(
            side="right", padx=4
        )

        self.name_entry = self._entry(form, 2, "Nombre del cliente:")
        self.address_entry = self._entry(form, 3, "Dirección:")
        self.phone_entry = self._entry(form, 4, "Teléfono de contacto:")
        self.equipment_entry = self._entry(form, 6, "Tipo / marca / modelo:")
        self.accessories_entry = self._entry(form, 7, "Accesorios incluidos:")
        self.fault_text = self._text(form, 9, "Falla reportada:")
        self.resolution_text = self._text(form, 10, "Resolución / reparación:")
        self.budget_entry = self._entry(form, 11, "Presupuesto (ARS):")
        self.pickup_entry = self._entry(form, 12, "Fecha de retiro (Espacio = Hoy):")
        self.pickup_entry.bind("<space>", self._insert_today)

        tk.Label(form, text="Estado:", font=("Arial", 8)).grid(
            row=13, column=0, sticky="w", pady=1
        )
        ttk.Combobox(
            form,
            textvariable=self.status_choice_var,
            values=ORDER_STATUSES,
            state="readonly",
            width=32,
        ).grid(row=13, column=1, sticky="w", pady=1)

        list_frame = tk.LabelFrame(
            self.root,
            text=" Órdenes registradas (clic para cargar) ",
            padx=6,
            pady=4,
            font=("Arial", 8, "bold"),
        )
        list_frame.pack(fill="both", expand=True, padx=10, pady=2)
        scrollbar = tk.Scrollbar(list_frame)
        scrollbar.pack(side="right", fill="y")
        self.order_list = tk.Listbox(
            list_frame,
            height=8,
            yscrollcommand=scrollbar.set,
            font=("Arial", 8),
            exportselection=False,
        )
        self.order_list.pack(side="left", fill="both", expand=True)
        self.order_list.bind("<<ListboxSelect>>", self._load_selected)
        scrollbar.config(command=self.order_list.yview)

        action_frame = tk.Frame(self.root, pady=6)
        action_frame.pack(fill="x", padx=10)
        tk.Button(
            action_frame,
            text="Guardar orden",
            command=lambda: self.save_order(False),
            bg="#4CAF50",
            fg="white",
            width=18,
        ).pack(side="left", expand=True, padx=3)
        tk.Button(
            action_frame,
            text="Guardar e imprimir",
            command=lambda: self.save_order(True),
            bg="#2196F3",
            fg="white",
            width=18,
        ).pack(side="left", expand=True, padx=3)

        import_frame = tk.Frame(self.root, pady=2)
        import_frame.pack(fill="x", padx=10)
        tk.Button(
            import_frame,
            text="Crear archivo de ejemplo",
            command=self.create_sample_file,
        ).pack(side="left", padx=3)
        tk.Button(
            import_frame,
            text="Importar archivo legado",
            command=self.import_legacy_file,
        ).pack(side="left", padx=3)
        tk.Label(self.root, textvariable=self.status_var, fg="#166534", anchor="w").pack(
            fill="x", padx=16, pady=(0, 8)
        )

    @staticmethod
    def _entry(parent: tk.Misc, row: int, label: str) -> tk.Entry:
        tk.Label(parent, text=label, font=("Arial", 8)).grid(
            row=row, column=0, sticky="w", pady=1
        )
        entry = tk.Entry(parent, width=40, font=("Arial", 8))
        entry.grid(row=row, column=1, sticky="w", pady=1)
        return entry

    @staticmethod
    def _text(parent: tk.Misc, row: int, label: str) -> tk.Text:
        tk.Label(parent, text=label, font=("Arial", 8)).grid(
            row=row, column=0, sticky="nw", pady=1
        )
        text = tk.Text(parent, width=40, height=2, font=("Arial", 8))
        text.grid(row=row, column=1, sticky="w", pady=1)
        return text

    def refresh_list(self) -> None:
        self.controller.refresh()
        self.order_list.delete(0, tk.END)
        for record in self.controller.orders:
            pickup = (
                f" | Retirado: {record.input.picked_up_on.strftime('%d/%m/%Y')}"
                if record.input.picked_up_on
                else ""
            )
            self.order_list.insert(
                tk.END,
                f"Orden #{record.order_number} - {record.input.customer_name} - "
                f"{record.input.equipment} ({format_ars_cents(record.input.budget_cents)}){pickup}",
            )

    def new_order(self) -> None:
        self.controller.select(None)
        self.order_number_var.set(str(self.controller.next_number_hint()))
        self.received_on_var.set(date.today().strftime("%d/%m/%Y"))
        self.status_choice_var.set("received")
        for entry in (
            self.name_entry,
            self.address_entry,
            self.phone_entry,
            self.equipment_entry,
            self.accessories_entry,
            self.budget_entry,
            self.pickup_entry,
        ):
            entry.delete(0, tk.END)
        self.fault_text.delete("1.0", tk.END)
        self.resolution_text.delete("1.0", tk.END)
        self.name_entry.focus_set()

    def _load_selected(self, _: object) -> None:
        selected = self.order_list.curselection()
        if selected:
            self.load_order(self.controller.orders[selected[0]])

    def load_order(self, record: OrderRecord) -> None:
        self.controller.select(record)
        self.order_number_var.set(str(record.order_number))
        self.received_on_var.set(record.input.received_on.strftime("%d/%m/%Y"))
        self.status_choice_var.set(record.input.status)
        self._set_entry(self.name_entry, record.input.customer_name)
        self._set_entry(self.address_entry, record.input.address)
        self._set_entry(self.phone_entry, record.input.phone)
        self._set_entry(self.equipment_entry, record.input.equipment)
        self._set_entry(self.accessories_entry, record.input.accessories)
        self._set_entry(self.budget_entry, format_ars_cents(record.input.budget_cents))
        self._set_entry(
            self.pickup_entry,
            record.input.picked_up_on.strftime("%d/%m/%Y")
            if record.input.picked_up_on
            else "",
        )
        self._set_text(self.fault_text, record.input.reported_fault)
        self._set_text(self.resolution_text, record.input.resolution)

    @staticmethod
    def _set_entry(entry: tk.Entry, value: str) -> None:
        entry.delete(0, tk.END)
        entry.insert(0, value)

    @staticmethod
    def _set_text(widget: tk.Text, value: str) -> None:
        widget.delete("1.0", tk.END)
        widget.insert("1.0", value)

    def search_order(self) -> None:
        record = self.controller.find_next(self.search_entry.get())
        if record is None:
            self.notice("No se encontró otra coincidencia.", error=True)
            return
        self.load_order(record)
        self.notice(f"Orden #{record.order_number} encontrada.")

    def navigate(self, forward: bool) -> None:
        record = self.controller.navigate(forward)
        if record is None:
            self.notice("No hay otra orden en esa dirección.", error=True)
            return
        self.load_order(record)

    def _order_from_form(self) -> OrderInput:
        customer = self.name_entry.get().strip()
        equipment = self.equipment_entry.get().strip()
        if not customer or not equipment:
            raise ValueError("El nombre del cliente y el equipo son obligatorios.")
        received_on = datetime.strptime(self.received_on_var.get(), "%d/%m/%Y").date()
        pickup_value = self.pickup_entry.get().strip()
        picked_up_on = (
            datetime.strptime(pickup_value, "%d/%m/%Y").date() if pickup_value else None
        )
        return OrderInput(
            customer_name=customer,
            address=self.address_entry.get().strip(),
            phone=self.phone_entry.get().strip(),
            equipment=equipment,
            accessories=self.accessories_entry.get().strip(),
            reported_fault=self.fault_text.get("1.0", tk.END).strip().replace("\n", " "),
            resolution=self.resolution_text.get("1.0", tk.END).strip().replace("\n", " "),
            budget_cents=parse_ars_cents(self.budget_entry.get()),
            received_on=received_on,
            picked_up_on=picked_up_on,
            status_override=self.status_choice_var.get(),
        )

    def save_order(self, print_ticket: bool) -> None:
        try:
            saved = self.controller.save(self._order_from_form())
            self.refresh_list()
            if print_ticket:
                self._print_ticket(saved)
        except (ValueError, RepositoryError, OSError) as error:
            self.notice(str(error), error=True)
            return
        self.notice(f"Orden #{saved.order_number} guardada correctamente.")
        self.new_order()

    def create_sample_file(self) -> None:
        path = write_sample_legacy_file(DATA_DIRECTORY / "ordenes_servicio_ejemplo.txt")
        self.notice(f"Archivo de ejemplo creado: {path}")

    def import_legacy_file(self) -> None:
        path = filedialog.askopenfilename(
            title="Elegí la base de órdenes anterior",
            filetypes=(("Archivos de órdenes", "*.txt"), ("Todos", "*.*")),
        )
        if not path:
            return
        try:
            parsed = parse_legacy_contents(Path(path).read_text(encoding="utf-8"))
        except OSError as error:
            self.notice(f"No se pudo leer el archivo: {error}", error=True)
            return
        if not parsed.accepted:
            self.notice("El archivo no contiene órdenes válidas.", error=True)
            return
        if not messagebox.askyesno(
            "Importar órdenes",
            f"Se encontraron {len(parsed.accepted)} órdenes válidas y "
            f"{len(parsed.rejected)} rechazadas. ¿Importar las válidas?",
            parent=self.root,
        ):
            return
        try:
            feedback = self.controller.import_parsed(parsed)
            self.refresh_list()
        except RepositoryError as error:
            self.notice(str(error), error=True)
            return
        extra = (
            f" Líneas con error: {', '.join(map(str, feedback.failed_lines))}."
            if feedback.failed_lines
            else ""
        )
        self.notice(
            f"Importadas {feedback.imported}/{feedback.accepted} órdenes."
            f" Rechazadas: {feedback.rejected}.{extra}",
            error=bool(feedback.rejected),
        )

    def _schedule_backup(self) -> None:
        now = datetime.now()
        if (
            now.weekday() <= 4
            and now.strftime("%H:%M") == BACKUP_TIME
            and self._last_backup_date != now.date()
        ):
            try:
                self.controller.write_backup(
                    DATA_DIRECTORY / "Backups" / self._weekday_name(now.weekday()) / "ordenes_servicio.txt"
                )
                self._last_backup_date = now.date()
                self.notice("Copia de seguridad automática creada.")
            except Exception as error:
                self.notice(f"No se pudo crear la copia automática: {error}", error=True)
        self.root.after(30_000, self._schedule_backup)

    @staticmethod
    def _weekday_name(weekday: int) -> str:
        return ("Lunes", "Martes", "Miercoles", "Jueves", "Viernes")[weekday]

    def _insert_today(self, _: object) -> str:
        self._set_entry(self.pickup_entry, date.today().strftime("%d/%m/%Y"))
        return "break"

    def _print_ticket(self, record: OrderRecord) -> None:
        DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
        path = DATA_DIRECTORY / f"orden_reparacion_{record.order_number}.txt"
        order = record.input
        lines = (
            "=== SERVICIO TÉCNICO ADAN ===",
            "25 de Mayo 1231, San Fernando | Tel: (011) 4744-7009",
            "CUIT: 20-23694564-3 | Ingresos Brutos: 20-23694564-3",
            "--------------------------------------------------",
            f"N° Orden: {record.order_number}",
            f"Fecha Ingreso: {order.received_on.strftime('%d/%m/%Y')}",
            f"Cliente: {order.customer_name}",
            f"Dir: {order.address}",
            f"Tel: {order.phone}",
            f"Equipo: {order.equipment}",
            f"Accesorios: {order.accessories}",
            f"Falla: {order.reported_fault}",
            f"Resolución: {order.resolution}",
            "Presupuesto: $" + format_ars_cents(order.budget_cents),
            "Fecha Retiro: "
            + (order.picked_up_on.strftime("%d/%m/%Y") if order.picked_up_on else ""),
            "--------------------------------------------------",
            "Términos y Condiciones:",
            "- Validez del presupuesto: 30 días corridos.",
            "- Retiro: Pasados los 90 días el equipo se considera abandonado.",
        )
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        if sys.platform.startswith("win") and hasattr(os, "startfile"):
            os.startfile(str(path), "print")
        else:
            webbrowser.open(path.as_uri())

    def notice(self, message: str, *, error: bool = False) -> None:
        self.status_var.set(message)
        self.root.after(5_000, lambda: self.status_var.set(""))
        if error:
            self.root.bell()


def main() -> None:
    root = tk.Tk()
    try:
        project_root = Path(__file__).resolve().parents[4]
        repository = SupabaseRepository(load_settings(project_root))
        controller = OrderController(repository)
        controller.refresh()
    except (ConfigurationError, RepositoryError, OSError, Exception) as error:
        messagebox.showerror("No se pudo iniciar", str(error), parent=root)
        root.destroy()
        return
    DesktopApplication(root, controller)
    root.mainloop()
