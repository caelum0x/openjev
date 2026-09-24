"""Deprecated alias: ``import opentypesafe_adapter`` now resolves to :mod:`openjev_adapters`.

The project was renamed from opentypesafe to OpenJev. This shim keeps old
imports (including submodules such as ``opentypesafe_adapter._core``) working by
mapping every ``opentypesafe_adapter.*`` name onto the matching ``openjev_adapters.*`` module.
Prefer ``import openjev_adapters`` in new code.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.machinery
import importlib.util
import sys
import warnings
from types import ModuleType

_OLD = "opentypesafe_adapter"
_NEW = "openjev_adapters"


class _AliasFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Serve ``opentypesafe_adapter.X`` imports from the already-renamed ``openjev_adapters.X`` modules."""

    def find_spec(
        self, fullname: str, path: object = None, target: object = None
    ) -> importlib.machinery.ModuleSpec | None:
        if fullname.startswith(_OLD + "."):
            return importlib.util.spec_from_loader(fullname, self)
        return None

    def create_module(self, spec: importlib.machinery.ModuleSpec) -> ModuleType:
        return importlib.import_module(_NEW + spec.name[len(_OLD) :])

    def exec_module(self, module: ModuleType) -> None:
        return None


warnings.warn(
    f"'{_OLD}' was renamed to '{_NEW}'; import '{_NEW}' instead.",
    DeprecationWarning,
    stacklevel=2,
)

if not any(isinstance(f, _AliasFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _AliasFinder())

sys.modules[_OLD] = importlib.import_module(_NEW)
