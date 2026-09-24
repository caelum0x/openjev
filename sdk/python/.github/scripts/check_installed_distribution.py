"""Check an installed SDK distribution."""

import asyncio
import sys
from importlib.metadata import version

import openjev
from openjev import AsyncTypeSafeClient, TypeSafeClient


async def main() -> None:
    """Check the installed version and initialize both clients."""
    if version("openjev") != sys.argv[1]:
        raise RuntimeError("Installed distribution version does not match the release")
    if openjev.__version__ != sys.argv[1]:
        raise RuntimeError("Exported SDK version does not match the release")
    with TypeSafeClient(api_key="release-smoke-test"):
        pass
    async with AsyncTypeSafeClient(api_key="release-smoke-test"):
        pass


if __name__ == "__main__":
    asyncio.run(main())
