"""openjev ``otsone`` — public API for the typed-decision model toolkit.

``otsone-1`` (family ``openjev``) is the flagship model trained and served
by this project. The inference engine lives in the internal :mod:`laya_mlx`
package, which keeps its name because it is the Laya-derived (Convai,
Apache-2.0) architecture that ``otsone-1`` is built on. This top-level package
re-exports that public API so ``import otsone`` works::

    import otsone
    agent = otsone.load("...")

The runnable entry points are ``otsone`` (CLI) and ``otsone-serve`` (HTTP
sidecar); ``laya-mlx`` / ``laya-serve`` remain as backward-compatible aliases.
"""

from laya_mlx import *  # noqa: F401,F403 -- re-export the engine's public API
from laya_mlx import __all__, __version__  # noqa: F401
