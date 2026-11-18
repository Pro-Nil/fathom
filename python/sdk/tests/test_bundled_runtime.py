"""Keyless boot tests for the production exe and development node carrier.

Each carrier skips independently when absent. The dummy API key only satisfies
adapter loading; initialize and shutdown do not call a model.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pentest_harness import PentestHarness, HarnessClient, HarnessConfig
from pentest_harness.errors import TransportClosedError
from pentest_harness_runtime import resolve_bundled_launch_args

_MODES = ("exe", "node")
_REPO_ROOT = Path(__file__).parents[3]
_MINIMAL_CONFIG = _REPO_ROOT / "examples" / "jsonrpc-agent" / "minimal.cordis.yml"

# The config must include the JSON-RPC serving plugin.
_CORDIS_YML = """\
- id: sdk-jsonrpc-server
  name: '@pentest-harness/dsh-sdk-jsonrpc-server'
- id: agent-core
  name: '@pentest-harness/dsh-agent-spine-demo'
  config:
    workspaceContext: false
- id: sessions
  name: '@pentest-harness/dsh-session-persistence-jsonl'
  config:
    root: './sessions'
- id: session-checkpoints
  name: '@pentest-harness/dsh-session-checkpoint-policy'
- id: subprocess
  name: '@pentest-harness/dsh-subprocess-local'
- id: bash
  name: '@pentest-harness/dsh-bash-local'
  config:
    cwd: '.'
- id: todo
  name: '@pentest-harness/dsh-tool-todo'
  config:
    allowParallelInProgress: true
"""


def _launch_args(mode: str) -> tuple[str, ...]:
    try:
        return resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")


def _client(tmp_path: Path, launch_args: tuple[str, ...]) -> HarnessClient:
    return HarnessClient(
        HarnessConfig(
            launch_args_override=launch_args,
            cwd=str(tmp_path),
            env={
                "DSH_CORDIS_CONFIG": "./cordis.yml",
                "DSH_SESSION_ROOT": str(tmp_path / "sessions"),
                "DSH_CWD": str(tmp_path),
                # The lazily mounted adapter requires a key even without a model call.
                "LLM_API_KEY": "sk-dummy-for-boot",
                "LLM_BASE_URL": "http://127.0.0.1:9",
            },
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_boots_a_cordis_config(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(_CORDIS_YML)

    with _client(tmp_path, launch_args) as client:
        init = client.initialize(provider="openai-compatible", cwd=str(tmp_path), model="gpt-5.5-pro")

    assert init.serverInfo is not None
    assert init.serverInfo.name == "pentest-harness-sdk-runtime"


@pytest.mark.parametrize("mode", _MODES)
def test_python_sdk_boots_minimal_jsonrpc_config(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    model = "minimal-environment-model"
    harness = PentestHarness(
        model=model,
        cwd=str(tmp_path),
        session_root=str(tmp_path / "sessions"),
        cordis=str(_MINIMAL_CONFIG),
        env={
            "DSH_MODEL": model,
            "DSH_CONTEXT_WINDOW": "1000000",
            "DSH_SYSTEM_PROMPT": "You are the Python SDK minimal boot test agent.",
        },
        api_key="sk-dummy-for-boot",
        base_url="http://127.0.0.1:9",
        launch_args_override=launch_args,
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_surfaces_unbundled_plugin_failure(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(
        "- id: missing\n  name: '@pentest-harness/dsh-does-not-exist'\n"
    )

    client = _client(tmp_path, launch_args)
    client.start()
    try:
        with pytest.raises((TransportClosedError, TimeoutError)) as excinfo:
            client.initialize(provider="openai-compatible", cwd=str(tmp_path), model="gpt-5.5-pro")
    finally:
        client.close()

    assert "@pentest-harness/dsh-does-not-exist" in str(excinfo.value)


@pytest.mark.parametrize("mode", _MODES)
@pytest.mark.parametrize("ambient_config", [None, ""], ids=["unset", "empty-counts-as-absent"])
def test_zero_config_run_injects_bundled_default_cordis_config(
    tmp_path: Path, mode: str, ambient_config: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _launch_args(mode)  # skip early when this carrier is unavailable
    monkeypatch.setenv("DSH_RUNTIME_MODE", mode)
    if ambient_config is None:
        monkeypatch.delenv("DSH_CORDIS_CONFIG", raising=False)
    else:
        monkeypatch.setenv("DSH_CORDIS_CONFIG", ambient_config)

    harness = PentestHarness(
        model="gpt-5.5-pro",
        cwd=str(tmp_path),
        session_root=str(tmp_path / "sessions"),
        api_key="sk-dummy-for-boot",
        base_url="http://127.0.0.1:9",
        request_timeout_seconds=120,
    )
    with harness:
        pass
