import httpx2
from tenacity import AsyncRetrying, Retrying

from openjev import AsyncTypeSafeClient, SystemOneResponse, TypeSafeClient
from openjev._core.config import Config
from openjev._core.endpoints import prepare_models
from openjev._core.transport import send, send_async


def wrong_sync_response(config: Config, http_client: httpx2.Client, retry: Retrying) -> SystemOneResponse:
    return send(http_client, retry, prepare_models(config, None, None))  # E: is not assignable to declared return type


async def wrong_async_response(config: Config, http_client: httpx2.AsyncClient, retry: AsyncRetrying) -> SystemOneResponse:
    return await send_async(http_client, retry, prepare_models(config, None, None))  # E: is not assignable to declared return type


def wrong_sync_client_response(config: Config, client: TypeSafeClient) -> SystemOneResponse:
    return client._request(prepare_models(config, None, None))  # E: is not assignable to declared return type


async def wrong_async_client_response(config: Config, client: AsyncTypeSafeClient) -> SystemOneResponse:
    return await client._request(prepare_models(config, None, None))  # E: is not assignable to declared return type
