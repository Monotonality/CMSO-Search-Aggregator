"""
2026 MSI Hackathon AI compliance helpers.

See: 2026 Hackathon AI Guidance.md (local Ollama/LM Studio; approved model families;
no cloud consumer LLMs; cleanup after the event).
"""

from __future__ import annotations

import os
import re
from typing import Any

GUIDANCE_DOC = "2026 Hackathon AI Guidance.md"

# Approved local SLM default (Gemma family, <=9B). Pull: ollama pull gemma3:4b
DEFAULT_OLLAMA_MODEL = "gemma3:4b"


def configured_ollama_model() -> str:
    return (
        os.environ.get("OLLAMA_VOICE_MODEL")
        or os.environ.get("OLLAMA_MODEL")
        or DEFAULT_OLLAMA_MODEL
    ).strip()

APPROVED_TOOLING = ("Ollama", "LM Studio")

ALLOWED_FAMILY_HINTS = (
    "llama",
    "mistral",
    "mixtral",
    "phi",
    "gemma",
)

PROHIBITED_NAME_FRAGMENTS = (
    "qwen",
    "deepseek",
    "grok",
    "openclaw",
    "chatgpt",
    "gpt-4",
    "gpt-3",
    "gpt4",
    "gpt3",
    "claude",
    "perplexity",
    "otter",
    "fireflies",
    "fellow",
    "workbeaver",
    "openai",
    "anthropic",
    "cohere",
)

# Cloud / remote inference (not local storage per hackathon guidance)
_CLOUD_RE = re.compile(r"(?:^|:|-)cloud(?:$|:|-)|-cloud\b", re.I)

# Rough size guard: prefer <=9B per hackathon guidance
_SIZE_RE = re.compile(r":(\d{1,3})b\b", re.I)


def hackathon_strict() -> bool:
    """When true (default), block non-compliant LLM models and FastEmbed."""
    return os.environ.get("HACKATHON_STRICT", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def fastembed_allowed() -> bool:
    if hackathon_strict():
        return False
    return os.getenv("USE_FASTEMBED", "").lower() in ("1", "true", "yes")


def _normalized_model_name(model: str) -> str:
    return model.strip().lower().split("@", 1)[0]


def validate_ollama_model(model: str) -> dict[str, Any]:
    """
    Return {ok, model, reasons[], recommended} for hackathon LLM use via Ollama.
    """
    raw = (model or "").strip()
    if not raw:
        return {
            "ok": False,
            "model": raw,
            "reasons": ["No Ollama model configured."],
            "recommended": DEFAULT_OLLAMA_MODEL,
        }

    name = _normalized_model_name(raw)
    reasons: list[str] = []

    for frag in PROHIBITED_NAME_FRAGMENTS:
        if frag in name:
            reasons.append(
                f'Prohibited for hackathon: model name contains "{frag}".'
            )
            break

    if _CLOUD_RE.search(name):
        reasons.append(
            "Cloud or remote Ollama models are not allowed; use a locally pulled model only."
        )

    if not any(fam in name for fam in ALLOWED_FAMILY_HINTS):
        reasons.append(
            "Model must be from an approved family: Llama, Mistral/Mixtral, Phi, or Gemma."
        )

    size_match = _SIZE_RE.search(name)
    if size_match:
        try:
            billions = int(size_match.group(1))
            if billions > 9:
                reasons.append(
                    f"Parameter size :{billions}b exceeds the hackathon recommendation (<=9B)."
                )
        except ValueError:
            pass

    if re.search(r"(?:^|[:-])(?:ft|finetune|merge|uncensored|abliterate)", name):
        reasons.append(
            "Avoid community fine-tuned, merged, or modified models for the hackathon."
        )

    return {
        "ok": len(reasons) == 0,
        "model": raw,
        "reasons": reasons,
        "recommended": DEFAULT_OLLAMA_MODEL,
    }


def filter_compliant_models(names: list[str]) -> list[str]:
    out: list[str] = []
    for n in names:
        if validate_ollama_model(n)["ok"]:
            out.append(n)
    return out


def pick_suggested_model(configured: str, names: list[str]) -> str | None:
    compliant = filter_compliant_models(names)
    if not compliant:
        return None
    cfg = configured.strip().lower()
    for n in compliant:
        if n.strip().lower() == cfg:
            return n
    prefs = (
        DEFAULT_OLLAMA_MODEL.lower(),
        "gemma3:4b",
        "llama3.2:3b",
        "phi3:mini",
        "gemma2:2b",
        "mistral:7b",
    )
    lower_map = {n.lower(): n for n in compliant}
    for pref in prefs:
        if pref in lower_map:
            return lower_map[pref]
        for n in compliant:
            if pref.split(":")[0] in n.lower():
                return n
    return compliant[0]


def compliance_summary() -> dict[str, Any]:
    return {
        "hackathon_strict": hackathon_strict(),
        "guidance_doc": GUIDANCE_DOC,
        "approved_llm_tooling": list(APPROVED_TOOLING),
        "approved_model_families": [
            "Llama (Meta)",
            "Mistral/Mixtral",
            "Phi (Microsoft)",
            "Gemma (Google)",
        ],
        "default_ollama_model": DEFAULT_OLLAMA_MODEL,
        "search_vectors": "tfidf-sklearn (local, no generative AI)",
        "fastembed_allowed": fastembed_allowed(),
        "voice_llm": "optional; local Ollama only when enabled",
        "cleanup_required": True,
        "cleanup_note": (
            "After the hackathon, remove pulled Ollama models from MSI devices and "
            "complete AI Hub / AI Eval if the project continues."
        ),
    }
